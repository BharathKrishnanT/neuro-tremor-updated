import { jsPDF } from 'jspdf';
import autoTable, { applyPlugin } from 'jspdf-autotable';
import { Session } from '../App';
import { format } from 'date-fns';
import { analyzeTremorDifferential } from './tremorAnalyzer';

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

  const diff = analyzeTremorDifferential(session.data, 'pen', 1.35);

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
    'Differential Tremor & Isometric Grip Force Assessment Report (MDS-UPDRS III Aligned)',
    14,
    17
  );

  let currentY = 29;
  doc.setFontSize(8.5);
  doc.setTextColor(100);
  doc.text(`Session ID: ${session.id}`, 14, currentY);
  if (session.integrityHash) {
    doc.text(`HMAC Audit Digest: ${session.integrityHash}`, 85, currentY);
  }
  doc.text(`Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`, 152, currentY);
  currentY += 6;

  // Section 1: Patient Details Table
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('1. Patient Demographics & Clinical Profile', 14, currentY);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.5);
  doc.line(14, currentY + 2, 196, currentY + 2);
  currentY += 4;

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
      { content: 'Referral / Notes:', styles: { fontStyle: 'bold' as const } },
      patient?.notes
        ? patient.notes.slice(0, 50) + (patient.notes.length > 50 ? '...' : '')
        : 'Differential PD vs. ET kinematic evaluation',
    ],
  ];

  autoTable(doc, {
    startY: currentY,
    body: patientTableBody,
    theme: 'plain',
    styles: { fontSize: 8.5, cellPadding: 1.8, textColor: [30, 41, 59] },
    columnStyles: {
      0: { cellWidth: 35, textColor: [71, 85, 105] },
      1: { cellWidth: 60 },
      2: { cellWidth: 35, textColor: [71, 85, 105] },
      3: { cellWidth: 55 },
    },
  });

  currentY = ((doc as any).lastAutoTable?.finalY ?? currentY + 24) + 5;

  // Section 2: Differential Tremor & Grip Force Biomarkers
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('2. Differential Phenotype & Spectral-Grip Biomarker Profile', 14, currentY);
  doc.setLineWidth(0.5);
  doc.line(14, currentY + 2, 196, currentY + 2);
  currentY += 4;

  const phenotypeLabel = session.phenotype || diff.phenotype;
  const pdProb = session.pdProbability ?? diff.pdProbability;
  const etProb = session.etProbability ?? diff.etProbability;
  const pillRoll = session.pillRollingIndex ?? diff.pillRollingIndex;
  const meanForce = session.avgForce ?? diff.avgForce;

  const findingsData = [
    [
      'Primary Motor Phenotype',
      phenotypeLabel,
      `PD Confidence: ${pdProb}% | ET Confidence: ${etProb}%`,
    ],
    [
      'Dominant Tremor Frequency',
      `${session.frequency.toFixed(2)} Hz`,
      `PD Band (3.5-6.5Hz): ${Math.round(diff.pdBandPower * 100)}% | ET Band (6.5-12Hz): ${Math.round(diff.etBandPower * 100)}%`,
    ],
    [
      'RMS Kinematic Amplitude',
      `${(session.rms / 9.80665).toFixed(4)} g (${session.rms.toFixed(2)} m/s²)`,
      `MDS-UPDRS III Score: ${diff.updrsScore.toFixed(1)} / 4.0 (${session.stage})`,
    ],
    [
      'Pill-Rolling Gyro Index',
      `${pillRoll} / 100`,
      pillRoll >= 45
        ? 'Pronation-supination rotational dominance (Characteristic of PD)'
        : 'Planar flexion-extension trajectory (Characteristic of ET / Action)',
    ],
    [
      'Isometric Grip Force (FSR)',
      `${meanForce} FSR (CV: ${diff.forceCv}%)`,
      `Force Decay Slope: ${diff.gripDecaySlope}/s (${diff.gripDecaySlope < -10 ? 'Bradykinetic decrement' : 'Stable grip'})`,
    ],
  ];

  autoTable(doc, {
    startY: currentY,
    head: [['Biomarker Parameter', 'Measured Value', 'Differential Diagnostic Interpretation']],
    body: findingsData,
    theme: 'grid',
    headStyles: {
      fillColor: [2, 132, 199],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    bodyStyles: { fontSize: 8.2, textColor: [30, 41, 59] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 48 },
      1: { cellWidth: 44, fontStyle: 'bold' },
      2: { cellWidth: 90 },
    },
  });

  currentY = ((doc as any).lastAutoTable?.finalY ?? currentY + 35) + 6;

  // Section 3: Clinical Impression & Rationale
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('3. Quantitative Differential Impression & Physician Review', 14, currentY);
  doc.setLineWidth(0.5);
  doc.line(14, currentY + 2, 196, currentY + 2);
  currentY += 6;

  doc.setFontSize(8.8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);

  doc.text(diff.clinicalRationale, 14, currentY, { maxWidth: 182 });
  currentY += 13;

  if (patient?.notes) {
    doc.setFont('helvetica', 'bold');
    doc.text('Clinician Notes:', 14, currentY);
    doc.setFont('helvetica', 'italic');
    doc.text(patient.notes, 45, currentY, { maxWidth: 151 });
    currentY += 12;
  }

  // Physician Sign-off block
  currentY += 6;
  doc.setFont('helvetica', 'normal');
  doc.setDrawColor(148, 163, 184);
  doc.line(14, currentY + 12, 90, currentY + 12);
  doc.line(120, currentY + 12, 196, currentY + 12);

  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(
    `Attending Physician / Examiner (${patient?.clinicianName || 'Signature'})`,
    14,
    currentY + 16
  );
  doc.text(`Date & Verification (${dateStr.split(' ')[0]})`, 120, currentY + 16);

  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      'CONFIDENTIAL CLINICAL ASSESSMENT — Generated via NeuroTremor for investigational screening & decision support. Not a diagnostic device.',
      doc.internal.pageSize.width / 2,
      doc.internal.pageSize.height - 8,
      { align: 'center' }
    );
  }

  doc.save(fileName);
};
