import React from 'react';
import { useLanguage } from '../lib/i18n';
import type { RecoveryAnalysisSummary } from '../lib/tremorAnalyzer';

interface TremorAnalysisProps {
  metrics: {
    rms: number;
    frequency: number;
    intensity: string;
    stage: string;
    updrsScore?: number;
    hoehnYahrStage?: string;
    estimatedExcursionCm?: number;
    is4to6HzPdLock?: boolean;
    kinematicBracket?: string;
    recoveryRate?: number;
    recoverySummary?: RecoveryAnalysisSummary;
    avgForce?: number;
    phenotype?: string;
  };
}

export const TremorAnalysis: React.FC<TremorAnalysisProps> = ({ metrics }) => {
  const { t } = useLanguage();

  const getTranslatedSeverity = (severity: string, stage: string) => {
    if (severity === 'Normal' || stage === 'Normal' || stage === 'Stage 0') return t('normal');
    if (severity === 'Mild' || stage === 'Stage 1') return t('mild');
    if (severity === 'Moderate' || stage === 'Stage 2') return t('moderate');
    if (severity === 'Severe' || stage === 'Stage 3' || stage === 'Stage 4') return t('severe');
    return severity || stage;
  };

  const isSevere =
    metrics.intensity === 'Severe' ||
    metrics.stage === 'Stage 3' ||
    metrics.stage === 'Stage 4';
  const isModerate = metrics.intensity === 'Moderate' || metrics.stage === 'Stage 2';
  const isMild = metrics.intensity === 'Mild' || metrics.stage === 'Stage 1';

  const rec = metrics.recoverySummary;
  const recoveryVal = rec ? rec.recoveryRate : metrics.recoveryRate ?? 0;
  const recordedCount = rec?.recordedCount ?? 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* 1. RMS Acceleration Magnitude */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 transition-colors">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {t('rmsAmplitude')}
          </span>
          <span className="font-mono">
            {metrics.estimatedExcursionCm && metrics.estimatedExcursionCm > 0.02
              ? `~${metrics.estimatedExcursionCm.toFixed(2)} cm excursion`
              : 'Calibrated RMS'}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-mono tabular-nums font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {(metrics.rms / 9.80665).toFixed(3)}
          </span>
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">g</span>
          <span className="text-xs font-mono tabular-nums text-slate-400 dark:text-slate-500">
            · {metrics.rms.toFixed(2)} m/s²
          </span>
        </div>
        <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>Kinematic vector</span>
          <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
            {metrics.kinematicBracket || '<0.06g normal'}
          </span>
        </div>
      </div>

      {/* 2. Dominant Tremor Frequency */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 transition-colors">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
          <span className="font-medium text-slate-700 dark:text-slate-300">
            Dominant Frequency
          </span>
          <span
            className={`font-mono ${
              metrics.is4to6HzPdLock
                ? 'text-sky-700 dark:text-sky-400 font-semibold'
                : 'text-sky-700 dark:text-sky-400'
            }`}
          >
            {metrics.is4to6HzPdLock ? '4–6 Hz PD Lock' : 'DFT Peak'}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-mono tabular-nums font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {metrics.frequency.toFixed(1)}
          </span>
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">Hz</span>
        </div>
        <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>Spectral cluster</span>
          <span className="font-mono text-slate-700 dark:text-slate-300">
            {metrics.frequency >= 3.8 && metrics.frequency <= 6.2
              ? '4–6 Hz PD Rest Band'
              : metrics.frequency >= 3.5 && metrics.frequency <= 6.5
              ? '3.5–6.5 Hz PD band'
              : metrics.frequency > 6.5 && metrics.frequency <= 12
              ? '6.5–12 Hz ET band'
              : 'Physiological (<3.5 Hz)'}
          </span>
        </div>
      </div>

      {/* 3. Clinical Severity Stage (Synchronized 1:1 with Kinematic Vector, UPDRS III & Hoehn-Yahr) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 transition-colors">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
          <span className="font-medium text-slate-700 dark:text-slate-300">
            Clinical Severity Stage
          </span>
          <span className="font-mono text-slate-600 dark:text-slate-400">
            {metrics.stage === 'Normal' ? 'Stage 0' : metrics.stage}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span
            data-testid="clinical-severity-stage-value"
            className={`text-3xl font-mono font-bold tracking-tight ${
              isSevere
                ? 'text-rose-700 dark:text-rose-400'
                : isModerate
                ? 'text-amber-700 dark:text-amber-400'
                : isMild
                ? 'text-sky-700 dark:text-sky-400'
                : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {getTranslatedSeverity(metrics.intensity, metrics.stage)}
          </span>
          {metrics.updrsScore !== undefined && (
            <span className="text-xs font-mono tabular-nums text-slate-400 dark:text-slate-500">
              · UPDRS {metrics.updrsScore.toFixed(1)}/4.0
            </span>
          )}
        </div>
        <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>Clinical stage</span>
          <span className="font-mono text-slate-700 dark:text-slate-300 truncate max-w-[180px]">
            {metrics.hoehnYahrStage ||
              `MDS-UPDRS III (${metrics.kinematicBracket?.split(' ')[0] || '<0.06g'})`}
          </span>
        </div>
      </div>

      {/* 4. Recorded-Section Recovery Rate (Sequential Section-over-Section Comparison) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 transition-colors">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
          <span className="font-medium text-slate-700 dark:text-slate-300">
            Recovery Rate (Recorded)
          </span>
          <span className="font-mono text-emerald-700 dark:text-emerald-400">
            {recordedCount >= 2 && rec?.previousSectionLabel && rec?.latestSectionLabel
              ? `${rec.latestSectionLabel} vs. ${rec.previousSectionLabel}`
              : recordedCount === 1
              ? 'S-1 Baseline Saved'
              : 'Recorded Sections Only'}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span
            data-testid="recovery-rate-value"
            className={`text-3xl font-mono tabular-nums font-bold tracking-tight ${
              recordedCount >= 2 && recoveryVal > 2.0
                ? 'text-emerald-700 dark:text-emerald-400'
                : recordedCount >= 2 && recoveryVal < -2.0
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {`${recoveryVal > 0 ? '+' : ''}${recoveryVal.toFixed(1)}%`}
          </span>
          <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
            {recordedCount < 2
              ? recordedCount === 1
                ? 'awaiting S-2'
                : 'awaiting S-1'
              : recoveryVal > 2.0
              ? 'reduction'
              : recoveryVal < -2.0
              ? 'increase'
              : 'stable'}
          </span>
        </div>
        <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>
            {recordedCount >= 2 && rec
              ? `Prev (${rec.previousSectionLabel}): ${rec.baselineRmsG.toFixed(3)}g`
              : recordedCount === 1 && rec
              ? `S-1 RMS: ${rec.baselineRmsG.toFixed(3)}g`
              : 'Record sections to compare'}
          </span>
          <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
            {metrics.avgForce !== undefined ? `Grip: ${metrics.avgForce} FSR` : '0 FSR'}
          </span>
        </div>
      </div>
    </div>
  );
};
