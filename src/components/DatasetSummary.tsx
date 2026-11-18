import React, { useState } from 'react';
import { SensorData } from '../lib/serial';
import { mlService } from '../lib/mlService';
import { Play, Trash2, FileText } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { generateClinicalReport, PatientDetails } from '../lib/reportGenerator';
import { useLanguage } from '../lib/i18n';
import { PatientDetailsModal } from './PatientDetailsModal';

interface DatasetSummaryProps {
  data: SensorData[];
  title?: string;
  onPlay: () => void;
  onClear: () => void;
  onRequestReport?: (session: any) => void;
  isDark?: boolean;
}

export const DatasetSummary: React.FC<DatasetSummaryProps> = ({ 
  data, 
  title, 
  onPlay, 
  onClear,
  onRequestReport,
  isDark = true
}) => {
  const { t } = useLanguage();
  const [showPatientModal, setShowPatientModal] = useState(false);
  const displayTitle = title || t('datasetAnalysisSummary');
  const features = mlService.extractFeatures(data, 'pen');
  const severityValue = mlService.heuristicPrediction(features, 'pen');
  
  // Create a temporary session object for the report
  const sessionForReport = {
    id: `temp-${Date.now()}`,
    userId: 'local-user',
    timestamp: Date.now(),
    duration: data.length > 0 ? (data.length / 200) : 0, // Assuming ~200Hz
    data,
    severity: severityValue.toFixed(2),
    stage: severityValue > 3 ? 'Stage 3' : severityValue > 2 ? 'Stage 2' : severityValue > 1 ? 'Stage 1' : 'Normal',
    rms: features.rms,
    frequency: features.frequency,
  };
  
  // Calculate severity distribution (mocked for now based on segments)
  const segmentSize = 100;
  const segments = [];
  for (let i = 0; i < data.length; i += segmentSize) {
    const segment = data.slice(i, i + segmentSize);
    if (segment.length >= 10) {
      const f = mlService.extractFeatures(segment, 'pen');
      const severity = mlService.heuristicPrediction(f, 'pen');
      segments.push({
        index: i / segmentSize,
        severity,
        rms: f.rms
      });
    }
  }

  const severityCounts = [0, 0, 0, 0, 0];
  segments.forEach(s => severityCounts[Math.round(s.severity)]++);

  const chartData = [
    { name: t('none'), count: severityCounts[0], color: '#16a34a' },
    { name: t('mild'), count: severityCounts[1], color: '#0284c7' },
    { name: t('moderate'), count: severityCounts[2], color: '#d97706' },
    { name: t('severe'), count: severityCounts[3], color: '#dc2626' },
    { name: t('extreme'), count: severityCounts[4], color: '#991b1b' },
  ];

  const gridStroke = isDark ? '#1e293b' : '#e2e8f0';
  const axisColor = isDark ? '#64748b' : '#94a3b8';
  const tooltipBg = isDark ? '#0f172a' : '#ffffff';
  const tooltipBorder = isDark ? '#1e293b' : '#e2e8f0';
  const tooltipTextColor = isDark ? '#f8fafc' : '#0f172a';

  const handleDownloadClick = () => {
    if (onRequestReport) {
      onRequestReport(sessionForReport);
    } else {
      setShowPatientModal(true);
    }
  };

  const handlePatientSubmit = (details: PatientDetails) => {
    generateClinicalReport(sessionForReport, details);
    setShowPatientModal(false);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-lg p-4 mb-6 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-100">{displayTitle}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Automated signal feature extraction & spectral staging</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button 
            onClick={handleDownloadClick}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:hover:bg-sky-900 dark:text-sky-300 rounded-md transition-colors text-xs font-medium border border-sky-200 dark:border-sky-800 shadow-2xs"
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('downloadReport')}</span>
          </button>
          <button 
            onClick={onPlay}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 rounded-md transition-colors text-xs font-medium shadow-2xs"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{displayTitle.includes("Pause") || displayTitle.includes("நிறுத்த") ? t('resumeAnalysis') : t('playSession')}</span>
          </button>
          <button 
            onClick={onClear}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 rounded-md transition-colors text-xs font-medium border border-slate-200 dark:border-slate-700 shadow-2xs"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t('clear')}</span>
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-3">
          <div className="bg-slate-50 dark:bg-slate-950/80 p-3 rounded-lg border border-slate-200/80 dark:border-slate-800">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium mb-1">{t('totalPoints')}</p>
            <p className="text-2xl font-mono font-bold text-slate-900 dark:text-slate-100">{data.length.toLocaleString()}</p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950/80 p-3 rounded-lg border border-slate-200/80 dark:border-slate-800">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium mb-1">{t('dominantFrequency')}</p>
            <p className="text-2xl font-mono font-bold text-sky-700 dark:text-sky-400">{features.frequency.toFixed(1)} <span className="text-xs font-normal">Hz</span></p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="bg-slate-50 dark:bg-slate-950/80 p-3 rounded-lg border border-slate-200/80 dark:border-slate-800">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium mb-1">{t('rmsTremor')}</p>
            <p className="text-2xl font-mono font-bold text-slate-900 dark:text-slate-100">{features.rms.toFixed(3)} <span className="text-xs font-normal">g</span></p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950/80 p-3 rounded-lg border border-slate-200/80 dark:border-slate-800">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium mb-1">{t('averageSeverity')}</p>
            <p className="text-2xl font-mono font-bold text-slate-900 dark:text-slate-100">{severityValue.toFixed(1)} <span className="text-xs font-normal text-slate-400">/ 4.0</span></p>
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-950/80 p-3 rounded-lg border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium mb-2">{t('severityDistribution')}</p>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="2 2" stroke={gridStroke} vertical={false} />
                <XAxis dataKey="name" stroke={axisColor} fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke={axisColor} fontSize={10} tickLine={false} axisLine={false} width={28} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: tooltipBg, 
                    border: `1px solid ${tooltipBorder}`, 
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)'
                  }}
                  itemStyle={{ color: tooltipTextColor }}
                />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Patient Details Modal */}
      <PatientDetailsModal
        isOpen={showPatientModal}
        onClose={() => setShowPatientModal(false)}
        onSubmit={handlePatientSubmit}
        defaultAssessmentDate={sessionForReport.timestamp}
      />
    </div>
  );
};
