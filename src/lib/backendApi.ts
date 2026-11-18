import { SensorData } from './serial';
import { DifferentialAnalysisResult, analyzeTremorDifferential, downsampleTelemetry } from './tremorAnalyzer';

export interface BackendHealthStatus {
  status: 'healthy' | 'degraded';
  version: string;
  uptimeSec: number;
  security: {
    cspActive: boolean;
    hstsPreload: boolean;
    rateLimiterActive: boolean;
    rateLimitPerMin: number;
    hmacSigningActive: boolean;
    lttbDownsamplingActive: boolean;
  };
  scalability: {
    activeIpBuckets: number;
    totalApiRequests: number;
    totalBlockedRequests: number;
    totalVerifiedSessions: number;
    heapUsedMb: number;
  };
}

export interface VerifiedSessionResponse {
  verified: boolean;
  sessionId: string;
  rawSampleCount: number;
  compressedSampleCount: number;
  compressionRatio: number;
  integrityHash: string;
  verifiedAt: string;
  analysis: DifferentialAnalysisResult;
  compressedData: SensorData[];
}

export async function fetchBackendHealth(): Promise<BackendHealthStatus | null> {
  try {
    const res = await fetch('/api/v1/health', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function verifyAndCompressSession(params: {
  sessionId: string;
  data: SensorData[];
  deviceType: 'mobile' | 'pen';
  sensitivityMultiplier: number;
  maxStoragePoints?: number;
}): Promise<VerifiedSessionResponse> {
  try {
    const res = await fetch('/api/v1/analyze-biomarkers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Fallback to deterministic local computation if offline
  }

  const analysis = analyzeTremorDifferential(
    params.data,
    params.deviceType,
    params.sensitivityMultiplier
  );
  const compressedData = downsampleTelemetry(params.data, params.maxStoragePoints || 350);
  return {
    verified: false,
    sessionId: params.sessionId,
    rawSampleCount: params.data.length,
    compressedSampleCount: compressedData.length,
    compressionRatio: Number((params.data.length / Math.max(1, compressedData.length)).toFixed(2)),
    integrityHash: `local-${params.sessionId.slice(0, 12)}`,
    verifiedAt: new Date().toISOString(),
    analysis,
    compressedData,
  };
}
