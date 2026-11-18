import React, { useState } from 'react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  ReferenceLine,
} from 'recharts';
import { Session } from '../App';
import { RecoveryAnalysisSummary } from '../lib/tremorAnalyzer';
import { useLanguage } from '../lib/i18n';
import { Save } from 'lucide-react';

interface RecoveryTrendChartProps {
  sessions: Session[];
  recoverySummary?: RecoveryAnalysisSummary;
  onCaptureSnapshot?: () => void;
  canSaveSection?: boolean;
  isConnected?: boolean;
  isDark?: boolean;
}

export const RecoveryTrendChart: React.FC<RecoveryTrendChartProps> = ({
  sessions,
  recoverySummary,
  onCaptureSnapshot,
  canSaveSection = false,
  isConnected = false,
  isDark = false,
}) => {
  const { t } = useLanguage();
  const [metricView, setMetricView] = useState<'recoveryRate' | 'rmsG'>('recoveryRate');

  const hasRecordedSections = sessions.length >= 1;

  // Build chart data strictly from recorded sections, calculating each section's recovery rate
  // relative to the immediately preceding recorded section (S-(i-1) -> S-i)
  const chartData = React.useMemo(() => {
    if (!hasRecordedSections) return [];

    const chronological = [...sessions].sort((a, b) => a.timestamp - b.timestamp);
    return chronological.map((session, index) => {
      const rmsG = Number((session.rms / 9.80665).toFixed(3));
      const prevSession = index > 0 ? chronological[index - 1] : null;
      const prevRms = prevSession ? prevSession.rms : session.rms;

      const recRate =
        prevSession && prevRms >= 0.05
          ? Number(
              Math.max(-100, Math.min(100, ((prevRms - session.rms) / prevRms) * 100)).toFixed(1)
            )
          : 0;

      return {
        name: `S-${index + 1}`,
        rms: Number(session.rms.toFixed(2)),
        rmsG,
        recoveryRate: recRate,
        comparisonBasis: index > 0 ? `vs. S-${index}` : 'Initial Baseline (S-1)',
        frequency: session.frequency,
        stage: session.stage,
        fullDate: new Date(session.timestamp).toLocaleString(),
      };
    });
  }, [hasRecordedSections, sessions]);

  const prevRmsG =
    recoverySummary?.baselineRmsG ??
    (chartData.length >= 2
      ? chartData[chartData.length - 2].rmsG
      : chartData[0]?.rmsG ?? 0);
  const latestG =
    recoverySummary?.currentRmsG ?? (chartData[chartData.length - 1]?.rmsG ?? 0);
  const netRecovery =
    recoverySummary?.recoveryRate ??
    (chartData[chartData.length - 1]?.recoveryRate || 0);

  if (!hasRecordedSections) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('recoveryProgress')} · Recorded Sections Only
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Recovery rate is calculated strictly across recorded sections (comparing each newly recorded section against the immediately previous recorded section), not during live unrecorded testing.
          </p>
        </div>
        {isConnected && onCaptureSnapshot && (
          <button
            type="button"
            onClick={onCaptureSnapshot}
            disabled={!canSaveSection}
            className="px-3.5 py-1.5 rounded-md bg-sky-700 hover:bg-sky-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <Save size={14} />
            <span>Save Recorded Section (S-1)</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-0.5">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              Recorded-Section Recovery Rate & Progression Graph
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {sessions.length} {sessions.length === 1 ? 'Recorded Section' : 'Recorded Sections'}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Plots all recorded sections chronologically (S-1 to S-{sessions.length}). Recovery rate for each recorded section is calculated relative to the immediately previous recorded section.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Metric View Switcher */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700 text-xs">
            <button
              type="button"
              onClick={() => setMetricView('recoveryRate')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                metricView === 'recoveryRate'
                  ? 'bg-white text-slate-900 dark:bg-slate-700 dark:text-white font-semibold shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              Recovery Rate (%)
            </button>
            <button
              type="button"
              onClick={() => setMetricView('rmsG')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                metricView === 'rmsG'
                  ? 'bg-white text-slate-900 dark:bg-slate-700 dark:text-white font-semibold shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              RMS Amplitude (g)
            </button>
          </div>

          {isConnected && onCaptureSnapshot && (
            <button
              type="button"
              onClick={onCaptureSnapshot}
              disabled={!canSaveSection}
              className="px-3 py-1.5 rounded-md bg-sky-700 hover:bg-sky-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              title="Save current drawn/tested telemetry as the next recorded section"
            >
              <Save size={13} />
              <span>Save Next Section (S-{sessions.length + 1})</span>
            </button>
          )}
        </div>
      </div>

      {/* 3-Column Quantitative Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 rounded-md p-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Previous Recorded Section RMS
            </div>
            <div className="text-lg font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
              {prevRmsG.toFixed(3)} <span className="text-xs font-normal text-slate-500">g</span>
            </div>
          </div>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {sessions.length >= 2
              ? `Section S-${sessions.length - 1}`
              : 'Initial Baseline (S-1)'}
          </span>
        </div>

        <div className="bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 rounded-md p-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Latest Recorded Section RMS
            </div>
            <div className="text-lg font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
              {latestG.toFixed(3)} <span className="text-xs font-normal text-slate-500">g</span>
            </div>
          </div>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            Section S-{sessions.length} ({chartData[chartData.length - 1]?.stage || 'Normal'})
          </span>
        </div>

        <div className="bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 rounded-md p-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Section-over-Section Recovery Rate
            </div>
            <div
              className={`text-lg font-mono tabular-nums font-bold ${
                netRecovery > 2.0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : netRecovery < -2.0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {netRecovery > 0 ? `+${netRecovery.toFixed(1)}%` : `${netRecovery.toFixed(1)}%`}
            </div>
          </div>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {sessions.length < 2
              ? 'Record S-2 to Compare'
              : `S-${sessions.length} vs. S-${sessions.length - 1}`}
          </span>
        </div>
      </div>

      {/* Area Chart across all Recorded Sections */}
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="colorRecoveryMetric" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor={metricView === 'rmsG' ? '#0284c7' : '#059669'}
                  stopOpacity={0.22}
                />
                <stop
                  offset="95%"
                  stopColor={metricView === 'rmsG' ? '#0284c7' : '#059669'}
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="2 2"
              stroke={isDark ? '#1e293b' : '#e2e8f0'}
              vertical={false}
            />
            <XAxis
              dataKey="name"
              stroke={isDark ? '#64748b' : '#94a3b8'}
              fontSize={10}
              tickLine={false}
              axisLine={false}
              dy={6}
            />
            <YAxis
              stroke={isDark ? '#64748b' : '#94a3b8'}
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val) =>
                metricView === 'rmsG' ? `${Number(val).toFixed(2)}g` : `${Number(val).toFixed(0)}%`
              }
              width={44}
            />
            {metricView === 'rmsG' && prevRmsG > 0 && (
              <ReferenceLine
                y={prevRmsG}
                stroke={isDark ? '#475569' : '#94a3b8'}
                strokeDasharray="3 3"
              />
            )}
            {metricView === 'recoveryRate' && (
              <ReferenceLine
                y={0}
                stroke={isDark ? '#475569' : '#94a3b8'}
                strokeDasharray="3 3"
              />
            )}
            <Tooltip
              contentStyle={{
                backgroundColor: isDark ? '#0f172a' : '#ffffff',
                border: isDark ? '1px solid #1e293b' : '1px solid #e2e8f0',
                borderRadius: '6px',
                color: isDark ? '#f8fafc' : '#0f172a',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
              }}
              formatter={(val: any, _name: any, item: any) =>
                metricView === 'rmsG'
                  ? [`${Number(val).toFixed(3)} g (${item?.payload?.rms ?? 0} m/s²)`, 'Recorded RMS']
                  : [
                      `${Number(val) > 0 ? '+' : ''}${Number(val).toFixed(1)}% (${
                        item?.payload?.comparisonBasis || ''
                      })`,
                      'Recovery Rate',
                    ]
              }
              labelFormatter={(label, payload) => {
                if (payload && payload[0]) {
                  return `${label} · ${payload[0].payload.fullDate} (${payload[0].payload.stage})`;
                }
                return label;
              }}
            />
            <Area
              type="monotone"
              dataKey={metricView}
              stroke={metricView === 'rmsG' ? '#0284c7' : '#059669'}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              fillOpacity={1}
              fill="url(#colorRecoveryMetric)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
