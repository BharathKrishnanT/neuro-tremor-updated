import { jsPDF } from 'jspdf';
import autoTable, { applyPlugin } from 'jspdf-autotable';
import { Session } from '../App';
import { format } from 'date-fns';
import {
  analyzeTremorDifferential,
  computeDatasetSectionSummary,
  computeSensorChannelStats,
} from './tremorAnalyzer';
import { renderDrawingToCanvas } from '../components/TouchPadCanvas';

try {
  applyPlugin(jsPDF);
} catch {
  // Ignore if already applied
}

export interface PatientDetails {
  fullName: string;
  patientId: string;
  age: string | number;
  gender: string;
  dominantHand: string;
  clinicianName: string;
  assessmentDate: string;
  medicationStatus?: string;
  notes?: string;
}

export const generateClinicalReport = (session: Session, patient?: PatientDetails) => {
  const doc = new jsPDF();
  const dateStr = patient?.assessmentDate || format(session.timestamp, 'yyyy-MM-dd HH:mm:ss');

  const sanitizedName = patient?.fullName
    ? patient.fullName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)
    : 'Patient';
  const fileName = `NeuroTremor_Report_${sanitizedName}_${format(session.timestamp, 'yyyyMMdd_HHmm')}.pdf`;

  const diff = session.analysis || analyzeTremorDifferential(session.data, 'pen', 1.35);
  const datasetSummary =
    session.datasetSummary ||
    computeDatasetSectionSummary(
      session.data,
      'pen',
      session.sensitivityMultiplier ?? 1.35
    );
  const sensorStats = session.sensorStats || computeSensorChannelStats(session.data);

  // Top Hospital / Clinic Branding Bar
  doc.setFillColor(15, 23, 42); // Slate 900
  doc.rect(0, 0, 210, 22, 'F');

  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.text('NEUROLOGY & MOVEMENT DISORDERS CLINIC', 14, 11);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(
    'Differential Tremor, Trackpad Drawing & Multi-Sensor Telemetry Report (MDS-UPDRS III Aligned)',
    14,
    17
  );

  let currentY = 28;
  doc.setFontSize(8.2);
  doc.setTextColor(100);
  doc.text(`Session ID: ${session.id}`, 14, currentY);
  if (session.integrityHash) {
    doc.text(`HMAC Audit Digest: ${session.integrityHash}`, 85, currentY);
  }
  doc.text(`Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`, 152, currentY);
  currentY += 5;

  // Section 1: Patient Details Table
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('1. Patient Demographics & Clinical Profile', 14, currentY);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.5);
  doc.line(14, currentY + 1.8, 196, currentY + 1.8);
  currentY += 3.5;

  const patientTableBody = [
    [
      { content: 'Patient Name:', styles: { fontStyle: 'bold' as const } },
      patient?.fullName || 'Anonymous / Unspecified',
      { content: 'Patient ID / MRN:', styles: { fontStyle: 'bold' as const } },
      patient?.patientId || 'MRN-RECORD',
    ],
    [
      { content: 'Age / Gender:', styles: { fontStyle: 'bold' as const } },
      `${patient?.age || 'N/A'} / ${patient?.gender || 'Unspecified'}`,
      { content: 'Dominant Hand:', styles: { fontStyle: 'bold' as const } },
      patient?.dominantHand || 'Right',
    ],
    [
      { content: 'Assessment Date:', styles: { fontStyle: 'bold' as const } },
      dateStr,
      { content: 'Medication State:', styles: { fontStyle: 'bold' as const } },
      patient?.medicationStatus || 'N/A',
    ],
    [
      { content: 'Attending Clinician:', styles: { fontStyle: 'bold' as const } },
      patient?.clinicianName || 'Attending Physician',
      { content: 'Telemetry & Mode:', styles: { fontStyle: 'bold' as const } },
      `${session.rawSampleCount || session.data.length} pts (${session.duration.toFixed(1)}s) · ${
        session.canvasMode === 'freedraw' ? 'Free-Draw' : 'Guided Spiral'
      }`,
    ],
  ];

  autoTable(doc, {
    startY: currentY,
    body: patientTableBody,
    theme: 'plain',
    styles: { fontSize: 8.2, cellPadding: 1.4, textColor: [30, 41, 59] },
    columnStyles: {
      0: { cellWidth: 35, textColor: [71, 85, 105] },
      1: { cellWidth: 60 },
      2: { cellWidth: 35, textColor: [71, 85, 105] },
      3: { cellWidth: 55 },
    },
  });

  currentY = ((doc as any).lastAutoTable?.finalY ?? currentY + 22) + 4;

  // Section 2: Differential Tremor & Grip Force Biomarkers
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('2. Total-Section Averaged Differential Biomarkers & Recovery Analysis', 14, currentY);
  doc.setLineWidth(0.5);
  doc.line(14, currentY + 1.8, 196, currentY + 1.8);
  currentY += 3.5;

  const phenotypeLabel = session.phenotype || diff.phenotype;
  const pdProb = session.pdProbability ?? diff.pdProbability;
  const etProb = session.etProbability ?? diff.etProbability;
  const pillRoll = session.pillRollingIndex ?? diff.pillRollingIndex;
  const meanForce = session.avgForce ?? diff.avgForce;
  const recRate = session.recoveryRate ?? 0;

  const findingsData = [
    [
      'Primary Motor Phenotype',
      phenotypeLabel,
      `PD: ${pdProb}% | ET: ${etProb}% | Normal: ${diff.normalProbability}%`,
    ],
    [
      'Dominant Tremor Frequency',
      `${session.frequency.toFixed(2)} Hz`,
      `4-6Hz PD Core: ${Math.round((diff.pdCore4to6Power ?? diff.pdBandPower) * 100)}% (3.5-6.5Hz: ${Math.round(diff.pdBandPower * 100)}%) | ET (6.5-12Hz): ${Math.round(
        diff.etBandPower * 100
      )}% | Rhythmicity (Q): ${diff.spectralRegularity}%`,
    ],
    [
      'RMS Kinematic Amplitude',
      `${(session.rms / 9.80665).toFixed(4)} g (${session.rms.toFixed(2)} m/s²)`,
      `UPDRS III: ${diff.updrsScore.toFixed(1)}/4.0 (${session.stage} · ${diff.hoehnYahrStage}) · ~${diff.estimatedExcursionCm.toFixed(2)} cm (${diff.kinematicBracket})`,
    ],
    [
      'Dataset Section Summary (Avg)',
      `${datasetSummary.avgRmsG.toFixed(3)} g · ${datasetSummary.avgFrequency.toFixed(1)} Hz · ${datasetSummary.avgSeverity.toFixed(2)}/4.0`,
      `${datasetSummary.segmentCount} windows (${datasetSummary.totalPoints} pts) · Dist [None:${datasetSummary.severityCounts[0]}, Mild:${datasetSummary.severityCounts[1]}, Mod:${datasetSummary.severityCounts[2]}, Sev:${datasetSummary.severityCounts[3]}, Ext:${datasetSummary.severityCounts[4]}]`,
    ],
    [
      'Section Recovery Rate',
      `${recRate > 0 ? '+' : ''}${recRate.toFixed(1)}% (${session.sectionComparisonLabel || 'Recorded'})`,
      session.previousSectionRms && session.previousSectionRms > 0
        ? `Compared to previous recorded section RMS (${(session.previousSectionRms / 9.80665).toFixed(3)} g / ${session.previousSectionRms.toFixed(2)} m/s²)`
        : 'Initial recorded baseline section (S-1)',
    ],
    [
      'Pill-Rolling & Micrographia',
      `Pill-Roll: ${pillRoll}/100 | Micrographia: ${diff.micrographiaIndex}/100`,
      `Gyro RMS: ${diff.gyroRms.toFixed(2)} °/s | Constancy: ${diff.constancyScore}/4 | Grip Coherence: ${diff.gripForceCoherence}/100`,
    ],
    [
      'Isometric Grip Force (FSR)',
      `${meanForce} FSR (CV: ${diff.forceCv}%)`,
      `Force Decay Slope: ${diff.gripDecaySlope}/s (${diff.gripDecaySlope < -10 ? 'Bradykinetic decrement' : 'Stable grip'})`,
    ],
  ];

  autoTable(doc, {
    startY: currentY,
    head: [['Calculated Parameter', 'Measured Value', 'Differential Diagnostic Interpretation']],
    body: findingsData,
    theme: 'grid',
    headStyles: {
      fillColor: [2, 132, 199],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.2,
    },
    bodyStyles: { fontSize: 7.8, cellPadding: 1.5, textColor: [30, 41, 59] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 46 },
      1: { cellWidth: 46, fontStyle: 'bold' },
      2: { cellWidth: 90 },
    },
  });

  currentY = ((doc as any).lastAutoTable?.finalY ?? currentY + 32) + 4;

  // Section 3: Read Multi-Sensor Channel Statistics
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('3. Multi-Channel Read Sensor Telemetry Summary (9-DOF IMU + FSR)', 14, currentY);
  doc.setLineWidth(0.5);
  doc.line(14, currentY + 1.8, 196, currentY + 1.8);
  currentY += 3.5;

  const sensorRows = [
    ['Accelerometer (m/s²)', `X: ${sensorStats.ax.mean} (RMS ${sensorStats.ax.rms})`, `Y: ${sensorStats.ay.mean} (RMS ${sensorStats.ay.rms})`, `Z: ${sensorStats.az.mean} (RMS ${sensorStats.az.rms})`],
    ['Gyroscope (°/s)', `GX: ${sensorStats.gx.mean} (RMS ${sensorStats.gx.rms})`, `GY: ${sensorStats.gy.mean} (RMS ${sensorStats.gy.rms})`, `GZ: ${sensorStats.gz.mean} (RMS ${sensorStats.gz.rms})`],
    ['Magnetometer (µT) & Grip', `MX: ${sensorStats.mx.mean} | MY: ${sensorStats.my.mean}`, `MZ: ${sensorStats.mz.mean} µT`, `FSR Mean: ${sensorStats.fsr.mean} (Max ${sensorStats.fsr.max})`],
  ];

  autoTable(doc, {
    startY: currentY,
    body: sensorRows,
    theme: 'grid',
    styles: { fontSize: 7.6, cellPadding: 1.4, textColor: [30, 41, 59] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 42, fillColor: [241, 245, 249] },
      1: { cellWidth: 46 },
      2: { cellWidth: 46 },
      3: { cellWidth: 48 },
    },
  });

  currentY = ((doc as any).lastAutoTable?.finalY ?? currentY + 18) + 4;

  // Section 4: Captured Trackpad Drawing Snapshot (if drawing strokes exist)
  if (session.drawingStrokes && session.drawingStrokes.length > 0 && typeof document !== 'undefined') {
    try {
      const offscreen = document.createElement('canvas');
      offscreen.width = 640;
      offscreen.height = 220;
      const ctx = offscreen.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, offscreen.width, offscreen.height);
        renderDrawingToCanvas(
          ctx,
          offscreen.width,
          offscreen.height,
          session.canvasMode || 'spiral',
          session.drawingStrokes
        );
        const imgData = offscreen.toDataURL('image/png');
        doc.setFontSize(10.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(
          `4. Captured Trackpad Drawing (${session.canvasMode === 'freedraw' ? 'Free-Draw' : 'Guided Spiral'} · ${session.drawingStrokes.length} Stroke${session.drawingStrokes.length === 1 ? '' : 's'})`,
          14,
          currentY
        );
        currentY += 2.5;
        doc.addImage(imgData, 'PNG', 14, currentY, 182, 42);
        currentY += 46;
      }
    } catch {
      // Ignore canvas export errors in headless environments
    }
  }

  // Section 4b: Time-Synchronized 200 Hz Multimodal Fusion Biomarkers (when available)
  if (session.multimodalFusion) {
    const mf = session.multimodalFusion;
    if (currentY > 235) {
      doc.addPage();
      currentY = 18;
    }
    doc.setFontSize(10.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(
      `Time-Synchronized Stroke-Level Multimodal Fusion (${mf.sampleRateHz} Hz · ${mf.totalMatrixRows.toLocaleString()} Synced Rows)`,
      14,
      currentY
    );
    doc.setLineWidth(0.5);
    doc.line(14, currentY + 1.8, 196, currentY + 1.8);
    currentY += 3.5;

    const fusionRows = [
      [
        'In-Air Resting Tremor (pen_up)',
        `${mf.inAirTremor.dominantFreqHz.toFixed(1)} Hz · ${mf.inAirTremor.rmsG.toFixed(3)} g`,
        `4-6 Hz PD Band: ${mf.inAirTremor.pd4to6Share}% | Duration: ${mf.inAirDurationSec.toFixed(1)}s (${mf.inAirTremor.windowCount} Welch windows)`,
      ],
      [
        'On-Paper Kinetic Tremor (pen_down)',
        `${mf.onPaperTremor.dominantFreqHz.toFixed(1)} Hz · ${mf.onPaperTremor.rmsG.toFixed(3)} g`,
        `5-10 Hz Kinetic Band: ${mf.onPaperTremor.kinetic5to10Share}% | Duration: ${mf.onPaperDurationSec.toFixed(1)}s (${mf.penDownRatioPct}% contact)`,
      ],
      [
        'Micrographia & Slowing',
        `Decay: ${mf.globalMotor.micrographiaDecayPct.toFixed(1)}% | Slowing: ${mf.globalMotor.progressiveSlowingPct.toFixed(1)}%`,
        `Mean Radial Error: ${mf.globalMotor.meanRadialErrorPx.toFixed(1)} px (RMS ${mf.globalMotor.rmsRadialErrorPx.toFixed(1)} px) | Mean Speed: ${mf.globalMotor.meanVelocityPxS.toFixed(0)} px/s`,
      ],
      [
        'FSR-Velocity Rigidity Coupling',
        `r = ${mf.rigidityCoupling.fsrVelocityCorrelation.toFixed(2)} | ${mf.rigidityCoupling.coupledSpikeCount} Spike(s)`,
        `On-Paper FSR: ${mf.rigidityCoupling.meanOnPaperFsr} (Peak ${mf.rigidityCoupling.peakFsr}) | In-Air FSR: ${mf.rigidityCoupling.meanInAirFsr}`,
      ],
    ];

    autoTable(doc, {
      startY: currentY,
      head: [['Fusion Dimension', 'Measured Value', '200 Hz Post-Completion Clinical Interpretation']],
      body: fusionRows,
      theme: 'grid',
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.0,
      },
      bodyStyles: { fontSize: 7.6, cellPadding: 1.4, textColor: [30, 41, 59] },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 46 },
        1: { cellWidth: 46, fontStyle: 'bold' },
        2: { cellWidth: 90 },
      },
    });

    currentY = ((doc as any).lastAutoTable?.finalY ?? currentY + 26) + 4;
  }

  // Section 5: Clinical Impression & Rationale
  if (currentY > 250) {
    doc.addPage();
    currentY = 18;
  }
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('Quantitative Differential Impression & Physician Sign-Off', 14, currentY);
  doc.setLineWidth(0.5);
  doc.line(14, currentY + 1.8, 196, currentY + 1.8);
  currentY += 5;

  doc.setFontSize(8.2);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);

  const combinedRationale = session.multimodalFusion
    ? `${diff.clinicalRationale} ${session.multimodalFusion.fusionClinicalSummary}`
    : diff.clinicalRationale;
  doc.text(combinedRationale, 14, currentY, { maxWidth: 182 });
  currentY += session.multimodalFusion ? 16 : 10;

  if (patient?.notes) {
    doc.setFont('helvetica', 'bold');
    doc.text('Clinician Notes:', 14, currentY);
    doc.setFont('helvetica', 'italic');
    doc.text(patient.notes, 42, currentY, { maxWidth: 154 });
    currentY += 8;
  }

  // Physician Sign-off block
  currentY += 4;
  doc.setFont('helvetica', 'normal');
  doc.setDrawColor(148, 163, 184);
  doc.line(14, currentY + 9, 90, currentY + 9);
  doc.line(120, currentY + 9, 196, currentY + 9);

  doc.setFontSize(7.8);
  doc.setTextColor(100);
  doc.text(
    `Attending Physician / Examiner (${patient?.clinicianName || 'Signature'})`,
    14,
    currentY + 13
  );
  doc.text(`Date & Verification (${dateStr.split(' ')[0]})`, 120, currentY + 13);

  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7.2);
    doc.setTextColor(148, 163, 184);
    doc.text(
      'CONFIDENTIAL CLINICAL ASSESSMENT — Generated via NeuroTremor for investigational screening & decision support. Not a diagnostic device.',
      doc.internal.pageSize.width / 2,
      doc.internal.pageSize.height - 7,
      { align: 'center' }
    );
  }

  doc.save(fileName);
};
