import React, { useState, useMemo } from 'react';
import { SensorData } from '../lib/serial';
import { mlService } from '../lib/mlService';
import {
  computeDatasetSectionSummary,
  computeSensorChannelStats,
} from '../lib/tremorAnalyzer';
import { Play, Trash2, FileText } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
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
  sensitivityMultiplier?: number;
}

export const DatasetSummary: React.FC<DatasetSummaryProps> = ({
  data,
  title,
  onPlay,
  onClear,
  onRequestReport,
  isDark = true,
  sensitivityMultiplier,
}) => {
  const { t } = useLanguage();
  const [showPatientModal, setShowPatientModal] = useState(false);
  const displayTitle = title || `${t('datasetAnalysisSummary')} (Total Section Average)`;
  const activeMult = sensitivityMultiplier ?? mlService.getSensitivityMultiplier();

  // Compute true average across all segments of the total section reading (never just the last second)
  const summary = useMemo(
    () => computeDatasetSectionSummary(data, 'pen', activeMult),
    [data, activeMult]
  );
  const diff = summary.differential;

  // Create a complete session object containing all section-averaged readings for the report
  const sessionForReport = useMemo(
    () => ({
      id: `sec-${Date.now()}`,
      userId: 'local-user',
      timestamp: Date.now(),
      duration: summary.durationSec,
      data,
      rawSampleCount: data.length,
      severity: summary.severityLabel,
      stage: summary.stage,
      rms: summary.avgRms,
      frequency: summary.avgFrequency,
      phenotype: diff.phenotype,
      pdProbability: diff.pdProbability,
      etProbability: diff.etProbability,
      pillRollingIndex: diff.pillRollingIndex,
      avgForce: diff.avgForce,
      analysis: diff,
      datasetSummary: summary,
      sensorStats: computeSensorChannelStats(data),
    }),
    [data, summary, diff]
  );

  const chartData = [
    { name: t('none'), count: summary.severityCounts[0], color: '#16a34a' },
    { name: t('mild'), count: summary.severityCounts[1], color: '#0284c7' },
    { name: t('moderate'), count: summary.severityCounts[2], color: '#d97706' },
    { name: t('severe'), count: summary.severityCounts[3], color: '#dc2626' },
    { name: t('extreme'), count: summary.severityCounts[4], color: '#991b1b' },
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
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-100">
            {displayTitle}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
            Averaged across all {summary.segmentCount}{' '}
            {summary.segmentCount === 1 ? 'segment' : 'segments'} of total section reading (
            {summary.durationSec.toFixed(1)}s · {summary.totalPoints.toLocaleString()} samples)
          </p>
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
            <span>
              {displayTitle.includes('Pause') || displayTitle.includes('நிறுத்த')
                ? t('resumeAnalysis')
                : t('playSession')}
            </span>
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
            <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium mb-1">
              {t('totalPoints')} (Section Span)
            </p>
            <div className="flex items-baseline gap-2 font-mono tabular-nums">
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {summary.totalPoints.toLocaleString()}
              </p>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                · {summary.durationSec.toFixed(1)}s ({summary.segmentCount} windows)
              </span>
            </div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950/80 p-3 rounded-lg border border-slate-200/80 dark:border-slate-800">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium mb-1">
              {t('dominantFrequency')} (Section Avg)
            </p>
            <div className="flex items-baseline gap-2 font-mono tabular-nums">
              <p className="text-2xl font-bold text-sky-700 dark:text-sky-400">
                {summary.avgFrequency.toFixed(1)} <span className="text-xs font-normal">Hz</span>
              </p>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                · PD {Math.round(diff.pdBandPower * 100)}% / ET {Math.round(diff.etBandPower * 100)}%
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="bg-slate-50 dark:bg-slate-950/80 p-3 rounded-lg border border-slate-200/80 dark:border-slate-800">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium mb-1">
              {t('rmsTremor')} (Section Avg)
            </p>
            <div className="flex items-baseline gap-2 font-mono tabular-nums">
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {summary.avgRmsG.toFixed(3)} <span className="text-xs font-normal">g</span>
              </p>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                · {summary.avgRms.toFixed(2)} m/s²
              </span>
            </div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950/80 p-3 rounded-lg border border-slate-200/80 dark:border-slate-800">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium mb-1">
              {t('averageSeverity')} (Section Avg)
            </p>
            <div className="flex items-baseline gap-2 font-mono tabular-nums">
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {summary.avgSeverity.toFixed(2)}{' '}
                <span className="text-xs font-normal text-slate-400">/ 4.0</span>
              </p>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                · {summary.severityLabel} ({summary.stage})
              </span>
            </div>
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-950/80 p-3 rounded-lg border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium mb-2">
            {t('severityDistribution')} (All {summary.segmentCount} Section Windows)
          </p>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="2 2" stroke={gridStroke} vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke={axisColor}
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke={axisColor}
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={28}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: tooltipBg,
                    border: `1px solid ${tooltipBorder}`,
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                  }}
                  itemStyle={{ color: tooltipTextColor }}
                />
                <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Section-Averaged Differential Biomarkers Summary Strip */}
      <div className="mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono tabular-nums">
        <div className="bg-slate-50/70 dark:bg-slate-950/60 p-2.5 rounded border border-slate-200/70 dark:border-slate-800">
          <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">
            Detected Motor Phenotype (Avg)
          </div>
          <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
            {diff.phenotype}
          </div>
          <div className="text-[10px] text-slate-500">
            PD {diff.pdProbability}% · ET {diff.etProbability}% · Base {diff.normalProbability}%
          </div>
        </div>
        <div className="bg-slate-50/70 dark:bg-slate-950/60 p-2.5 rounded border border-slate-200/70 dark:border-slate-800">
          <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">
            Pill-Rolling Gyro Index (Avg)
          </div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            {diff.pillRollingIndex} / 100
          </div>
          <div className="text-[10px] text-slate-500">
            {diff.pillRollingIndex >= 45 ? 'Pronation-supination' : 'Planar flexion-extension'}
          </div>
        </div>
        <div className="bg-slate-50/70 dark:bg-slate-950/60 p-2.5 rounded border border-slate-200/70 dark:border-slate-800">
          <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">
            Spectral Rhythmicity Q (Avg)
          </div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            {diff.spectralRegularity}%
          </div>
          <div className="text-[10px] text-slate-500">
            Constancy {diff.constancyScore}/4 · Peak {diff.dominantFreq.toFixed(1)} Hz
          </div>
        </div>
        <div className="bg-slate-50/70 dark:bg-slate-950/60 p-2.5 rounded border border-slate-200/70 dark:border-slate-800">
          <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">
            Grip Force Stability (Avg)
          </div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            {diff.avgForce} FSR
          </div>
          <div className="text-[10px] text-slate-500">
            Slope {diff.gripDecaySlope > 0 ? `+${diff.gripDecaySlope}` : diff.gripDecaySlope}/s · CV{' '}
            {diff.forceCv}%
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

