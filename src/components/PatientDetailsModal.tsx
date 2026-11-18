import React, { useState, useEffect } from 'react';
import { User, Hash, Calendar, Stethoscope, FileText, X, Download, Clock } from 'lucide-react';
import { useLanguage } from '../lib/i18n';
import { PatientDetails } from '../lib/reportGenerator';

interface PatientDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (details: PatientDetails) => void;
  defaultAssessmentDate?: number;
}

export const PatientDetailsModal: React.FC<PatientDetailsModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  defaultAssessmentDate,
}) => {
  const { t } = useLanguage();

  // Helper to format ISO datetime for datetime-local input
  const getFormattedDateTime = (timestamp?: number) => {
    const d = timestamp ? new Date(timestamp) : new Date();
    // Format YYYY-MM-DDTHH:mm in local timezone
    const offset = d.getTimezoneOffset() * 60000;
    const localISOTime = new Date(d.getTime() - offset).toISOString().slice(0, 16);
    return localISOTime;
  };

  const [fullName, setFullName] = useState('');
  const [patientId, setPatientId] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('Male');
  const [dominantHand, setDominantHand] = useState('Right');
  const [clinicianName, setClinicianName] = useState('');
  const [assessmentDate, setAssessmentDate] = useState(() => getFormattedDateTime(defaultAssessmentDate));
  const [medicationStatus, setMedicationStatus] = useState('N/A');
  const [notes, setNotes] = useState('');

  // Reset or initialize default values whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setAssessmentDate(getFormattedDateTime(defaultAssessmentDate));
      if (!patientId) {
        // Auto-generate realistic MRN (Medical Record Number)
        const randomNum = Math.floor(100000 + Math.random() * 900000);
        setPatientId(`MRN-${randomNum}`);
      }
    }
  }, [isOpen, defaultAssessmentDate]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      fullName: fullName.trim() || 'Anonymous Patient',
      patientId: patientId.trim() || `MRN-${Date.now().toString().slice(-6)}`,
      age: age.trim() || 'N/A',
      gender,
      dominantHand,
      clinicianName: clinicianName.trim() || 'Attending Physician',
      assessmentDate: assessmentDate ? new Date(assessmentDate).toLocaleString() : new Date().toLocaleString(),
      medicationStatus,
      notes: notes.trim(),
    });
  };

  const handleQuickDownload = () => {
    onSubmit({
      fullName: 'Anonymous Patient',
      patientId: patientId || `MRN-${Date.now().toString().slice(-6)}`,
      age: 'N/A',
      gender: 'Unspecified',
      dominantHand: 'Right',
      clinicianName: 'Attending Physician',
      assessmentDate: assessmentDate ? new Date(assessmentDate).toLocaleString() : new Date().toLocaleString(),
      medicationStatus: 'N/A',
      notes: '',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg max-w-2xl w-full p-5 shadow-xl overflow-hidden max-h-[92vh] flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-md bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-400 flex items-center justify-center border border-sky-200 dark:border-sky-800">
              <FileText size={18} />
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                {t('patientDetailsModalTitle')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('patientDetailsModalDesc')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title={t('close')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto py-3 space-y-3.5 pr-1 custom-scrollbar">
          {/* Assessment Date Banner (Automatic) */}
          <div className="bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-md p-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center space-x-2 text-slate-800 dark:text-slate-200 text-xs font-medium">
              <Calendar size={14} className="text-sky-700 dark:text-sky-400" />
              <span>{t('assessmentDate')}:</span>
              <span className="font-mono text-slate-900 dark:text-white font-semibold">
                {assessmentDate ? new Date(assessmentDate).toLocaleString() : new Date().toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="datetime-local"
                value={assessmentDate}
                onChange={(e) => setAssessmentDate(e.target.value)}
                className="text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-0.5 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <button
                type="button"
                onClick={() => setAssessmentDate(getFormattedDateTime())}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-slate-200/80 hover:bg-slate-300/80 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 font-medium transition-colors"
                title="Reset to current time"
              >
                <Clock size={11} />
                <span>Now</span>
              </button>
            </div>
          </div>

          {/* Primary Info: Name & ID */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                {t('patientFullName')} <span className="text-rose-600">*</span>
              </label>
              <div className="relative">
                <User size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Eleanor Vance"
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all"
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                {t('patientId')}
              </label>
              <div className="relative">
                <Hash size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
                <input
                  type="text"
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  placeholder="e.g. MRN-849201"
                  className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
              </div>
            </div>
          </div>

          {/* Demographic Grid: Age, Gender, Dominant Hand, Medication */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                {t('patientAge')}
              </label>
              <input
                type="number"
                min="1"
                max="125"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="e.g. 68"
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                {t('patientGender')}
              </label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              >
                <option value="Male">{t('genderMale')}</option>
                <option value="Female">{t('genderFemale')}</option>
                <option value="Other">{t('genderOther')}</option>
                <option value="Unspecified">{t('genderUnspecified')}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                {t('dominantHand')}
              </label>
              <select
                value={dominantHand}
                onChange={(e) => setDominantHand(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              >
                <option value="Right">{t('handRight')}</option>
                <option value="Left">{t('handLeft')}</option>
                <option value="Ambidextrous">{t('handAmbidextrous')}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
                {t('medicationState')}
              </label>
              <select
                value={medicationStatus}
                onChange={(e) => setMedicationStatus(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              >
                <option value="ON Medication">{t('medOn')}</option>
                <option value="OFF Medication">{t('medOff')}</option>
                <option value="N/A">{t('medNa')}</option>
              </select>
            </div>
          </div>

          {/* Clinician Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
              {t('clinicianName')}
            </label>
            <div className="relative">
              <Stethoscope size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
              <input
                type="text"
                value={clinicianName}
                onChange={(e) => setClinicianName(e.target.value)}
                placeholder="e.g. Dr. Robert Chen, MD (Neurology)"
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all"
              />
            </div>
          </div>

          {/* Clinical Notes */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
              {t('clinicalNotes')}
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Patient presents with resting tremor in right upper extremity. Tremor exacerbates during postural extension."
              className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all resize-none"
            />
          </div>

          {/* Action Buttons */}
          <div className="pt-2.5 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={handleQuickDownload}
              className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 underline font-medium transition-colors"
            >
              {t('skipAndGenerate')}
            </button>

            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 sm:flex-initial px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-md border border-slate-200 dark:border-slate-700 transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                className="flex-1 sm:flex-initial flex items-center justify-center space-x-1.5 px-4 py-1.5 text-xs font-medium text-white bg-sky-700 hover:bg-sky-800 rounded-md shadow-2xs transition-all"
              >
                <Download size={14} />
                <span>{t('generatePdfReport')}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
