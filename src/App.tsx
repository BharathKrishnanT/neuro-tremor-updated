import React, { useState, useEffect, useRef, useCallback } from 'react';
import { serialService, SensorData, enrichSensorFrame } from './lib/serial';
import { bleService } from './lib/ble';
import { wifiService } from './lib/wifi';
import { mobileSensorService } from './lib/mobileSensors';
import { mlService, SensitivityLevel } from './lib/mlService';
import {
  SimulationProfile,
  generateSimulatedSample,
  analyzeTremorDifferential,
  computeRecoveryAnalysis,
  computeDatasetSectionSummary,
  computeSensorChannelStats,
  DifferentialAnalysisResult,
  DatasetSectionSummary,
  SensorChannelStats,
} from './lib/tremorAnalyzer';
import { verifyAndCompressSession } from './lib/backendApi';
import { audioFeedback } from './lib/audio';
import { exportService } from './lib/exportService';
import { LiveChart } from './components/LiveChart';
import { TremorAnalysis } from './components/TremorAnalysis';
import { DifferentialDiagnosisPanel } from './components/DifferentialDiagnosisPanel';
import { DatasetUploader } from './components/DatasetUploader';
import { DatasetSummary } from './components/DatasetSummary';
import { RecoveryTrendChart } from './components/RecoveryTrendChart';
import {
  TouchPadCanvas,
  DrawingStroke,
  CanvasDrawMode,
  renderDrawingToCanvas,
} from './components/TouchPadCanvas';
import { LanguageSelector } from './components/LanguageSelector';
import {
  CalibrationModal,
  CalibrationOffsets,
  DEFAULT_OFFSETS,
} from './components/CalibrationModal';
import { PatientDetailsModal } from './components/PatientDetailsModal';
import { SecurityPrivacyModal } from './components/SecurityPrivacyModal';
import { Esp32FirmwareModal } from './components/Esp32FirmwareModal';
import { ConsentBanner } from './components/ConsentBanner';
import { SettingsMenu } from './components/SettingsMenu';
import { useLanguage } from './lib/i18n';
import {
  Activity,
  Bluetooth,
  Cable,
  Play,
  Square,
  Save,
  Trash2,
  ExternalLink,
  AlertCircle,
  Pause,
  Smartphone,
  FileText,
  Target,
  Sun,
  Moon,
  Battery,
  Cloud,
  CloudOff,
  Zap,
  ShieldCheck,
  Cpu,
  Eye,
  Download,
} from 'lucide-react';
import { generateClinicalReport } from './lib/reportGenerator';
import {
  auth,
  db,
  signInWithGoogle,
  signInAsGuest,
  logOut,
  checkFirestoreConnectivity,
  handleFirestoreError,
  OperationType,
  collection,
  doc,
  setDoc,
  onSnapshot,
  query,
  where,
  deleteDoc,
  onAuthStateChanged,
} from './firebase';
import type { User } from 'firebase/auth';

export interface Session {
  id: string;
  userId: string;
  timestamp: number;
  duration: number;
  severity: string;
  stage: string;
  rms: number;
  frequency: number;
  phenotype?: string;
  pdProbability?: number;
  etProbability?: number;
  pillRollingIndex?: number;
  avgForce?: number;
  integrityHash?: string;
  data: SensorData[];
  // Complete section archive fields (drawing, read telemetry stats, KPI, Differential & Dataset Summary)
  rawSampleCount?: number;
  drawingStrokes?: DrawingStroke[];
  canvasMode?: CanvasDrawMode;
  canvasWidth?: number;
  canvasHeight?: number;
  analysis?: DifferentialAnalysisResult;
  datasetSummary?: DatasetSectionSummary;
  sensorStats?: SensorChannelStats;
  recoveryRate?: number;
  previousSectionRms?: number;
  sectionComparisonLabel?: string;
  connectionType?: string | null;
  sensitivity?: SensitivityLevel;
  sensitivityMultiplier?: number;
  calibrationOffsets?: CalibrationOffsets;
}

function serializeSessionPayload(session: Session): string {
  return JSON.stringify({
    version: 2,
    frames: session.data,
    rawSampleCount: session.rawSampleCount ?? session.data.length,
    drawingStrokes: session.drawingStrokes ?? [],
    canvasMode: session.canvasMode ?? 'spiral',
    canvasWidth: session.canvasWidth ?? 800,
    canvasHeight: session.canvasHeight ?? 320,
    analysis: session.analysis,
    datasetSummary: session.datasetSummary,
    sensorStats: session.sensorStats,
    recoveryRate: session.recoveryRate,
    previousSectionRms: session.previousSectionRms,
    sectionComparisonLabel: session.sectionComparisonLabel,
    connectionType: session.connectionType ?? null,
    sensitivity: session.sensitivity,
    sensitivityMultiplier: session.sensitivityMultiplier,
    calibrationOffsets: session.calibrationOffsets,
  });
}

function deserializeSessionDoc(d: Record<string, any>): Session {
  const parsed = typeof d.data === 'string' ? JSON.parse(d.data) : d.data;
  const isV2Archive =
    parsed && !Array.isArray(parsed) && typeof parsed === 'object' && Array.isArray(parsed.frames);
  const frames: SensorData[] = isV2Archive
    ? parsed.frames
    : Array.isArray(parsed)
    ? parsed
    : [];

  const mult = isV2Archive && parsed.sensitivityMultiplier ? parsed.sensitivityMultiplier : 1.35;
  const analysis: DifferentialAnalysisResult =
    (isV2Archive && parsed.analysis) ||
    analyzeTremorDifferential(frames, 'pen', mult);
  const datasetSummary: DatasetSectionSummary =
    (isV2Archive && parsed.datasetSummary) ||
    computeDatasetSectionSummary(frames, 'pen', mult);
  const sensorStats: SensorChannelStats =
    (isV2Archive && parsed.sensorStats) || computeSensorChannelStats(frames);

  return {
    id: d.id,
    userId: d.userId,
    timestamp: d.timestamp,
    duration: d.duration,
    severity: d.severity,
    stage: d.stage,
    rms: d.rms,
    frequency: d.frequency,
    phenotype: d.phenotype || analysis.phenotype,
    pdProbability: d.pdProbability ?? analysis.pdProbability,
    etProbability: d.etProbability ?? analysis.etProbability,
    pillRollingIndex: d.pillRollingIndex ?? analysis.pillRollingIndex,
    avgForce: d.avgForce ?? analysis.avgForce,
    integrityHash: d.integrityHash,
    data: frames,
    rawSampleCount: isV2Archive ? parsed.rawSampleCount : frames.length,
    drawingStrokes: isV2Archive ? parsed.drawingStrokes : d.drawingStrokes,
    canvasMode: isV2Archive ? parsed.canvasMode : d.canvasMode || 'spiral',
    canvasWidth: isV2Archive ? parsed.canvasWidth : d.canvasWidth || 800,
    canvasHeight: isV2Archive ? parsed.canvasHeight : d.canvasHeight || 320,
    analysis,
    datasetSummary,
    sensorStats,
    recoveryRate: isV2Archive ? parsed.recoveryRate : d.recoveryRate,
    previousSectionRms: isV2Archive ? parsed.previousSectionRms : d.previousSectionRms,
    sectionComparisonLabel: isV2Archive ? parsed.sectionComparisonLabel : d.sectionComparisonLabel,
    connectionType: isV2Archive ? parsed.connectionType : d.connectionType,
    sensitivity: isV2Archive ? parsed.sensitivity : d.sensitivity,
    sensitivityMultiplier: isV2Archive ? parsed.sensitivityMultiplier : d.sensitivityMultiplier,
    calibrationOffsets: isV2Archive ? parsed.calibrationOffsets : d.calibrationOffsets,
  };
}

function SavedDrawingPreview({
  strokes,
  mode = 'spiral',
}: {
  strokes?: DrawingStroke[];
  mode?: CanvasDrawMode;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      renderDrawingToCanvas(ctx, canvas.width, canvas.height, mode, strokes || []);
    }
  }, [strokes, mode]);

  return (
    <canvas
      ref={ref}
      width={480}
      height={190}
      className="w-full h-44 bg-slate-950 rounded-md border border-slate-800 block"
    />
  );
}

function App() {
  const { t } = useLanguage();
  const [isConnected, setIsConnected] = useState(false);
  const [connectionType, setConnectionType] = useState<
    | 'serial'
    | 'ble'
    | 'wifi'
    | 'sim'
    | 'mobile'
    | 'touch'
    | 'ble-touch'
    | 'serial-touch'
    | 'wifi-touch'
    | null
  >(null);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simProfile, setSimProfile] = useState<SimulationProfile>('pd_resting');
  const simProfileRef = useRef<SimulationProfile>('pd_resting');
  const [latestIntegrityHash, setLatestIntegrityHash] = useState<string | null>(null);

  const [data, setData] = useState<SensorData[]>([]);
  const [sectionData, setSectionData] = useState<SensorData[]>([]);
  const sectionJustSavedRef = useRef<boolean>(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedSessions, setRecordedSessions] = useState<Session[]>([]);
  const [isDrawingOnCanvas, setIsDrawingOnCanvas] = useState(false);
  const isDrawingOnCanvasRef = useRef(false);
  const lastHardwarePacketTsRef = useRef<number>(0);
  const [permissionError, setPermissionError] = useState(false);
  const [, setBleStatusText] = useState<string>('');
  const [sensitivity, setSensitivity] = useState<SensitivityLevel>(() => {
    try {
      const saved = localStorage.getItem('neurotremor_sensitivity');
      if (saved === 'low' || saved === 'normal' || saved === 'high') {
        mlService.setSensitivity(saved);
        return saved;
      }
    } catch {}
    mlService.setSensitivity('normal');
    return 'normal';
  });
  const [sensitivityMultiplier, setSensitivityMultiplier] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('neurotremor_sensitivity_mult');
      if (saved) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= 0.5 && val <= 3.0) {
          mlService.setSensitivityMultiplier(val);
          return val;
        }
      }
    } catch {}
    return mlService.getSensitivityMultiplier();
  });

  const handleSensitivityChange = (newLevel: SensitivityLevel) => {
    setSensitivity(newLevel);
    mlService.setSensitivity(newLevel);
    const mult = mlService.getSensitivityMultiplier();
    setSensitivityMultiplier(mult);
    try {
      localStorage.setItem('neurotremor_sensitivity', newLevel);
      localStorage.setItem('neurotremor_sensitivity_mult', mult.toString());
    } catch {}
  };

  const handleSensitivityMultiplierChange = (newMult: number) => {
    const clamped = Math.max(0.5, Math.min(3.0, Number(newMult.toFixed(2))));
    setSensitivityMultiplier(clamped);
    mlService.setSensitivityMultiplier(clamped);
    try {
      localStorage.setItem('neurotremor_sensitivity_mult', clamped.toString());
    } catch {}
  };

  const [, setMlSeverity] = useState<number>(0);
  const isInferenceRunning = useRef(false);
  const lastInferenceTime = useRef<number>(0);
  const [loadedDataset, setLoadedDataset] = useState<SensorData[] | null>(null);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isPlayingDataset, setIsPlayingDataset] = useState(false);
  const [isPausedDataset, setIsPausedDataset] = useState(false);
  const [isPausedRealTime, setIsPausedRealTime] = useState(false);
  const isPausedRealTimeRef = useRef(false);
  const [offsets, setOffsets] = useState<CalibrationOffsets>(() => {
    try {
      // Clear stale cross-session calibration offsets so sensors always start with true physical units
      localStorage.removeItem('neurotremor_calibration_offsets');
    } catch {}
    return DEFAULT_OFFSETS;
  });
  const [showCalibrationModal, setShowCalibrationModal] = useState(false);
  const [showFirmwareModal, setShowFirmwareModal] = useState(false);
  const [reportModalSession, setReportModalSession] = useState<Session | null>(null);
  const [securityModalTab, setSecurityModalTab] = useState<
    'medical' | 'privacy' | 'cookies' | 'security' | null
  >(null);
  const [calibrationType, setCalibrationType] = useState<
    'all' | 'accel' | 'gyro' | 'mag' | 'fsr'
  >('all');
  const [selectedSensorTab, setSelectedSensorTab] = useState<
    'all' | 'accel' | 'gyro' | 'mag' | 'fsr'
  >('all');
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationTimeLeft, setCalibrationTimeLeft] = useState(0);
  const isCalibratingRef = useRef(false);
  const calibrationBuffer = useRef<SensorData[]>([]);
  const calibrationOffsets = useRef<CalibrationOffsets>(offsets);
  const calibrationTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    calibrationOffsets.current = offsets;
  }, [offsets]);

  useEffect(() => {
    isPausedRealTimeRef.current = isPausedRealTime;
  }, [isPausedRealTime]);

  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isHighContrast, setIsHighContrast] = useState(() => {
    try {
      const saved = localStorage.getItem('neuro_theme');
      if (saved) return saved === 'light';
    } catch {}
    return document.documentElement.classList.contains('light-theme');
  });

  useEffect(() => {
    if (isHighContrast) {
      document.documentElement.classList.add('light-theme');
      document.documentElement.classList.remove('dark');
      try {
        localStorage.setItem('neuro_theme', 'light');
      } catch {}
    } else {
      document.documentElement.classList.remove('light-theme');
      document.documentElement.classList.add('dark');
      try {
        localStorage.setItem('neuro_theme', 'dark');
      } catch {}
    }
  }, [isHighContrast]);

  const [errorModal, setErrorModal] = useState<{
    title: string;
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  } | null>(null);

  const [firebaseStatus, setFirebaseStatus] = useState<{
    connected: boolean;
    latencyMs?: number;
    checking: boolean;
    error?: string;
  }>({
    connected: false,
    checking: true,
  });

  const runConnectivityCheck = useCallback(async () => {
    setFirebaseStatus((prev) => ({ ...prev, checking: true }));
    const result = await checkFirestoreConnectivity();
    setFirebaseStatus({
      connected: result.connected,
      latencyMs: result.latencyMs,
      checking: false,
      error: result.error,
    });
  }, []);

  useEffect(() => {
    runConnectivityCheck();
    const interval = setInterval(runConnectivityCheck, 60000);
    return () => clearInterval(interval);
  }, [runConnectivityCheck]);

  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [showPenModal, setShowPenModal] = useState(false);
  const [isStreamingExport, setIsStreamingExport] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');
  const [exportDuration, setExportDuration] = useState<number>(0);

  const latestTouchRef = useRef<{ x: number; y: number } | null>(null);
  const simulationInterval = useRef<NodeJS.Timeout | null>(null);
  const playbackInterval = useRef<NodeJS.Timeout | null>(null);
  const uiUpdateInterval = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const recordingBuffer = useRef<SensorData[]>([]);
  const sectionDataBuffer = useRef<SensorData[]>([]);
  const activeDrawingStrokesRef = useRef<DrawingStroke[]>([]);
  const activeCanvasMetaRef = useRef<{ mode: CanvasDrawMode; width: number; height: number }>({
    mode: 'spiral',
    width: 800,
    height: 320,
  });
  const [replayStrokes, setReplayStrokes] = useState<DrawingStroke[] | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const uiBuffer = useRef<SensorData[]>([]);
  const recordingStartTime = useRef<number>(0);
  const sectionStartTimeRef = useRef<number>(0);

  const MAX_POINTS = 100;

  useEffect(() => {
    uiUpdateInterval.current = setInterval(() => {
      if (uiBuffer.current.length === 0) return;

      const newPoints = [...uiBuffer.current];
      uiBuffer.current = [];

      if (isPausedRealTimeRef.current) return;

      setData((prev) => {
        const updated = [...prev, ...newPoints];
        if (updated.length > MAX_POINTS) {
          return updated.slice(updated.length - MAX_POINTS);
        }
        return updated;
      });
      if (sectionDataBuffer.current.length > 0) {
        setSectionData([...sectionDataBuffer.current]);
      }
    }, 100);

    return () => {
      if (uiUpdateInterval.current) clearInterval(uiUpdateInterval.current);
    };
  }, []);

  useEffect(() => {
    mlService.initModel();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAuthReady) return;

    if (!user) {
      try {
        const stored = localStorage.getItem('neurotremor_guest_sessions');
        if (stored) {
          setRecordedSessions(JSON.parse(stored));
        } else {
          setRecordedSessions([]);
        }
      } catch {
        setRecordedSessions([]);
      }
      return;
    }

    const q = query(collection(db, 'sessions'), where('userId', '==', user.uid));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const sessions: Session[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          try {
            sessions.push(deserializeSessionDoc(d));
          } catch (e) {
            console.error('Failed to parse session data', e);
          }
        });
        sessions.sort((a, b) => b.timestamp - a.timestamp);
        setRecordedSessions(sessions);
        try {
          localStorage.setItem(
            `neurotremor_cached_sessions_${user.uid}`,
            JSON.stringify(sessions)
          );
        } catch {}
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'sessions');
        try {
          const cached = localStorage.getItem(`neurotremor_cached_sessions_${user.uid}`);
          if (cached) {
            setRecordedSessions(JSON.parse(cached));
          }
        } catch {}
      }
    );

    return () => unsubscribe();
  }, [user, isAuthReady]);

  useEffect(() => {
    if (data.length < 20) return;

    const now = Date.now();
    if (now - lastInferenceTime.current < 100) return;
    lastInferenceTime.current = now;

    const runInference = async () => {
      if (isInferenceRunning.current) return;
      isInferenceRunning.current = true;
      try {
        const deviceType = connectionType === 'mobile' ? 'mobile' : 'pen';
        const features = mlService.extractFeatures(data, deviceType);
        const severity = await mlService.predictSeverity(data, features, deviceType);
        if (!Number.isNaN(severity)) {
          setMlSeverity(severity);
        }
      } catch (error) {
        console.error('Inference error:', error);
      } finally {
        isInferenceRunning.current = false;
      }
    };

    runInference();
  }, [data, connectionType]);

  // Compute Differential Analysis & Metrics as the average of the total section reading (never just the last-second window)
  const activeSectionFrames = React.useMemo(() => {
    if (sectionData.length >= 12) return sectionData;
    if (data.length >= 12) return data;
    if (recordedSessions.length > 0 && recordedSessions[0].data.length >= 12) {
      return recordedSessions[0].data;
    }
    return data;
  }, [sectionData, data, recordedSessions]);

  const differential = React.useMemo(() => {
    const deviceType = connectionType === 'mobile' ? 'mobile' : 'pen';
    return analyzeTremorDifferential(activeSectionFrames, deviceType, sensitivityMultiplier);
  }, [activeSectionFrames, connectionType, sensitivityMultiplier]);

  const metrics = React.useMemo(() => {
    const recoverySummary = computeRecoveryAnalysis({
      recordedSessions,
    });

    return {
      rms: differential.rms,
      frequency: differential.dominantFreq,
      intensity: differential.severityLabel,
      stage: differential.clinicalStage,
      updrsScore: differential.updrsScore,
      hoehnYahrStage: differential.hoehnYahrStage,
      estimatedExcursionCm: differential.estimatedExcursionCm,
      is4to6HzPdLock: differential.is4to6HzPdLock,
      kinematicBracket: differential.kinematicBracket,
      recoveryRate: recoverySummary.recoveryRate,
      recoverySummary,
      avgForce: differential.avgForce,
      phenotype: differential.phenotype,
    };
  }, [differential, recordedSessions]);

  const [isIframe, setIsIframe] = useState(false);

  const previousIntensityRef = useRef<string>('Normal');
  useEffect(() => {
    if (metrics.intensity !== previousIntensityRef.current) {
      if (
        (metrics.intensity === 'Severe' && previousIntensityRef.current !== 'Severe') ||
        (metrics.intensity === 'Moderate' && previousIntensityRef.current === 'Mild') ||
        (metrics.intensity === 'Moderate' && previousIntensityRef.current === 'Normal')
      ) {
        audioFeedback.playThresholdCrossed(metrics.intensity);
      }
      previousIntensityRef.current = metrics.intensity;
    }
  }, [metrics.intensity]);

  useEffect(() => {
    try {
      if (window.self !== window.top) {
        setIsIframe(true);
      }
    } catch {
      setIsIframe(true);
    }
  }, []);

  const [hasGyro, setHasGyro] = useState(false);
  const [hasMag, setHasMag] = useState(false);

  const handleData = useCallback(
    (newData: SensorData) => {
      // Ensure 6-DOF IMUs (which omit mx/my/mz or fsr) synthesize 3-axis geomagnetic vector & grip coupling
      const enriched = enrichSensorFrame(newData);
      let finalData = enriched;

      if (isCalibratingRef.current) {
        calibrationBuffer.current.push(enriched);
      }

      // Gate pen and trackpad connections so tremor measurement only runs while actively drawing on the canvas
      const isPenOrTrackpadConnection =
        connectionType === 'ble' ||
        connectionType === 'serial' ||
        connectionType === 'wifi' ||
        connectionType === 'touch' ||
        connectionType === 'ble-touch' ||
        connectionType === 'serial-touch' ||
        connectionType === 'wifi-touch';

      if (isPenOrTrackpadConnection && !isDrawingOnCanvasRef.current && !isPlayingDataset) {
        return;
      }

      const currentOffsets = calibrationOffsets.current;
      finalData = {
        ...finalData,
        ax: finalData.ax - currentOffsets.ax,
        ay: finalData.ay - currentOffsets.ay,
        az: currentOffsets.retainGravity
          ? finalData.az - (currentOffsets.az - 9.80665)
          : finalData.az - currentOffsets.az,
        gx: finalData.gx - currentOffsets.gx,
        gy: finalData.gy - currentOffsets.gy,
        gz: finalData.gz - currentOffsets.gz,
        mx: finalData.mx - currentOffsets.mx,
        my: finalData.my - currentOffsets.my,
        mz: finalData.mz - currentOffsets.mz,
        fsr: Math.max(0, finalData.fsr - currentOffsets.fsr),
      };

      if (connectionType !== 'touch' && latestTouchRef.current) {
        finalData = {
          ...finalData,
          touchX: latestTouchRef.current.x,
          touchY: latestTouchRef.current.y,
        };
      }

      uiBuffer.current.push(finalData);

      // If a previous section was just saved, reset the section buffer on the first sample of the next section
      if (sectionJustSavedRef.current) {
        sectionJustSavedRef.current = false;
        sectionDataBuffer.current = [];
      }

      // Accumulate every single read telemetry sample for the current section (up to 3,000 frames)
      if (sectionDataBuffer.current.length === 0) {
        sectionStartTimeRef.current = Date.now();
      }
      if (sectionDataBuffer.current.length < 3000) {
        sectionDataBuffer.current.push(finalData);
      }

      if (isRecording) {
        recordingBuffer.current.push(finalData);
      }

      if (exportService.isWriting) {
        exportService.writeData(finalData);
      }

      if (
        !hasGyro &&
        (Math.abs(finalData.gx) > 0.01 ||
          Math.abs(finalData.gy) > 0.01 ||
          Math.abs(finalData.gz) > 0.01)
      ) {
        setHasGyro(true);
      }
      if (
        !hasMag &&
        (Math.abs(finalData.mx) > 0.01 ||
          Math.abs(finalData.my) > 0.01 ||
          Math.abs(finalData.mz) > 0.01)
      ) {
        setHasMag(true);
      }
    },
    [hasGyro, hasMag, isRecording, connectionType, isPlayingDataset]
  );

  useEffect(() => {
    serialService.onData((d) => {
      lastHardwarePacketTsRef.current = Date.now();
      handleData(d);
    });
    serialService.onError((err) => {
      console.error('Serial Error:', err);
      setIsConnected(false);
      setConnectionType(null);
    });

    bleService.onData((d) => {
      lastHardwarePacketTsRef.current = Date.now();
      handleData(d);
    });
    bleService.onBattery(setBatteryLevel);
    bleService.onStatus((status) => setBleStatusText(status));
    bleService.onError((err) => {
      console.error('BLE Error:', err);
      setIsConnected(false);
      setConnectionType(null);
      setBatteryLevel(null);
    });
    bleService.onDisconnect(() => {
      setIsConnected(false);
      setConnectionType(null);
      setBatteryLevel(null);
    });

    wifiService.onData((d) => {
      lastHardwarePacketTsRef.current = Date.now();
      handleData(d);
    });
    wifiService.onError((err) => {
      console.error('WiFi Error:', err);
      setIsConnected(false);
      setConnectionType(null);
    });
    wifiService.onDisconnect(() => {
      setIsConnected(false);
      setConnectionType(null);
    });

    mobileSensorService.onData(handleData);
    mobileSensorService.onBattery(setBatteryLevel);
    mobileSensorService.onError((err) => {
      console.error('Mobile Sensor Error:', err);
      setIsConnected(false);
      setConnectionType(null);
    });
  }, [handleData]);

  useEffect(() => {
    return () => {
      serialService.disconnect();
      bleService.disconnect();
      mobileSensorService.stop();
    };
  }, []);

  const connectSerial = async (combined: boolean = false) => {
    try {
      setPermissionError(false);
      await serialService.connect();
      isDrawingOnCanvasRef.current = false;
      setIsDrawingOnCanvas(false);
      uiBuffer.current = [];
      recordingBuffer.current = [];
      setData([]);
      setIsConnected(true);
      setConnectionType(combined ? 'serial-touch' : 'serial');
      setIsSimulating(false);
    } catch (err: any) {
      if (err.name === 'SecurityError' || err.message?.includes('permissions policy')) {
        setPermissionError(true);
      } else if (err.name !== 'NotFoundError') {
        setErrorModal({
          title: 'USB Serial Connection Notice',
          message: `Failed to connect to serial device: ${err.message || String(err)}`,
        });
      }
    }
  };

  const connectBLE = async (combined: boolean = false, scanAll: boolean = false) => {
    try {
      setPermissionError(false);
      setBleStatusText('Connecting to Bluetooth...');
      await bleService.connect({ scanAll });
      isDrawingOnCanvasRef.current = false;
      setIsDrawingOnCanvas(false);
      uiBuffer.current = [];
      recordingBuffer.current = [];
      setData([]);
      setIsConnected(true);
      setConnectionType(combined ? 'ble-touch' : 'ble');
      setIsSimulating(false);
    } catch (err: any) {
      if (err.name === 'SecurityError' || err.message?.includes('permissions policy')) {
        setPermissionError(true);
      } else if (
        err.name === 'NotFoundError' ||
        err.message?.includes('cancelled') ||
        err.message?.includes('canceled')
      ) {
        // User dismissed picker
      } else {
        setErrorModal({
          title: 'Bluetooth Connection Notice',
          message: `Bluetooth connection encountered an issue: ${err.message || String(err)}.`,
        });
      }
    }
  };

  const connectMobile = async () => {
    try {
      setPermissionError(false);
      await mobileSensorService.start();
      setIsConnected(true);
      setConnectionType('mobile');
      setIsSimulating(false);
    } catch (err: any) {
      setErrorModal({
        title: 'Mobile Sensor Notice',
        message: `Failed to access mobile motion sensors: ${err.message || String(err)}`,
      });
    }
  };

  const disconnect = async () => {
    if (connectionType && connectionType.includes('serial')) await serialService.disconnect();
    if (connectionType && connectionType.includes('ble')) await bleService.disconnect();
    if (connectionType && connectionType.includes('wifi')) wifiService.disconnect();
    if (connectionType === 'mobile') mobileSensorService.stop();
    if (isSimulating) {
      if (simulationInterval.current) clearInterval(simulationInterval.current);
      setIsSimulating(false);
    }
    stopDatasetPlayback();
    isDrawingOnCanvasRef.current = false;
    setIsDrawingOnCanvas(false);
    setIsConnected(false);
    setConnectionType(null);
    setBatteryLevel(null);
  };

  const stopDatasetPlayback = useCallback(() => {
    if (playbackInterval.current) {
      clearInterval(playbackInterval.current);
      playbackInterval.current = null;
    }
    setIsPlayingDataset(false);
    setIsPausedDataset(false);
  }, []);

  const pauseDatasetPlayback = () => {
    if (playbackInterval.current) {
      clearInterval(playbackInterval.current);
      playbackInterval.current = null;
    }
    setIsPausedDataset(true);
  };

  const resumeDatasetPlayback = () => {
    if (!loadedDataset) return;
    setIsPausedDataset(false);

    let index = playbackIndex;
    playbackInterval.current = setInterval(() => {
      if (index < loadedDataset.length) {
        handleData(loadedDataset[index]);
        setPlaybackIndex(index);
        index++;
      } else {
        stopDatasetPlayback();
      }
    }, 10);
  };

  const startDatasetPlayback = (dataset: SensorData[]) => {
    if (isSimulating) {
      if (simulationInterval.current) clearInterval(simulationInterval.current);
      setIsSimulating(false);
    }
    stopDatasetPlayback();
    setData([]);
    setPlaybackIndex(0);
    setIsPlayingDataset(true);
    setIsPausedDataset(false);
    setIsConnected(true);
    setConnectionType('sim');

    let index = 0;
    playbackInterval.current = setInterval(() => {
      if (index < dataset.length) {
        handleData(dataset[index]);
        setPlaybackIndex(index);
        index++;
      } else {
        stopDatasetPlayback();
      }
    }, 10);
  };

  const simSampleCountRef = useRef<number>(0);

  const startSimulationWithProfile = useCallback(
    (profile: SimulationProfile) => {
      simProfileRef.current = profile;
      setSimProfile(profile);
      uiBuffer.current = [];

      if (simulationInterval.current) {
        clearInterval(simulationInterval.current);
      }

      setIsSimulating(true);
      setIsConnected(true);
      setConnectionType('sim');

      const baseStartTs = Date.now() - 1600;
      startTimeRef.current = baseStartTs;

      // Seed 80 phase-continuous 50Hz samples (1.6s window) so DFT immediately locks onto 4.8Hz PD or 8.5Hz ET
      const initialSeed: SensorData[] = [];
      for (let i = 0; i < 80; i++) {
        const elapsed = i * 0.02;
        initialSeed.push(generateSimulatedSample(elapsed, profile, baseStartTs + i * 20));
      }
      simSampleCountRef.current = 80;
      sectionDataBuffer.current = [...initialSeed];
      sectionJustSavedRef.current = false;
      setData(initialSeed);
      setSectionData(initialSeed);

      simulationInterval.current = setInterval(() => {
        const idx = simSampleCountRef.current++;
        const elapsedSec = idx * 0.02;
        const sampleTs = startTimeRef.current + idx * 20;
        const sample = generateSimulatedSample(elapsedSec, simProfileRef.current, sampleTs);
        handleData(sample);
      }, 20);
    },
    [handleData]
  );

  const toggleSimulation = () => {
    if (isSimulating) {
      if (simulationInterval.current) clearInterval(simulationInterval.current);
      setIsSimulating(false);
      setIsConnected(false);
      setConnectionType(null);
    } else {
      startSimulationWithProfile(simProfile);
    }
  };

  const handleChangeSimProfile = (newProfile: SimulationProfile) => {
    startSimulationWithProfile(newProfile);
  };

  const clearData = () => {
    setData([]);
    setSectionData([]);
    sectionJustSavedRef.current = false;
    sectionDataBuffer.current = [];
    recordingBuffer.current = [];
    activeDrawingStrokesRef.current = [];
    setReplayStrokes(null);
  };

  const startCalibration = (
    type: 'all' | 'accel' | 'gyro' | 'mag' | 'fsr' = 'all',
    retainGrav: boolean = offsets.retainGravity
  ) => {
    if (isCalibratingRef.current || !isConnected) return;

    isCalibratingRef.current = true;
    setIsCalibrating(true);
    setCalibrationType(type);
    setCalibrationTimeLeft(3);
    calibrationBuffer.current = [];

    let timeLeft = 3;
    calibrationTimer.current = setInterval(() => {
      timeLeft -= 1;
      setCalibrationTimeLeft(timeLeft);

      if (timeLeft <= 0) {
        if (calibrationTimer.current) clearInterval(calibrationTimer.current);
        isCalibratingRef.current = false;
        setIsCalibrating(false);

        if (calibrationBuffer.current.length > 0) {
          const count = calibrationBuffer.current.length;
          const sum = calibrationBuffer.current.reduce(
            (acc, val) => {
              acc.ax += val.ax;
              acc.ay += val.ay;
              acc.az += val.az;
              acc.gx += val.gx;
              acc.gy += val.gy;
              acc.gz += val.gz;
              acc.mx += val.mx;
              acc.my += val.my;
              acc.mz += val.mz;
              acc.fsr += val.fsr;
              return acc;
            },
            { ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0, mx: 0, my: 0, mz: 0, fsr: 0 }
          );

          const mean = {
            ax: sum.ax / count,
            ay: sum.ay / count,
            az: sum.az / count,
            gx: sum.gx / count,
            gy: sum.gy / count,
            gz: sum.gz / count,
            mx: sum.mx / count,
            my: sum.my / count,
            mz: sum.mz / count,
            fsr: sum.fsr / count,
          };

          setOffsets((prev) => {
            let nextOffsets: CalibrationOffsets = { ...prev, retainGravity: retainGrav };
            // Retain local geomagnetic reference vector (28.5, -12.4, 36.2 µT) so magnetometer doesn't flatline at 0.00 µT after calibration
            const magOffsetX = retainGrav ? mean.mx - 28.5 : mean.mx;
            const magOffsetY = retainGrav ? mean.my - -12.4 : mean.my;
            const magOffsetZ = retainGrav ? mean.mz - 36.2 : mean.mz;

            if (type === 'all') {
              nextOffsets = {
                ax: mean.ax,
                ay: mean.ay,
                az: mean.az,
                gx: mean.gx,
                gy: mean.gy,
                gz: mean.gz,
                mx: magOffsetX,
                my: magOffsetY,
                mz: magOffsetZ,
                // Do not zero out active holding grip force during 'all' baseline calibration
                fsr: 0,
                retainGravity: retainGrav,
              };
            } else if (type === 'accel') {
              nextOffsets.ax = mean.ax;
              nextOffsets.ay = mean.ay;
              nextOffsets.az = mean.az;
              nextOffsets.retainGravity = retainGrav;
            } else if (type === 'gyro') {
              nextOffsets.gx = mean.gx;
              nextOffsets.gy = mean.gy;
              nextOffsets.gz = mean.gz;
            } else if (type === 'mag') {
              nextOffsets.mx = magOffsetX;
              nextOffsets.my = magOffsetY;
              nextOffsets.mz = magOffsetZ;
            } else if (type === 'fsr') {
              nextOffsets.fsr = Math.min(mean.fsr, 150);
            }
            calibrationOffsets.current = nextOffsets;
            return nextOffsets;
          });
        }
      }
    }, 1000);
  };

  const resetSensorCalibration = (type: 'all' | 'accel' | 'gyro' | 'mag' | 'fsr') => {
    setOffsets((prev) => {
      let nextOffsets: CalibrationOffsets = { ...prev };
      if (type === 'all') {
        nextOffsets = { ...DEFAULT_OFFSETS };
      } else if (type === 'accel') {
        nextOffsets.ax = 0;
        nextOffsets.ay = 0;
        nextOffsets.az = 0;
      } else if (type === 'gyro') {
        nextOffsets.gx = 0;
        nextOffsets.gy = 0;
        nextOffsets.gz = 0;
      } else if (type === 'mag') {
        nextOffsets.mx = 0;
        nextOffsets.my = 0;
        nextOffsets.mz = 0;
      } else if (type === 'fsr') {
        nextOffsets.fsr = 0;
      }
      calibrationOffsets.current = nextOffsets;
      try {
        localStorage.removeItem('neurotremor_calibration_offsets');
      } catch {}
      return nextOffsets;
    });
  };

  const handleSaveOffsets = (newOffsets: CalibrationOffsets) => {
    setOffsets(newOffsets);
    calibrationOffsets.current = newOffsets;
  };

  const exportSession = (targetSession?: Session) => {
    if (targetSession) {
      const blob = new Blob([JSON.stringify(targetSession, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `neurotremor-section-${targetSession.id.slice(0, 8)}-${new Date(
        targetSession.timestamp
      ).toISOString()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const rawFrames =
      sectionDataBuffer.current.length > 0 ? sectionDataBuffer.current : data;
    if (rawFrames.length === 0) return;
    const deviceType = connectionType === 'mobile' ? 'mobile' : 'pen';
    const fullExport = {
      exportedAt: new Date().toISOString(),
      connectionType,
      sensitivity,
      sensitivityMultiplier,
      calibrationOffsets: offsets,
      canvasMode: activeCanvasMetaRef.current.mode,
      drawingStrokes: activeDrawingStrokesRef.current,
      analysis: analyzeTremorDifferential(rawFrames, deviceType, sensitivityMultiplier),
      sensorStats: computeSensorChannelStats(rawFrames),
      rawSampleCount: rawFrames.length,
      data: rawFrames,
    };
    const blob = new Blob([JSON.stringify(fullExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tremor-section-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSignInAsGuest = async () => {
    try {
      await signInAsGuest();
    } catch (error: any) {
      setErrorModal({
        title: 'Guest Cloud Mode',
        message: `Could not activate guest session: ${error.message || String(error)}.`,
      });
    }
  };

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        return;
      }
      setErrorModal({
        title: 'Sign In Notice',
        message: `Authentication prompt could not be completed (${error.message || 'Popup blocked'}).\n\nYou can continue immediately with Guest Cloud Mode to sync and store all patient data in Firebase Firestore.`,
        actionLabel: 'Continue as Guest (Cloud Sync)',
        onAction: async () => {
          setErrorModal(null);
          await handleSignInAsGuest();
        },
      });
    }
  };

  const handleStopAndSaveRecording = async () => {
    audioFeedback.playStopRecording();
    setIsRecording(false);

    // Prefer manual recordingBuffer if active, otherwise use the complete uncapped sectionDataBuffer or sectionData
    const rawFrames =
      recordingBuffer.current.length >= 12
        ? [...recordingBuffer.current]
        : sectionDataBuffer.current.length >= 12
        ? [...sectionDataBuffer.current]
        : sectionData.length >= 12
        ? [...sectionData]
        : [...data];

    recordingBuffer.current = [];
    sectionDataBuffer.current = [];
    sectionJustSavedRef.current = true;
    setSectionData(rawFrames);

    if (rawFrames.length === 0) return;

    const firstTs = rawFrames[0]?.timestamp || sectionStartTimeRef.current || Date.now();
    const lastTs = rawFrames[rawFrames.length - 1]?.timestamp || Date.now();
    const duration = Math.max(
      0.5,
      recordingStartTime.current > 0
        ? (Date.now() - recordingStartTime.current) / 1000
        : (lastTs - firstTs) / 1000
    );
    recordingStartTime.current = 0;

    const sessionId = crypto.randomUUID();
    const deviceType = connectionType === 'mobile' ? 'mobile' : 'pen';

    // Verify & preserve high-density telemetry frames (up to 1,500 points)
    const verifiedRes = await verifyAndCompressSession({
      sessionId,
      data: rawFrames,
      deviceType,
      sensitivityMultiplier,
      maxStoragePoints: 1500,
    });

    setLatestIntegrityHash(verifiedRes.integrityHash);
    const diffAnalysis = verifiedRes.analysis;
    const datasetSummary = computeDatasetSectionSummary(
      rawFrames,
      deviceType,
      sensitivityMultiplier
    );
    const sensorStats = computeSensorChannelStats(rawFrames);

    // Capture all drawn strokes; if touchX/touchY exist in frames without explicit strokes, synthesize a stroke
    let savedStrokes: DrawingStroke[] = [...activeDrawingStrokesRef.current];
    if (savedStrokes.length === 0) {
      const touchPts = rawFrames
        .filter((f) => typeof f.touchX === 'number' && typeof f.touchY === 'number')
        .map((f) => ({
          x: Number((f.touchX || 0).toFixed(1)),
          y: Number((f.touchY || 0).toFixed(1)),
          pressure: Math.round(f.fsr || 2048),
          t: f.timestamp,
        }));
      if (touchPts.length > 1) {
        savedStrokes = [
          {
            mode: activeCanvasMetaRef.current.mode,
            canvasWidth: activeCanvasMetaRef.current.width,
            canvasHeight: activeCanvasMetaRef.current.height,
            points: touchPts,
          },
        ];
      }
    }
    activeDrawingStrokesRef.current = [];

    // Compute sequential section-over-section recovery rate against the immediately previous recorded section
    const prevRecorded = recordedSessions.length > 0 ? recordedSessions[0] : null;
    const nextSectionNum = recordedSessions.length + 1;
    const sectionComparisonLabel =
      prevRecorded && recordedSessions.length >= 1
        ? `S-${nextSectionNum} vs. S-${nextSectionNum - 1}`
        : 'S-1 Baseline Saved';
    const previousSectionRms = prevRecorded ? prevRecorded.rms : undefined;
    const sequentialRecoveryRate =
      prevRecorded && prevRecorded.rms >= 0.05
        ? Number(
            Math.max(
              -100,
              Math.min(100, ((prevRecorded.rms - diffAnalysis.rms) / prevRecorded.rms) * 100)
            ).toFixed(1)
          )
        : 0;

    const newSession: Session = {
      id: sessionId,
      userId: user ? user.uid : 'guest',
      timestamp: Date.now(),
      duration: Number(duration.toFixed(2)),
      severity: diffAnalysis.severityLabel,
      stage: diffAnalysis.clinicalStage,
      rms: diffAnalysis.rms,
      frequency: diffAnalysis.dominantFreq,
      phenotype: diffAnalysis.phenotype,
      pdProbability: diffAnalysis.pdProbability,
      etProbability: diffAnalysis.etProbability,
      pillRollingIndex: diffAnalysis.pillRollingIndex,
      avgForce: diffAnalysis.avgForce,
      integrityHash: verifiedRes.integrityHash,
      data: verifiedRes.compressedData,
      rawSampleCount: rawFrames.length,
      drawingStrokes: savedStrokes,
      canvasMode: activeCanvasMetaRef.current.mode,
      canvasWidth: activeCanvasMetaRef.current.width,
      canvasHeight: activeCanvasMetaRef.current.height,
      analysis: diffAnalysis,
      datasetSummary,
      sensorStats,
      recoveryRate: sequentialRecoveryRate,
      previousSectionRms,
      sectionComparisonLabel,
      connectionType,
      sensitivity,
      sensitivityMultiplier,
      calibrationOffsets: { ...offsets },
    };

    if (!user) {
      setRecordedSessions((prev) => [newSession, ...prev]);
      try {
        const existing = JSON.parse(localStorage.getItem('neurotremor_guest_sessions') || '[]');
        localStorage.setItem(
          'neurotremor_guest_sessions',
          JSON.stringify([newSession, ...existing])
        );
      } catch {}
      mlService.trainOnSession(newSession.data, newSession.severity);
      return;
    }

    setRecordedSessions((prev) => [newSession, ...prev]);
    try {
      const cached = JSON.parse(
        localStorage.getItem(`neurotremor_cached_sessions_${user.uid}`) || '[]'
      );
      localStorage.setItem(
        `neurotremor_cached_sessions_${user.uid}`,
        JSON.stringify([newSession, ...cached])
      );
    } catch {}

    // Persist complete section archive to Firestore conforming strictly to hardened security rules
    const firestoreDocPayload = {
      id: newSession.id,
      userId: newSession.userId,
      timestamp: newSession.timestamp,
      duration: newSession.duration,
      severity: newSession.severity,
      stage: newSession.stage,
      rms: newSession.rms,
      frequency: newSession.frequency,
      phenotype: newSession.phenotype || 'Resting Baseline',
      pdProbability: newSession.pdProbability ?? 0,
      etProbability: newSession.etProbability ?? 0,
      pillRollingIndex: newSession.pillRollingIndex ?? 0,
      avgForce: newSession.avgForce ?? 0,
      integrityHash: newSession.integrityHash || '',
      data: serializeSessionPayload(newSession),
    };

    setDoc(doc(db, 'sessions', sessionId), firestoreDocPayload)
      .then(() => {
        mlService.trainOnSession(newSession.data, newSession.severity);
      })
      .catch((error) => {
        handleFirestoreError(error, OperationType.CREATE, `sessions/${sessionId}`);
      });
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#090d16] text-slate-900 dark:text-slate-100 font-sans selection:bg-sky-500/20 transition-colors">
      {/* Error Modal */}
      {errorModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-red-300 dark:border-red-900/50 rounded-lg max-w-md w-full p-5 shadow-xl">
            <div className="flex items-center space-x-2.5 mb-3 text-red-600 dark:text-red-400">
              <AlertCircle size={22} />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {errorModal.title}
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-5 leading-relaxed whitespace-pre-line">
              {errorModal.message}
            </p>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setErrorModal(null)}
                className="px-3.5 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-xs font-medium transition-colors"
              >
                {t('dismiss')}
              </button>
              {errorModal.actionLabel && errorModal.onAction && (
                <button
                  onClick={() => errorModal.onAction!()}
                  className="px-3.5 py-1.5 rounded-md bg-sky-700 hover:bg-sky-800 text-white text-xs font-medium transition-colors flex items-center gap-1.5"
                >
                  <Zap size={13} />
                  <span>{errorModal.actionLabel}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-900/50 rounded-lg max-w-md w-full p-5 shadow-xl">
            <div className="flex items-center space-x-2.5 mb-3 text-amber-600 dark:text-amber-400">
              <AlertCircle size={22} />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {confirmModal.title}
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-5 leading-relaxed">
              {confirmModal.message}
            </p>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setConfirmModal(null)}
                className="px-3.5 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-xs font-medium transition-colors border border-slate-200 dark:border-slate-700"
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
                className="px-3.5 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-medium transition-colors"
              >
                {t('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pen/Touch Input Selection Modal */}
      {showPenModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg max-w-md w-full p-5 shadow-xl">
            <div className="flex items-center space-x-2.5 mb-2 text-sky-700 dark:text-sky-400">
              <FileText size={22} />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t('connectPenOrTouchPad')}
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
              {t('chooseInputMethod')}
            </p>
            <div className="flex flex-col space-y-2">
              <button
                onClick={() => {
                  setShowPenModal(false);
                  isDrawingOnCanvasRef.current = false;
                  setIsDrawingOnCanvas(false);
                  uiBuffer.current = [];
                  recordingBuffer.current = [];
                  setData([]);
                  setIsConnected(true);
                  setConnectionType('touch');
                  setIsSimulating(false);
                }}
                className="w-full flex items-center space-x-3 px-3 py-2.5 rounded-md bg-white hover:bg-slate-50 text-slate-800 dark:bg-slate-800/80 dark:hover:bg-slate-800 dark:text-white text-xs font-medium transition-colors border border-slate-200 dark:border-slate-700"
              >
                <div className="bg-slate-100 dark:bg-slate-700 p-1.5 rounded-md text-slate-600 dark:text-slate-300">
                  <FileText size={16} />
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {t('useDeviceTouchPad')}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">
                    {t('drawDirectlyMouse')}
                  </div>
                </div>
              </button>

              <button
                onClick={() => {
                  setShowPenModal(false);
                  connectBLE();
                }}
                className="w-full flex items-center space-x-3 px-3 py-2.5 rounded-md bg-white hover:bg-slate-50 text-slate-800 dark:bg-slate-800/80 dark:hover:bg-slate-800 dark:text-white text-xs font-medium transition-colors border border-slate-200 dark:border-slate-700"
              >
                <div className="bg-sky-50 dark:bg-sky-950/50 p-1.5 rounded-md text-sky-700 dark:text-sky-400">
                  <Bluetooth size={16} />
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {t('connectCustomEsp32')}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">
                    {t('connectViaBle')}
                  </div>
                </div>
              </button>

              <button
                onClick={() => {
                  setShowPenModal(false);
                  connectBLE(true);
                }}
                className="w-full flex items-center space-x-3 px-3 py-2.5 rounded-md bg-white hover:bg-slate-50 text-slate-800 dark:bg-slate-800/80 dark:hover:bg-slate-800 dark:text-white text-xs font-medium transition-colors border border-slate-200 dark:border-slate-700"
              >
                <div className="bg-sky-50 dark:bg-sky-950/50 p-1.5 rounded-md text-sky-700 dark:text-sky-400">
                  <div className="flex items-center space-x-1">
                    <Bluetooth size={14} />
                    <FileText size={14} />
                  </div>
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {t('combinedModeBle')}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">
                    {t('useBleEsp32TouchPad')}
                  </div>
                </div>
              </button>

              <button
                onClick={() => {
                  setShowPenModal(false);
                  connectSerial(true);
                }}
                className="w-full flex items-center space-x-3 px-3 py-2.5 rounded-md bg-white hover:bg-slate-50 text-slate-800 dark:bg-slate-800/80 dark:hover:bg-slate-800 dark:text-white text-xs font-medium transition-colors border border-slate-200 dark:border-slate-700"
              >
                <div className="bg-sky-50 dark:bg-sky-950/50 p-1.5 rounded-md text-sky-700 dark:text-sky-400">
                  <div className="flex items-center space-x-1">
                    <Cable size={14} />
                    <FileText size={14} />
                  </div>
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {t('combinedModeUsb')}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">
                    {t('useUsbEsp32TouchPad')}
                  </div>
                </div>
              </button>

              <button
                onClick={() => setShowPenModal(false)}
                className="w-full mt-2 px-3 py-1.5 rounded-md bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs font-medium transition-colors"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Iframe Warning Banner */}
      {isIframe && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/50 px-4 py-1.5 text-center">
          <p className="text-xs text-amber-900 dark:text-amber-300 flex items-center justify-center gap-1.5">
            <AlertCircle size={13} />
            <span>{t('hardwareAccessRestricted')}</span>
            <a
              href={window.location.href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium hover:text-black dark:hover:text-white flex items-center gap-1"
            >
              {t('openInNewTab')} <ExternalLink size={11} />
            </a>
          </p>
        </div>
      )}

      {/* Permission Error Modal */}
      {permissionError && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-red-300 dark:border-red-900/50 rounded-lg max-w-md w-full p-5 shadow-xl">
            <div className="flex items-center space-x-2.5 mb-3 text-red-600 dark:text-red-400">
              <AlertCircle size={22} />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t('connectionBlocked')}
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
              {t('browserBlockedAccess')}
            </p>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setPermissionError(false)}
                className="px-3.5 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-xs font-medium transition-colors"
              >
                {t('dismiss')}
              </button>
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-md bg-sky-700 hover:bg-sky-800 text-white text-xs font-medium transition-colors"
              >
                <span>{t('openInNewTab')}</span>
                <ExternalLink size={13} />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Clinical Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md sticky top-0 z-40 transition-colors">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          {/* Left Zone: Settings + Brand Wordmark */}
          <div className="flex items-center gap-3 shrink-0">
            <SettingsMenu
              user={user}
              onSignIn={handleSignIn}
              onSignInAsGuest={handleSignInAsGuest}
              onSignOut={logOut}
              onOpenSecurityModal={(tab) => setSecurityModalTab(tab || 'medical')}
              isHighContrast={isHighContrast}
              onToggleHighContrast={() => setIsHighContrast(!isHighContrast)}
              onOpenCalibration={() => setShowCalibrationModal(true)}
              isCalibrating={isCalibrating}
              hasOffsets={offsets.ax !== 0 || offsets.gx !== 0 || offsets.mx !== 0}
              firebaseStatus={firebaseStatus}
              onTestFirebase={runConnectivityCheck}
              sensitivity={sensitivity}
              sensitivityMultiplier={sensitivityMultiplier}
              onChangeSensitivity={handleSensitivityChange}
              onChangeSensitivityMultiplier={handleSensitivityMultiplierChange}
            />
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-sky-700 rounded-md flex items-center justify-center text-white shrink-0">
                <Activity size={16} />
              </div>
              <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
                NeuroTremor
              </span>
            </div>
          </div>

          {/* Center / Right Telemetry & Hardware Controls */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Live Stream State Text Indicator */}
            <div className="hidden md:flex items-center gap-2 text-xs font-mono text-slate-600 dark:text-slate-400 mr-2">
              <span
                className={
                  isConnected
                    ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }
              >
                {isConnected
                  ? `● ${
                      isPlayingDataset
                        ? t('playingDataset')
                        : isSimulating
                        ? `SIMULATING (${simProfile === 'pd_resting' ? 'PD 4.8Hz' : simProfile === 'et_postural' ? 'ET 8.5Hz' : 'BASELINE'})`
                        : connectionType === 'touch'
                        ? t('touchPadMode')
                        : connectionType === 'ble'
                        ? (bleService.getDeviceName() || 'BLE PEN').toUpperCase()
                        : connectionType === 'mobile'
                        ? t('mobileSensors')
                        : t('usbConnected')
                    }`
                  : `○ ${t('disconnected')}`}
              </span>
              <span aria-hidden="true">·</span>
              {firebaseStatus.connected ? (
                <span
                  className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"
                  title={`Firestore Connected (${firebaseStatus.latencyMs ?? 0}ms)`}
                >
                  <Cloud size={13} />
                  <span>Cloud Sync</span>
                </span>
              ) : (
                <button
                  onClick={runConnectivityCheck}
                  className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 hover:underline"
                  title="Click to re-check Firestore connection"
                >
                  <CloudOff size={13} />
                  <span>{firebaseStatus.checking ? 'Syncing...' : 'Local Cache'}</span>
                </button>
              )}
            </div>

            {batteryLevel !== null &&
              isConnected &&
              (connectionType === 'ble' ||
                connectionType === 'mobile' ||
                connectionType === 'ble-touch') && (
                <div
                  className="flex items-center gap-1 text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300 px-2 py-1"
                  title="Device Battery Level"
                >
                  <Battery
                    size={14}
                    className={
                      batteryLevel > 20
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }
                  />
                  <span>{batteryLevel}%</span>
                </div>
              )}

            {!isConnected ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <DatasetUploader
                  onDataLoaded={(dataset) => {
                    setLoadedDataset(dataset);
                    startDatasetPlayback(dataset);
                  }}
                  onError={(msg) => setErrorModal({ title: 'Dataset Error', message: msg })}
                />
                <button
                  onClick={() => connectSerial(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 rounded-md transition-colors text-xs font-medium whitespace-nowrap shrink-0"
                  title="Connect via USB Cable"
                >
                  <Cable size={14} />
                  <span className="hidden sm:inline">{t('usb')}</span>
                </button>
                <button
                  onClick={() => connectBLE(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-700 hover:bg-sky-800 text-white rounded-md transition-colors text-xs font-medium whitespace-nowrap shrink-0"
                  title="Connect via Bluetooth Low Energy (BLE)"
                >
                  <Bluetooth size={14} />
                  <span className="hidden sm:inline">Bluetooth</span>
                </button>
                <button
                  onClick={connectMobile}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700 rounded-md transition-colors text-xs font-medium whitespace-nowrap shrink-0"
                  title="Use Mobile Sensors"
                >
                  <Smartphone size={14} />
                  <span className="hidden sm:inline">{t('mobile')}</span>
                </button>
                <button
                  onClick={() => setShowPenModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700 rounded-md transition-colors text-xs font-medium whitespace-nowrap shrink-0"
                  title="Connect Pen or Touch Pad"
                >
                  <FileText size={14} />
                  <span className="hidden sm:inline">{t('penTouch')}</span>
                </button>
                <button
                  onClick={toggleSimulation}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-50 text-sky-800 border border-sky-200 hover:bg-sky-100 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800 rounded-md transition-colors text-xs font-semibold whitespace-nowrap shrink-0"
                  title="Run Clinical Tremor Simulation"
                >
                  <Play size={14} />
                  <span>{t('demo')}</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                {!isPlayingDataset && (
                  <button
                    onClick={() => setShowCalibrationModal(true)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-md transition-colors text-xs font-medium whitespace-nowrap shrink-0 ${
                      isCalibrating
                        ? 'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300'
                        : offsets.ax !== 0 || offsets.gx !== 0 || offsets.mx !== 0
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <Target size={14} className={isCalibrating ? 'animate-spin' : ''} />
                    <span>
                      {isCalibrating
                        ? `${t('calibrating')} (${calibrationTimeLeft}s)`
                        : t('calibrate')}
                    </span>
                  </button>
                )}
                <button
                  onClick={disconnect}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-md hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50 transition-colors text-xs font-medium whitespace-nowrap shrink-0"
                >
                  <Square size={14} />
                  <span>
                    {isPlayingDataset
                      ? t('stopPlayback')
                      : isSimulating
                      ? t('stopDemo')
                      : t('disconnect')}
                  </span>
                </button>
              </div>
            )}

            <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block mx-0.5" />

            <LanguageSelector />

            <button
              onClick={() => setIsHighContrast(!isHighContrast)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white text-slate-700 border border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-xs font-medium whitespace-nowrap shrink-0"
              title={isHighContrast ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            >
              {isHighContrast ? <Moon size={14} /> : <Sun size={14} />}
              <span className="hidden md:inline">{isHighContrast ? t('dark') : t('light')}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Clinical Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {isPlayingDataset && loadedDataset && (
          <div className="mb-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-xs font-semibold text-sky-800 dark:text-sky-400 font-mono">
                  {t('datasetPlaybackProgress')}
                </span>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                  {playbackIndex + 1} / {loadedDataset.length} {t('points')}
                </div>
              </div>
              <div className="flex space-x-1.5">
                {isPausedDataset ? (
                  <button
                    onClick={resumeDatasetPlayback}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-sky-700 hover:bg-sky-800 text-white rounded-md transition-colors text-xs font-medium"
                  >
                    <Play size={13} />
                    <span>{t('resume')}</span>
                  </button>
                ) : (
                  <button
                    onClick={pauseDatasetPlayback}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-white text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-50 transition-colors text-xs font-medium"
                  >
                    <Pause size={13} />
                    <span>{t('pause')}</span>
                  </button>
                )}
                <button
                  onClick={stopDatasetPlayback}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50 rounded-md hover:bg-red-100 transition-colors text-xs font-medium"
                >
                  <Square size={13} />
                  <span>{t('stop')}</span>
                </button>
              </div>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-sky-600 h-full transition-all duration-150"
                style={{ width: `${((playbackIndex + 1) / loadedDataset.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {isPausedDataset && (
          <DatasetSummary
            data={
              loadedDataset
                ? loadedDataset.slice(0, Math.max(12, playbackIndex + 1))
                : sectionData.length > 0
                ? sectionData
                : data
            }
            title={t('analysisUntilPause')}
            onPlay={resumeDatasetPlayback}
            onClear={() => {
              setLoadedDataset(null);
              stopDatasetPlayback();
            }}
            onRequestReport={(sess) => setReportModalSession(sess)}
            isDark={!isHighContrast}
            sensitivityMultiplier={sensitivityMultiplier}
          />
        )}

        {loadedDataset && !isPlayingDataset && (
          <DatasetSummary
            data={loadedDataset}
            onPlay={() => startDatasetPlayback(loadedDataset)}
            onClear={() => setLoadedDataset(null)}
            onRequestReport={(sess) => setReportModalSession(sess)}
            isDark={!isHighContrast}
            sensitivityMultiplier={sensitivityMultiplier}
          />
        )}

        {!loadedDataset && !isPlayingDataset && sectionData.length >= 12 && (
          <DatasetSummary
            data={sectionData}
            title={`${t('datasetAnalysisSummary')} (Total Section Average)`}
            onPlay={() => startDatasetPlayback(sectionData)}
            onClear={clearData}
            onRequestReport={(sess) => setReportModalSession(sess)}
            isDark={!isHighContrast}
            sensitivityMultiplier={sensitivityMultiplier}
          />
        )}

        {isConnected && connectionType !== 'sim' && (
          <div className="mb-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-xs font-semibold text-sky-800 dark:text-sky-400 font-mono">
                  {isDrawingOnCanvas
                    ? `● ${t('realtimeAnalysisLive')} (Active Canvas Stroke · ${sectionData.length || data.length} pts)`
                    : sectionData.length > 0
                    ? `○ Section Averaged · ${sectionData.length} Total Section Samples`
                    : '○ Pen Connected · Standby (Start Drawing on Spiral or Free-Draw Canvas Below)'}
                </span>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isDrawingOnCanvas
                    ? `${t('collectingDataFrom')} ${
                        connectionType?.includes('touch')
                          ? t('touchPadAndPen')
                          : connectionType === 'mobile'
                          ? t('mobile')
                          : t('device')
                      }`
                    : 'Tremor measurement starts only when you draw on the trackpad spiral or free-draw canvas.'}
                </div>
              </div>
              {(sectionData.length > 0 || data.length > 0) && (
                <div className="flex space-x-1.5">
                  {isPausedRealTime ? (
                    <button
                      onClick={() => setIsPausedRealTime(false)}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-sky-700 hover:bg-sky-800 text-white rounded-md transition-colors text-xs font-medium"
                    >
                      <Play size={13} />
                      <span>{t('resume')}</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => setIsPausedRealTime(true)}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-white text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-50 transition-colors text-xs font-medium"
                    >
                      <Pause size={13} />
                      <span>{t('pause')}</span>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setIsPausedRealTime(false);
                      const fullSection =
                        sectionDataBuffer.current.length > 0
                          ? [...sectionDataBuffer.current]
                          : sectionData.length > 0
                          ? [...sectionData]
                          : [...data];
                      setLoadedDataset(fullSection);
                      disconnect();
                    }}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50 rounded-md hover:bg-red-100 transition-colors text-xs font-medium"
                  >
                    <Square size={13} />
                    <span>{t('stopAnalysis')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {isConnected && (
          <TouchPadCanvas
            onData={handleData}
            mode={connectionType === 'touch' ? 'touch' : 'combined'}
            onDrawingStateChange={(drawing) => {
              isDrawingOnCanvasRef.current = drawing;
              setIsDrawingOnCanvas(drawing);
              if (!drawing && sectionDataBuffer.current.length > 0) {
                setSectionData([...sectionDataBuffer.current]);
              }
            }}
            onStrokesChange={(strokes, canvasMode, canvasWidth, canvasHeight) => {
              activeDrawingStrokesRef.current = strokes;
              activeCanvasMetaRef.current = {
                mode: canvasMode,
                width: canvasWidth,
                height: canvasHeight,
              };
            }}
            replayStrokes={replayStrokes}
            onClearData={clearData}
            onSaveDrawingSession={handleStopAndSaveRecording}
            isRecording={isRecording}
            onToggleRecording={() => {
              if (isRecording) {
                handleStopAndSaveRecording();
              } else {
                audioFeedback.playStartRecording();
                setIsRecording(true);
                recordingBuffer.current = [];
                recordingStartTime.current = Date.now();
              }
            }}
            sampleCount={sectionData.length || sectionDataBuffer.current.length || data.length}
            onTouchUpdate={(x, y, _pressure, syntheticFrame) => {
              latestTouchRef.current = { x, y };
              if (
                connectionType !== 'touch' &&
                syntheticFrame &&
                Date.now() - lastHardwarePacketTsRef.current > 180
              ) {
                handleData(syntheticFrame);
              }
            }}
          />
        )}

        {/* Primary 4-Column Kinematic KPI Strip */}
        <TremorAnalysis metrics={metrics} />

        {/* Differential Tremor & Grip Pressure Diagnostic Panel */}
        <DifferentialDiagnosisPanel
          differential={differential}
          isSimulating={isSimulating}
          simProfile={simProfile}
          onChangeSimProfile={handleChangeSimProfile}
          isDark={!isHighContrast}
          latestIntegrityHash={latestIntegrityHash}
        />

        {/* Recorded-Section Recovery Rate & Longitudinal Graph */}
        <div className="mb-6">
          <RecoveryTrendChart
            sessions={recordedSessions}
            recoverySummary={metrics.recoverySummary}
            isDark={!isHighContrast}
            isConnected={isConnected}
            canSaveSection={
              sectionData.length >= 12 ||
              data.length >= 12 ||
              recordingBuffer.current.length >= 12
            }
            onCaptureSnapshot={handleStopAndSaveRecording}
          />
        </div>

        {/* Sensor Graph Selector & Sensitivity Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 mb-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-lg">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mr-2">
              {t('sensors')}
            </span>
            {[
              { id: 'all', label: t('allSensors') },
              { id: 'accel', label: t('accelerometer') },
              { id: 'gyro', label: t('gyroscope') },
              { id: 'mag', label: t('magnetometer') },
              { id: 'fsr', label: t('gripPressure') },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedSensorTab(tab.id as any)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  selectedSensorTab === tab.id
                    ? 'bg-slate-900 text-white dark:bg-slate-700 dark:text-slate-100 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/80 p-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs">
              <span className="text-xs text-slate-500 dark:text-slate-400 px-1.5">
                Sensitivity:
              </span>
              <div className="flex items-center gap-1">
                {(['low', 'normal', 'high'] as const).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => handleSensitivityChange(lvl)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      sensitivity === lvl
                        ? 'bg-sky-700 text-white font-semibold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {lvl === 'low' ? 'Low (Writing)' : lvl === 'normal' ? 'Normal' : 'High'}
                  </button>
                ))}
              </div>
              <div className="h-3 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />
              <div className="hidden sm:flex items-center gap-1.5 px-1">
                <input
                  type="range"
                  min="0.5"
                  max="3.0"
                  step="0.05"
                  aria-label="Sensitivity Threshold Multiplier"
                  value={sensitivityMultiplier}
                  onChange={(e) => handleSensitivityMultiplierChange(parseFloat(e.target.value))}
                  className="w-16 h-1 accent-sky-700 dark:accent-sky-500 cursor-pointer rounded bg-slate-200 dark:bg-slate-700"
                />
                <span className="text-xs font-mono tabular-nums font-medium text-slate-700 dark:text-slate-300">
                  {sensitivityMultiplier.toFixed(2)}x
                </span>
              </div>
            </div>

            <button
              onClick={() => setShowCalibrationModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Target size={13} className={isCalibrating ? 'animate-spin' : ''} />
              <span>
                {isCalibrating
                  ? `${t('calibrating')} (${calibrationTimeLeft}s)`
                  : t('calibrateSensors')}
              </span>
            </button>
          </div>
        </div>

        {/* Sensor Charts Grid */}
        <div
          className={`grid gap-6 mb-8 ${
            selectedSensorTab === 'all' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
          }`}
        >
          {(selectedSensorTab === 'all' || selectedSensorTab === 'accel') && (
            <LiveChart
              title={t('accelerometer')}
              data={data}
              isDark={!isHighContrast}
              dataKeys={[
                { key: 'ax', color: '#ef4444', name: t('xAxis') },
                { key: 'ay', color: '#16a34a', name: t('yAxis') },
                { key: 'az', color: '#2563eb', name: t('zAxis') },
              ]}
              unit="m/s²"
              calibratedDomain={[-16, 16]}
              scalePresets={[
                { label: '±16 m/s²', domain: [-16, 16] },
                { label: 'Auto Fit', domain: ['auto', 'auto'] },
                { label: '±25 m/s²', domain: [-25, 25] },
              ]}
              onQuickCalibrate={() => startCalibration('accel')}
              onResetCalibration={() => resetSensorCalibration('accel')}
              calibrateLabel={t('calibrateAccelerometer')}
              isCalibrated={offsets.ax !== 0 || offsets.ay !== 0 || offsets.az !== 0}
            />
          )}
          {(selectedSensorTab === 'all' || selectedSensorTab === 'gyro') && (
            <LiveChart
              title={t('gyroscope')}
              data={data}
              isDark={!isHighContrast}
              dataKeys={[
                { key: 'gx', color: '#ea580c', name: t('xRotation') },
                { key: 'gy', color: '#9333ea', name: t('yRotation') },
                { key: 'gz', color: '#0891b2', name: t('zRotation') },
              ]}
              unit="°/s"
              scalePresets={[
                { label: 'Auto Fit', domain: ['auto', 'auto'] },
                { label: '±100 °/s', domain: [-100, 100] },
                { label: '±250 °/s', domain: [-250, 250] },
              ]}
              onQuickCalibrate={() => startCalibration('gyro')}
              onResetCalibration={() => resetSensorCalibration('gyro')}
              calibrateLabel={t('zeroGyroDrift')}
              isCalibrated={offsets.gx !== 0 || offsets.gy !== 0 || offsets.gz !== 0}
            />
          )}
          {(selectedSensorTab === 'all' || selectedSensorTab === 'mag') && (
            <LiveChart
              title={t('magnetometer')}
              data={data}
              isDark={!isHighContrast}
              dataKeys={[
                { key: 'mx', color: '#db2777', name: t('xMag') },
                { key: 'my', color: '#7c3aed', name: t('yMag') },
                { key: 'mz', color: '#2563eb', name: t('zMag') },
              ]}
              unit="µT"
              scalePresets={[
                { label: 'Auto Fit', domain: ['auto', 'auto'] },
                { label: '±80 µT', domain: [-80, 80] },
                { label: '±150 µT', domain: [-150, 150] },
              ]}
              onQuickCalibrate={() => startCalibration('mag')}
              onResetCalibration={() => resetSensorCalibration('mag')}
              calibrateLabel={t('calibrateMagnetometer')}
              isCalibrated={offsets.mx !== 0 || offsets.my !== 0 || offsets.mz !== 0}
            />
          )}
          {(selectedSensorTab === 'all' || selectedSensorTab === 'fsr') && (
            <LiveChart
              title={`${t('gripPressure')} (FSR)`}
              data={data}
              isDark={!isHighContrast}
              dataKeys={[{ key: 'fsr', color: '#d97706', name: t('pressure') }]}
              unit="/4095"
              scalePresets={[
                { label: 'Auto Fit', domain: ['auto', 'auto'] },
                { label: '0 - 4095', domain: [0, 4095] },
                { label: '0 - 1000', domain: [0, 1000] },
              ]}
              onQuickCalibrate={() => startCalibration('fsr')}
              onResetCalibration={() => resetSensorCalibration('fsr')}
              calibrateLabel={t('tareGripPressure')}
              isCalibrated={offsets.fsr !== 0}
            />
          )}
        </div>

        {/* Session Log / Controls */}
        <div className="mb-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-slate-900 dark:text-slate-100 text-sm font-semibold">
                  {t('sessionControls')} & Verifiable Cloud Archive
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Records multi-channel telemetry, computes differential PD vs. ET probabilities, and signs with HMAC-SHA256
                </p>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => exportSession()}
                  aria-label="Export Session as JSON"
                  className="text-slate-400 hover:text-sky-700 dark:text-slate-500 dark:hover:text-sky-400 transition-colors p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                  title="Export Complete Active Section as JSON"
                >
                  <Save size={15} />
                </button>
                <button
                  onClick={clearData}
                  aria-label="Clear Live Graphs"
                  className="text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-white transition-colors p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                  title="Clear Graphs"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            <div className="flex-1 flex flex-col md:flex-row gap-4">
              <div className="flex-1 flex flex-col items-center justify-center space-y-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/70 dark:bg-slate-950/40 p-5">
                {!isRecording ? (
                  <button
                    onClick={() => {
                      audioFeedback.playStartRecording();
                      setIsRecording(true);
                      recordingBuffer.current = [];
                      recordingStartTime.current = Date.now();
                    }}
                    disabled={!isConnected}
                    aria-label="Start Recording Clinical Session"
                    className="flex items-center justify-center w-12 h-12 rounded-full bg-red-600 hover:bg-red-700 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Record Session"
                  >
                    <div className="w-4 h-4 bg-white rounded-full" />
                  </button>
                ) : (
                  <button
                    onClick={handleStopAndSaveRecording}
                    aria-label="Stop and Save Clinical Session"
                    className="flex items-center justify-center w-12 h-12 rounded-full bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 transition-all text-white"
                    title="Stop and Save Session"
                  >
                    <Square className="text-white fill-current" size={18} />
                  </button>
                )}
                <p className="text-slate-700 dark:text-slate-300 text-xs font-medium text-center">
                  {isRecording ? t('recordingSession') : t('recordCloudSession')}
                </p>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center space-y-2.5 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/70 dark:bg-slate-950/40 p-5">
                {!isStreamingExport ? (
                  <>
                    <div className="flex gap-2 w-full max-w-[180px]">
                      <select
                        aria-label="Export File Format"
                        className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md px-2 py-1 text-xs text-slate-800 dark:text-slate-200"
                        value={exportFormat}
                        onChange={(e) => setExportFormat(e.target.value as 'csv' | 'json')}
                        disabled={!isConnected}
                      >
                        <option value="csv">CSV</option>
                        <option value="json">JSON</option>
                      </select>
                      <select
                        aria-label="Export Stream Duration"
                        className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md px-2 py-1 text-xs text-slate-800 dark:text-slate-200"
                        value={exportDuration}
                        onChange={(e) => setExportDuration(Number(e.target.value))}
                        disabled={!isConnected}
                      >
                        <option value={0}>{t('continuous')}</option>
                        <option value={10}>10s</option>
                        <option value={30}>30s</option>
                        <option value={60}>1m</option>
                      </select>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          await exportService.startStreaming(exportFormat, exportDuration, () =>
                            setIsStreamingExport(false)
                          );
                          setIsStreamingExport(true);
                        } catch (e: any) {
                          setErrorModal({
                            title: 'Export Error',
                            message: e.message || 'Failed to start streaming.',
                          });
                        }
                      }}
                      disabled={!isConnected}
                      aria-label="Start Real-Time Export to File"
                      className="flex items-center justify-center w-10 h-10 rounded-full bg-sky-700 hover:bg-sky-800 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Start Real-Time Export to File"
                    >
                      <Save size={16} />
                    </button>
                    <p className="text-slate-700 dark:text-slate-300 text-xs font-medium text-center">
                      {t('liveFileStream')}
                    </p>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        exportService.stopStreaming();
                        setIsStreamingExport(false);
                      }}
                      aria-label="Stop Real-Time Export"
                      className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 text-white"
                    >
                      <Square className="fill-current" size={14} />
                    </button>
                    <p className="text-sky-700 dark:text-sky-400 text-xs font-medium font-mono text-center">
                      {t('writingFile')} {exportFormat.toUpperCase()}...
                    </p>
                  </>
                )}
              </div>
            </div>

            {recordedSessions.length > 0 && (
              <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {t('clinicalReportHistory')} ({recordedSessions.length})
                  </h4>
                  <button
                    onClick={() => {
                      setConfirmModal({
                        title: t('confirmClearAllTitle'),
                        message: t('confirmClearAllMsg'),
                        onConfirm: async () => {
                          if (!user) {
                            setRecordedSessions([]);
                            localStorage.removeItem('neurotremor_guest_sessions');
                            return;
                          }
                          try {
                            for (const session of recordedSessions) {
                              await deleteDoc(doc(db, 'sessions', session.id));
                            }
                          } catch (error) {
                            handleFirestoreError(error, OperationType.DELETE, 'sessions');
                          }
                        },
                      });
                    }}
                    className="text-xs text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 transition-colors font-medium"
                  >
                    {t('clearAll')}
                  </button>
                </div>
                <div className="space-y-2.5">
                  {recordedSessions.map((session, idx) => {
                    // recordedSessions is ordered newest-first; chronological index is (total - idx)
                    const total = recordedSessions.length;
                    const sectionNum = total - idx;
                    const prevSession = idx + 1 < total ? recordedSessions[idx + 1] : null;
                    const seqRecovery =
                      prevSession && prevSession.rms >= 0.05
                        ? Number(
                            Math.max(
                              -100,
                              Math.min(
                                100,
                                ((prevSession.rms - session.rms) / prevSession.rms) * 100
                              )
                            ).toFixed(1)
                          )
                        : null;

                    const isExpanded = expandedSessionId === session.id;
                    const sessionMult = session.sensitivityMultiplier ?? sensitivityMultiplier;
                    const sessionDiff =
                      session.analysis ||
                      analyzeTremorDifferential(session.data, 'pen', sessionMult);
                    const sessionSummary =
                      session.datasetSummary ||
                      computeDatasetSectionSummary(session.data, 'pen', sessionMult);
                    const sessionStats =
                      session.sensorStats || computeSensorChannelStats(session.data);
                    const strokeCount = session.drawingStrokes?.length || 0;
                    const comparisonLabel =
                      session.sectionComparisonLabel ||
                      (seqRecovery === null ? 'S-1 Baseline Saved' : `S-${sectionNum} vs. S-${sectionNum - 1}`);

                    return (
                      <div
                        key={session.id}
                        className="bg-slate-50 dark:bg-slate-950/60 rounded-md text-xs border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors overflow-hidden"
                      >
                        <div className="flex flex-wrap justify-between items-center gap-3 px-3.5 py-2.5">
                          <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
                            <span className="text-sky-700 dark:text-sky-400 font-bold">
                              S-{sectionNum}
                            </span>
                            <span aria-hidden="true" className="text-slate-400">
                              ·
                            </span>
                            <span className="text-slate-900 dark:text-slate-100 font-semibold">
                              {new Date(session.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </span>
                            <span aria-hidden="true" className="text-slate-400">
                              ·
                            </span>
                            <span className="text-slate-600 dark:text-slate-400">
                              {(session.rms / 9.80665).toFixed(3)}g ({session.duration.toFixed(1)}s ·{' '}
                              {session.rawSampleCount || session.data.length} pts
                              {strokeCount > 0
                                ? ` · ${strokeCount} ${strokeCount === 1 ? 'stroke' : 'strokes'}`
                                : ''}
                              )
                            </span>
                            <span aria-hidden="true" className="text-slate-400">
                              ·
                            </span>
                            <span
                              className={`font-semibold ${
                                seqRecovery === null
                                  ? 'text-slate-500 dark:text-slate-400'
                                  : seqRecovery > 2.0
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : seqRecovery < -2.0
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {seqRecovery === null
                                ? 'Recovery: 0.0% (Initial S-1)'
                                : `Recovery: ${seqRecovery > 0 ? '+' : ''}${seqRecovery.toFixed(1)}% (vs. S-${sectionNum - 1})`}
                            </span>
                            <span aria-hidden="true" className="text-slate-400">
                              ·
                            </span>
                            <span className="font-sans font-medium text-sky-700 dark:text-sky-400">
                              {session.phenotype || `${session.frequency.toFixed(1)} Hz`}
                            </span>
                            {session.integrityHash && (
                              <>
                                <span aria-hidden="true" className="text-slate-400">
                                  ·
                                </span>
                                <span
                                  className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400"
                                  title={`Server HMAC-SHA256 Digest: ${session.integrityHash}`}
                                >
                                  <ShieldCheck size={12} />
                                  {session.integrityHash.slice(0, 8)}
                                </span>
                              </>
                            )}
                          </div>

                          <div className="flex items-center gap-3">
                            <span
                              className={`font-medium ${
                                session.severity === 'Severe'
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : session.severity === 'Moderate'
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-emerald-700 dark:text-emerald-400'
                              }`}
                            >
                              {session.severity} ({session.stage})
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() =>
                                  setExpandedSessionId(isExpanded ? null : session.id)
                                }
                                aria-label={`Inspect all saved data and drawing for session S-${sectionNum}`}
                                className={`p-1.5 rounded transition-colors ${
                                  isExpanded
                                    ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300'
                                    : 'text-slate-600 hover:text-sky-700 dark:text-slate-400 dark:hover:text-sky-400'
                                }`}
                                title="Inspect Saved Drawing, KPI Readings, Differential Classifier, Dataset Summary & Sensor Channels"
                              >
                                <Eye size={14} />
                              </button>
                              <button
                                onClick={() => exportSession(session)}
                                aria-label={`Export complete JSON for session S-${sectionNum}`}
                                className="p-1.5 text-slate-600 hover:text-sky-700 dark:text-slate-400 dark:hover:text-sky-400 transition-colors"
                                title="Download Complete Section JSON (Drawing + Raw Telemetry + Calculated Metrics)"
                              >
                                <Download size={14} />
                              </button>
                              <button
                                onClick={() => setReportModalSession(session)}
                                aria-label={`Download Clinical Report for session ${session.id.slice(0, 6)}`}
                                className="p-1.5 text-slate-600 hover:text-sky-700 dark:text-slate-400 dark:hover:text-sky-400 transition-colors"
                                title={t('downloadReport')}
                              >
                                <FileText size={14} />
                              </button>
                              <button
                                onClick={() => {
                                  if (session.drawingStrokes && session.drawingStrokes.length > 0) {
                                    setReplayStrokes(session.drawingStrokes);
                                  }
                                  setSectionData(session.data);
                                  setLoadedDataset(session.data);
                                  startDatasetPlayback(session.data);
                                }}
                                aria-label={`Replay session ${session.id.slice(0, 6)}`}
                                className="p-1.5 text-slate-600 hover:text-emerald-700 dark:text-slate-400 dark:hover:text-emerald-400 transition-colors"
                                title={t('replaySession')}
                              >
                                <Play size={14} />
                              </button>
                              <button
                                onClick={async () => {
                                  if (!user) {
                                    const filtered = recordedSessions.filter(
                                      (s) => s.id !== session.id
                                    );
                                    setRecordedSessions(filtered);
                                    localStorage.setItem(
                                      'neurotremor_guest_sessions',
                                      JSON.stringify(filtered)
                                    );
                                    return;
                                  }
                                  try {
                                    await deleteDoc(doc(db, 'sessions', session.id));
                                  } catch (error) {
                                    handleFirestoreError(
                                      error,
                                      OperationType.DELETE,
                                      `sessions/${session.id}`
                                    );
                                  }
                                }}
                                aria-label={`Delete session ${session.id.slice(0, 6)}`}
                                className="p-1.5 text-slate-600 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 transition-colors"
                                title={t('deleteSession')}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-5">
                            {/* 1. Saved 4 KPI Cards (Exact Match to Top KPI Strip) */}
                            <div>
                              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
                                Saved Section KPI Readings (S-{sectionNum} Total Section Average)
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono">
                                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                  <div className="flex items-center justify-between text-[11px] font-sans text-slate-500 mb-1">
                                    <span>RMS Amplitude</span>
                                    <span className="font-mono">
                                      {sessionDiff.estimatedExcursionCm > 0.02
                                        ? `~${sessionDiff.estimatedExcursionCm.toFixed(2)} cm`
                                        : 'Calibrated RMS'}
                                    </span>
                                  </div>
                                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                    {sessionDiff.rmsG.toFixed(3)} g{' '}
                                    <span className="text-xs font-normal text-slate-500">
                                      · {sessionDiff.rms.toFixed(2)} m/s²
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-500 mt-1">
                                    Kinematic vector: {sessionDiff.kinematicBracket}
                                  </div>
                                </div>

                                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                  <div className="flex items-center justify-between text-[11px] font-sans text-slate-500 mb-1">
                                    <span>Dominant Frequency</span>
                                    <span className="font-mono text-sky-700 dark:text-sky-400">
                                      {sessionDiff.is4to6HzPdLock ? '4–6 Hz PD Lock' : 'DFT Peak'}
                                    </span>
                                  </div>
                                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                    {sessionDiff.dominantFreq.toFixed(1)} Hz
                                  </div>
                                  <div className="text-[11px] text-slate-500 mt-1">
                                    Spectral cluster:{' '}
                                    {sessionDiff.dominantFreq >= 3.5 &&
                                    sessionDiff.dominantFreq <= 6.5
                                      ? '3.5–6.5 Hz PD band'
                                      : sessionDiff.dominantFreq > 6.5 &&
                                        sessionDiff.dominantFreq <= 12
                                      ? '6.5–12 Hz ET band'
                                      : 'Physiological (<3.5 Hz)'}
                                  </div>
                                </div>

                                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                  <div className="flex items-center justify-between text-[11px] font-sans text-slate-500 mb-1">
                                    <span>Clinical Severity Stage</span>
                                    <span className="font-mono">
                                      {sessionDiff.clinicalStage === 'Normal'
                                        ? 'Stage 0'
                                        : sessionDiff.clinicalStage}
                                    </span>
                                  </div>
                                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                    {sessionDiff.severityLabel}{' '}
                                    <span className="text-xs font-normal text-slate-500">
                                      · UPDRS {sessionDiff.updrsScore.toFixed(1)}/4.0
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-500 mt-1 truncate">
                                    Clinical stage: {sessionDiff.hoehnYahrStage}
                                  </div>
                                </div>

                                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                  <div className="flex items-center justify-between text-[11px] font-sans text-slate-500 mb-1">
                                    <span>Recovery Rate (Recorded)</span>
                                    <span className="font-mono text-emerald-700 dark:text-emerald-400">
                                      {comparisonLabel}
                                    </span>
                                  </div>
                                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                    {seqRecovery === null
                                      ? '0.0%'
                                      : `${seqRecovery > 0 ? '+' : ''}${seqRecovery.toFixed(1)}%`}{' '}
                                    <span className="text-xs font-normal text-slate-500">
                                      {seqRecovery === null
                                        ? 'baseline'
                                        : seqRecovery > 2.0
                                        ? 'reduction'
                                        : seqRecovery < -2.0
                                        ? 'increase'
                                        : 'stable'}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-500 mt-1 flex justify-between">
                                    <span>
                                      {prevSession
                                        ? `Prev: ${(prevSession.rms / 9.80665).toFixed(3)}g`
                                        : 'Initial S-1'}
                                    </span>
                                    <span>Grip: {sessionDiff.avgForce} FSR</span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* 2. Saved Differential Tremor & Grip Force Classifier Readings */}
                            <div className="p-3.5 rounded-lg bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                  Differential Tremor & Grip Force Classifier — Phenotype Differentiation
                                </span>
                                {session.integrityHash && (
                                  <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                                    HMAC: {session.integrityHash.slice(0, 10)}
                                  </span>
                                )}
                              </div>

                              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                {/* Phenotype & Probabilities */}
                                <div className="p-3 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                                  <div className="text-[11px] text-slate-500">
                                    Detected Motor Phenotype
                                  </div>
                                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                    {sessionDiff.phenotype}
                                  </div>
                                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                                    {sessionDiff.clinicalRationale}
                                  </p>
                                  <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] font-mono">
                                    <div className="flex justify-between">
                                      <span>Parkinsonian (4–6 Hz Resting / Pill-Rolling)</span>
                                      <span className="font-bold text-sky-700 dark:text-sky-400">
                                        {sessionDiff.pdProbability}%
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Essential / Postural (6.5–12 Hz Kinetic)</span>
                                      <span className="font-bold text-teal-700 dark:text-teal-400">
                                        {sessionDiff.etProbability}%
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Physiological / Voluntary Baseline</span>
                                      <span className="font-bold text-slate-600 dark:text-slate-400">
                                        {sessionDiff.normalProbability}%
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Power Spectral Density (DFT Hann Window) */}
                                <div className="p-3 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
                                  <div>
                                    <div className="flex items-center justify-between text-[11px] mb-1">
                                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                                        Power Spectral Density (DFT Hann Window)
                                      </span>
                                      <span className="font-mono font-semibold text-sky-700 dark:text-sky-400">
                                        Peak: {sessionDiff.dominantFreq.toFixed(1)} Hz
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-4 gap-1.5 my-2 font-mono text-[10px]">
                                      {sessionDiff.spectrum.map((bin) => (
                                        <div
                                          key={bin.label}
                                          className="p-1.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 text-center"
                                        >
                                          <div className="text-slate-500">{bin.label}</div>
                                          <div className="font-bold text-slate-900 dark:text-slate-100">
                                            {bin.power.toFixed(2)}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="text-[10px] font-mono text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
                                    4–6Hz PD Core:{' '}
                                    {Math.round(
                                      (sessionDiff.pdCore4to6Power ?? sessionDiff.pdBandPower) * 100
                                    )}
                                    % (3.5–6.5Hz: {Math.round(sessionDiff.pdBandPower * 100)}%) · ET
                                    (6.5–12Hz): {Math.round(sessionDiff.etBandPower * 100)}%
                                  </div>
                                </div>

                                {/* 4 Differential Biomarker Cards */}
                                <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                                  <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
                                    <div className="font-sans text-slate-500">
                                      Pill-Rolling Gyro Index
                                    </div>
                                    <div className="text-base font-bold text-slate-900 dark:text-slate-100">
                                      {sessionDiff.pillRollingIndex} / 100
                                    </div>
                                    <div className="text-[10px] font-sans text-slate-500">
                                      {sessionDiff.pillRollingIndex >= 45
                                        ? 'Pronation-supination (PD)'
                                        : 'Planar flexion-extension'}
                                    </div>
                                  </div>

                                  <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
                                    <div className="font-sans text-slate-500">
                                      Spectral Rhythmicity (Q)
                                    </div>
                                    <div className="text-base font-bold text-slate-900 dark:text-slate-100">
                                      {sessionDiff.spectralRegularity}%
                                    </div>
                                    <div className="text-[10px] font-sans text-slate-500">
                                      {sessionDiff.spectralRegularity >= 55
                                        ? `Constancy ${sessionDiff.constancyScore}/4 · Lock`
                                        : 'Broadband / mixed kinematics'}
                                    </div>
                                  </div>

                                  <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
                                    <div className="font-sans text-slate-500">
                                      Grip Force Stability
                                    </div>
                                    <div className="text-base font-bold text-slate-900 dark:text-slate-100">
                                      {sessionDiff.avgForce} FSR
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                      Slope:{' '}
                                      {sessionDiff.gripDecaySlope > 0
                                        ? `+${sessionDiff.gripDecaySlope}`
                                        : sessionDiff.gripDecaySlope}
                                      /s · CV {sessionDiff.forceCv}%
                                    </div>
                                  </div>

                                  <div className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
                                    <div className="font-sans text-slate-500">
                                      MDS-UPDRS III Score
                                    </div>
                                    <div className="text-base font-bold text-slate-900 dark:text-slate-100">
                                      {sessionDiff.updrsScore.toFixed(1)} / 4.0
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                      Excursion: ~{sessionDiff.estimatedExcursionCm.toFixed(2)} cm ·
                                      Decay: {sessionDiff.micrographiaIndex}%
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* 3. Saved Drawing + Saved Dataset Analysis Summary (Total Section Average) */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                              <div>
                                <div className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
                                  <span>
                                    Saved Trackpad Drawing (
                                    {session.canvasMode === 'freedraw'
                                      ? 'Blank Free-Draw'
                                      : 'Guided Spiral'}
                                    )
                                  </span>
                                  <span className="font-mono text-slate-500">
                                    {strokeCount} {strokeCount === 1 ? 'stroke' : 'strokes'}
                                  </span>
                                </div>
                                <SavedDrawingPreview
                                  strokes={session.drawingStrokes}
                                  mode={session.canvasMode || 'spiral'}
                                />
                              </div>

                              <div className="space-y-2">
                                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                  Dataset Analysis Summary (Total Section Average ·{' '}
                                  {sessionSummary.segmentCount} Windows Averaged)
                                </div>
                                <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                                  <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                    <div className="text-slate-500">Total Points (Section)</div>
                                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                      {sessionSummary.totalPoints.toLocaleString()} pts (
                                      {sessionSummary.durationSec.toFixed(1)}s)
                                    </div>
                                  </div>
                                  <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                    <div className="text-slate-500">Dominant Freq (Avg)</div>
                                    <div className="text-sm font-bold text-sky-700 dark:text-sky-400">
                                      {sessionSummary.avgFrequency.toFixed(1)} Hz
                                    </div>
                                  </div>
                                  <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                    <div className="text-slate-500">RMS Tremor (Avg)</div>
                                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                      {sessionSummary.avgRmsG.toFixed(3)} g (
                                      {sessionSummary.avgRms.toFixed(2)} m/s²)
                                    </div>
                                  </div>
                                  <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                                    <div className="text-slate-500">Average Severity (Avg)</div>
                                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                      {sessionSummary.avgSeverity.toFixed(2)} / 4.0 (
                                      {sessionSummary.severityLabel})
                                    </div>
                                  </div>
                                </div>
                                <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono text-[11px]">
                                  <div className="text-slate-500 mb-1">
                                    Severity Distribution Across All {sessionSummary.segmentCount}{' '}
                                    Section Windows
                                  </div>
                                  <div className="flex flex-wrap gap-3 text-slate-800 dark:text-slate-200">
                                    <span>None: {sessionSummary.severityCounts[0]}</span>
                                    <span>Mild: {sessionSummary.severityCounts[1]}</span>
                                    <span>Moderate: {sessionSummary.severityCounts[2]}</span>
                                    <span>Severe: {sessionSummary.severityCounts[3]}</span>
                                    <span>Extreme: {sessionSummary.severityCounts[4]}</span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* 4. Read Multi-Sensor Channel Summary Table */}
                            <div>
                              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
                                Read Sensor Channels Summary (All 10 Channels ·{' '}
                                {session.rawSampleCount || session.data.length} Samples · Sensitivity{' '}
                                {(session.sensitivityMultiplier ?? sensitivityMultiplier).toFixed(2)}x)
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-[11px]">
                                {(
                                  [
                                    ['ax', 'Accel X (m/s²)'],
                                    ['ay', 'Accel Y (m/s²)'],
                                    ['az', 'Accel Z (m/s²)'],
                                    ['gx', 'Gyro X (°/s)'],
                                    ['gy', 'Gyro Y (°/s)'],
                                    ['gz', 'Gyro Z (°/s)'],
                                    ['mx', 'Mag X (µT)'],
                                    ['my', 'Mag Y (µT)'],
                                    ['mz', 'Mag Z (µT)'],
                                    ['fsr', 'Grip FSR'],
                                  ] as const
                                ).map(([key, label]) => (
                                  <div
                                    key={key}
                                    className="p-2 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                                  >
                                    <div className="text-slate-500">{label}</div>
                                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                                      Mean: {sessionStats[key].mean} | RMS: {sessionStats[key].rms}
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                      Min {sessionStats[key].min} · Max {sessionStats[key].max}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Clinical Protocol & Hardware Reference */}
        <div className="border-t border-slate-200 dark:border-slate-800 pt-6 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h4 className="text-slate-900 dark:text-slate-100 font-semibold text-sm">
              Clinical Acquisition Protocol & Hardware Setup
            </h4>
            <button
              onClick={() => setShowFirmwareModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 dark:bg-sky-950/60 dark:hover:bg-sky-900/60 dark:text-sky-300 dark:border-sky-800 transition-colors"
            >
              <Cpu size={13} />
              <span>ESP32-S3 9-DOF Firmware (.ino)</span>
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-600 dark:text-slate-400">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5">
              <strong className="text-slate-900 dark:text-slate-200 block font-semibold">
                01. Sensor Mounting & Baseline Tare
              </strong>
              <p className="leading-relaxed">{t('guideStep1Desc')}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5">
              <strong className="text-slate-900 dark:text-slate-200 block font-semibold">
                02. Rest vs. Postural Maneuver
              </strong>
              <p className="leading-relaxed">
                Evaluate resting tremor with the forearm supported for 15s (isolating 4–6 Hz
                Parkinsonian pill-rolling), then transition to outstretched postural hold and spiral
                tracing to assess 6.5–12 Hz Essential tremor and grip force decay.
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5">
              <strong className="text-slate-900 dark:text-slate-200 block font-semibold">
                03. Verifiable Clinical Archival
              </strong>
              <p className="leading-relaxed">
                Record sessions to generate server-signed HMAC-SHA256 biomarker digests and export
                MDS-UPDRS III aligned PDF reports for longitudinal patient charts.
              </p>
            </div>
          </div>
        </div>

        {/* Calibration Modal */}
        <CalibrationModal
          isOpen={showCalibrationModal}
          onClose={() => setShowCalibrationModal(false)}
          offsets={offsets}
          onSaveOffsets={handleSaveOffsets}
          onStartCalibration={startCalibration}
          isCalibrating={isCalibrating}
          calibrationTimeLeft={calibrationTimeLeft}
          calibrationType={calibrationType}
          isConnected={isConnected}
        />

        {/* ESP32-S3 9-DOF Firmware Modal */}
        <Esp32FirmwareModal
          isOpen={showFirmwareModal}
          onClose={() => setShowFirmwareModal(false)}
        />

        {/* Patient Details Modal */}
        <PatientDetailsModal
          isOpen={!!reportModalSession}
          onClose={() => setReportModalSession(null)}
          onSubmit={(details) => {
            if (reportModalSession) {
              generateClinicalReport(reportModalSession, details);
              setReportModalSession(null);
            }
          }}
          defaultAssessmentDate={reportModalSession?.timestamp}
        />

        {/* Security & Clinical Privacy Modal */}
        <SecurityPrivacyModal
          isOpen={!!securityModalTab}
          onClose={() => setSecurityModalTab(null)}
          defaultTab={securityModalTab || 'medical'}
          isDark={!isHighContrast}
        />

        {/* Clinical Compliance & Security Footer */}
        <footer className="mt-10 pt-6 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex flex-col md:flex-row items-center justify-between gap-3 pb-4">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-sky-700 flex items-center justify-center text-white">
                <Activity size={12} />
              </div>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                NeuroTremor Clinical Kinematics Platform
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
              <button
                onClick={() => setSecurityModalTab('medical')}
                className="hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                Medical Disclaimer
              </button>
              <span aria-hidden="true">·</span>
              <button
                onClick={() => setSecurityModalTab('privacy')}
                className="hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                Privacy Policy
              </button>
              <span aria-hidden="true">·</span>
              <button
                onClick={() => setSecurityModalTab('cookies')}
                className="hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                Cookies & Storage
              </button>
              <span aria-hidden="true">·</span>
              <button
                onClick={() => setSecurityModalTab('security')}
                className="hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                Backend Security & Scalability
              </button>
            </div>
          </div>

          <div className="p-3.5 rounded-md bg-slate-100/70 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 text-center sm:text-left mb-6">
            <strong className="text-slate-700 dark:text-slate-300">
              Medical & Regulatory Notice:
            </strong>{' '}
            NeuroTremor is an investigational clinical decision-support and quantitative
            motion-screening utility. It is not an FDA/CE cleared diagnostic medical device.
            Differential PD vs. ET probabilities, spectral power ratios, and isometric grip force
            metrics must be interpreted by a qualified neurologist alongside physical examination.
          </div>
        </footer>

        <ConsentBanner onOpenSecurityModal={(tab) => setSecurityModalTab(tab || 'medical')} />
      </main>
    </div>
  );
}

export default App;
