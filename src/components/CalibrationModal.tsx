import React, { useState, useEffect } from 'react';
import { Target, CheckCircle2, RotateCcw, Compass, Activity, Disc, HandMetal, X } from 'lucide-react';
import { useLanguage } from '../lib/i18n';

export interface CalibrationOffsets {
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  mx: number;
  my: number;
  mz: number;
  fsr: number;
  retainGravity: boolean;
}

export const DEFAULT_OFFSETS: CalibrationOffsets = {
  ax: 0,
  ay: 0,
  az: 0,
  gx: 0,
  gy: 0,
  gz: 0,
  mx: 0,
  my: 0,
  mz: 0,
  fsr: 0,
  retainGravity: true,
};

interface CalibrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  offsets: CalibrationOffsets;
  onSaveOffsets: (newOffsets: CalibrationOffsets) => void;
  onStartCalibration: (type: 'all' | 'accel' | 'gyro' | 'mag' | 'fsr', retainGravity: boolean) => void;
  isCalibrating: boolean;
  calibrationTimeLeft: number;
  calibrationType: 'all' | 'accel' | 'gyro' | 'mag' | 'fsr';
  isConnected: boolean;
}

export const CalibrationModal: React.FC<CalibrationModalProps> = ({
  isOpen,
  onClose,
  offsets,
  onSaveOffsets,
  onStartCalibration,
  isCalibrating,
  calibrationTimeLeft,
  calibrationType,
  isConnected,
}) => {
  const { t } = useLanguage();
  const [retainGravity, setRetainGravity] = useState<boolean>(offsets.retainGravity ?? true);

  useEffect(() => {
    setRetainGravity(offsets.retainGravity ?? true);
  }, [offsets.retainGravity]);

  if (!isOpen) return null;

  const handleToggleGravity = () => {
    const updated = !retainGravity;
    setRetainGravity(updated);
    onSaveOffsets({
      ...offsets,
      retainGravity: updated,
    });
  };

  const handleReset = () => {
    onSaveOffsets(DEFAULT_OFFSETS);
  };

  const isAnyCalibrated = 
    offsets.ax !== 0 || offsets.ay !== 0 || offsets.az !== 0 ||
    offsets.gx !== 0 || offsets.gy !== 0 || offsets.gz !== 0 ||
    offsets.mx !== 0 || offsets.my !== 0 || offsets.mz !== 0 ||
    offsets.fsr !== 0;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg max-w-2xl w-full p-5 shadow-xl max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-md bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 flex items-center justify-center text-sky-700 dark:text-sky-400">
              <Target size={18} className={isCalibrating ? 'animate-spin' : ''} />
            </div>
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-100 flex items-center gap-2">
                {t('calibrationModalTitle')}
                {isAnyCalibrated && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800">
                    {t('calibratedBadge')}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('calibrationModalSubtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Live Calibration Banner if active */}
        {isCalibrating && (
          <div className="mb-4 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-7 h-7 rounded-md bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center text-amber-800 dark:text-amber-300 font-mono font-semibold text-xs">
                {calibrationTimeLeft}s
              </div>
              <div>
                <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                  {t('calibratingSensors')} ({calibrationType.toUpperCase()})...
                </div>
                <div className="text-[11px] text-amber-700 dark:text-amber-400">
                  {t('calibrationPrompt')}
                </div>
              </div>
            </div>
            <div className="text-[10px] font-mono text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 rounded border border-amber-300 dark:border-amber-700">
              {t('sampling')}
            </div>
          </div>
        )}

        {/* Primary Calibration Action */}
        <div className="p-3.5 rounded-md bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 mb-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                {t('fullCalibration')}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t('fullCalibrationDesc')}
              </div>
            </div>
            <button
              onClick={() => onStartCalibration('all', retainGravity)}
              disabled={isCalibrating || !isConnected}
              className={`px-3.5 py-1.5 rounded-md font-medium text-xs flex items-center gap-1.5 transition-all whitespace-nowrap shadow-2xs ${
                isCalibrating
                  ? 'bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-500 cursor-not-allowed'
                  : isConnected
                  ? 'bg-sky-700 hover:bg-sky-800 text-white'
                  : 'bg-slate-100 text-slate-500 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
              }`}
            >
              <Target size={14} />
              <span>{isCalibrating ? `${t('calibratingSensors')} (${calibrationTimeLeft}s)...` : t('calibrateAllSensors')}</span>
            </button>
          </div>

          {/* Accelerometer Z gravity preference toggle */}
          <div className="mt-3 pt-2.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-600 dark:text-slate-400">{t('accelZGravityMode')}</span>
            <button
              type="button"
              onClick={handleToggleGravity}
              className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-800 dark:text-slate-200 font-mono text-[11px] shadow-2xs"
            >
              {retainGravity ? `✓ ${t('retainGravity')}` : t('zeroCenteredDynamic')}
            </button>
          </div>
        </div>

        {/* Individual Sensor Zeroing Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4">
          
          {/* Accelerometer */}
          <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 flex flex-col justify-between shadow-2xs">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Activity size={14} className="text-sky-700 dark:text-sky-400" />
                <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider">{t('accelerometer')}</span>
              </div>
              <button
                onClick={() => onStartCalibration('accel', retainGravity)}
                disabled={isCalibrating || !isConnected}
                className="text-[10px] px-2 py-0.5 rounded bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 dark:bg-sky-950/60 dark:hover:bg-sky-900/60 dark:text-sky-300 dark:border-sky-800 transition-colors font-medium font-mono"
              >
                {t('zeroAccel')}
              </button>
            </div>
            <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 space-y-0.5">
              <div>{t('offsetX')}: <span className="font-semibold text-slate-900 dark:text-slate-100">{offsets.ax >= 0 ? `+${offsets.ax.toFixed(3)}` : offsets.ax.toFixed(3)} m/s²</span></div>
              <div>{t('offsetY')}: <span className="font-semibold text-slate-900 dark:text-slate-100">{offsets.ay >= 0 ? `+${offsets.ay.toFixed(3)}` : offsets.ay.toFixed(3)} m/s²</span></div>
              <div>{t('offsetZ')}: <span className="font-semibold text-slate-900 dark:text-slate-100">{offsets.az >= 0 ? `+${offsets.az.toFixed(3)}` : offsets.az.toFixed(3)} m/s²</span></div>
            </div>
          </div>

          {/* Gyroscope */}
          <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 flex flex-col justify-between shadow-2xs">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Disc size={14} className="text-indigo-600 dark:text-indigo-400" />
                <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider">{t('gyroscope')}</span>
              </div>
              <button
                onClick={() => onStartCalibration('gyro', retainGravity)}
                disabled={isCalibrating || !isConnected}
                className="text-[10px] px-2 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 dark:text-indigo-300 dark:border-indigo-800 transition-colors font-medium font-mono"
              >
                {t('zeroGyro')}
              </button>
            </div>
            <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 space-y-0.5">
              <div>{t('driftGX')}: <span className="font-semibold text-slate-900 dark:text-slate-100">{offsets.gx >= 0 ? `+${offsets.gx.toFixed(2)}` : offsets.gx.toFixed(2)} °/s</span></div>
              <div>{t('driftGY')}: <span className="font-semibold text-slate-900 dark:text-slate-100">{offsets.gy >= 0 ? `+${offsets.gy.toFixed(2)}` : offsets.gy.toFixed(2)} °/s</span></div>
              <div>{t('driftGZ')}: <span className="font-semibold text-slate-900 dark:text-slate-100">{offsets.gz >= 0 ? `+${offsets.gz.toFixed(2)}` : offsets.gz.toFixed(2)} °/s</span></div>
            </div>
          </div>

          {/* Magnetometer */}
          <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 flex flex-col justify-between shadow-2xs">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Compass size={14} className="text-slate-700 dark:text-slate-300" />
                <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider">{t('magnetometer')}</span>
              </div>
              <button
                onClick={() => onStartCalibration('mag', retainGravity)}
                disabled={isCalibrating || !isConnected}
                className="text-[10px] px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700 transition-colors font-medium font-mono"
              >
                {t('zeroMag')}
              </button>
            </div>
            <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 space-y-0.5">
              <div>{t('biasMX')}: <span className="font-semibold text-slate-900 dark:text-slate-100">{offsets.mx >= 0 ? `+${offsets.mx.toFixed(1)}` : offsets.mx.toFixed(1)} µT</span></div>
              <div>{t('biasMY')}: <span className="font-semibold text-slate-900 dark:text-slate-100">{offsets.my >= 0 ? `+${offsets.my.toFixed(1)}` : offsets.my.toFixed(1)} µT</span></div>
              <div>{t('biasMZ')}: <span className="font-semibold text-slate-900 dark:text-slate-100">{offsets.mz >= 0 ? `+${offsets.mz.toFixed(1)}` : offsets.mz.toFixed(1)} µT</span></div>
            </div>
          </div>

          {/* Grip Pressure / FSR */}
          <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 flex flex-col justify-between shadow-2xs">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <HandMetal size={14} className="text-amber-700 dark:text-amber-400" />
                <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider">{t('fsrPressure')}</span>
              </div>
              <button
                onClick={() => onStartCalibration('fsr', retainGravity)}
                disabled={isCalibrating || !isConnected}
                className="text-[10px] px-2 py-0.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 dark:text-amber-300 dark:border-amber-800 transition-colors font-medium font-mono"
              >
                {t('tareGrip')}
              </button>
            </div>
            <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 space-y-0.5">
              <div>{t('restingTare')}: <span className="font-semibold text-slate-900 dark:text-slate-100">+{offsets.fsr.toFixed(0)} / 1000</span></div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">{t('zerosPenRestingPressure')}</div>
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-rose-700 dark:text-slate-400 dark:hover:text-rose-400 transition-colors px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <RotateCcw size={13} />
            <span>{t('resetDefaults')}</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-100 rounded-md text-xs font-medium transition-colors shadow-2xs"
          >
            {t('done')}
          </button>
        </div>

      </div>
    </div>
  );
};
