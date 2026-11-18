import React, { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import { Target } from 'lucide-react';
import { SensorData } from '../lib/serial';
import { useLanguage } from '../lib/i18n';

export interface ScalePreset {
  label: string;
  domain: [number, number] | ['auto', 'auto'];
}

interface LiveChartProps {
  data: SensorData[];
  dataKeys: { key: keyof SensorData; color: string; name: string }[];
  title: string;
  yDomain?: [number, number] | ['auto', 'auto'];
  calibratedDomain?: [number, number];
  scalePresets?: ScalePreset[];
  unit?: string;
  onQuickCalibrate?: () => void;
  onResetCalibration?: () => void;
  calibrateLabel?: string;
  isCalibrated?: boolean;
  isDark?: boolean;
}

export const LiveChart: React.FC<LiveChartProps> = React.memo(({ 
  data, 
  dataKeys, 
  title, 
  yDomain,
  calibratedDomain,
  scalePresets,
  unit = '',
  onQuickCalibrate,
  onResetCalibration,
  calibrateLabel,
  isCalibrated = false,
  isDark = false
}) => {
  const { t } = useLanguage();
  // Determine default domain preset
  const defaultDomain = calibratedDomain || yDomain || (['auto', 'auto'] as ['auto', 'auto']);
  const [selectedScaleIndex, setSelectedScaleIndex] = useState<number>(0);

  // Available scale options
  const presets: ScalePreset[] = useMemo(() => {
    if (scalePresets && scalePresets.length > 0) {
      return scalePresets;
    }
    if (calibratedDomain) {
      return [
        { label: `${t('calibratedBadge')} (${calibratedDomain[0]} to ${calibratedDomain[1]})`, domain: calibratedDomain },
        { label: t('autoFit'), domain: ['auto', 'auto'] }
      ];
    }
    if (yDomain) {
      return [
        { label: t('calibratedBadge'), domain: yDomain },
        { label: t('autoFit'), domain: ['auto', 'auto'] }
      ];
    }
    return [
      { label: t('autoFit'), domain: ['auto', 'auto'] }
    ];
  }, [scalePresets, calibratedDomain, yDomain, t]);

  const activePreset = presets[selectedScaleIndex] || presets[0];

  // If Auto Fit is active, compute dynamic bounds with 15% breathing room from the recent window
  const computedDomain = useMemo<[number, number] | ['auto', 'auto']>(() => {
    if (typeof activePreset.domain[0] === 'number' && typeof activePreset.domain[1] === 'number') {
      return [activePreset.domain[0], activePreset.domain[1]];
    }

    if (!data || data.length === 0) {
      return [-5, 5];
    }

    // Inspect last 50 samples
    const sampleWindow = data.slice(Math.max(0, data.length - 50));
    let min = Infinity;
    let max = -Infinity;

    for (const point of sampleWindow) {
      for (const dk of dataKeys) {
        const val = Number(point[dk.key]);
        if (!isNaN(val)) {
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }
    }

    if (!isFinite(min) || !isFinite(max)) {
      return [-5, 5];
    }

    if (min === max) {
      return [min - 1, max + 1];
    }

    const span = max - min;
    const padding = Math.max(span * 0.15, 0.1);
    const low = Math.floor((min - padding) * 10) / 10;
    const high = Math.ceil((max + padding) * 10) / 10;
    return [low, high];
  }, [activePreset, data, dataKeys]);

  // Extract latest live readings for readout chips
  const latestData = data.length > 0 ? data[data.length - 1] : null;

  return (
    <div className="w-full h-72 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-lg p-3.5 flex flex-col transition-all shadow-2xs">
      {/* Chart Header: Title, Live Values & Scale Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-slate-900 dark:text-slate-100 text-xs font-semibold uppercase tracking-wider font-sans">
            {title}
          </h3>
          {unit && (
            <span className="text-[10px] font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded font-medium">
              {unit}
            </span>
          )}
          {isCalibrated && (
            <button
              type="button"
              onClick={onResetCalibration}
              title="Click to reset calibration offsets for this sensor"
              className="text-[10px] font-mono text-sky-800 dark:text-sky-300 bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/60 dark:hover:bg-sky-900/60 border border-sky-200 dark:border-sky-800 px-1.5 py-0.5 rounded font-semibold cursor-pointer transition-colors"
            >
              {t('calibratedBadge')} ×
            </button>
          )}
          {onQuickCalibrate && (
            <button
              type="button"
              onClick={onQuickCalibrate}
              className="p-1 rounded text-slate-400 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title={calibrateLabel}
            >
              <Target size={13} />
            </button>
          )}
        </div>

        {/* Live Values Readout Chips */}
        {latestData && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
            {dataKeys.map((dk) => {
              const val = Number(latestData[dk.key]);
              const formattedVal = isNaN(val) ? '--' : val > 0 && dk.key !== 'fsr' ? `+${val.toFixed(2)}` : val.toFixed(2);
              return (
                <span
                  key={dk.key}
                  className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-50 border border-slate-200/80 text-slate-800 dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-200 shadow-2xs"
                  title={`${dk.name}: ${formattedVal} ${unit}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dk.color }} />
                  <span className="text-slate-500 dark:text-slate-400 text-[10px] font-semibold uppercase">{dk.name.split(' ')[0]}:</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">{formattedVal}</span>
                </span>
              );
            })}
          </div>
        )}

        {/* Scale Preset Selector Buttons */}
        {presets.length > 1 && (
          <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-md border border-slate-200/80 dark:border-slate-700/80 text-[11px]">
            {presets.map((preset, idx) => {
              const isActive = idx === selectedScaleIndex;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setSelectedScaleIndex(idx)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all whitespace-nowrap ${
                    isActive
                      ? 'bg-white text-sky-800 font-semibold shadow-2xs border border-slate-200 dark:bg-slate-700 dark:text-sky-300 dark:border-slate-600'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700/50'
                  }`}
                  title={`Switch scale to ${preset.label}`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Chart Canvas */}
      <div className="flex-1 w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="2 2" stroke={isDark ? "#1e293b" : "#e2e8f0"} />
            <XAxis 
              dataKey="timestamp" 
              type="number" 
              domain={['dataMin', 'dataMax']} 
              tickFormatter={(unixTime) => new Date(unixTime).toLocaleTimeString()}
              hide
            />
            <YAxis 
              domain={computedDomain} 
              stroke={isDark ? "#64748b" : "#94a3b8"}
              fontSize={10} 
              tickFormatter={(v) => typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) : v}
              width={38}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: isDark ? '#0f172a' : '#ffffff', 
                borderColor: isDark ? '#1e293b' : '#e2e8f0', 
                color: isDark ? '#f8fafc' : '#0f172a', 
                borderRadius: '6px', 
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
              }}
              labelFormatter={(label: any) => new Date(Number(label) || Date.now()).toLocaleTimeString()}
              formatter={(val: any, name: any) => [
                `${Number(val).toFixed(2)} ${unit}`, 
                String(name ?? '')
              ]}
            />
            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '2px' }} />
            {dataKeys.map((dk) => (
              <Line
                key={dk.key}
                type="monotone"
                dataKey={dk.key}
                stroke={dk.color}
                name={dk.name}
                dot={false}
                strokeWidth={1.75}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
