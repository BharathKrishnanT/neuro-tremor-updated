import { SensorData, enrichSensorFrame } from './serial';
import { SimulationProfile, generateSimulatedSample } from './tremorAnalyzer';
import type { CanvasDrawMode, DrawingStroke } from '../components/TouchPadCanvas';

export interface RawDigitizerSample {
  tMs: number;
  x: number;
  y: number;
  pressure: number;
  penDown: 0 | 1;
  mode: CanvasDrawMode;
  canvasWidth: number;
  canvasHeight: number;
}

export interface FusedMatrixRow {
  t: number; // seconds from t = 0 (5 ms increments at 200 Hz)
  x: number;
  y: number;
  vx: number; // px/s
  vy: number; // px/s
  speed: number; // px/s magnitude
  radialError: number; // px deviation from Archimedes spiral template (or local path drift)
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  mx: number;
  my: number;
  mz: number;
  fsr: number;
  penDown: 0 | 1;
}

export interface PhaseTremorMetrics {
  dominantFreqHz: number;
  rmsG: number;
  rmsMs2: number;
  pd4to6Share: number; // 0..100%
  kinetic5to10Share: number; // 0..100%
  sampleCount: number;
  durationSec: number;
  windowCount: number;
}

export interface RigidityCouplingEvent {
  tSec: number;
  fsr: number;
  baselineFsr: number;
  speed: number;
  speedDropPct: number;
  radialErrorPx: number;
}

export interface FusionTimelinePoint {
  tSec: number;
  fsr: number;
  speed: number;
  radialError: number;
  penDown: 0 | 1;
  isRigiditySpike: boolean;
}

export interface FusionFftBin {
  freqHz: number;
  inAirPower: number;
  onPaperPower: number;
}

export interface MultimodalFusionResult {
  sampleRateHz: number;
  durationSec: number;
  totalMatrixRows: number;
  canvasMode: CanvasDrawMode;
  inAirDurationSec: number;
  onPaperDurationSec: number;
  penDownRatioPct: number;
  inAirTremor: PhaseTremorMetrics;
  onPaperTremor: PhaseTremorMetrics;
  globalMotor: {
    micrographiaDecayPct: number; // Positive = progressive shrinkage across trial
    progressiveSlowingPct: number; // Positive = late velocity slower than early velocity
    meanVelocityPxS: number;
    earlyVelocityPxS: number;
    lateVelocityPxS: number;
    meanRadialErrorPx: number;
    rmsRadialErrorPx: number;
    strokeCount: number;
  };
  rigidityCoupling: {
    fsrVelocityCorrelation: number; // Pearson r (-1..+1; negative indicates rigidity spikes slow strokes)
    coupledSpikeCount: number;
    meanOnPaperFsr: number;
    meanInAirFsr: number;
    peakFsr: number;
    rigidityEvents: RigidityCouplingEvent[];
  };
  timelineSeries: FusionTimelinePoint[];
  fftComparisonSeries: FusionFftBin[];
  fusionClinicalSummary: string;
}

export interface MultimodalFusionOutput {
  summary: MultimodalFusionResult;
  matrix: FusedMatrixRow[];
}

export const FUSION_SAMPLE_RATE_HZ = 200;
export const FUSION_DT_SEC = 1 / FUSION_SAMPLE_RATE_HZ; // 0.005 s (5 ms)

/**
 * Exact radial distance (px) from point (x, y) to the closest turn of the
 * Archimedes spiral template rendered by TouchPadCanvas:
 *   x(theta) = cx + (1 + theta) * cos(theta) * scale
 *   y(theta) = cy + (1 + theta) * sin(theta) * scale,  theta in [0, 50)
 */
export function computeArchimedesRadialError(
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number
): number {
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);
  const scale = canvasWidth > 1000 ? 8 : 5;

  let phi = Math.atan2(dy, dx);
  if (phi < 0) phi += Math.PI * 2;

  // Estimate nearest winding k such that r ≈ (1 + phi + 2*pi*k) * scale
  const approxK = Math.round((r / scale - 1 - phi) / (Math.PI * 2));
  let minErr = Infinity;
  for (let k = Math.max(0, approxK - 1); k <= Math.max(0, approxK + 1); k++) {
    const theta = phi + k * Math.PI * 2;
    if (theta < 0 || theta > 50) continue;
    const expectedR = (1 + theta) * scale;
    const err = Math.abs(r - expectedR);
    if (err < minErr) minErr = err;
  }

  if (!Number.isFinite(minErr)) {
    // Fallback to outer/inner bound distance
    return Number(Math.abs(r - scale).toFixed(2));
  }
  return Number(minErr.toFixed(2));
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

/**
 * Synchronizes raw timestamped IMU/FSR packets and digitizer pointer events onto
 * a uniform 200 Hz (5 ms) multichannel matrix anchored at t = 0.
 */
export function resampleTo200HzMatrix(
  rawSensors: SensorData[],
  rawDigitizer: RawDigitizerSample[],
  t0Ms: number,
  durationMs: number,
  canvasMode: CanvasDrawMode = 'spiral',
  canvasWidth = 800,
  canvasHeight = 320
): FusedMatrixRow[] {
  const safeDurationMs = Math.max(200, Math.min(durationMs, 120000));
  const rowCount = Math.max(40, Math.floor((safeDurationMs / 1000) * FUSION_SAMPLE_RATE_HZ) + 1);

  const sortedSensors = [...rawSensors]
    .map((s) => enrichSensorFrame(s))
    .sort((a, b) => a.timestamp - b.timestamp);

  const sortedDig = [...rawDigitizer].sort((a, b) => a.tMs - b.tMs);

  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;

  const rows: FusedMatrixRow[] = new Array(rowCount);
  let sIdx = 0;
  let dIdx = 0;

  for (let i = 0; i < rowCount; i++) {
    const tSec = i * FUSION_DT_SEC;
    const targetMs = t0Ms + tSec * 1000;

    // 1. Piecewise-linear interpolation of 9-axis IMU + FSR
    let ax = 0,
      ay = 0,
      az = 9.80665,
      gx = 0,
      gy = 0,
      gz = 0,
      mx = 28.5,
      my = -12.4,
      mz = 36.2,
      fsr = 0;
    let fallbackTouchX: number | undefined;
    let fallbackTouchY: number | undefined;

    if (sortedSensors.length > 0) {
      while (sIdx < sortedSensors.length - 2 && sortedSensors[sIdx + 1].timestamp < targetMs) {
        sIdx++;
      }
      const s0 = sortedSensors[sIdx];
      const s1 = sortedSensors[Math.min(sIdx + 1, sortedSensors.length - 1)];
      const span = s1.timestamp - s0.timestamp;
      const alpha = span > 0 ? Math.max(0, Math.min(1, (targetMs - s0.timestamp) / span)) : 0;

      ax = lerp(s0.ax, s1.ax, alpha);
      ay = lerp(s0.ay, s1.ay, alpha);
      az = lerp(s0.az, s1.az, alpha);
      gx = lerp(s0.gx, s1.gx, alpha);
      gy = lerp(s0.gy, s1.gy, alpha);
      gz = lerp(s0.gz, s1.gz, alpha);
      mx = lerp(s0.mx, s1.mx, alpha);
      my = lerp(s0.my, s1.my, alpha);
      mz = lerp(s0.mz, s1.mz, alpha);
      fsr = lerp(s0.fsr, s1.fsr, alpha);
      if (typeof s0.touchX === 'number' && typeof s0.touchY === 'number') {
        fallbackTouchX =
          typeof s1.touchX === 'number' ? lerp(s0.touchX, s1.touchX, alpha) : s0.touchX;
        fallbackTouchY =
          typeof s1.touchY === 'number' ? lerp(s0.touchY, s1.touchY, alpha) : s0.touchY;
      }
    }

    // 2. Piecewise-linear interpolation of (x, y) + zero-order hold for penDown
    let x = fallbackTouchX ?? cx;
    let y = fallbackTouchY ?? cy;
    let penDown: 0 | 1 = 0;

    if (sortedDig.length > 0) {
      while (dIdx < sortedDig.length - 1 && sortedDig[dIdx + 1].tMs <= targetMs) {
        dIdx++;
      }
      const d0 = sortedDig[dIdx];
      const d1 = sortedDig[Math.min(dIdx + 1, sortedDig.length - 1)];

      if (targetMs < sortedDig[0].tMs) {
        x = sortedDig[0].x;
        y = sortedDig[0].y;
        penDown = 0;
      } else if (d0.penDown === 1 && d1.penDown === 1 && d1.tMs > d0.tMs && d1.tMs - d0.tMs <= 160) {
        const alpha = Math.max(0, Math.min(1, (targetMs - d0.tMs) / (d1.tMs - d0.tMs)));
        x = lerp(d0.x, d1.x, alpha);
        y = lerp(d0.y, d1.y, alpha);
        penDown = 1;
        // Blend pointer pressure when FSR hardware is absent
        if (fsr < 5 && d0.pressure > 0) {
          fsr = lerp(d0.pressure, d1.pressure, alpha);
        }
      } else {
        x = d0.x;
        y = d0.y;
        // If sample is stale beyond 180ms after the last pointer event without a pen_up, consider lifted
        const ageMs = targetMs - d0.tMs;
        penDown = d0.penDown === 1 && ageMs <= 180 ? 1 : 0;
        if (penDown === 1 && fsr < 5 && d0.pressure > 0) {
          fsr = d0.pressure;
        }
      }
    }

    const radialError =
      penDown === 1
        ? canvasMode === 'spiral'
          ? computeArchimedesRadialError(x, y, canvasWidth, canvasHeight)
          : 0
        : 0;

    rows[i] = {
      t: Number(tSec.toFixed(4)),
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      vx: 0,
      vy: 0,
      speed: 0,
      radialError,
      ax: Number(ax.toFixed(4)),
      ay: Number(ay.toFixed(4)),
      az: Number(az.toFixed(4)),
      gx: Number(gx.toFixed(3)),
      gy: Number(gy.toFixed(3)),
      gz: Number(gz.toFixed(3)),
      mx: Number(mx.toFixed(3)),
      my: Number(my.toFixed(3)),
      mz: Number(mz.toFixed(3)),
      fsr: Number(Math.max(0, fsr).toFixed(1)),
      penDown,
    };
  }

  // 3. Smoothed central-difference velocity (window ±25 ms = ±5 ticks at 200 Hz)
  const halfWin = 5;
  const spanSec = (halfWin * 2) * FUSION_DT_SEC; // 0.05 s
  for (let i = 0; i < rowCount; i++) {
    if (rows[i].penDown === 0) {
      rows[i].vx = 0;
      rows[i].vy = 0;
      rows[i].speed = 0;
      continue;
    }
    const left = Math.max(0, i - halfWin);
    const right = Math.min(rowCount - 1, i + halfWin);
    if (rows[left].penDown === 1 && rows[right].penDown === 1 && right > left) {
      const dt = (right - left) * FUSION_DT_SEC;
      const vx = (rows[right].x - rows[left].x) / (dt || spanSec);
      const vy = (rows[right].y - rows[left].y) / (dt || spanSec);
      const speed = Math.hypot(vx, vy);
      rows[i].vx = Number(vx.toFixed(2));
      rows[i].vy = Number(vy.toFixed(2));
      rows[i].speed = Number(speed.toFixed(2));
    }
  }

  // 4. For Free-Draw mode, compute local curvature/path jitter as radialError proxy
  if (canvasMode === 'freedraw') {
    const smoothSpan = 10; // ±50 ms baseline path chord
    for (let i = smoothSpan; i < rowCount - smoothSpan; i++) {
      if (
        rows[i].penDown === 1 &&
        rows[i - smoothSpan].penDown === 1 &&
        rows[i + smoothSpan].penDown === 1
      ) {
        const midX = (rows[i - smoothSpan].x + rows[i + smoothSpan].x) / 2;
        const midY = (rows[i - smoothSpan].y + rows[i + smoothSpan].y) / 2;
        rows[i].radialError = Number(Math.hypot(rows[i].x - midX, rows[i].y - midY).toFixed(2));
      }
    }
  }

  return rows;
}

/**
 * Computes 2–4 second Hann-windowed Welch PSD (0.5–14.0 Hz in 0.5 Hz bins)
 * strictly over contiguous segments matching targetPenDown (0 = In-Air, 1 = On-Paper).
 */
export function computePhaseWelchSpectrum(
  rows: FusedMatrixRow[],
  targetPenDown: 0 | 1
): { metrics: PhaseTremorMetrics; spectrum: Array<{ freqHz: number; power: number }> } {
  const freqGrid: number[] = [];
  for (let f = 0.5; f <= 14.0001; f += 0.5) {
    freqGrid.push(Number(f.toFixed(1)));
  }

  // Extract contiguous runs matching targetPenDown
  const segments: FusedMatrixRow[][] = [];
  let current: FusedMatrixRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].penDown === targetPenDown) {
      current.push(rows[i]);
    } else if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length > 0) segments.push(current);

  const allPhaseSamples = segments.reduce((acc, seg) => acc + seg.length, 0);
  const durationSec = Number((allPhaseSamples * FUSION_DT_SEC).toFixed(2));

  if (allPhaseSamples < 40) {
    return {
      metrics: {
        dominantFreqHz: 0,
        rmsG: 0,
        rmsMs2: 0,
        pd4to6Share: 0,
        kinetic5to10Share: 0,
        sampleCount: allPhaseSamples,
        durationSec,
        windowCount: 0,
      },
      spectrum: freqGrid.map((f) => ({ freqHz: f, power: 0 })),
    };
  }

  // Compute dynamic acceleration magnitude for each window (2.56s–4.0s = 512–800 samples at 200 Hz, fallback to segment length >= 64)
  const powerAccum = new Float64Array(freqGrid.length);
  let windowCount = 0;
  let totalRmsSq = 0;
  let totalRmsSamples = 0;

  for (const seg of segments) {
    if (seg.length < 40) continue;

    // 3-axis mean-removed linear acceleration signal for this segment
    let meanAx = 0,
      meanAy = 0,
      meanAz = 0;
    for (let i = 0; i < seg.length; i++) {
      meanAx += seg[i].ax;
      meanAy += seg[i].ay;
      meanAz += seg[i].az;
    }
    meanAx /= seg.length;
    meanAy /= seg.length;
    meanAz /= seg.length;

    const sig = new Float64Array(seg.length);
    for (let i = 0; i < seg.length; i++) {
      const dax = seg[i].ax - meanAx;
      const day = seg[i].ay - meanAy;
      const daz = seg[i].az - meanAz;
      const magSq = dax * dax + day * day + daz * daz;
      totalRmsSq += magSq;
      totalRmsSamples++;
      // Signed projection along principal tremor axis preserves sinusoidal zero-crossings for clean DFT peak
      sig[i] = dax + day + daz;
    }

    // Choose 2–4 second window (512 or 600 samples at 200 Hz) if segment allows; else full segment
    const winLen = seg.length >= 600 ? 600 : seg.length >= 400 ? 400 : seg.length;
    const hop = Math.max(100, Math.floor(winLen / 2));

    for (let start = 0; start <= seg.length - winLen; start += hop) {
      let winMean = 0;
      for (let j = 0; j < winLen; j++) winMean += sig[start + j];
      winMean /= winLen;

      // Apply Hann window and evaluate DFT at exact 0.5 Hz grid points
      for (let b = 0; b < freqGrid.length; b++) {
        const f = freqGrid[b];
        const omega = (2 * Math.PI * f) / FUSION_SAMPLE_RATE_HZ;
        let re = 0;
        let im = 0;
        for (let j = 0; j < winLen; j++) {
          const hann = 0.5 * (1 - Math.cos((2 * Math.PI * j) / Math.max(1, winLen - 1)));
          const val = (sig[start + j] - winMean) * hann;
          const angle = omega * j;
          re += val * Math.cos(angle);
          im -= val * Math.sin(angle);
        }
        const psd = (re * re + im * im) / (winLen * winLen);
        powerAccum[b] += psd;
      }
      windowCount++;
      if (start + winLen >= seg.length) break;
    }
  }

  const rmsMs2 = totalRmsSamples > 0 ? Math.sqrt(totalRmsSq / totalRmsSamples) : 0;
  const rmsG = rmsMs2 / 9.80665;

  const spectrum: Array<{ freqHz: number; power: number }> = [];
  let maxPower = 0;
  let dominantFreqHz = 0;
  let totalBandPower = 0;
  let pd4to6Power = 0;
  let kinetic5to10Power = 0;

  for (let b = 0; b < freqGrid.length; b++) {
    const avgPower = windowCount > 0 ? powerAccum[b] / windowCount : 0;
    const f = freqGrid[b];
    // Scale PSD into clean readable clinical spectral units
    const scaled = Number((Math.sqrt(avgPower) * 4.0).toFixed(3));
    spectrum.push({ freqHz: f, power: scaled });

    if (f >= 2.0 && f <= 13.0) {
      totalBandPower += avgPower;
      if (f >= 4.0 && f <= 6.0) pd4to6Power += avgPower;
      if (f >= 5.0 && f <= 10.0) kinetic5to10Power += avgPower;
      if (avgPower > maxPower && rmsMs2 > 0.005) {
        maxPower = avgPower;
        dominantFreqHz = f;
      }
    }
  }

  const pd4to6Share =
    totalBandPower > 1e-9 ? Math.round((pd4to6Power / totalBandPower) * 100) : 0;
  const kinetic5to10Share =
    totalBandPower > 1e-9 ? Math.round((kinetic5to10Power / totalBandPower) * 100) : 0;

  return {
    metrics: {
      dominantFreqHz: Number(dominantFreqHz.toFixed(1)),
      rmsG: Number(rmsG.toFixed(3)),
      rmsMs2: Number(rmsMs2.toFixed(2)),
      pd4to6Share,
      kinetic5to10Share,
      sampleCount: allPhaseSamples,
      durationSec,
      windowCount,
    },
    spectrum,
  };
}

/**
 * Full post-completion multimodal fusion pass:
 *  - Resamples synchronized streams to 200 Hz (17 channels)
 *  - Separates In-Air (pen_up) vs. On-Paper (pen_down) 2–4s Welch FFT spectra
 *  - Computes global Micrographia, Progressive Slowing, and Spiral Radial Error
 *  - Computes FSR-402 rigidity-spike coupling with stroke velocity drops
 */
export function computeMultimodalFusion(
  rawSensors: SensorData[],
  rawDigitizer: RawDigitizerSample[],
  strokes: DrawingStroke[],
  t0Ms: number,
  endMs: number,
  canvasMode: CanvasDrawMode = 'spiral',
  canvasWidth = 800,
  canvasHeight = 320
): MultimodalFusionOutput {
  const durationMs = Math.max(500, endMs - t0Ms);
  const matrix = resampleTo200HzMatrix(
    rawSensors,
    rawDigitizer,
    t0Ms,
    durationMs,
    canvasMode,
    canvasWidth,
    canvasHeight
  );

  const inAirRes = computePhaseWelchSpectrum(matrix, 0);
  const onPaperRes = computePhaseWelchSpectrum(matrix, 1);

  const fftComparisonSeries: FusionFftBin[] = inAirRes.spectrum.map((bin, idx) => ({
    freqHz: bin.freqHz,
    inAirPower: bin.power,
    onPaperPower: onPaperRes.spectrum[idx]?.power ?? 0,
  }));

  const onPaperRows = matrix.filter((r) => r.penDown === 1);
  const inAirRows = matrix.filter((r) => r.penDown === 0);

  const durationSec = Number(((matrix.length - 1) * FUSION_DT_SEC).toFixed(2));
  const onPaperDurationSec = Number((onPaperRows.length * FUSION_DT_SEC).toFixed(2));
  const inAirDurationSec = Number((inAirRows.length * FUSION_DT_SEC).toFixed(2));
  const penDownRatioPct =
    matrix.length > 0 ? Math.round((onPaperRows.length / matrix.length) * 100) : 0;

  // Global radial error & velocity metrics on active strokes
  let sumSpeed = 0;
  let sumRadialErr = 0;
  let sumRadialErrSq = 0;
  let sumOnPaperFsr = 0;
  let peakFsr = 0;

  const movingRows = onPaperRows.filter((r) => r.speed > 2);
  for (let i = 0; i < onPaperRows.length; i++) {
    const r = onPaperRows[i];
    sumSpeed += r.speed;
    sumRadialErr += r.radialError;
    sumRadialErrSq += r.radialError * r.radialError;
    sumOnPaperFsr += r.fsr;
    if (r.fsr > peakFsr) peakFsr = r.fsr;
  }

  let sumInAirFsr = 0;
  for (let i = 0; i < inAirRows.length; i++) {
    sumInAirFsr += inAirRows[i].fsr;
    if (inAirRows[i].fsr > peakFsr) peakFsr = inAirRows[i].fsr;
  }

  const meanVelocityPxS =
    onPaperRows.length > 0 ? Number((sumSpeed / onPaperRows.length).toFixed(1)) : 0;
  const meanRadialErrorPx =
    onPaperRows.length > 0 ? Number((sumRadialErr / onPaperRows.length).toFixed(2)) : 0;
  const rmsRadialErrorPx =
    onPaperRows.length > 0
      ? Number(Math.sqrt(sumRadialErrSq / onPaperRows.length).toFixed(2))
      : 0;
  const meanOnPaperFsr =
    onPaperRows.length > 0 ? Math.round(sumOnPaperFsr / onPaperRows.length) : 0;
  const meanInAirFsr = inAirRows.length > 0 ? Math.round(sumInAirFsr / inAirRows.length) : 0;

  // Progressive slowing: compare first 30% vs. last 30% of active moving rows
  let earlyVelocityPxS = meanVelocityPxS;
  let lateVelocityPxS = meanVelocityPxS;
  let progressiveSlowingPct = 0;
  if (movingRows.length >= 40) {
    const third = Math.max(10, Math.floor(movingRows.length * 0.3));
    let earlySum = 0;
    let lateSum = 0;
    for (let i = 0; i < third; i++) earlySum += movingRows[i].speed;
    for (let i = movingRows.length - third; i < movingRows.length; i++) lateSum += movingRows[i].speed;
    earlyVelocityPxS = Number((earlySum / third).toFixed(1));
    lateVelocityPxS = Number((lateSum / third).toFixed(1));
    if (earlyVelocityPxS > 5) {
      progressiveSlowingPct = Number(
        Math.max(-100, Math.min(100, ((earlyVelocityPxS - lateVelocityPxS) / earlyVelocityPxS) * 100)).toFixed(1)
      );
    }
  }

  // Global Micrographia: progressive amplitude/turn-spacing shrinkage across strokes or active segments
  let micrographiaDecayPct = 0;
  if (strokes.length >= 2) {
    const spans = strokes
      .filter((s) => s.points.length >= 6)
      .map((s) => {
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        for (const p of s.points) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        return Math.hypot(maxX - minX, maxY - minY);
      });
    if (spans.length >= 2 && spans[0] > 10) {
      const earlySpan = spans.slice(0, Math.ceil(spans.length / 2)).reduce((a, b) => a + b, 0) / Math.ceil(spans.length / 2);
      const lateSpan = spans.slice(Math.floor(spans.length / 2)).reduce((a, b) => a + b, 0) / Math.ceil(spans.length / 2);
      micrographiaDecayPct = Number(
        Math.max(-50, Math.min(100, ((earlySpan - lateSpan) / earlySpan) * 100)).toFixed(1)
      );
    }
  } else if (movingRows.length >= 80) {
    // Compare early vs. late radial step growth per second (for single continuous spiral)
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const half = Math.floor(movingRows.length / 2);
    const earlyPath = movingRows
      .slice(1, half)
      .reduce((acc, r, idx) => acc + Math.hypot(r.x - movingRows[idx].x, r.y - movingRows[idx].y), 0);
    const latePath = movingRows
      .slice(half + 1)
      .reduce(
        (acc, r, idx) =>
          acc + Math.hypot(r.x - movingRows[half + idx].x, r.y - movingRows[half + idx].y),
        0
      );
    const earlyR =
      movingRows.slice(0, half).reduce((acc, r) => acc + Math.hypot(r.x - cx, r.y - cy), 0) / half;
    const lateR =
      movingRows.slice(half).reduce((acc, r) => acc + Math.hypot(r.x - cx, r.y - cy), 0) /
      Math.max(1, movingRows.length - half);
    if (earlyPath > 20 && earlyR > 5) {
      const pathDecay = ((earlyPath - latePath) / earlyPath) * 100;
      const radialCompression = lateR < earlyR ? ((earlyR - lateR) / earlyR) * 60 : 0;
      micrographiaDecayPct = Number(
        Math.max(-30, Math.min(100, pathDecay * 0.7 + radialCompression * 0.3)).toFixed(1)
      );
    }
  }

  // FSR-402 Rigidity Spike <-> Stroke Velocity Drop Coupling
  let fsrVelocityCorrelation = 0;
  const rigidityEvents: RigidityCouplingEvent[] = [];
  const spikeTimesSet = new Set<number>();

  if (onPaperRows.length >= 40) {
    // Compute Pearson r between FSR and stroke speed across on-paper rows
    let meanF = 0,
      meanV = 0;
    for (const r of onPaperRows) {
      meanF += r.fsr;
      meanV += r.speed;
    }
    meanF /= onPaperRows.length;
    meanV /= onPaperRows.length;

    let cov = 0,
      varF = 0,
      varV = 0;
    for (const r of onPaperRows) {
      const df = r.fsr - meanF;
      const dv = r.speed - meanV;
      cov += df * dv;
      varF += df * df;
      varV += dv * dv;
    }
    if (varF > 1e-6 && varV > 1e-6) {
      fsrVelocityCorrelation = Number(
        Math.max(-1, Math.min(1, cov / Math.sqrt(varF * varV))).toFixed(2)
      );
    }

    const stdF = Math.sqrt(varF / onPaperRows.length);
    const spikeThreshold = meanF + Math.max(45, stdF * 1.15);

    // Detect coupled events (refractory window 1.2s between distinct rigidity spikes)
    let lastEventT = -2;
    for (let i = 20; i < matrix.length - 20; i++) {
      const row = matrix[i];
      if (row.penDown !== 1) continue;
      if (row.t - lastEventT < 1.2) continue;
      if (row.fsr < spikeThreshold) continue;

      // Local baseline velocity over ±1.5s on-paper context
      let localVSum = 0;
      let localVCount = 0;
      const startCtx = Math.max(0, i - 300);
      const endCtx = Math.min(matrix.length - 1, i + 300);
      for (let k = startCtx; k <= endCtx; k += 5) {
        if (matrix[k].penDown === 1 && matrix[k].speed > 2) {
          localVSum += matrix[k].speed;
          localVCount++;
        }
      }
      const localBaselineV = localVCount > 0 ? localVSum / localVCount : meanV;

      // Minimum velocity within ±250ms (±50 rows at 200Hz)
      let minV = row.speed;
      for (let k = Math.max(0, i - 50); k <= Math.min(matrix.length - 1, i + 50); k++) {
        if (matrix[k].penDown === 1 && matrix[k].speed < minV) {
          minV = matrix[k].speed;
        }
      }

      const dropPct =
        localBaselineV > 5
          ? Math.max(0, ((localBaselineV - minV) / localBaselineV) * 100)
          : 0;

      if (dropPct >= 18) {
        lastEventT = row.t;
        spikeTimesSet.add(Math.round(row.t * 2) / 2);
        rigidityEvents.push({
          tSec: Number(row.t.toFixed(2)),
          fsr: Math.round(row.fsr),
          baselineFsr: Math.round(meanF),
          speed: Number(minV.toFixed(1)),
          speedDropPct: Number(dropPct.toFixed(1)),
          radialErrorPx: row.radialError,
        });
      }
    }
  }

  // Build compact ~200-point timeline series for crisp Recharts rendering & compact Firestore archival
  const targetPlotPoints = 200;
  const stride = Math.max(1, Math.floor(matrix.length / targetPlotPoints));
  const timelineSeries: FusionTimelinePoint[] = [];

  for (let i = 0; i < matrix.length; i += stride) {
    const endIdx = Math.min(matrix.length, i + stride);
    let sumF = 0,
      sumV = 0,
      sumErr = 0,
      downCount = 0,
      maxF = 0;
    let repT = matrix[i].t;
    for (let j = i; j < endIdx; j++) {
      sumF += matrix[j].fsr;
      sumV += matrix[j].speed;
      sumErr += matrix[j].radialError;
      if (matrix[j].penDown === 1) downCount++;
      if (matrix[j].fsr > maxF) maxF = matrix[j].fsr;
    }
    const cnt = endIdx - i;
    const penDown: 0 | 1 = downCount >= cnt / 2 ? 1 : 0;
    const isRigiditySpike = rigidityEvents.some((ev) => Math.abs(ev.tSec - repT) <= Math.max(0.35, stride * FUSION_DT_SEC));
    timelineSeries.push({
      tSec: Number(repT.toFixed(2)),
      fsr: Math.round(isRigiditySpike ? maxF : sumF / cnt),
      speed: Number((sumV / cnt).toFixed(1)),
      radialError: Number((sumErr / cnt).toFixed(1)),
      penDown,
      isRigiditySpike,
    });
  }

  // Deterministic clinical summary contrasting in-air rest vs. on-paper kinetic tremor & rigidity coupling
  const inAirSummary =
    inAirRes.metrics.sampleCount >= 40
      ? `In-air resting segments (${inAirDurationSec.toFixed(1)}s) peaked at ${inAirRes.metrics.dominantFreqHz.toFixed(1)} Hz (${inAirRes.metrics.rmsG.toFixed(3)} g, ${inAirRes.metrics.pd4to6Share}% 4–6 Hz PD band).`
      : 'Insufficient in-air (pen_up) duration to isolate resting tremor spectrum.';

  const onPaperSummary =
    onPaperRes.metrics.sampleCount >= 40
      ? `On-paper strokes (${onPaperDurationSec.toFixed(1)}s) peaked at ${onPaperRes.metrics.dominantFreqHz.toFixed(1)} Hz (${onPaperRes.metrics.rmsG.toFixed(3)} g, ${onPaperRes.metrics.kinetic5to10Share}% 5–10 Hz kinetic band) with ${meanRadialErrorPx.toFixed(1)} px mean spiral deviation.`
      : 'Insufficient on-paper (pen_down) stroke duration to isolate kinetic tremor spectrum.';

  const couplingSummary =
    rigidityEvents.length > 0
      ? `Detected ${rigidityEvents.length} FSR-402 rigidity spike${rigidityEvents.length === 1 ? '' : 's'} coupled with stroke velocity drops (r = ${fsrVelocityCorrelation.toFixed(2)}), micrographia decay ${micrographiaDecayPct.toFixed(1)}%, and progressive slowing ${progressiveSlowingPct.toFixed(1)}%.`
      : `FSR-velocity coupling r = ${fsrVelocityCorrelation.toFixed(2)} with micrographia decay ${micrographiaDecayPct.toFixed(1)}% and progressive slowing ${progressiveSlowingPct.toFixed(1)}%.`;

  const summary: MultimodalFusionResult = {
    sampleRateHz: FUSION_SAMPLE_RATE_HZ,
    durationSec,
    totalMatrixRows: matrix.length,
    canvasMode,
    inAirDurationSec,
    onPaperDurationSec,
    penDownRatioPct,
    inAirTremor: inAirRes.metrics,
    onPaperTremor: onPaperRes.metrics,
    globalMotor: {
      micrographiaDecayPct,
      progressiveSlowingPct,
      meanVelocityPxS,
      earlyVelocityPxS,
      lateVelocityPxS,
      meanRadialErrorPx,
      rmsRadialErrorPx,
      strokeCount: Math.max(strokes.length, onPaperRows.length > 0 ? 1 : 0),
    },
    rigidityCoupling: {
      fsrVelocityCorrelation,
      coupledSpikeCount: rigidityEvents.length,
      meanOnPaperFsr,
      meanInAirFsr,
      peakFsr: Math.round(peakFsr),
      rigidityEvents: rigidityEvents.slice(0, 12),
    },
    timelineSeries,
    fftComparisonSeries,
    fusionClinicalSummary: `${inAirSummary} ${onPaperSummary} ${couplingSummary}`,
  };

  return { summary, matrix };
}

/**
 * Generates synchronized Demo IMU + Digitizer samples for the 90-second
 * Multimodal Fusion test (alternating In-Air resting pauses and On-Paper spiral
 * turns with progressive micrographia, slowing, and FSR rigidity spikes).
 */
export function generateDemoFusionTick(
  elapsedSec: number,
  profile: SimulationProfile,
  timestampMs: number,
  canvasWidth = 800,
  canvasHeight = 320
): { sensor: SensorData; digitizer: RawDigitizerSample } {
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  const scale = canvasWidth > 1000 ? 8 : 5;

  // Schedule 4 distinct in-air resting intervals (pen_up) so resting vs. kinetic FFT separation is crystal clear:
  // In-air windows: [0..4s], [20..25s], [44..49s], [68..73s]
  const isInAir =
    elapsedSec < 4.0 ||
    (elapsedSec >= 20.0 && elapsedSec < 25.0) ||
    (elapsedSec >= 44.0 && elapsedSec < 49.0) ||
    (elapsedSec >= 68.0 && elapsedSec < 73.0);

  const penDown: 0 | 1 = isInAir ? 0 : 1;

  // Active drawing progress with progressive bradykinetic slowing for PD profile
  const slowingFactor =
    profile === 'pd_resting'
      ? Math.max(0.55, 1.0 - (elapsedSec / 90) * 0.38)
      : profile === 'et_postural'
      ? Math.max(0.82, 1.0 - (elapsedSec / 90) * 0.14)
      : 0.96;

  // Periodic rigidity spikes every ~11s during on-paper drawing (PD shows strong spike + velocity drop)
  const spikeCenters = [11.5, 31.0, 39.5, 56.0, 63.5, 79.5];
  let spikeEnvelope = 0;
  for (const sc of spikeCenters) {
    const dist = Math.abs(elapsedSec - sc);
    if (dist < 0.75) {
      spikeEnvelope = Math.max(spikeEnvelope, Math.exp(-(dist * dist) / 0.14));
    }
  }

  const rigidityDip =
    profile === 'pd_resting'
      ? 1 - 0.65 * spikeEnvelope
      : profile === 'et_postural'
      ? 1 - 0.25 * spikeEnvelope
      : 1 - 0.08 * spikeEnvelope;

  // Spiral angle advances only during pen_down, with progressive micrographia compression on outer turns
  const activeTime = Math.max(0, elapsedSec - 4.0);
  const effectiveSpeed = slowingFactor * rigidityDip;
  const theta = (activeTime * 1.45 * effectiveSpeed) % 24;
  const micrographiaScale =
    profile === 'pd_resting' ? Math.max(0.68, 1.0 - (elapsedSec / 90) * 0.28) : 0.98;

  // Tremor perturbation on spiral radius
  const tremorFreq = isInAir
    ? profile === 'pd_resting'
      ? 4.8
      : profile === 'et_postural'
      ? 6.0
      : 10.5
    : profile === 'pd_resting'
    ? 5.5
    : profile === 'et_postural'
    ? 8.5
    : 10.0;

  const radialJitter =
    penDown === 1
      ? (profile === 'et_postural' ? 8.5 : profile === 'pd_resting' ? 4.8 + spikeEnvelope * 4.2 : 1.1) *
        Math.sin(2 * Math.PI * tremorFreq * elapsedSec)
      : 0;

  const r = (1 + theta) * scale * micrographiaScale + radialJitter;
  const x = cx + r * Math.cos(theta);
  const y = cy + r * Math.sin(theta);

  // Synthesize IMU sample tailored to phase (PD = prominent 4.8Hz in-air resting tremor; ET = prominent 8.5Hz on-paper kinetic tremor)
  const baseSample = generateSimulatedSample(
    elapsedSec,
    isInAir
      ? profile === 'pd_resting'
        ? 'pd_resting'
        : 'physiological'
      : profile === 'pd_resting'
      ? 'pd_resting'
      : profile,
    timestampMs
  );

  // Modulate IMU amplitude & FSR to accurately reflect pen_up vs. pen_down physiology
  let ax = baseSample.ax;
  let ay = baseSample.ay;
  let az = baseSample.az;
  let fsr = baseSample.fsr;

  if (profile === 'pd_resting') {
    if (isInAir) {
      // Strong 4.8 Hz in-air resting tremor, low hover grip pressure
      fsr = Math.max(120, Math.round(360 + 60 * Math.sin(2 * Math.PI * 4.8 * elapsedSec)));
    } else {
      // On-paper attenuated tremor + elevated grip pressure with rigidity spikes
      ax = baseSample.ax * 0.62 + 0.85 * Math.sin(2 * Math.PI * 5.8 * elapsedSec);
      ay = baseSample.ay * 0.62 + 0.65 * Math.cos(2 * Math.PI * 5.8 * elapsedSec);
      fsr = Math.round(1450 + 1350 * spikeEnvelope + 95 * Math.sin(2 * Math.PI * 5.5 * elapsedSec));
    }
  } else if (profile === 'et_postural') {
    if (isInAir) {
      // Mild postural tremor while hovering
      ax = baseSample.ax * 0.45;
      ay = baseSample.ay * 0.45;
      fsr = Math.round(420 + 40 * Math.sin(2 * Math.PI * 7.5 * elapsedSec));
    } else {
      // Prominent 8.5 Hz kinetic action tremor on paper
      ax = baseSample.ax * 1.18;
      ay = baseSample.ay * 1.18;
      fsr = Math.round(1680 + 420 * spikeEnvelope + 160 * Math.sin(2 * Math.PI * 8.5 * elapsedSec));
    }
  } else {
    fsr = isInAir ? 260 : Math.round(1220 + 75 * spikeEnvelope);
  }

  const sensor = enrichSensorFrame({
    ...baseSample,
    ax,
    ay,
    az,
    fsr,
    touchX: penDown === 1 ? Number(x.toFixed(1)) : undefined,
    touchY: penDown === 1 ? Number(y.toFixed(1)) : undefined,
    timestamp: timestampMs,
  });

  const digitizer: RawDigitizerSample = {
    tMs: timestampMs,
    x: Number(x.toFixed(1)),
    y: Number(y.toFixed(1)),
    pressure: fsr,
    penDown,
    mode: 'spiral',
    canvasWidth,
    canvasHeight,
  };

  return { sensor, digitizer };
}

export function format200HzMatrixCsv(matrix: FusedMatrixRow[]): string {
  const header =
    't,x,y,vx,vy,radial_error,ax,ay,az,gx,gy,gz,mx,my,mz,fsr,pen_down';
  const lines = new Array<string>(matrix.length + 1);
  lines[0] = header;
  for (let i = 0; i < matrix.length; i++) {
    const r = matrix[i];
    lines[i + 1] = `${r.t},${r.x},${r.y},${r.vx},${r.vy},${r.radialError},${r.ax},${r.ay},${r.az},${r.gx},${r.gy},${r.gz},${r.mx},${r.my},${r.mz},${r.fsr},${r.penDown}`;
  }
  return lines.join('\n');
}

export function format200HzMatrixJson(
  summary: MultimodalFusionResult,
  matrix: FusedMatrixRow[]
): string {
  return JSON.stringify(
    {
      schema: 'neurotremor-multimodal-fusion-200hz-v1',
      exportedAt: new Date().toISOString(),
      sampleRateHz: FUSION_SAMPLE_RATE_HZ,
      channels: [
        't',
        'x',
        'y',
        'vx',
        'vy',
        'radial_error',
        'ax',
        'ay',
        'az',
        'gx',
        'gy',
        'gz',
        'mx',
        'my',
        'mz',
        'fsr',
        'pen_down',
      ],
      summary,
      matrix,
    },
    null,
    2
  );
}

export function download200HzMatrixCsv(matrix: FusedMatrixRow[], tag = 'fusion') {
  const csv = format200HzMatrixCsv(matrix);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `neurotremor-200hz-${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function download200HzMatrixJson(
  summary: MultimodalFusionResult,
  matrix: FusedMatrixRow[],
  tag = 'fusion'
) {
  const json = format200HzMatrixJson(summary, matrix);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `neurotremor-200hz-${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
