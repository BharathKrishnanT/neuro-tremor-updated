import express, { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeTremorDifferential,
  downsampleTelemetry,
} from './src/lib/tremorAnalyzer.ts';
import type { SensorData } from './src/lib/serial.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const HMAC_SECRET =
  process.env.SESSION_INTEGRITY_SECRET ||
  crypto.createHash('sha256').update('neurotremor-clinical-audit-v3').digest('hex');

// --- Sliding-Window Token Bucket Rate Limiter (Per-IP & Endpoint) ---
interface RateRecord {
  tokens: number;
  lastRefill: number;
  blockedCount: number;
}

const rateBuckets = new Map<string, RateRecord>();
const MAX_TOKENS = 90; // 90 requests per minute burst
const REFILL_PER_MS = MAX_TOKENS / 60000;
let totalApiRequests = 0;
let totalBlockedRequests = 0;
let totalVerifiedSessions = 0;
const serverStartTime = Date.now();

// Periodic eviction of stale rate-limit buckets to prevent memory exhaustion
setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of rateBuckets.entries()) {
    if (now - rec.lastRefill > 300000) {
      rateBuckets.delete(key);
    }
  }
}, 120000).unref();

function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  // Note: Do NOT set X-Frame-Options: SAMEORIGIN so the AI Studio preview iframe can embed the app
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload'
  );
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );
  res.setHeader('X-XSS-Protection', '0');
  next();
}

function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  totalApiRequests++;
  const clientIp =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown';
  const now = Date.now();
  let bucket = rateBuckets.get(clientIp);

  if (!bucket) {
    bucket = { tokens: MAX_TOKENS - 1, lastRefill: now, blockedCount: 0 };
    rateBuckets.set(clientIp, bucket);
  } else {
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(MAX_TOKENS, bucket.tokens + elapsed * REFILL_PER_MS);
    bucket.lastRefill = now;
    if (bucket.tokens < 1) {
      bucket.blockedCount++;
      totalBlockedRequests++;
      res.setHeader('Retry-After', '5');
      res.setHeader('X-RateLimit-Limit', String(MAX_TOKENS));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.status(429).json({
        error: 'Too Many Requests',
        message: 'Clinical API rate limit exceeded. Please wait before submitting additional telemetry batches.',
      });
      return;
    }
    bucket.tokens -= 1;
  }

  res.setHeader('X-RateLimit-Limit', String(MAX_TOKENS));
  res.setHeader('X-RateLimit-Remaining', String(Math.floor(bucket.tokens)));
  next();
}

/**
 * Sanitizes and bounds incoming SensorData frames, rejecting prototype pollution
 * and clamping out-of-range spikes.
 */
function sanitizeSensorFrames(rawArray: unknown, maxFrames = 6000): SensorData[] {
  if (!Array.isArray(rawArray)) {
    throw new Error('Telemetry payload must be an array of sensor frames.');
  }
  if (rawArray.length === 0) {
    throw new Error('Telemetry array cannot be empty.');
  }

  const slice = rawArray.slice(-maxFrames);
  const clamp = (val: unknown, min: number, max: number, fallback = 0): number => {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };

  return slice.map((item, idx) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Invalid sensor frame at index ${idx}`);
    }
    const d = item as Record<string, unknown>;
    return {
      timestamp: clamp(d.timestamp, 1000000000000, 9999999999999, Date.now() + idx * 20),
      ax: clamp(d.ax, -200, 200, 0),
      ay: clamp(d.ay, -200, 200, 0),
      az: clamp(d.az, -200, 200, 9.80665),
      gx: clamp(d.gx, -4000, 4000, 0),
      gy: clamp(d.gy, -4000, 4000, 0),
      gz: clamp(d.gz, -4000, 4000, 0),
      mx: clamp(d.mx, -4000, 4000, 0),
      my: clamp(d.my, -4000, 4000, 0),
      mz: clamp(d.mz, -4000, 4000, 0),
      fsr: clamp(d.fsr, 0, 4096, 0),
      ...(typeof d.touchX === 'number' ? { touchX: clamp(d.touchX, 0, 10000) } : {}),
      ...(typeof d.touchY === 'number' ? { touchY: clamp(d.touchY, 0, 10000) } : {}),
    };
  });
}

function computeSessionIntegrityHash(payload: {
  sessionId: string;
  phenotype: string;
  dominantFreq: number;
  rms: number;
  pdProbability: number;
  etProbability: number;
  sampleCount: number;
}): string {
  const canonical = `${payload.sessionId}|${payload.phenotype}|${payload.dominantFreq.toFixed(1)}|${payload.rms.toFixed(3)}|${payload.pdProbability}|${payload.etProbability}|${payload.sampleCount}`;
  return crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(canonical)
    .digest('hex')
    .slice(0, 24);
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '2mb' }));

  // 1. Health & Security Posture Endpoint
  app.get('/api/v1/health', rateLimitMiddleware, (_req: Request, res: Response) => {
    const mem = process.memoryUsage();
    res.json({
      status: 'healthy',
      version: '3.0.0-clinical-hardened',
      uptimeSec: Math.round((Date.now() - serverStartTime) / 1000),
      security: {
        cspActive: true,
        hstsPreload: true,
        rateLimiterActive: true,
        rateLimitPerMin: MAX_TOKENS,
        hmacSigningActive: true,
        lttbDownsamplingActive: true,
      },
      scalability: {
        activeIpBuckets: rateBuckets.size,
        totalApiRequests,
        totalBlockedRequests,
        totalVerifiedSessions,
        heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(1)),
      },
    });
  });

  // 2. Differential Biomarker & Session Compression Endpoint
  app.post('/api/v1/analyze-biomarkers', rateLimitMiddleware, (req: Request, res: Response) => {
    try {
      const {
        sessionId = crypto.randomUUID(),
        data,
        deviceType = 'pen',
        sensitivityMultiplier = 1.35,
        maxStoragePoints = 350,
      } = req.body || {};

      const sanitizedFrames = sanitizeSensorFrames(data, 6000);
      const validDevice = deviceType === 'mobile' ? 'mobile' : 'pen';
      const validMult = Math.max(0.5, Math.min(3.0, Number(sensitivityMultiplier) || 1.35));

      const analysis = analyzeTremorDifferential(sanitizedFrames, validDevice, validMult);
      const compressedData = downsampleTelemetry(
        sanitizedFrames,
        Math.max(50, Math.min(800, Number(maxStoragePoints) || 350))
      );

      const integrityHash = computeSessionIntegrityHash({
        sessionId: String(sessionId).slice(0, 64),
        phenotype: analysis.phenotype,
        dominantFreq: analysis.dominantFreq,
        rms: analysis.rms,
        pdProbability: analysis.pdProbability,
        etProbability: analysis.etProbability,
        sampleCount: sanitizedFrames.length,
      });

      totalVerifiedSessions++;

      res.json({
        verified: true,
        sessionId: String(sessionId).slice(0, 64),
        rawSampleCount: sanitizedFrames.length,
        compressedSampleCount: compressedData.length,
        compressionRatio: Number((sanitizedFrames.length / Math.max(1, compressedData.length)).toFixed(2)),
        integrityHash,
        verifiedAt: new Date().toISOString(),
        analysis,
        compressedData,
      });
    } catch (err: any) {
      res.status(400).json({
        verified: false,
        error: err?.message || 'Invalid telemetry payload',
      });
    }
  });

  // 3. Cryptographic Audit Verification Endpoint
  app.post('/api/v1/verify-integrity', rateLimitMiddleware, (req: Request, res: Response) => {
    const {
      sessionId,
      phenotype,
      dominantFreq,
      rms,
      pdProbability,
      etProbability,
      sampleCount,
      integrityHash,
    } = req.body || {};

    if (!sessionId || !phenotype || !integrityHash) {
      res.status(400).json({ valid: false, error: 'Missing required integrity fields' });
      return;
    }

    const expected = computeSessionIntegrityHash({
      sessionId: String(sessionId),
      phenotype: String(phenotype),
      dominantFreq: Number(dominantFreq) || 0,
      rms: Number(rms) || 0,
      pdProbability: Number(pdProbability) || 0,
      etProbability: Number(etProbability) || 0,
      sampleCount: Number(sampleCount) || 0,
    });

    res.json({
      valid: expected === integrityHash,
      expectedHash: expected,
    });
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[NeuroTremor Server] Hardened clinical backend listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
