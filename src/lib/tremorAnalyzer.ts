import type { SensorData } from './serial.ts';

export type TremorPhenotype =
  | 'Parkinsonian Tremor (PD)'
  | 'Essential / Postural Tremor (ET)'
  | 'Physiological / Subclinical'
  | 'Voluntary Motion / Writing'
  | 'Resting Baseline';

export type SimulationProfile = 'pd_resting' | 'et_postural' | 'physiological';

export interface SpectralBin {
  freq: number;
  label: string;
  power: number;
  band: 'voluntary' | 'pd' | 'et' | 'physiological';
}

export interface LiveTrendPoint {
  id: string;
  label: string;
  timestamp: number;
  rms: number;
  rmsG: number;
  frequency: number;
  updrsScore: number;
  stage: string;
  recoveryRate: number;
}

export interface RecoveryAnalysisSummary {
  recoveryRate: number; // -100 to +100 (%)
  baselineRms: number; // m/s^2 (Previous recorded section RMS)
  baselineRmsG: number; // g
  currentRms: number; // m/s^2 (Latest recorded section RMS)
  currentRmsG: number; // g
  previousSectionLabel?: string; // e.g. 'S-1'
  latestSectionLabel?: string; // e.g. 'S-2'
  recordedCount: number;
  baselineSource: 'Previous Recorded Section' | 'Initial Recorded Baseline' | 'Awaiting Recorded Section';
  statusLabel: 'Improving' | 'Exacerbated' | 'Stable Baseline';
}

export interface DifferentialAnalysisResult {
  rms: number; // m/s^2
  rmsG: number; // g-force
  dominantFreq: number; // Hz
  gyroRms: number; // deg/s
  avgForce: number; // FSR 0-4095
  forceCv: number; // Coefficient of variation (%)
  gripDecaySlope: number; // FSR units per second (negative = fatigue/bradykinetic decay)
  pdBandPower: number; // 3.5 - 6.5 Hz relative ratio (0 - 1)
  pdCore4to6Power: number; // 4.0 - 6.0 Hz core nigrostriatal resting ratio (0 - 1)
  etBandPower: number; // 6.5 - 12.0 Hz relative ratio (0 - 1)
  voluntaryBandPower: number; // 0.5 - 3.5 Hz relative ratio (0 - 1)
  physBandPower: number; // > 12.0 Hz relative ratio (0 - 1)
  spectralRegularity: number; // 0 - 100 narrowband rhythmicity (Q-factor proxy)
  pillRollingIndex: number; // 0 - 100 rotational pronation-supination dominance
  gripForceCoherence: number; // 0 - 100 force-oscillation coupling
  micrographiaIndex: number; // 0 - 100 spatial stroke decay / spiral deviation
  pdProbability: number; // 0 - 100%
  etProbability: number; // 0 - 100%
  normalProbability: number; // 0 - 100%
  phenotype: TremorPhenotype;
  updrsScore: number; // 0.0 - 4.0 MDS-UPDRS scale
  constancyScore: number; // 0 - 4 MDS-UPDRS Item 3.18 Rest Tremor Constancy
  estimatedExcursionCm: number; // Peak-to-peak physical displacement in cm (MDS-UPDRS 3.17)
  hoehnYahrStage: string; // e.g. 'H&Y Stage 1 · Unilateral / Early PD'
  is4to6HzPdLock: boolean; // True when dominant frequency is locked in 4.0-6.0 Hz PD band
  clinicalStage: string; // 'Normal' | 'Stage 1' | 'Stage 2' | 'Stage 3' | 'Stage 4'
  severityLabel: 'Normal' | 'Mild' | 'Moderate' | 'Severe';
  kinematicBracket: string; // e.g. '<0.06g normal', '0.06–0.55g mild', '0.55–1.15g moderate', '>1.15g severe'
  clinicalRationale: string;
  spectrum: SpectralBin[];
}

/**
 * Unified, calibrated MDS-UPDRS III (Items 3.15/3.17/3.18) & Hoehn-Yahr clinical staging engine.
 * Accounts for both RMS acceleration (g) and 4–6 Hz Parkinsonian narrowband spectral lock
 * (since a 4–6 Hz rest tremor produces ~2.8x lower raw acceleration per cm of displacement
 * than an 8–12 Hz postural tremor: a_RMS ~ (2*pi*f)^2 * d).
 *
 * Reference thresholds at default Normal sensitivity (1.35x, scale = 1.0):
 * - Normal (Stage 0 / H&Y 0):     < 0.06 g  (< 0.59 m/s²)   -> UPDRS 0.0 - 0.3
 * - Mild (Stage 1 / H&Y 1):       0.06 - 0.55 g (0.59 - 5.39 m/s²) -> UPDRS 0.8 - 1.8 (< 2 cm)
 * - Moderate (Stage 2 / H&Y 2):   0.55 - 1.15 g (5.39 - 11.28 m/s²) -> UPDRS 1.9 - 2.8 (2 - 5 cm)
 * - Severe (Stage 3-4 / H&Y 3+):  >= 1.15 g (>= 11.28 m/s²) -> UPDRS 2.9 - 4.0 (> 5 cm)
 */
export function calculateClinicalStaging(
  rms: number,
  dominantFreq: number,
  voluntaryBandPower: number,
  sensitivityMultiplier: number = 1.35,
  pdBandPower: number = 0,
  spectralRegularity: number = 0
): {
  updrsScore: number;
  constancyScore: number;
  estimatedExcursionCm: number;
  hoehnYahrStage: string;
  is4to6HzPdLock: boolean;
  clinicalStage: string;
  severityLabel: 'Normal' | 'Mild' | 'Moderate' | 'Severe';
  kinematicBracket: string;
} {
  const rmsG = rms / 9.80665;
  const scale = Math.max(0.45, sensitivityMultiplier / 1.35);

  // Subclinical noise floor threshold (0.06g at Normal 1.35x, 0.04g at Low 0.90x)
  const normalMaxG = Math.max(0.04, Math.min(0.09, 0.06 * scale));
  const mildMaxG = Math.max(0.35, 0.55 * scale);
  const moderateMaxG = Math.max(0.85, 1.15 * scale);

  // Detect 4.0 - 6.0 Hz (3.6 - 6.4 Hz margin) Parkinsonian narrowband rest tremor lock
  const is4to6HzPdLock =
    rmsG >= normalMaxG &&
    dominantFreq >= 3.6 &&
    dominantFreq <= 6.4 &&
    (pdBandPower >= 0.45 || dominantFreq <= 6.2);

  // Estimate physical peak-to-peak tremor excursion in cm using harmonic kinematics
  // d_pp = 2 * sqrt(2) * a_rms / (2 * pi * f)^2 * 100 (with 1.15x distal hand factor)
  const effFreq = dominantFreq >= 3.5 ? dominantFreq : 5.0;
  const omegaSq = Math.pow(2 * Math.PI * effFreq, 2);
  const rawExcursionCm = rms > 0 ? ((2 * Math.sqrt(2) * rms) / omegaSq) * 100 * 1.15 : 0;
  const estimatedExcursionCm = Number(Math.min(15.0, rawExcursionCm).toFixed(2));

  // MDS-UPDRS Item 3.18 Rest Tremor Constancy score (0-4)
  const constancyScore =
    rmsG < normalMaxG
      ? 0
      : spectralRegularity >= 85
      ? 4
      : spectralRegularity >= 65
      ? 3
      : spectralRegularity >= 40
      ? 2
      : 1;

  // Reject slow intentional/voluntary movement (< 2.8 Hz) unless extreme amplitude
  if (
    rms === 0 ||
    (dominantFreq > 0 && dominantFreq < 2.8 && voluntaryBandPower > 0.65 && rmsG < mildMaxG)
  ) {
    return {
      updrsScore: 0.0,
      constancyScore: 0,
      estimatedExcursionCm: 0,
      hoehnYahrStage: 'H&Y 0 · Subclinical',
      is4to6HzPdLock: false,
      clinicalStage: 'Normal',
      severityLabel: 'Normal',
      kinematicBracket: `<${normalMaxG.toFixed(2)}g normal`,
    };
  }

  let updrsScore = 0;
  let severityLabel: 'Normal' | 'Mild' | 'Moderate' | 'Severe' = 'Normal';
  let clinicalStage = 'Normal';
  let hoehnYahrStage = 'H&Y 0 · Subclinical';
  let kinematicBracket = `<${normalMaxG.toFixed(2)}g normal`;

  if (rmsG < normalMaxG) {
    updrsScore = (rmsG / normalMaxG) * 0.3;
    if (updrsScore < 0.2) updrsScore = 0;
    severityLabel = 'Normal';
    clinicalStage = 'Normal';
    hoehnYahrStage = 'H&Y 0 · Subclinical';
    kinematicBracket = `<${normalMaxG.toFixed(2)}g normal`;
  } else if (rmsG < mildMaxG) {
    const ratio = (rmsG - normalMaxG) / (mildMaxG - normalMaxG);
    // Apply 4-6 Hz Parkinsonian constancy boost within Stage 1 so 0.12-0.20g at 4-6Hz scores ~1.1-1.4 UPDRS
    const pdBoost = is4to6HzPdLock ? 0.22 + (constancyScore / 4) * 0.15 : 0;
    updrsScore = Math.min(1.8, 0.8 + ratio * 0.9 + pdBoost);
    severityLabel = 'Mild';
    clinicalStage = 'Stage 1';
    hoehnYahrStage = is4to6HzPdLock
      ? 'H&Y Stage 1 (Early PD)'
      : 'Stage 1 (Mild Postural)';
    kinematicBracket = `${normalMaxG.toFixed(2)}–${mildMaxG.toFixed(2)}g mild`;
  } else if (rmsG < moderateMaxG) {
    const ratio = (rmsG - mildMaxG) / (moderateMaxG - mildMaxG);
    const pdBoost = is4to6HzPdLock ? 0.15 : 0;
    updrsScore = Math.min(2.8, 1.9 + ratio * 0.85 + pdBoost);
    severityLabel = 'Moderate';
    clinicalStage = 'Stage 2';
    hoehnYahrStage = is4to6HzPdLock
      ? 'H&Y Stage 2 (Bilateral PD)'
      : 'Stage 2 (Moderate Kinetic)';
    kinematicBracket = `${mildMaxG.toFixed(2)}–${moderateMaxG.toFixed(2)}g moderate`;
  } else {
    const ratio = Math.min(1.0, (rmsG - moderateMaxG) / (1.0 * scale));
    updrsScore = 2.9 + ratio * 1.1; // 2.9 to 4.0
    severityLabel = 'Severe';
    clinicalStage = updrsScore >= 3.6 ? 'Stage 4' : 'Stage 3';
    hoehnYahrStage =
      clinicalStage === 'Stage 4'
        ? 'H&Y Stage 4 (Advanced PD)'
        : 'H&Y Stage 3 (Marked PD)';
    kinematicBracket = `>${moderateMaxG.toFixed(2)}g severe`;
  }

  return {
    updrsScore: Number(Math.max(0, Math.min(4.0, updrsScore)).toFixed(1)),
    constancyScore,
    estimatedExcursionCm,
    hoehnYahrStage,
    is4to6HzPdLock,
    clinicalStage,
    severityLabel,
    kinematicBracket,
  };
}

/**
 * Computes sequential recovery rate (%) strictly across recorded clinical sections.
 * Does NOT calculate continuous live recovery during unrecorded testing.
 * Compares the latest recorded section (S-n) against the immediately preceding recorded section (S-(n-1)).
 */
export function computeRecoveryAnalysis(params: {
  currentRms?: number;
  sessionBaselineRms?: number | null;
  recordedSessions: { rms: number; timestamp: number }[];
  isConnected?: boolean;
}): RecoveryAnalysisSummary {
  const { recordedSessions } = params;

  if (!Array.isArray(recordedSessions) || recordedSessions.length === 0) {
    return {
      recoveryRate: 0,
      baselineRms: 0,
      baselineRmsG: 0,
      currentRms: 0,
      currentRmsG: 0,
      recordedCount: 0,
      baselineSource: 'Awaiting Recorded Section',
      statusLabel: 'Stable Baseline',
    };
  }

  // Order recorded sections chronologically from oldest (S-1) to latest (S-n)
  const chronological = [...recordedSessions].sort((a, b) => a.timestamp - b.timestamp);
  const count = chronological.length;

  if (count === 1) {
    const firstRms = Math.max(0, chronological[0].rms || 0);
    return {
      recoveryRate: 0,
      baselineRms: Number(firstRms.toFixed(2)),
      baselineRmsG: Number((firstRms / 9.80665).toFixed(3)),
      currentRms: Number(firstRms.toFixed(2)),
      currentRmsG: Number((firstRms / 9.80665).toFixed(3)),
      previousSectionLabel: 'S-1',
      latestSectionLabel: 'S-1',
      recordedCount: 1,
      baselineSource: 'Initial Recorded Baseline',
      statusLabel: 'Stable Baseline',
    };
  }

  // Compare latest recorded section (S-n) against the immediately previous recorded section (S-(n-1))
  const prevSection = chronological[count - 2];
  const latestSection = chronological[count - 1];
  const baselineRms = Math.max(0, prevSection.rms || 0);
  const activeRms = Math.max(0, latestSection.rms || 0);

  const MIN_VALID_DIVISOR_RMS = 0.05;
  let recoveryRate = 0;
  if (baselineRms >= MIN_VALID_DIVISOR_RMS) {
    const rawDeltaPct = ((baselineRms - activeRms) / baselineRms) * 100;
    recoveryRate = Number(Math.max(-100, Math.min(100, rawDeltaPct)).toFixed(1));
  }

  let statusLabel: RecoveryAnalysisSummary['statusLabel'] = 'Stable Baseline';
  if (recoveryRate >= 2.5) statusLabel = 'Improving';
  else if (recoveryRate <= -2.5) statusLabel = 'Exacerbated';

  return {
    recoveryRate,
    baselineRms: Number(baselineRms.toFixed(2)),
    baselineRmsG: Number((baselineRms / 9.80665).toFixed(3)),
    currentRms: Number(activeRms.toFixed(2)),
    currentRmsG: Number((activeRms / 9.80665).toFixed(3)),
    previousSectionLabel: `S-${count - 1}`,
    latestSectionLabel: `S-${count}`,
    recordedCount: count,
    baselineSource: 'Previous Recorded Section',
    statusLabel,
  };
}

/**
 * Computes Discrete Fourier Transform (DFT) power spectrum across 1.0 Hz to 15.0 Hz
 * at 0.5 Hz resolution using Hann windowing to suppress spectral leakage.
 */
export function computePowerSpectrum(
  signal: number[],
  sampleRateHz: number
): { freq: number; power: number }[] {
  const N = signal.length;
  if (N < 8 || sampleRateHz <= 0) {
    return [];
  }

  const mean = signal.reduce((a, b) => a + b, 0) / N;
  const windowed = new Array<number>(N);
  for (let n = 0; n < N; n++) {
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
    windowed[n] = (signal[n] - mean) * hann;
  }

  const results: { freq: number; power: number }[] = [];
  for (let freq = 1.0; freq <= 15.0; freq += 0.5) {
    let real = 0;
    let imag = 0;
    const omega = (2 * Math.PI * freq) / sampleRateHz;
    for (let n = 0; n < N; n++) {
      real += windowed[n] * Math.cos(omega * n);
      imag -= windowed[n] * Math.sin(omega * n);
    }
    const power = (real * real + imag * imag) / (N * N);
    results.push({ freq: Number(freq.toFixed(1)), power });
  }

  return results;
}

/**
 * High-precision differential analysis separating Parkinsonian (4-6 Hz resting/pill-rolling +
 * bradykinetic grip force decrement) from Essential/Postural Tremor (6.5-12 Hz kinetic/action
 * coupled with active grip exertion) and voluntary motion.
 */
export function analyzeTremorDifferential(
  dataWindow: SensorData[],
  deviceType: 'mobile' | 'pen' = 'pen',
  sensitivityMultiplier: number = 1.35
): DifferentialAnalysisResult {
  const emptySpectrum: SpectralBin[] = [
    { freq: 2.0, label: '2Hz', power: 0, band: 'voluntary' },
    { freq: 3.5, label: '3.5Hz', power: 0, band: 'pd' },
    { freq: 5.0, label: '5Hz', power: 0, band: 'pd' },
    { freq: 6.5, label: '6.5Hz', power: 0, band: 'pd' },
    { freq: 8.0, label: '8Hz', power: 0, band: 'et' },
    { freq: 9.5, label: '9.5Hz', power: 0, band: 'et' },
    { freq: 11.0, label: '11Hz', power: 0, band: 'et' },
    { freq: 13.0, label: '13Hz', power: 0, band: 'physiological' },
  ];

  if (!dataWindow || dataWindow.length < 12) {
    return {
      rms: 0,
      rmsG: 0,
      dominantFreq: 0,
      gyroRms: 0,
      avgForce: 0,
      forceCv: 0,
      gripDecaySlope: 0,
      pdBandPower: 0,
      pdCore4to6Power: 0,
      etBandPower: 0,
      voluntaryBandPower: 0,
      physBandPower: 0,
      spectralRegularity: 0,
      pillRollingIndex: 0,
      gripForceCoherence: 0,
      micrographiaIndex: 0,
      pdProbability: 0,
      etProbability: 0,
      normalProbability: 100,
      phenotype: 'Resting Baseline',
      updrsScore: 0,
      constancyScore: 0,
      estimatedExcursionCm: 0,
      hoehnYahrStage: 'H&Y 0 · Subclinical',
      is4to6HzPdLock: false,
      clinicalStage: 'Normal',
      severityLabel: 'Normal',
      kinematicBracket: '<0.06g normal',
      clinicalRationale:
        'Awaiting sufficient sensor frames (minimum 12 samples) for spectral decomposition.',
      spectrum: emptySpectrum,
    };
  }

  const N = dataWindow.length;
  const durationSec = Math.max(
    0.05,
    (dataWindow[N - 1].timestamp - dataWindow[0].timestamp) / 1000
  );
  const rawRate = (N - 1) / durationSec;
  const sampleRateHz = Math.max(20, Math.min(250, Number.isFinite(rawRate) ? rawRate : 50));

  // 1. Local trend subtraction (high-pass > 2 Hz) to isolate oscillatory tremor from gross limb translation
  const baselineHalfWindow = Math.max(2, Math.min(10, Math.floor(sampleRateHz * 0.12)));
  const dynAccelSigned: number[] = [];
  const dynAccelMag: number[] = [];
  const gyroMag: number[] = [];
  const pronationGyro: number[] = [];

  for (let i = 0; i < N; i++) {
    const start = Math.max(0, i - baselineHalfWindow);
    const end = Math.min(N, i + baselineHalfWindow + 1);
    const count = end - start;
    let bx = 0,
      by = 0,
      bz = 0;
    for (let j = start; j < end; j++) {
      bx += dataWindow[j].ax;
      by += dataWindow[j].ay;
      bz += dataWindow[j].az;
    }
    bx /= count;
    by /= count;
    bz /= count;

    const ox = dataWindow[i].ax - bx;
    const oy = dataWindow[i].ay - by;
    const oz = dataWindow[i].az - bz;

    const compositeSigned = ox + oy * 0.85 + oz * 0.5;
    const mag = Math.sqrt(ox * ox + oy * oy + oz * oz);
    dynAccelSigned.push(compositeSigned);
    dynAccelMag.push(mag);

    const gx = dataWindow[i].gx || 0;
    const gy = dataWindow[i].gy || 0;
    const gz = dataWindow[i].gz || 0;
    gyroMag.push(Math.sqrt(gx * gx + gy * gy + gz * gz));
    pronationGyro.push(Math.sqrt(gx * gx + gz * gz));
  }

  // 2. Compute RMS Acceleration & Gyro RMS
  const sumSqAccel = dynAccelMag.reduce((a, b) => a + b * b, 0);
  let rms = Math.sqrt(sumSqAccel / N);
  const noiseDeadband =
    (deviceType === 'pen' ? 0.25 : 0.32) * Math.min(1.6, sensitivityMultiplier * 0.75);
  if (rms < noiseDeadband) {
    rms = 0;
  }
  const rmsG = rms / 9.80665;

  const gyroRms = Math.sqrt(gyroMag.reduce((a, b) => a + b * b, 0) / N);
  const pronationRms = Math.sqrt(pronationGyro.reduce((a, b) => a + b * b, 0) / N);

  // 3. Compute DFT Power Spectrum across 1.0 - 15.0 Hz
  const rawSpectrum = computePowerSpectrum(dynAccelSigned, sampleRateHz);

  let voluntaryPowerSum = 0;
  let pdPowerSum = 0;
  let pdCore4to6Sum = 0;
  let etPowerSum = 0;
  let physPowerSum = 0;
  let maxTremorPower = 0;
  let peakFreq = 0;

  for (const bin of rawSpectrum) {
    if (bin.freq < 3.5) {
      voluntaryPowerSum += bin.power;
    } else if (bin.freq >= 3.5 && bin.freq <= 6.5) {
      pdPowerSum += bin.power;
      if (bin.freq >= 4.0 && bin.freq <= 6.0) {
        pdCore4to6Sum += bin.power;
      }
      if (bin.power > maxTremorPower) {
        maxTremorPower = bin.power;
        peakFreq = bin.freq;
      }
    } else if (bin.freq > 6.5 && bin.freq <= 12.0) {
      etPowerSum += bin.power;
      if (bin.power > maxTremorPower) {
        maxTremorPower = bin.power;
        peakFreq = bin.freq;
      }
    } else {
      physPowerSum += bin.power;
      if (bin.power > maxTremorPower) {
        maxTremorPower = bin.power;
        peakFreq = bin.freq;
      }
    }
  }

  const totalPower = voluntaryPowerSum + pdPowerSum + etPowerSum + physPowerSum + 1e-9;

  if (rms > 0 && rawSpectrum.length > 2) {
    let bestIdx = 0;
    for (let i = 1; i < rawSpectrum.length; i++) {
      if (rawSpectrum[i].freq >= 3.0 && rawSpectrum[i].power > rawSpectrum[bestIdx].power) {
        bestIdx = i;
      }
    }
    if (bestIdx > 0 && bestIdx < rawSpectrum.length - 1) {
      const alpha = rawSpectrum[bestIdx - 1].power;
      const beta = rawSpectrum[bestIdx].power;
      const gamma = rawSpectrum[bestIdx + 1].power;
      const denom = alpha - 2 * beta + gamma;
      if (Math.abs(denom) > 1e-9) {
        const p = 0.5 * ((alpha - gamma) / denom);
        peakFreq = Math.max(1.0, Math.min(15.0, rawSpectrum[bestIdx].freq + p * 0.5));
      } else {
        peakFreq = rawSpectrum[bestIdx].freq;
      }
    }
  } else {
    peakFreq = 0;
  }

  const pdBandPower = rms === 0 ? 0 : pdPowerSum / totalPower;
  const pdCore4to6Power = rms === 0 ? 0 : pdCore4to6Sum / totalPower;
  const etBandPower = rms === 0 ? 0 : etPowerSum / totalPower;
  const voluntaryBandPower = rms === 0 ? 0 : voluntaryPowerSum / totalPower;
  const physBandPower = rms === 0 ? 0 : physPowerSum / totalPower;

  let peakNeighborhoodPower = 0;
  for (const bin of rawSpectrum) {
    if (Math.abs(bin.freq - peakFreq) <= 0.6) {
      peakNeighborhoodPower += bin.power;
    }
  }
  const spectralRegularity =
    rms === 0 ? 0 : Math.min(100, Math.round((peakNeighborhoodPower / totalPower) * 145));

  // 4. Pill-Rolling Rotational Dominance Index (Pronation/Supination Gyro vs Linear Accel)
  let pillRollingIndex = 0;
  if (rms > 0.05) {
    const rotToLinRatio = pronationRms / Math.max(0.5, rms);
    const axisDominance = gyroRms > 0.5 ? pronationRms / gyroRms : 0.5;
    pillRollingIndex = Math.min(
      100,
      Math.max(0, Math.round((Math.min(rotToLinRatio, 25) / 25) * 70 + axisDominance * 30))
    );
  }

  // 5. Grip Force (FSR) Analysis & Bradykinetic Decay Slope
  const forces = dataWindow.map((d) => Math.max(0, d.fsr || 0));
  const avgForce = forces.reduce((a, b) => a + b, 0) / N;
  const forceVariance =
    forces.reduce((acc, f) => acc + (f - avgForce) * (f - avgForce), 0) / N;
  const forceStd = Math.sqrt(forceVariance);
  const forceCv = avgForce > 25 ? Math.min(100, (forceStd / avgForce) * 100) : 0;

  const firstHalfForce =
    forces.slice(0, Math.floor(N / 2)).reduce((a, b) => a + b, 0) /
    Math.max(1, Math.floor(N / 2));
  const secondHalfForce =
    forces.slice(Math.floor(N / 2)).reduce((a, b) => a + b, 0) /
    Math.max(1, N - Math.floor(N / 2));
  const gripDecaySlope = (secondHalfForce - firstHalfForce) / Math.max(0.5, durationSec * 0.5);

  const gripForceCoherence =
    avgForce > 20
      ? Math.min(100, Math.round(forceCv * 1.6 + (gripDecaySlope < -15 ? 25 : 10)))
      : rms > 0.25
      ? 72
      : 0;

  // 6. Micrographia / Spiral Drawing Spatial Analysis
  let micrographiaIndex = 0;
  const touchPoints = dataWindow.filter(
    (d) => typeof d.touchX === 'number' && typeof d.touchY === 'number'
  );
  if (touchPoints.length >= 10) {
    const stepDisplacements: number[] = [];
    for (let i = 1; i < touchPoints.length; i++) {
      const dx = (touchPoints[i].touchX || 0) - (touchPoints[i - 1].touchX || 0);
      const dy = (touchPoints[i].touchY || 0) - (touchPoints[i - 1].touchY || 0);
      stepDisplacements.push(Math.sqrt(dx * dx + dy * dy));
    }
    const earlyDisp =
      stepDisplacements
        .slice(0, Math.floor(stepDisplacements.length / 2))
        .reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(stepDisplacements.length / 2));
    const lateDisp =
      stepDisplacements
        .slice(Math.floor(stepDisplacements.length / 2))
        .reduce((a, b) => a + b, 0) /
      Math.max(1, stepDisplacements.length - Math.floor(stepDisplacements.length / 2));
    if (earlyDisp > 0.5 && lateDisp < earlyDisp) {
      const shrinkageRatio = (earlyDisp - lateDisp) / earlyDisp;
      micrographiaIndex = Math.min(100, Math.round(shrinkageRatio * 140));
    }
  } else if (gripDecaySlope < -10 && pdBandPower > 0.4) {
    micrographiaIndex = Math.min(100, Math.round(Math.abs(gripDecaySlope) * 0.6 + pdBandPower * 35));
  }

  // 7. Build Downsampled 8-Bin Visual Spectrum for Clinical UI
  const targetBins: { freq: number; label: string; band: SpectralBin['band'] }[] = [
    { freq: 2.0, label: '2Hz', band: 'voluntary' },
    { freq: 3.5, label: '3.5Hz', band: 'pd' },
    { freq: 5.0, label: '5Hz', band: 'pd' },
    { freq: 6.5, label: '6.5Hz', band: 'pd' },
    { freq: 8.0, label: '8Hz', band: 'et' },
    { freq: 9.5, label: '9.5Hz', band: 'et' },
    { freq: 11.0, label: '11Hz', band: 'et' },
    { freq: 13.0, label: '13Hz', band: 'physiological' },
  ];

  const spectrum: SpectralBin[] = targetBins.map((tb) => {
    const matching = rawSpectrum.filter((r) => Math.abs(r.freq - tb.freq) <= 0.75);
    const avgP =
      matching.length > 0
        ? matching.reduce((acc, m) => acc + m.power, 0) / matching.length
        : 0;
    return {
      freq: tb.freq,
      label: tb.label,
      power: rms === 0 ? 0 : Number((avgP * 10).toFixed(2)),
      band: tb.band,
    };
  });

  // 8. Unified Clinical Severity Staging (Normal / Stage 1 Mild / Stage 2 Moderate / Stage 3-4 Severe)
  const staging = calculateClinicalStaging(
    rms,
    peakFreq,
    voluntaryBandPower,
    sensitivityMultiplier,
    pdBandPower,
    spectralRegularity
  );

  // 9. Differential Bayesian / Ensemble Probability Scoring (PD vs ET vs Normal)
  let pdScore = 0;
  let etScore = 0;
  let normalScore = 15;

  if (staging.severityLabel === 'Normal' || staging.updrsScore < 0.5) {
    normalScore = 92;
    pdScore = 4;
    etScore = 4;
  } else {
    if (peakFreq >= 3.5 && peakFreq <= 6.4) {
      // Extra weighting when locked strictly inside the 4.0-6.0 Hz Nigrostriatal PD rest window
      const coreBoost = peakFreq >= 4.0 && peakFreq <= 6.0 ? 8 : 0;
      pdScore += 48 + coreBoost + pdBandPower * 35;
      etScore += etBandPower * 25;
    } else if (peakFreq > 6.4 && peakFreq <= 12.0) {
      etScore += 48 + etBandPower * 35;
      pdScore += pdBandPower * 25;
    } else {
      normalScore += 40;
    }

    if (pillRollingIndex >= 45) {
      pdScore += 18;
    } else if (pillRollingIndex < 25 && rms > 0.4) {
      etScore += 12;
    }

    if (avgForce < 350 || gripDecaySlope < -12) {
      pdScore += 14;
    }
    if (avgForce >= 450 && peakFreq >= 6.2) {
      etScore += 18;
    }

    if (spectralRegularity > 55) {
      if (peakFreq <= 6.4) pdScore += 10;
      else etScore += 10;
    }
  }

  const scoreSum = Math.max(1, pdScore + etScore + normalScore);
  const pdProbability = Math.round((pdScore / scoreSum) * 100);
  const etProbability = Math.round((etScore / scoreSum) * 100);
  const normalProbability = Math.max(0, 100 - pdProbability - etProbability);

  // 10. Determine Phenotype & Clinical Rationale (Guaranteed consistent with severityLabel & clinicalStage)
  let phenotype: TremorPhenotype = 'Resting Baseline';
  let clinicalRationale = '';

  if (staging.severityLabel === 'Normal' || staging.updrsScore < 0.5) {
    if (voluntaryBandPower > 0.6 && avgForce > 100) {
      phenotype = 'Voluntary Motion / Writing';
      clinicalRationale = `Low-frequency intentional kinematics (${peakFreq.toFixed(1)} Hz) with stable isometric grip (${avgForce.toFixed(0)} FSR). Pathological tremor bands (4–12 Hz) remain within physiological noise floor.`;
    } else {
      phenotype = 'Physiological / Subclinical';
      clinicalRationale = `Kinematic RMS (${rmsG.toFixed(3)} g) is within normal physiological stability (${staging.kinematicBracket}). No pathological tremor excursion detected.`;
    }
  } else if (pdProbability >= etProbability && pdProbability >= 45) {
    phenotype = 'Parkinsonian Tremor (PD)';
    clinicalRationale = `${staging.severityLabel} (${staging.clinicalStage}, UPDRS ${staging.updrsScore.toFixed(1)}, ${staging.hoehnYahrStage}) ${peakFreq.toFixed(1)} Hz narrowband oscillation (${Math.round(pdBandPower * 100)}% energy in 3.5–6.5 Hz PD band, ~${staging.estimatedExcursionCm.toFixed(2)} cm excursion) with pronation-supination rotational index (${pillRollingIndex}/100)${gripDecaySlope < -10 ? ' and bradykinetic grip decay' : ''}.`;
  } else if (etProbability > pdProbability && etProbability >= 45) {
    phenotype = 'Essential / Postural Tremor (ET)';
    clinicalRationale = `${staging.severityLabel} (${staging.clinicalStage}, UPDRS ${staging.updrsScore.toFixed(1)}) ${peakFreq.toFixed(1)} Hz kinetic/postural oscillation (${Math.round(etBandPower * 100)}% energy in 6.5–12.0 Hz ET band, ~${staging.estimatedExcursionCm.toFixed(2)} cm excursion)${avgForce > 50 ? ` coupled with active grip exertion (${avgForce.toFixed(0)} FSR)` : ''} and planar flexion-extension profile.`;
  } else {
    phenotype = 'Physiological / Subclinical';
    clinicalRationale = `Borderline ${staging.severityLabel.toLowerCase()} oscillation (${peakFreq.toFixed(1)} Hz, ${rmsG.toFixed(3)} g, ${staging.clinicalStage}). Continue recording during isolated rest and postural extension.`;
  }

  return {
    rms: Number(rms.toFixed(3)),
    rmsG: Number(rmsG.toFixed(4)),
    dominantFreq: Number(peakFreq.toFixed(1)),
    gyroRms: Number(gyroRms.toFixed(2)),
    avgForce: Number(avgForce.toFixed(0)),
    forceCv: Number(forceCv.toFixed(1)),
    gripDecaySlope: Number(gripDecaySlope.toFixed(1)),
    pdBandPower: Number(pdBandPower.toFixed(3)),
    pdCore4to6Power: Number(pdCore4to6Power.toFixed(3)),
    etBandPower: Number(etBandPower.toFixed(3)),
    voluntaryBandPower: Number(voluntaryBandPower.toFixed(3)),
    physBandPower: Number(physBandPower.toFixed(3)),
    spectralRegularity,
    pillRollingIndex,
    gripForceCoherence,
    micrographiaIndex,
    pdProbability,
    etProbability,
    normalProbability,
    phenotype,
    updrsScore: staging.updrsScore,
    constancyScore: staging.constancyScore,
    estimatedExcursionCm: staging.estimatedExcursionCm,
    hoehnYahrStage: staging.hoehnYahrStage,
    is4to6HzPdLock: staging.is4to6HzPdLock,
    clinicalStage: staging.clinicalStage,
    severityLabel: staging.severityLabel,
    kinematicBracket: staging.kinematicBracket,
    clinicalRationale,
    spectrum,
  };
}

/**
 * Generates realistic synthetic clinical telemetry frames calibrated to the unified staging scale:
 * - 'pd_resting': 4.8 Hz Parkinsonian pill-rolling tremor (Moderate Stage 2, ~0.78g, gradual recovery/modulation)
 * - 'et_postural': 8.5 Hz Essential action/postural tremor (Mild Stage 1, ~0.46g, active kinetic grip)
 * - 'physiological': Steady baseline (<0.05g, Stage 0 Normal)
 */
export function generateSimulatedSample(
  elapsedSec: number,
  profile: SimulationProfile = 'pd_resting',
  timestamp: number = Date.now()
): SensorData {
  const noise = () => (Math.random() - 0.5) * 0.08;

  if (profile === 'pd_resting') {
    const fPd = 4.8;
    const omega = 2 * Math.PI * fPd * elapsedSec;
    // Gradual therapeutic/stabilization envelope over time so live recovery rate is visibly dynamic
    const envelope = Math.max(0.72, 1.08 - Math.min(0.28, elapsedSec * 0.015) + 0.08 * Math.sin(2 * Math.PI * 0.25 * elapsedSec));
    const ax = Math.sin(omega) * 7.2 * envelope + noise();
    const ay = Math.cos(omega + 0.4) * 5.6 * envelope + noise();
    const az = 9.80665 + Math.sin(omega) * 2.1 * envelope + noise();

    // Pronation-supination rotational oscillation (high gx & gz)
    const gx = Math.cos(omega) * 145 * envelope + noise() * 10;
    const gy = Math.sin(omega) * 28 + noise() * 5;
    const gz = Math.sin(omega + 0.3) * 115 * envelope + noise() * 10;

    // Bradykinetic grip pressure: starts moderate (~260) and slowly decays with 4.8Hz force ripple
    const decay = Math.max(90, 260 - (elapsedSec % 12) * 14);
    const fsr = Math.max(0, decay + Math.sin(omega) * 28 + noise() * 15);

    return {
      timestamp,
      ax,
      ay,
      az,
      gx,
      gy,
      gz,
      mx: Math.sin(elapsedSec * 0.5) * 35,
      my: Math.cos(elapsedSec * 0.5) * 35,
      mz: 18 + noise() * 5,
      fsr,
    };
  }

  if (profile === 'et_postural') {
    const fEt = 8.5;
    const omega = 2 * Math.PI * fEt * elapsedSec;
    const envelope = Math.max(0.78, 1.04 - Math.min(0.20, elapsedSec * 0.012));
    const ax = Math.sin(omega) * 4.2 * envelope + noise() * 1.2;
    const ay = Math.sin(omega + 0.15) * 4.4 * envelope + noise() * 1.2;
    const az = 9.80665 + Math.sin(omega) * 2.4 * envelope + noise();

    // Flexion-extension primarily in gy, lower pronation-supination roll ratio
    const gx = Math.sin(omega) * 18 + noise() * 6;
    const gy = Math.cos(omega) * 95 + noise() * 8;
    const gz = Math.sin(omega) * 15 + noise() * 6;

    // High active kinetic grip exertion (~680 FSR) with 8.5Hz kinetic modulation
    const fsr = 680 + Math.sin(omega) * 85 + Math.cos(elapsedSec * 1.5) * 35;

    return {
      timestamp,
      ax,
      ay,
      az,
      gx,
      gy,
      gz,
      mx: Math.sin(elapsedSec) * 42,
      my: Math.cos(elapsedSec) * 42,
      mz: 22 + noise() * 5,
      fsr,
    };
  }

  const omegaPhys = 2 * Math.PI * 11.0 * elapsedSec;
  return {
    timestamp,
    ax: Math.sin(omegaPhys) * 0.06 + noise() * 0.4,
    ay: Math.cos(omegaPhys) * 0.05 + noise() * 0.4,
    az: 9.80665 + noise() * 0.4,
    gx: noise() * 3,
    gy: noise() * 3,
    gz: noise() * 3,
    mx: 28,
    my: 31,
    mz: 15,
    fsr: 310 + noise() * 8,
  };
}

export function downsampleTelemetry(data: SensorData[], maxPoints: number = 400): SensorData[] {
  if (!Array.isArray(data) || data.length <= maxPoints) {
    return data;
  }
  const result: SensorData[] = [];
  const step = (data.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(data.length - 1, Math.round(i * step));
    result.push(data[idx]);
  }
  return result;
}
