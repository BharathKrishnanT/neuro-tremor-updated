import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichSensorFrame, SensorData } from './serial';
import {
  FUSION_SAMPLE_RATE_HZ,
  RawDigitizerSample,
  computeArchimedesRadialError,
  resampleTo200HzMatrix,
  computeMultimodalFusion,
  generateDemoFusionTick,
  format200HzMatrixCsv,
  format200HzMatrixJson,
} from './multimodalFusion';

test('computeArchimedesRadialError returns ~0 px on ideal spiral and exact radial offset when shifted', () => {
  const width = 800;
  const height = 320;
  const cx = width / 2;
  const cy = height / 2;
  const scale = 5; // canvasWidth <= 1000
  const theta = 10.5;
  const idealR = (1 + theta) * scale;

  const exactX = cx + idealR * Math.cos(theta);
  const exactY = cy + idealR * Math.sin(theta);
  const exactErr = computeArchimedesRadialError(exactX, exactY, width, height);
  assert.ok(exactErr < 0.05, `Expected near-zero radial error on ideal spiral, got ${exactErr}`);

  const offset = 12;
  const shiftedX = cx + (idealR + offset) * Math.cos(theta);
  const shiftedY = cy + (idealR + offset) * Math.sin(theta);
  const shiftedErr = computeArchimedesRadialError(shiftedX, shiftedY, width, height);
  assert.ok(
    Math.abs(shiftedErr - offset) < 0.25,
    `Expected ~${offset} px radial error, got ${shiftedErr}`
  );
});

test('resampleTo200HzMatrix produces uniform 5 ms spacing and all 17 synchronized channels', () => {
  const t0 = 1_700_000_000_000;
  const durationMs = 4000; // 4 s -> 801 rows at 200 Hz
  const sensors: SensorData[] = [];
  const digitizer: RawDigitizerSample[] = [];

  for (let ms = 0; ms <= durationMs; ms += 20) {
    const tSec = ms / 1000;
    const penDown: 0 | 1 = ms >= 1000 && ms <= 3000 ? 1 : 0;
    sensors.push(
      enrichSensorFrame({
        ax: 1.5 * Math.sin(2 * Math.PI * 5 * tSec),
        ay: 1.2 * Math.cos(2 * Math.PI * 5 * tSec),
        az: 9.80665,
        gx: 12 * Math.sin(2 * Math.PI * 5 * tSec),
        gy: -10 * Math.cos(2 * Math.PI * 5 * tSec),
        gz: 0,
        mx: 28,
        my: -12,
        mz: 36,
        fsr: penDown === 1 ? 1500 : 250,
        timestamp: t0 + ms,
      })
    );
    digitizer.push({
      tMs: t0 + ms,
      x: 400 + 40 * Math.cos(tSec * 2),
      y: 160 + 40 * Math.sin(tSec * 2),
      pressure: penDown === 1 ? 1500 : 0,
      penDown,
      mode: 'spiral',
      canvasWidth: 800,
      canvasHeight: 320,
    });
  }

  const matrix = resampleTo200HzMatrix(sensors, digitizer, t0, durationMs, 'spiral', 800, 320);
  assert.equal(matrix.length, Math.floor((durationMs / 1000) * FUSION_SAMPLE_RATE_HZ) + 1);
  assert.equal(matrix[0].t, 0);

  for (let i = 1; i < matrix.length; i++) {
    const dt = Number((matrix[i].t - matrix[i - 1].t).toFixed(4));
    assert.equal(dt, 0.005, `Expected uniform 5 ms step at row ${i}, got ${dt}`);
  }

  // Verify pen_up vs pen_down zero-order hold separation
  assert.equal(matrix[100].penDown, 0); // t = 0.5s
  assert.equal(matrix[400].penDown, 1); // t = 2.0s
  assert.equal(matrix[700].penDown, 0); // t = 3.5s
});

test('computeMultimodalFusion cleanly separates In-Air 4.8 Hz PD tremor from On-Paper 8.5 Hz kinetic tremor and detects rigidity coupling', () => {
  const t0 = 1_700_000_000_000;
  const durationSec = 24;
  const durationMs = durationSec * 1000;
  const sensors: SensorData[] = [];
  const digitizer: RawDigitizerSample[] = [];
  const width = 800;
  const height = 320;
  const cx = width / 2;
  const cy = height / 2;

  // Phase schedule:
  // [0..6s]  In-Air (pen_up): 4.8 Hz PD rest tremor
  // [6..18s] On-Paper (pen_down): 8.5 Hz kinetic tremor + progressive slowing + micrographia + rigidity spikes at 10s and 14s
  // [18..24s] In-Air (pen_up): 4.8 Hz PD rest tremor
  let theta = 2.0;

  for (let ms = 0; ms <= durationMs; ms += 10) {
    const tSec = ms / 1000;
    const isOnPaper = tSec >= 6.0 && tSec < 18.0;
    const penDown: 0 | 1 = isOnPaper ? 1 : 0;

    // Rigidity spikes centered at t = 10s and t = 14s
    const spike1 = Math.exp(-Math.pow(tSec - 10.0, 2) / 0.12);
    const spike2 = Math.exp(-Math.pow(tSec - 14.0, 2) / 0.12);
    const spikeEnv = Math.max(spike1, spike2);

    // Progressive slowing across on-paper segment + sharp dip during rigidity spikes
    const progress = isOnPaper ? (tSec - 6.0) / 12.0 : 0;
    const baseOmega = 3.2 * (1 - 0.45 * progress); // slower later
    const effectiveOmega = baseOmega * (1 - 0.72 * spikeEnv);

    if (isOnPaper) {
      theta += effectiveOmega * 0.01;
    }

    // Progressive micrographia (radius shrinks slightly toward end of trial)
    const radius = 85 * (1 - 0.32 * progress);
    const x = cx + radius * Math.cos(theta);
    const y = cy + radius * Math.sin(theta);

    const freq = isOnPaper ? 8.5 : 4.8;
    const amp = isOnPaper ? 2.4 : 3.2;

    const fsr = isOnPaper
      ? Math.round(1350 + 1600 * spikeEnv)
      : Math.round(280 + 25 * Math.sin(2 * Math.PI * 4.8 * tSec));

    sensors.push(
      enrichSensorFrame({
        ax: amp * Math.sin(2 * Math.PI * freq * tSec),
        ay: amp * 0.75 * Math.cos(2 * Math.PI * freq * tSec),
        az: 9.80665 + amp * 0.25 * Math.sin(2 * Math.PI * freq * tSec),
        gx: amp * 8 * Math.sin(2 * Math.PI * freq * tSec),
        gy: amp * 6 * Math.cos(2 * Math.PI * freq * tSec),
        gz: 0,
        mx: 28,
        my: -12,
        mz: 36,
        fsr,
        timestamp: t0 + ms,
      })
    );

    digitizer.push({
      tMs: t0 + ms,
      x,
      y,
      pressure: fsr,
      penDown,
      mode: 'spiral',
      canvasWidth: width,
      canvasHeight: height,
    });
  }

  const { summary, matrix } = computeMultimodalFusion(
    sensors,
    digitizer,
    [],
    t0,
    t0 + durationMs,
    'spiral',
    width,
    height
  );

  assert.equal(summary.sampleRateHz, 200);
  assert.equal(summary.totalMatrixRows, matrix.length);
  assert.ok(
    Math.abs(summary.inAirTremor.dominantFreqHz - 4.8) <= 0.6,
    `Expected In-Air dominant freq ~4.8 Hz, got ${summary.inAirTremor.dominantFreqHz} Hz`
  );
  assert.ok(
    Math.abs(summary.onPaperTremor.dominantFreqHz - 8.5) <= 0.6,
    `Expected On-Paper dominant freq ~8.5 Hz, got ${summary.onPaperTremor.dominantFreqHz} Hz`
  );
  assert.ok(
    summary.inAirTremor.pd4to6Share >= 40,
    `Expected high 4–6 Hz PD share in-air, got ${summary.inAirTremor.pd4to6Share}%`
  );
  assert.ok(
    summary.onPaperTremor.kinetic5to10Share >= 40,
    `Expected high 5–10 Hz kinetic share on-paper, got ${summary.onPaperTremor.kinetic5to10Share}%`
  );
  assert.ok(
    summary.globalMotor.progressiveSlowingPct > 15,
    `Expected positive progressive slowing %, got ${summary.globalMotor.progressiveSlowingPct}%`
  );
  assert.ok(
    summary.rigidityCoupling.fsrVelocityCorrelation < -0.25,
    `Expected negative FSR-velocity correlation, got ${summary.rigidityCoupling.fsrVelocityCorrelation}`
  );
  assert.ok(
    summary.rigidityCoupling.coupledSpikeCount >= 1,
    `Expected at least 1 coupled rigidity spike, got ${summary.rigidityCoupling.coupledSpikeCount}`
  );
  assert.ok(summary.timelineSeries.length > 20);
  assert.ok(summary.fftComparisonSeries.length >= 20);
});

test('generateDemoFusionTick and 200 Hz CSV/JSON export format produce valid 17-channel output', () => {
  const t0 = 1_700_000_000_000;
  const sensors: SensorData[] = [];
  const digitizer: RawDigitizerSample[] = [];

  // Sample 12 seconds of Demo Fusion PD profile (covers initial [0..4s] in-air + [4..12s] on-paper)
  for (let ms = 0; ms <= 12000; ms += 20) {
    const tick = generateDemoFusionTick(ms / 1000, 'pd_resting', t0 + ms, 800, 320);
    sensors.push(tick.sensor);
    digitizer.push(tick.digitizer);
  }

  const hasInAir = digitizer.some((d) => d.penDown === 0);
  const hasOnPaper = digitizer.some((d) => d.penDown === 1);
  assert.ok(hasInAir && hasOnPaper, 'Demo fusion stream should contain both pen_up and pen_down');

  const { summary, matrix } = computeMultimodalFusion(
    sensors,
    digitizer,
    [],
    t0,
    t0 + 12000,
    'spiral',
    800,
    320
  );

  const csv = format200HzMatrixCsv(matrix.slice(0, 10));
  const csvLines = csv.trim().split('\n');
  assert.equal(csvLines.length, 11);
  assert.equal(
    csvLines[0],
    't,x,y,vx,vy,radial_error,ax,ay,az,gx,gy,gz,mx,my,mz,fsr,pen_down'
  );
  assert.equal(csvLines[1].split(',').length, 17);

  const jsonStr = format200HzMatrixJson(summary, matrix.slice(0, 5));
  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.sampleRateHz, 200);
  assert.equal(parsed.channels.length, 17);
  assert.equal(parsed.matrix.length, 5);
  assert.ok(typeof parsed.summary.fusionClinicalSummary === 'string');
});
