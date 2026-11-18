import React from 'react';
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
import {
  DifferentialAnalysisResult,
  SimulationProfile,
} from '../lib/tremorAnalyzer';
import { ShieldCheck, SlidersHorizontal } from 'lucide-react';

interface DifferentialDiagnosisPanelProps {
  differential: DifferentialAnalysisResult;
  isSimulating: boolean;
  simProfile: SimulationProfile;
  onChangeSimProfile: (profile: SimulationProfile) => void;
  isDark: boolean;
  latestIntegrityHash?: string | null;
}

export const DifferentialDiagnosisPanel: React.FC<DifferentialDiagnosisPanelProps> = ({
  differential,
  isSimulating,
  simProfile,
  onChangeSimProfile,
  isDark,
  latestIntegrityHash,
}) => {
  const isPd = differential.phenotype === 'Parkinsonian Tremor (PD)';
  const isEt = differential.phenotype === 'Essential / Postural Tremor (ET)';

  const getBandColor = (band: string) => {
    if (band === 'pd') return '#0284c7'; // Clinical Cobalt (PD 3.5-6.5 Hz)
    if (band === 'et') return '#0d9488'; // Clinical Teal (ET 6.5-12.0 Hz)
    if (band === 'voluntary') return '#64748b'; // Voluntary (<3.5 Hz)
    return '#94a3b8'; // Physiological (>12 Hz)
  };

  const gridStroke = isDark ? '#1e293b' : '#e2e8f0';
  const axisColor = isDark ? '#94a3b8' : '#64748b';

  return (
    <section
      aria-label="Differential Tremor & Grip Force Biomarker Analysis"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 mb-6"
    >
      {/* Top Header Row + Optional Simulation Phenotype Switcher */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-4 mb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span className="font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
              Differential Tremor & Grip Force Classifier
            </span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">
              DFT Spectral Decomposition (3.5–6.5 Hz PD vs 6.5–12.0 Hz ET)
            </span>
            {latestIntegrityHash && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 font-mono text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                  <ShieldCheck size={13} />
                  HMAC: {latestIntegrityHash.slice(0, 10)}
                </span>
              </>
            )}
          </div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Phenotype Differentiation: Parkinsonian Resting vs. Essential Postural Tremor
          </h2>
        </div>

        {/* Interactive Simulation Profile Switcher (visible during Demo or for instant clinical comparison) */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mr-1">
            <SlidersHorizontal size={13} />
            <span>Test Signal Profile:</span>
          </span>
          <div
            role="group"
            aria-label="Clinical Tremor Simulation Preset"
            className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/90 rounded-lg border border-slate-200/80 dark:border-slate-700"
          >
            <button
              type="button"
              onClick={() => onChangeSimProfile('pd_resting')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                isSimulating && simProfile === 'pd_resting'
                  ? 'bg-sky-700 text-white shadow-2xs'
                  : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              PD Resting (4.8 Hz + Grip Decay)
            </button>
            <button
              type="button"
              onClick={() => onChangeSimProfile('et_postural')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                isSimulating && simProfile === 'et_postural'
                  ? 'bg-teal-700 text-white shadow-2xs'
                  : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Essential Postural (8.5 Hz Action)
            </button>
            <button
              type="button"
              onClick={() => onChangeSimProfile('physiological')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                isSimulating && simProfile === 'physiological'
                  ? 'bg-slate-800 text-white dark:bg-slate-600 shadow-2xs'
                  : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Physiological Baseline
            </button>
          </div>
        </div>
      </div>

      {/* Main 3-Column Clinical Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Column 1 (4 cols): Primary Differential Phenotype & Probability Distribution */}
        <div className="lg:col-span-4 flex flex-col justify-between bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/90 dark:border-slate-800 rounded-lg p-4">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
              Detected Motor Phenotype
            </div>
            <div
              data-testid="differential-phenotype-label"
              className={`text-lg font-bold tracking-tight mb-2 ${
                isPd
                  ? 'text-sky-700 dark:text-sky-400'
                  : isEt
                  ? 'text-teal-700 dark:text-teal-400'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {differential.phenotype}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
              {differential.clinicalRationale}
            </p>
          </div>

          {/* Probability Bars */}
          <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Parkinsonian (4–6 Hz Resting / Pill-Rolling)
                </span>
                <span className="font-mono tabular-nums font-semibold text-sky-700 dark:text-sky-400">
                  {differential.pdProbability}%
                </span>
              </div>
              <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-600 transition-all duration-150"
                  style={{ width: `${differential.pdProbability}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Essential / Postural (6.5–12 Hz Kinetic)
                </span>
                <span className="font-mono tabular-nums font-semibold text-teal-700 dark:text-teal-400">
                  {differential.etProbability}%
                </span>
              </div>
              <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal-600 transition-all duration-150"
                  style={{ width: `${differential.etProbability}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Physiological / Voluntary Baseline
                </span>
                <span className="font-mono tabular-nums font-semibold text-slate-600 dark:text-slate-400">
                  {differential.normalProbability}%
                </span>
              </div>
              <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-slate-500 transition-all duration-150"
                  style={{ width: `${differential.normalProbability}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Column 2 (4 cols): Power Spectral Density (PSD) Distribution */}
        <div className="lg:col-span-4 flex flex-col justify-between bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/90 dark:border-slate-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Power Spectral Density (DFT Hann Window)
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Energy distribution across clinical frequency bands
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-300">
              Peak: {differential.dominantFreq.toFixed(1)} Hz
            </span>
          </div>

          <div className="h-40 w-full my-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={differential.spectrum} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 2" stroke={gridStroke} vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke={axisColor}
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis stroke={axisColor} fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: isDark ? '#0f172a' : '#ffffff',
                    borderColor: gridStroke,
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                  }}
                  formatter={(val: any) => [`${Number(val).toFixed(2)} PSD`, 'Spectral Power']}
                />
                <Bar dataKey="power" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {differential.spectrum.map((entry, index) => (
                    <Cell key={`psd-${index}`} fill={getBandColor(entry.band)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-800 font-mono tabular-nums">
            <span>
              4–6Hz PD Core: {Math.round((differential.pdCore4to6Power ?? differential.pdBandPower) * 100)}% (3.5–6.5Hz: {Math.round(differential.pdBandPower * 100)}%)
            </span>
            <span>·</span>
            <span>ET (6.5–12Hz): {Math.round(differential.etBandPower * 100)}%</span>
          </div>
        </div>

        {/* Column 3 (4 cols): Kinematic & Grip Force Differential Biomarkers */}
        <div className="lg:col-span-4 grid grid-cols-2 gap-3">
          {/* Biomarker 1: Pronation-Supination Pill-Rolling Index */}
          <div className="bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/90 dark:border-slate-800 rounded-lg p-3.5 flex flex-col justify-between">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Pill-Rolling Gyro Index
            </div>
            <div className="my-1">
              <span className="text-2xl font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                {differential.pillRollingIndex}
              </span>
              <span className="text-xs font-mono text-slate-400 ml-1">/ 100</span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {differential.pillRollingIndex >= 45
                ? 'Pronation-supination dominant (PD)'
                : 'Planar flexion-extension'}
            </div>
          </div>

          {/* Biomarker 2: Spectral Narrowband Regularity */}
          <div className="bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/90 dark:border-slate-800 rounded-lg p-3.5 flex flex-col justify-between">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Spectral Rhythmicity (Q)
            </div>
            <div className="my-1">
              <span className="text-2xl font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                {differential.spectralRegularity}%
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {differential.spectralRegularity >= 55
                ? `Constancy ${differential.constancyScore ?? 4}/4 · Pacemaker lock`
                : 'Broadband / mixed kinematics'}
            </div>
          </div>

          {/* Biomarker 3: Isometric Grip Force & Bradykinetic Decay */}
          <div className="bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/90 dark:border-slate-800 rounded-lg p-3.5 flex flex-col justify-between">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Grip Force Stability
            </div>
            <div className="my-1">
              <span className="text-2xl font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                {differential.avgForce}
              </span>
              <span className="text-xs font-mono text-slate-400 ml-1">FSR</span>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Slope: {differential.gripDecaySlope > 0 ? `+${differential.gripDecaySlope}` : differential.gripDecaySlope}/s · CV {differential.forceCv}%
            </div>
          </div>

          {/* Biomarker 4: MDS-UPDRS III Quantitative Score */}
          <div className="bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/90 dark:border-slate-800 rounded-lg p-3.5 flex flex-col justify-between">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              MDS-UPDRS III Score
            </div>
            <div className="my-1">
              <span className="text-2xl font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                {differential.updrsScore.toFixed(1)}
              </span>
              <span className="text-xs font-mono text-slate-400 ml-1">/ 4.0</span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Excursion: ~{(differential.estimatedExcursionCm ?? 0).toFixed(2)} cm · Decay: {differential.micrographiaIndex}%
            </div>
          </div>
        </div>
      </div>

      {/* Clinical Parkinson's Staging & 4-6 Hz Nigrostriatal Biomarker Reference Ladder */}
      <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              MDS-UPDRS III (Item 3.17/3.18) & Hoehn-Yahr Clinical Staging Matrix
            </span>
            <span className="text-slate-400">·</span>
            <span className="font-mono text-slate-600 dark:text-slate-400">
              Active Stage: {differential.hoehnYahrStage || differential.clinicalStage}
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {differential.is4to6HzPdLock
              ? `4.0–6.0 Hz Parkinsonian Rest Lock Active (${differential.dominantFreq.toFixed(1)} Hz · ${Math.round(differential.pdBandPower * 100)}% PD Energy)`
              : `4.0–6.0 Hz Nigrostriatal PD Window vs. 6.5–12.0 Hz Postural ET Window`}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {[
            {
              stageId: 'Normal',
              title: 'Stage 0 · Normal (H&Y 0)',
              gRange: '< 0.06g (< 0.59 m/s²)',
              updrs: 'UPDRS 0.0–0.4 · < 0.1 cm',
              desc: 'Physiological baseline stability; no rhythmic 4–12 Hz motor oscillation.',
              active: differential.severityLabel === 'Normal',
              activeBorder: 'border-slate-400 dark:border-slate-500 bg-slate-100/80 dark:bg-slate-800/70',
              textAccent: 'text-slate-900 dark:text-slate-100',
            },
            {
              stageId: 'Stage 1',
              title: 'Stage 1 · Mild (H&Y Stage 1)',
              gRange: '0.06 – 0.55g (0.59–5.39 m/s²)',
              updrs: 'UPDRS 0.8–1.8 · < 2 cm excursion',
              desc: 'Early / unilateral 4–6 Hz PD pill-rolling or mild postural tremor.',
              active: differential.severityLabel === 'Mild',
              activeBorder: 'border-sky-500/80 dark:border-sky-500/70 bg-sky-50/70 dark:bg-sky-950/30',
              textAccent: 'text-sky-700 dark:text-sky-400',
            },
            {
              stageId: 'Stage 2',
              title: 'Stage 2 · Moderate (H&Y Stage 2)',
              gRange: '0.55 – 1.15g (5.39–11.28 m/s²)',
              updrs: 'UPDRS 1.9–2.8 · 2–5 cm excursion',
              desc: 'Persistent bilateral 4–6 Hz resting tremor with bradykinetic grip decay.',
              active: differential.severityLabel === 'Moderate',
              activeBorder: 'border-amber-500/80 dark:border-amber-500/70 bg-amber-50/70 dark:bg-amber-950/30',
              textAccent: 'text-amber-700 dark:text-amber-400',
            },
            {
              stageId: 'Stage 3',
              title: 'Stage 3–4 · Severe (H&Y Stage 3+)',
              gRange: '>= 1.15g (>= 11.28 m/s²)',
              updrs: 'UPDRS 2.9–4.0 · > 5 cm excursion',
              desc: 'Marked high-amplitude tremor excursion impairing motor independence.',
              active: differential.severityLabel === 'Severe',
              activeBorder: 'border-rose-500/80 dark:border-rose-500/70 bg-rose-50/70 dark:bg-rose-950/30',
              textAccent: 'text-rose-700 dark:text-rose-400',
            },
          ].map((tier) => (
            <div
              key={tier.stageId}
              className={`rounded-md p-3 border transition-colors ${
                tier.active
                  ? tier.activeBorder
                  : 'border-slate-200/80 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-950/40 opacity-75'
              }`}
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className={`text-xs font-semibold ${tier.active ? tier.textAccent : 'text-slate-700 dark:text-slate-300'}`}>
                  {tier.title}
                </span>
                {tier.active && (
                  <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                    Active
                  </span>
                )}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-700 dark:text-slate-300 mb-1">
                {tier.gRange} · {tier.updrs}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                {tier.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
