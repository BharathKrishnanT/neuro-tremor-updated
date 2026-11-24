import React, { useState } from 'react';
import {
  MultimodalFusionResult,
  FusedMatrixRow,
  download200HzMatrixCsv,
  download200HzMatrixJson,
} from '../lib/multimodalFusion';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  Scatter,
} from 'recharts';
import { Save, Trash2, FileSpreadsheet, FileJson } from 'lucide-react';

interface MultimodalFusionPanelProps {
  result: MultimodalFusionResult;
  matrix: FusedMatrixRow[] | null;
  isDark: boolean;
  onSaveFusedSection?: () => void;
  onClearFusion: () => void;
  canSave?: boolean;
}

export const MultimodalFusionPanel: React.FC<MultimodalFusionPanelProps> = ({
  result,
  matrix,
  isDark,
  onSaveFusedSection,
  onClearFusion,
  canSave = true,
}) => {
  const [showRadialOverlay, setShowRadialOverlay] = useState(false);

  const gridStroke = isDark ? '#1e293b' : '#e2e8f0';
  const axisColor = isDark ? '#64748b' : '#64748b';
  const tooltipBg = isDark ? '#0f172a' : '#ffffff';
  const tooltipBorder = isDark ? '#1e293b' : '#cbd5e1';
  const tooltipText = isDark ? '#f8fafc' : '#0f172a';

  // Build shaded pen_up (in-air) intervals for the timeline chart
  const inAirSpans: Array<{ x1: number; x2: number }> = [];
  let spanStart: number | null = null;
  for (let i = 0; i < result.timelineSeries.length; i++) {
    const pt = result.timelineSeries[i];
    if (pt.penDown === 0 && spanStart === null) {
      spanStart = pt.tSec;
    } else if (pt.penDown === 1 && spanStart !== null) {
      inAirSpans.push({ x1: spanStart, x2: pt.tSec });
      spanStart = null;
    }
  }
  if (spanStart !== null && result.timelineSeries.length > 0) {
    inAirSpans.push({
      x1: spanStart,
      x2: result.timelineSeries[result.timelineSeries.length - 1].tSec,
    });
  }

  // Augment timeline points with an explicit spike FSR value for Scatter overlay
  const chartTimeline = result.timelineSeries.map((pt) => ({
    ...pt,
    spikeFsr: pt.isRigiditySpike ? pt.fsr : null,
  }));

  const couplingTone =
    result.rigidityCoupling.fsrVelocityCorrelation <= -0.25 ||
    result.rigidityCoupling.coupledSpikeCount >= 2
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-emerald-700 dark:text-emerald-400';

  const couplingLabel =
    result.rigidityCoupling.coupledSpikeCount > 0
      ? `▲ ${result.rigidityCoupling.coupledSpikeCount} Coupled Rigidity ${
          result.rigidityCoupling.coupledSpikeCount === 1 ? 'Spike' : 'Spikes'
        }`
      : '● Nominal Grip–Velocity Tracking';

  return (
    <section
      aria-label="Multimodal Fusion Summary"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 mb-6"
    >
      {/* Header Row & Direct Export / Save Actions */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Post-Completion Stroke-Level Multimodal Fusion Summary
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-1">
            <span>{result.sampleRateHz} Hz Uniform Matrix (17 Channels)</span>
            <span aria-hidden="true">·</span>
            <span>{result.durationSec.toFixed(1)}s Total Span</span>
            <span aria-hidden="true">·</span>
            <span>{result.totalMatrixRows.toLocaleString()} Synced Rows</span>
            <span aria-hidden="true">·</span>
            <span>
              On-Paper {result.onPaperDurationSec.toFixed(1)}s ({result.penDownRatioPct}%) / In-Air{' '}
              {result.inAirDurationSec.toFixed(1)}s
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {matrix && matrix.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => download200HzMatrixCsv(matrix, result.canvasMode)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md transition-colors text-xs font-medium whitespace-nowrap shrink-0"
                title="Download full 200 Hz 17-channel matrix as CSV"
              >
                <FileSpreadsheet size={13} />
                <span>Export 200 Hz CSV</span>
              </button>
              <button
                type="button"
                onClick={() => download200HzMatrixJson(result, matrix, result.canvasMode)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md transition-colors text-xs font-medium whitespace-nowrap shrink-0"
                title="Download full 200 Hz matrix and fusion biomarkers as JSON"
              >
                <FileJson size={13} />
                <span>Export 200 Hz JSON</span>
              </button>
            </>
          )}

          {onSaveFusedSection && canSave && (
            <button
              type="button"
              onClick={onSaveFusedSection}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-sky-700 hover:bg-sky-800 text-white rounded-md transition-colors text-xs font-semibold whitespace-nowrap shrink-0"
              title="Save fused biomarkers, drawing, and telemetry into Recorded Sections & Cloud Sync"
            >
              <Save size={13} />
              <span>Save Fused Section</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClearFusion}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-md transition-colors text-xs font-medium whitespace-nowrap shrink-0"
          >
            <Trash2 size={13} />
            <span>Clear Fusion</span>
          </button>
        </div>
      </div>

      {/* 4-Column Calibrated Clinical Biomarker Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 py-4 border-b border-slate-200 dark:border-slate-800">
        {/* 1. In-Air Resting Tremor (pen_up) */}
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 rounded-md p-3.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            In-Air Resting Tremor (pen_up)
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5 font-mono tabular-nums">
            <span className="text-2xl font-bold text-sky-700 dark:text-sky-400">
              {result.inAirTremor.dominantFreqHz.toFixed(1)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">Hz</span>
            <span className="text-xs text-slate-400 mx-1">·</span>
            <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {result.inAirTremor.rmsG.toFixed(3)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">g</span>
          </div>
          <div className="mt-1.5 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400">
            4–6 Hz PD Band: {result.inAirTremor.pd4to6Share}% · {result.inAirDurationSec.toFixed(1)}s
            ({result.inAirTremor.windowCount} FFT win)
          </div>
        </div>

        {/* 2. On-Paper Kinetic Tremor (pen_down) */}
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 rounded-md p-3.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            On-Paper Kinetic Tremor (pen_down)
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5 font-mono tabular-nums">
            <span className="text-2xl font-bold text-amber-700 dark:text-amber-400">
              {result.onPaperTremor.dominantFreqHz.toFixed(1)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">Hz</span>
            <span className="text-xs text-slate-400 mx-1">·</span>
            <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {result.onPaperTremor.rmsG.toFixed(3)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">g</span>
          </div>
          <div className="mt-1.5 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400">
            5–10 Hz Kinetic: {result.onPaperTremor.kinetic5to10Share}% ·{' '}
            {result.onPaperDurationSec.toFixed(1)}s ({result.onPaperTremor.windowCount} FFT win)
          </div>
        </div>

        {/* 3. Global Micrographia & Progressive Slowing */}
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 rounded-md p-3.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Micrographia & Progressive Slowing
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5 font-mono tabular-nums">
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {result.globalMotor.micrographiaDecayPct.toFixed(1)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">% decay</span>
            <span className="text-xs text-slate-400 mx-1">·</span>
            <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {result.globalMotor.progressiveSlowingPct > 0 ? '+' : ''}
              {result.globalMotor.progressiveSlowingPct.toFixed(1)}%
            </span>
          </div>
          <div className="mt-1.5 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400">
            Radial Error: {result.globalMotor.meanRadialErrorPx.toFixed(1)} px · Speed:{' '}
            {result.globalMotor.meanVelocityPxS.toFixed(0)} px/s
          </div>
        </div>

        {/* 4. FSR-402 Grip Rigidity <-> Velocity Coupling */}
        <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 rounded-md p-3.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            FSR Grip–Velocity Rigidity Coupling
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5 font-mono tabular-nums">
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              r = {result.rigidityCoupling.fsrVelocityCorrelation.toFixed(2)}
            </span>
            <span className="text-xs text-slate-400 mx-1">·</span>
            <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {result.rigidityCoupling.meanOnPaperFsr}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">FSR</span>
          </div>
          <div className={`mt-1.5 text-[11px] font-mono tabular-nums font-medium ${couplingTone}`}>
            {couplingLabel}
          </div>
        </div>
      </div>

      {/* Dual Synchronized Clinical Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 py-5 border-b border-slate-200 dark:border-slate-800 items-stretch">
        {/* Chart 1: Synchronized FSR Grip Force vs. Stroke Velocity */}
        <div className="flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Synchronized FSR Grip Force vs. Stroke Velocity
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Shaded bands mark in-air (pen_up) pauses · Amber markers flag coupled rigidity spikes
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowRadialOverlay((v) => !v)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors whitespace-nowrap shrink-0 ${
                showRadialOverlay
                  ? 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800'
                  : 'bg-white text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
              }`}
            >
              {showRadialOverlay ? 'Hide Radial Error' : 'Overlay Radial Error'}
            </button>
          </div>

          <div className="h-64 w-full bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 rounded-md p-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartTimeline} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="2 2" stroke={gridStroke} vertical={false} />
                {inAirSpans.map((sp, i) => (
                  <ReferenceArea
                    key={`air-${i}`}
                    x1={sp.x1}
                    x2={sp.x2}
                    yAxisId="fsr"
                    fill={isDark ? '#1e293b' : '#e2e8f0'}
                    fillOpacity={0.45}
                  />
                ))}
                <XAxis
                  dataKey="tSec"
                  type="number"
                  domain={[0, 'dataMax']}
                  stroke={axisColor}
                  fontSize={10}
                  tickFormatter={(v) => `${Number(v).toFixed(0)}s`}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="fsr"
                  orientation="left"
                  stroke="#d97706"
                  fontSize={10}
                  width={42}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  yAxisId="speed"
                  orientation="right"
                  stroke="#059669"
                  fontSize={10}
                  width={42}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: tooltipBg,
                    border: `1px solid ${tooltipBorder}`,
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                  }}
                  labelStyle={{ color: tooltipText, fontWeight: 600 }}
                  labelFormatter={(val) => `t = ${Number(val).toFixed(2)} s`}
                  formatter={(value: any, name: any) => {
                    if (name === 'fsr') return [`${value} FSR`, 'FSR Grip'];
                    if (name === 'speed') return [`${value} px/s`, 'Stroke Speed'];
                    if (name === 'radialError') return [`${value} px`, 'Radial Error'];
                    if (name === 'spikeFsr') return [`${value} FSR`, 'Rigidity Spike'];
                    return [value, name];
                  }}
                />
                <Area
                  yAxisId="fsr"
                  type="monotone"
                  dataKey="fsr"
                  stroke="#d97706"
                  fill="#f59e0b"
                  fillOpacity={isDark ? 0.12 : 0.15}
                  strokeWidth={1.75}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="speed"
                  type="monotone"
                  dataKey="speed"
                  stroke="#059669"
                  strokeWidth={1.75}
                  dot={false}
                  isAnimationActive={false}
                />
                {showRadialOverlay && (
                  <Line
                    yAxisId="speed"
                    type="monotone"
                    dataKey="radialError"
                    stroke="#0284c7"
                    strokeWidth={1.3}
                    strokeDasharray="3 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                <Scatter
                  yAxisId="fsr"
                  dataKey="spikeFsr"
                  fill="#dc2626"
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] font-mono text-slate-500 dark:text-slate-400">
            <span className="text-amber-700 dark:text-amber-400">— FSR Grip (Left)</span>
            <span className="text-emerald-700 dark:text-emerald-400">— Stroke Speed px/s (Right)</span>
            <span className="text-rose-600 dark:text-rose-400">● Rigidity Spike Event</span>
            <span>■ Shaded = In-Air (pen_up)</span>
          </div>
        </div>

        {/* Chart 2: In-Air (pen_up) vs. On-Paper (pen_down) Welch FFT Spectrum */}
        <div className="flex flex-col">
          <div className="mb-3">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              In-Air (pen_up) vs. On-Paper (pen_down) FFT Tremor Spectrum
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              2–4 s Hann-windowed Welch PSD at 200 Hz isolating 4–6 Hz resting vs. 5–10 Hz kinetic bands
            </p>
          </div>

          <div className="h-64 w-full bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 rounded-md p-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={result.fftComparisonSeries}
                margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="2 2" stroke={gridStroke} vertical={false} />
                <ReferenceArea
                  x1={4.0}
                  x2={6.0}
                  fill="#0284c7"
                  fillOpacity={isDark ? 0.14 : 0.1}
                />
                <ReferenceArea
                  x1={6.0}
                  x2={10.0}
                  fill="#d97706"
                  fillOpacity={isDark ? 0.1 : 0.08}
                />
                <XAxis
                  dataKey="freqHz"
                  type="number"
                  domain={[0.5, 14]}
                  stroke={axisColor}
                  fontSize={10}
                  tickFormatter={(v) => `${v} Hz`}
                  tickLine={false}
                />
                <YAxis
                  stroke={axisColor}
                  fontSize={10}
                  width={36}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: tooltipBg,
                    border: `1px solid ${tooltipBorder}`,
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                  }}
                  labelStyle={{ color: tooltipText, fontWeight: 600 }}
                  labelFormatter={(val) => `Frequency: ${Number(val).toFixed(1)} Hz`}
                  formatter={(value: any, name: any) => {
                    if (name === 'inAirPower') return [`${Number(value).toFixed(3)}`, 'In-Air Rest (pen_up)'];
                    if (name === 'onPaperPower') return [`${Number(value).toFixed(3)}`, 'On-Paper Kinetic (pen_down)'];
                    return [value, name];
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="inAirPower"
                  stroke="#0284c7"
                  fill="#0284c7"
                  fillOpacity={isDark ? 0.18 : 0.14}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="onPaperPower"
                  stroke="#d97706"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] font-mono text-slate-500 dark:text-slate-400">
            <span className="text-sky-700 dark:text-sky-400">— In-Air Rest (pen_up)</span>
            <span className="text-amber-700 dark:text-amber-400">- - On-Paper Kinetic (pen_down)</span>
            <span>Band Guides: 4–6 Hz PD Rest · 6–10 Hz Kinetic/ET</span>
          </div>
        </div>
      </div>

      {/* Clinical Synthesis & Coupled Rigidity Events Log */}
      <div className="pt-4 space-y-3">
        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
          <strong className="text-slate-900 dark:text-slate-100">Multimodal Fusion Synthesis:</strong>{' '}
          {result.fusionClinicalSummary}
        </p>

        {result.rigidityCoupling.rigidityEvents.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-sans">
                  <th className="py-1.5 pr-4 font-medium">Event Time</th>
                  <th className="py-1.5 pr-4 font-medium">Peak Grip (FSR)</th>
                  <th className="py-1.5 pr-4 font-medium">Baseline FSR</th>
                  <th className="py-1.5 pr-4 font-medium">Min Stroke Speed</th>
                  <th className="py-1.5 pr-4 font-medium">Velocity Drop</th>
                  <th className="py-1.5 font-medium">Radial Error</th>
                </tr>
              </thead>
              <tbody>
                {result.rigidityCoupling.rigidityEvents.slice(0, 6).map((ev, idx) => (
                  <tr
                    key={`${ev.tSec}-${idx}`}
                    className="border-b border-slate-100 dark:border-slate-800/60 text-slate-800 dark:text-slate-200"
                  >
                    <td className="py-1.5 pr-4">t = {ev.tSec.toFixed(2)} s</td>
                    <td className="py-1.5 pr-4 text-amber-700 dark:text-amber-400 font-semibold">
                      {ev.fsr} FSR
                    </td>
                    <td className="py-1.5 pr-4 text-slate-500">{ev.baselineFsr} FSR</td>
                    <td className="py-1.5 pr-4">{ev.speed.toFixed(1)} px/s</td>
                    <td className="py-1.5 pr-4 text-rose-700 dark:text-rose-400 font-semibold">
                      -{ev.speedDropPct.toFixed(1)}%
                    </td>
                    <td className="py-1.5">{ev.radialErrorPx.toFixed(1)} px</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};
