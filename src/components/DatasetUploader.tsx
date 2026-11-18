import React, { useRef } from 'react';
import { Upload, FileText, AlertCircle } from 'lucide-react';
import { SensorData, enrichSensorFrame, parseUniversalTelemetryLine } from '../lib/serial';
import { useLanguage } from '../lib/i18n';

interface DatasetUploaderProps {
  onDataLoaded: (data: SensorData[]) => void;
  onError: (message: string) => void;
}

export const DatasetUploader: React.FC<DatasetUploaderProps> = ({ onDataLoaded, onError }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();

  const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB limit
  const MAX_SAMPLE_POINTS = 30000; // Prevent memory exhaustion DoS

  const clampNumber = (val: any, min: number, max: number, fallback: number = 0): number => {
    const num = Number(val);
    if (!Number.isFinite(num) || Number.isNaN(num)) return fallback;
    return Math.max(min, Math.min(max, num));
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset input immediately so same file can be reselected if needed
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Validate file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      onError(`File exceeds maximum permitted size of 10 MB (Selected: ${(file.size / (1024 * 1024)).toFixed(1)} MB).`);
      return;
    }

    // Validate extension
    const fileNameLower = file.name.toLowerCase();
    if (!fileNameLower.endsWith('.json') && !fileNameLower.endsWith('.csv')) {
      onError("Unsupported file type. Only certified .csv and .json sensor datasets are permitted.");
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      onError("An error occurred while reading the file. Please verify file permissions.");
    };

    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content || typeof content !== 'string') {
        onError("Uploaded file is empty or corrupted.");
        return;
      }

      try {
        if (fileNameLower.endsWith('.json')) {
          const parsed = JSON.parse(content);
          if (!Array.isArray(parsed)) {
            throw new Error("Invalid JSON structure: Expected an array of sensor telemetry objects.");
          }
          if (parsed.length === 0) {
            throw new Error("The JSON dataset contains zero records.");
          }
          if (parsed.length > MAX_SAMPLE_POINTS) {
            throw new Error(`Dataset exceeds maximum allowable sample limit of ${MAX_SAMPLE_POINTS} data points.`);
          }

          const sanitizedData: SensorData[] = parsed.slice(0, MAX_SAMPLE_POINTS).map((d, idx) =>
            enrichSensorFrame({
              timestamp: clampNumber(d.timestamp, 0, 9999999999999, Date.now() + idx * 20),
              ax: clampNumber(d.ax, -500, 500),
              ay: clampNumber(d.ay, -500, 500),
              az: clampNumber(d.az, -500, 500),
              gx: clampNumber(d.gx, -5000, 5000),
              gy: clampNumber(d.gy, -5000, 5000),
              gz: clampNumber(d.gz, -5000, 5000),
              mx: clampNumber(d.mx, -5000, 5000),
              my: clampNumber(d.my, -5000, 5000),
              mz: clampNumber(d.mz, -5000, 5000),
              fsr: clampNumber(d.fsr ?? d.fsrPressure, 0, 4096),
            })
          );

          onDataLoaded(sanitizedData);
        } else if (fileNameLower.endsWith('.csv')) {
          const lines = content.split(/\r?\n/);
          const data: SensorData[] = [];
          const baseTs = Date.now();

          for (let i = 0; i < lines.length && data.length < MAX_SAMPLE_POINTS; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const parsedRow = parseUniversalTelemetryLine(line);
            if (parsedRow) {
              data.push({
                ...parsedRow,
                timestamp: baseTs + data.length * 20,
              });
            }
          }

          if (data.length === 0) throw new Error("No valid telemetry rows detected in the CSV file.");
          onDataLoaded(data);
        }
      } catch (err: any) {
        onError(typeof err?.message === 'string' ? err.message : "Failed to parse sensor dataset.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".csv,.json"
        className="hidden"
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 border border-slate-200 rounded-md hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700 transition-colors text-xs font-medium shadow-2xs"
        title={t('uploadTooltip')}
      >
        <Upload className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400" />
        <span className="hidden md:inline">{t('loadDataset')}</span>
      </button>
    </div>
  );
};
