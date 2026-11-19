import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeTremorDifferential,
  calculateClinicalStaging,
  computeDatasetSectionSummary,
  computeRecoveryAnalysis,
  generateSimulatedSample,
  downsampleTelemetry,
} from './tremorAnalyzer';
import { SensorData, enrichSensorFrame, parseUniversalTelemetryLine } from './serial';

function generateWindow(
  profile: 'pd_resting' | 'et_postural' | 'physiological',
  sampleCount = 100,
  rateHz = 50
): SensorData[] {
  const samples: SensorData[] = [];
  const startTs = 1700000000000;
  for (let i = 0; i < sampleCount; i++) {
    const elapsedSec = i / rateHz;
    const ts = startTs + Math.round(elapsedSec * 1000);
    samples.push(generateSimulatedSample(elapsedSec, profile, ts));
  }
  return samples;
}

test('Clinical Severity Staging aligns both 0.128g (1.25 m/s² @ 5.5 Hz PD lock) and 0.502g (4.92 m/s² @ 4.0 Hz) to Mild / Stage 1', () => {
  // 1. User hardware case 2: 0.128g (1.25 m/s²) at 5.5 Hz with 98% PD band energy and 100% rhythmicity (even at 0.90x sensitivity)
  const pdEarly = calculateClinicalStaging(1.25, 5.5, 0.02, 0.90, 0.98, 100);
  assert.equal(pdEarly.severityLabel, 'Mild');
  assert.equal(pdEarly.clinicalStage, 'Stage 1');
  assert.equal(pdEarly.is4to6HzPdLock, true);
  assert.ok(pdEarly.hoehnYahrStage.includes('H&Y Stage 1'));
  assert.ok(
    pdEarly.updrsScore >= 1.0 && pdEarly.updrsScore <= 1.8,
    `Expected Early 5.5Hz PD UPDRS in 1.0-1.8, got ${pdEarly.updrsScore}`
  );

  // 2. User hardware case 1: 0.502g (4.92 m/s²) at 4.0 Hz
  const staging = calculateClinicalStaging(4.92, 4.0, 0.05, 1.35, 0.95, 100);
  assert.equal(staging.severityLabel, 'Mild');
  assert.equal(staging.clinicalStage, 'Stage 1');
  assert.equal(staging.kinematicBracket, '0.06–0.55g mild');
  assert.ok(
    staging.updrsScore >= 0.8 && staging.updrsScore <= 1.8,
    `Expected Mild UPDRS in 0.8-1.8, got ${staging.updrsScore}`
  );
});

test('Clinical Severity Staging maps Normal (<0.06g), Moderate (0.55-1.15g), and Severe (>=1.15g) consistently', () => {
  const normal = calculateClinicalStaging(0.35, 5.0, 0.1, 1.35);
  assert.equal(normal.severityLabel, 'Normal');
  assert.equal(normal.clinicalStage, 'Normal');

  const moderate = calculateClinicalStaging(8.5, 4.8, 0.05, 1.35, 0.9, 95);
  assert.equal(moderate.severityLabel, 'Moderate');
  assert.equal(moderate.clinicalStage, 'Stage 2');

  const severe = calculateClinicalStaging(15.0, 4.8, 0.05, 1.35, 0.9, 95);
  assert.equal(severe.severityLabel, 'Severe');
  assert.ok(severe.clinicalStage === 'Stage 3' || severe.clinicalStage === 'Stage 4');
});

test('computeRecoveryAnalysis ignores unrecorded live testing and calculates sequential recovery across recorded sections', () => {
  // 0. Unrecorded live testing without recorded sections returns 0% (no continuous live recovery calculation)
  const unrecordedTesting = computeRecoveryAnalysis({
    currentRms: 3.8,
    sessionBaselineRms: 5.0,
    recordedSessions: [],
    isConnected: true,
  });
  assert.equal(unrecordedTesting.recoveryRate, 0);
  assert.equal(unrecordedTesting.recordedCount, 0);
  assert.equal(unrecordedTesting.baselineSource, 'Awaiting Recorded Section');

  // 1. Single recorded section (S-1) establishes the initial recorded baseline at 0%
  const singleRecorded = computeRecoveryAnalysis({
    recordedSessions: [{ rms: 8.0, timestamp: 1000 }],
  });
  assert.equal(singleRecorded.baselineSource, 'Initial Recorded Baseline');
  assert.equal(singleRecorded.recoveryRate, 0);
  assert.equal(singleRecorded.baselineRms, 8.0);
  assert.equal(singleRecorded.recordedCount, 1);

  // 2. Multiple recorded sections: calculates recovery rate of latest section (S-3) from the immediately previous section (S-2)
  const sequentialRecorded = computeRecoveryAnalysis({
    recordedSessions: [
      { rms: 3.0, timestamp: 3000 }, // S-3 (latest)
      { rms: 6.0, timestamp: 2000 }, // S-2 (previous recorded section)
      { rms: 8.0, timestamp: 1000 }, // S-1 (oldest)
    ],
  });
  assert.equal(sequentialRecorded.baselineSource, 'Previous Recorded Section');
  assert.equal(sequentialRecorded.previousSectionLabel, 'S-2');
  assert.equal(sequentialRecorded.latestSectionLabel, 'S-3');
  assert.equal(sequentialRecorded.baselineRms, 6.0);
  assert.equal(sequentialRecorded.currentRms, 3.0);
  assert.equal(sequentialRecorded.recoveryRate, 50.0);
  assert.equal(sequentialRecorded.statusLabel, 'Improving');
});

test('Parkinsonian resting tremor (4.8 Hz + pill-rolling + grip decay) is accurately classified as PD', () => {
  const pdWindow = generateWindow('pd_resting', 100, 50);
  const res = analyzeTremorDifferential(pdWindow, 'pen', 1.35);

  assert.equal(res.phenotype, 'Parkinsonian Tremor (PD)');
  assert.ok(res.dominantFreq >= 4.0 && res.dominantFreq <= 6.0);
  assert.ok(res.pdProbability > res.etProbability);
  assert.ok(res.pdBandPower > res.etBandPower);
  assert.ok(res.pillRollingIndex >= 40);
});

test('Essential / Postural tremor (8.5 Hz + active kinetic grip) is accurately differentiated from Parkinsonian tremor', () => {
  const etWindow = generateWindow('et_postural', 100, 50);
  const res = analyzeTremorDifferential(etWindow, 'pen', 1.35);

  assert.equal(res.phenotype, 'Essential / Postural Tremor (ET)');
  assert.ok(res.dominantFreq >= 7.0 && res.dominantFreq <= 10.5);
  assert.ok(res.etProbability > res.pdProbability);
  assert.ok(res.etBandPower > res.pdBandPower);
});

test('Physiological baseline is classified as Physiological / Subclinical with UPDRS 0 while retaining non-zero subclinical RMS and frequency', () => {
  const normWindow = generateWindow('physiological', 100, 50);
  const res = analyzeTremorDifferential(normWindow, 'pen', 1.35);

  assert.equal(res.phenotype, 'Physiological / Subclinical');
  assert.equal(res.updrsScore, 0);
  assert.equal(res.severityLabel, 'Normal');
  assert.ok(res.rms > 0, `Expected non-zero subclinical RMS, got ${res.rms}`);
  assert.ok(res.dominantFreq > 0, `Expected non-zero subclinical dominant frequency, got ${res.dominantFreq}`);
});

test('computeDatasetSectionSummary and analyzeTremorDifferential calculate section-wide average across all windows and ignore trailing stationary pause', () => {
  const activePd = generateWindow('pd_resting', 240, 50);
  const lastTs = activePd[activePd.length - 1].timestamp;
  const trailingStillness: SensorData[] = [];
  for (let i = 1; i <= 80; i++) {
    trailingStillness.push({
      ax: 0,
      ay: 0,
      az: 9.81,
      gx: 0,
      gy: 0,
      gz: 0,
      mx: 28,
      my: -14,
      mz: 41,
      fsr: 3403,
      timestamp: lastTs + i * 20,
    });
  }
  const fullSection = [...activePd, ...trailingStillness];
  const summary = computeDatasetSectionSummary(fullSection, 'pen', 1.35);

  assert.equal(summary.totalPoints, 320);
  assert.ok(summary.segmentCount >= 2);
  assert.ok(summary.avgRms > 1.5, `Expected section average RMS > 1.5 m/s², got ${summary.avgRms}`);
  assert.ok(summary.avgRmsG > 0.15, `Expected section average RMS > 0.15 g, got ${summary.avgRmsG}`);
  assert.ok(summary.avgFrequency >= 4.0 && summary.avgFrequency <= 6.0, `Expected 4-6Hz average frequency, got ${summary.avgFrequency}`);
  assert.equal(summary.differential.phenotype, 'Parkinsonian Tremor (PD)');
});

test('downsampleTelemetry bounds large arrays to maxPoints while preserving start and end', () => {
  const largeWindow = generateWindow('pd_resting', 1200, 100);
  const compact = downsampleTelemetry(largeWindow, 300);

  assert.equal(compact.length, 300);
  assert.equal(compact[0].timestamp, largeWindow[0].timestamp);
  assert.equal(compact[compact.length - 1].timestamp, largeWindow[largeWindow.length - 1].timestamp);
});

test('enrichSensorFrame and parseUniversalTelemetryLine synthesize live 3-axis Magnetometer (µT) and Grip Pressure for 6-DOF IMU packets while preserving 9-DOF hardware values', () => {
  // 1. 6-DOF KV line with omitted magnetometer and FSR
  const parsed6Dof = parseUniversalTelemetryLine('X:1.45,Y:-0.82,Z:9.65,GX:24.5,GY:-18.2,GZ:11.0');
  assert.ok(parsed6Dof !== null);
  assert.ok(Math.abs(parsed6Dof.mx) > 5, `Expected non-zero mx (µT), got ${parsed6Dof.mx}`);
  assert.ok(Math.abs(parsed6Dof.my) > 3, `Expected non-zero my (µT), got ${parsed6Dof.my}`);
  assert.ok(Math.abs(parsed6Dof.mz) > 10, `Expected non-zero mz (µT), got ${parsed6Dof.mz}`);
  assert.ok(parsed6Dof.fsr > 0, `Expected active grip pressure proxy > 0, got ${parsed6Dof.fsr}`);

  // 2. 9-DOF hardware frame with explicit magnetometer values is preserved unaltered
  const hw9Dof = enrichSensorFrame({
    ax: 0.5,
    ay: -0.2,
    az: 9.8,
    gx: 5.0,
    gy: -3.0,
    gz: 2.0,
    mx: 31.4,
    my: -15.8,
    mz: 42.1,
    fsr: 615,
    timestamp: Date.now(),
  });
  assert.equal(hw9Dof.mx, 31.4);
  assert.equal(hw9Dof.my, -15.8);
  assert.equal(hw9Dof.mz, 42.1);
  assert.equal(hw9Dof.fsr, 615);
});

test('ESP32-S3 Mini (ICM-20948 + FSR) 10-col and 13-col CSV lines with IMU_Status=OK parse accurately and filter startup headers', () => {
  // 1. Ignore ESP32-S3 startup headers and BLE status strings
  assert.equal(
    parseUniversalTelemetryLine('Time,IMU_Status,AccelX,AccelY,AccelZ,GyroX,GyroY,GyroZ,FSR_Raw,FSR_Pressure'),
    null
  );
  assert.equal(parseUniversalTelemetryLine('BLE CLIENT CONNECTED'), null);
  assert.equal(parseUniversalTelemetryLine('======================================'), null);

  // 2. 10-column ESP32-S3 Mini line: Time,IMU_Status,ax(mg),ay(mg),az(mg),gx,gy,gz,fsrRaw,fsrPressure
  const esp10Col = parseUniversalTelemetryLine('14520,OK,152.300,-241.000,985.450,18.250,-12.840,6.310,3650,445');
  assert.ok(esp10Col !== null);
  // 985.45 mg * 0.00980665 ≈ 9.664 m/s²
  assert.ok(esp10Col.az > 9.0 && esp10Col.az < 10.2, `Expected az in m/s², got ${esp10Col.az}`);
  assert.equal(esp10Col.gx, 18.25);
  assert.equal(esp10Col.gy, -12.84);
  assert.equal(esp10Col.gz, 6.31);
  assert.equal(esp10Col.fsr, 445);
  // Magnetometer is synthesized in µT when 10-col firmware omits magX/Y/Z
  assert.ok(Math.abs(esp10Col.mx) > 1 && Math.abs(esp10Col.mz) > 5);

  // 3. 13-column ESP32-S3 Mini 9-DOF line (with ICM-20948 AK09916 magX, magY, magZ in µT)
  const esp13Col = parseUniversalTelemetryLine(
    '14540,OK,152.300,-241.000,985.450,18.250,-12.840,6.310,29.450,-14.200,38.750,3650,445'
  );
  assert.ok(esp13Col !== null);
  assert.equal(esp13Col.mx, 29.45);
  assert.equal(esp13Col.my, -14.2);
  assert.equal(esp13Col.mz, 38.75);
  assert.equal(esp13Col.fsr, 445);
});



