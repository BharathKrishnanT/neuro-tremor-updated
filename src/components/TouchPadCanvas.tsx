import React, { useRef, useEffect, useState, useCallback } from 'react';
import { SensorData, enrichSensorFrame } from '../lib/serial';
import { Maximize2, Minimize2, Save, Square, Trash2, Compass, Edit3 } from 'lucide-react';
import { useLanguage } from '../lib/i18n';

export type CanvasDrawMode = 'spiral' | 'freedraw';

export interface DrawingPoint {
  x: number;
  y: number;
  pressure: number;
  t: number;
}

export interface DrawingStroke {
  mode: CanvasDrawMode;
  points: DrawingPoint[];
  canvasWidth: number;
  canvasHeight: number;
}

export interface DigitizerStreamEvent {
  x: number;
  y: number;
  pressure: number;
  penDown: 0 | 1;
  mode: CanvasDrawMode;
  canvasWidth: number;
  canvasHeight: number;
  timestamp: number;
}

export interface TouchPadCanvasProps {
  onData: (data: SensorData) => void;
  mode?: 'touch' | 'combined';
  onTouchUpdate?: (x: number, y: number, pressure: number, syntheticFrame?: SensorData) => void;
  onDigitizerEvent?: (evt: DigitizerStreamEvent) => void;
  onDrawingStateChange?: (isDrawing: boolean) => void;
  onStrokesChange?: (
    strokes: DrawingStroke[],
    canvasMode: CanvasDrawMode,
    canvasWidth: number,
    canvasHeight: number
  ) => void;
  replayStrokes?: DrawingStroke[] | null;
  clearNonce?: number;
  isReplaying?: boolean;
  isFusionTestActive?: boolean;
  externalPenPoint?: { x: number; y: number; pressure: number; penDown: 0 | 1; t: number } | null;
  onClearReplay?: () => void;
  onClearData?: () => void;
  onSaveDrawingSession?: () => void;
  isRecording?: boolean;
  onToggleRecording?: () => void;
  sampleCount?: number;
}

export function renderDrawingToCanvas(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  activeMode: CanvasDrawMode,
  strokes: DrawingStroke[] = []
) {
  ctx.clearRect(0, 0, w, h);

  // Subtle background coordinate grid for clinical spatial reference
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.35)';
  ctx.lineWidth = 1;
  const gridStep = 32;
  ctx.beginPath();
  for (let gx = gridStep; gx < w; gx += gridStep) {
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, h);
  }
  for (let gy = gridStep; gy < h; gy += gridStep) {
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
  }
  ctx.stroke();

  if (activeMode === 'spiral') {
    // Archimedes Spiral Reference Template
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const scale = w > 1000 ? 8 : 5;
    for (let i = 0; i < 500; i++) {
      const angle = 0.1 * i;
      const x = w / 2 + (1 + angle) * Math.cos(angle) * scale;
      const y = h / 2 + (1 + angle) * Math.sin(angle) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Center origin target marker
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Free-Draw Center Crosshair Axes
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.55)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(
    activeMode === 'spiral'
      ? 'GUIDED ARCHIMEDES SPIRAL · TRACE FROM CENTER OUTWARD'
      : 'BLANK FREE-DRAW WORKSPACE · WRITE OR DRAW FREELY TO MEASURE TREMOR',
    w / 2,
    24
  );

  // Render any existing or replayed user strokes
  for (const stroke of strokes) {
    if (!stroke.points || stroke.points.length === 0) continue;
    const scaleX = stroke.canvasWidth > 0 ? w / stroke.canvasWidth : 1;
    const scaleY = stroke.canvasHeight > 0 ? h / stroke.canvasHeight : 1;
    ctx.beginPath();
    stroke.points.forEach((pt, idx) => {
      const px = pt.x * scaleX;
      const py = pt.y * scaleY;
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

export function TouchPadCanvas({
  onData,
  mode = 'touch',
  onTouchUpdate,
  onDigitizerEvent,
  onDrawingStateChange,
  onStrokesChange,
  replayStrokes,
  clearNonce = 0,
  isReplaying = false,
  isFusionTestActive = false,
  externalPenPoint = null,
  onClearReplay,
  onClearData,
  onSaveDrawingSession,
  isRecording = false,
  onToggleRecording,
  sampleCount = 0,
}: TouchPadCanvasProps) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasDrawMode>('spiral');
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const strokesRef = useRef<DrawingStroke[]>([]);
  const hadReplayRef = useRef<boolean>(false);
  const currentStrokeRef = useRef<DrawingStroke | null>(null);
  const extStrokeRef = useRef<DrawingStroke | null>(null);
  const lastPos = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastVel = useRef<{ vx: number; vy: number; ax: number; ay: number } | null>(null);

  const redrawAll = useCallback(
    (activeMode: CanvasDrawMode = canvasMode, strokes: DrawingStroke[] = strokesRef.current) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx && canvas) {
        renderDrawingToCanvas(ctx, canvas.width, canvas.height, activeMode, strokes);
      }
    },
    [canvasMode]
  );

  // Sync replayStrokes when a saved session is replayed, and wipe the canvas cleanly when replay is cleared
  useEffect(() => {
    if (replayStrokes && replayStrokes.length > 0) {
      hadReplayRef.current = true;
      const replayMode = replayStrokes[0].mode || 'spiral';
      setCanvasMode(replayMode);
      strokesRef.current = replayStrokes;
      setHasDrawn(true);
      redrawAll(replayMode, replayStrokes);
    } else if (hadReplayRef.current) {
      hadReplayRef.current = false;
      strokesRef.current = [];
      currentStrokeRef.current = null;
      setIsDrawing(false);
      setHasDrawn(false);
      redrawAll(canvasMode, []);
    }
  }, [replayStrokes, canvasMode, redrawAll]);

  // Wipe canvas whenever an external clear/reset is triggered (e.g., Clear Replay or Clear Data)
  useEffect(() => {
    if (clearNonce > 0) {
      hadReplayRef.current = false;
      strokesRef.current = [];
      currentStrokeRef.current = null;
      extStrokeRef.current = null;
      setIsDrawing(false);
      setHasDrawn(false);
      redrawAll(canvasMode, []);
    }
  }, [clearNonce, canvasMode, redrawAll]);

  // Trace live external demo fusion points onto the canvas during 90s Demo Fusion Test
  useEffect(() => {
    if (!externalPenPoint) {
      extStrokeRef.current = null;
      return;
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const scaleX = canvas.width / 800;
    const scaleY = canvas.height / 320;
    const px = externalPenPoint.x * scaleX;
    const py = externalPenPoint.y * scaleY;

    if (externalPenPoint.penDown === 1) {
      setHasDrawn(true);
      if (!extStrokeRef.current) {
        const s: DrawingStroke = {
          mode: 'spiral',
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          points: [
            {
              x: Number(px.toFixed(1)),
              y: Number(py.toFixed(1)),
              pressure: Math.round(externalPenPoint.pressure),
              t: externalPenPoint.t,
            },
          ],
        };
        extStrokeRef.current = s;
        strokesRef.current = [...strokesRef.current, s];
      } else {
        const prev = extStrokeRef.current.points[extStrokeRef.current.points.length - 1];
        extStrokeRef.current.points.push({
          x: Number(px.toFixed(1)),
          y: Number(py.toFixed(1)),
          pressure: Math.round(externalPenPoint.pressure),
          t: externalPenPoint.t,
        });
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(px, py);
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      onStrokesChange?.(strokesRef.current, 'spiral', canvas.width, canvas.height);
    } else {
      extStrokeRef.current = null;
    }
  }, [externalPenPoint, onStrokesChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();

      if (Math.abs(canvas.width - rect.width) > 5 || Math.abs(canvas.height - rect.height) > 5) {
        canvas.width = rect.width;
        canvas.height = rect.height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          renderDrawingToCanvas(ctx, canvas.width, canvas.height, canvasMode, strokesRef.current);
        }
      }
    };

    const observer = new ResizeObserver(() => {
      handleResize();
    });

    if (canvas.parentElement) {
      observer.observe(canvas.parentElement);
    }

    handleResize();

    return () => observer.disconnect();
  }, [isFullscreen, canvasMode]);

  const resetCanvasSurface = useCallback(
    (targetMode: CanvasDrawMode = canvasMode) => {
      setHasDrawn(false);
      setIsDrawing(false);
      strokesRef.current = [];
      currentStrokeRef.current = null;
      onDrawingStateChange?.(false);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx && canvas) {
        renderDrawingToCanvas(ctx, canvas.width, canvas.height, targetMode, []);
        onStrokesChange?.([], targetMode, canvas.width, canvas.height);
      }
    },
    [canvasMode, onDrawingStateChange, onStrokesChange]
  );

  const handleSwitchMode = (nextMode: CanvasDrawMode) => {
    if (nextMode === canvasMode) return;
    setCanvasMode(nextMode);
    resetCanvasSurface(nextMode);
  };

  const getCanvasCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    setIsDrawing(true);
    setHasDrawn(true);
    onDrawingStateChange?.(true);

    const now = Date.now();
    lastPos.current = { x: e.clientX, y: e.clientY, t: now };
    lastVel.current = { vx: 0, vy: 0, ax: 0, ay: 0 };

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const { x, y } = getCanvasCoordinates(e);
    const pressure = e.pressure !== undefined && e.pressure > 0 ? e.pressure * 4095 : 2048;

    const newStroke: DrawingStroke = {
      mode: canvasMode,
      canvasWidth: canvas?.width || 800,
      canvasHeight: canvas?.height || 320,
      points: [{ x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), pressure: Math.round(pressure), t: now }],
    };
    currentStrokeRef.current = newStroke;
    strokesRef.current = [...strokesRef.current, newStroke];
    onDigitizerEvent?.({
      x: Number(x.toFixed(1)),
      y: Number(y.toFixed(1)),
      pressure: Math.round(pressure),
      penDown: 1,
      mode: canvasMode,
      canvasWidth: canvas?.width || 800,
      canvasHeight: canvas?.height || 320,
      timestamp: now,
    });
    onStrokesChange?.(
      strokesRef.current,
      canvasMode,
      canvas?.width || 800,
      canvas?.height || 320
    );

    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // When 90s multimodal fusion test is active, stream hover coordinates as pen_up (0)
    if (!isDrawing) {
      if (isFusionTestActive && onDigitizerEvent) {
        const canvas = canvasRef.current;
        const { x, y } = getCanvasCoordinates(e);
        onDigitizerEvent({
          x: Number(x.toFixed(1)),
          y: Number(y.toFixed(1)),
          pressure: 0,
          penDown: 0,
          mode: canvasMode,
          canvasWidth: canvas?.width || 800,
          canvasHeight: canvas?.height || 320,
          timestamp: Date.now(),
        });
      }
      return;
    }
    if (!lastPos.current || !lastVel.current) return;

    const now = Date.now();
    const dt = (now - lastPos.current.t) / 1000;
    if (dt <= 0) return;

    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;

    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1.5) {
      lastPos.current = { x: e.clientX, y: e.clientY, t: now };
      return;
    }

    const pxToMeter = 0.00015;
    const vx = (dx * pxToMeter) / dt;
    const vy = (dy * pxToMeter) / dt;

    const rawAx = Math.max(-6, Math.min(6, (vx - lastVel.current.vx) / dt));
    const rawAy = Math.max(-6, Math.min(6, (vy - lastVel.current.vy) / dt));

    const ax =
      lastVel.current.vx === 0 ? rawAx * 0.2 : (lastVel.current.ax || 0) * 0.85 + rawAx * 0.15;
    const ay =
      lastVel.current.vy === 0 ? rawAy * 0.2 : (lastVel.current.ay || 0) * 0.85 + rawAy * 0.15;

    const pressure = e.pressure !== undefined && e.pressure > 0 ? e.pressure * 4095 : 2048;
    const { x, y } = getCanvasCoordinates(e);

    if (currentStrokeRef.current) {
      currentStrokeRef.current.points.push({
        x: Number(x.toFixed(1)),
        y: Number(y.toFixed(1)),
        pressure: Math.round(pressure),
        t: now,
      });
      const canvas = canvasRef.current;
      onDigitizerEvent?.({
        x: Number(x.toFixed(1)),
        y: Number(y.toFixed(1)),
        pressure: Math.round(pressure),
        penDown: 1,
        mode: canvasMode,
        canvasWidth: canvas?.width || 800,
        canvasHeight: canvas?.height || 320,
        timestamp: now,
      });
      onStrokesChange?.(
        strokesRef.current,
        canvasMode,
        canvas?.width || 800,
        canvas?.height || 320
      );
    }

    const gx = Number(Math.max(-180, Math.min(180, vy * 120)).toFixed(2));
    const gy = Number(Math.max(-180, Math.min(180, -vx * 120)).toFixed(2));
    const gz = Number(Math.max(-180, Math.min(180, (ax - ay) * 18)).toFixed(2));

    const syntheticFrame = enrichSensorFrame({
      timestamp: now,
      ax,
      ay,
      az: 9.80665,
      gx,
      gy,
      gz,
      mx: 0,
      my: 0,
      mz: 0,
      fsr: pressure,
      touchX: x,
      touchY: y,
    });

    if (mode === 'touch') {
      onData(syntheticFrame);
    } else if (onTouchUpdate) {
      onTouchUpdate(x, y, pressure, syntheticFrame);
    }

    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    lastPos.current = { x: e.clientX, y: e.clientY, t: now };
    lastVel.current = { vx, vy, ax, ay };
  };

  const stopDrawingStroke = () => {
    if (isDrawing) {
      const canvas = canvasRef.current;
      const lastPt =
        currentStrokeRef.current?.points[currentStrokeRef.current.points.length - 1] ?? null;
      onDigitizerEvent?.({
        x: lastPt ? lastPt.x : (canvas?.width || 800) / 2,
        y: lastPt ? lastPt.y : (canvas?.height || 320) / 2,
        pressure: 0,
        penDown: 0,
        mode: canvasMode,
        canvasWidth: canvas?.width || 800,
        canvasHeight: canvas?.height || 320,
        timestamp: Date.now(),
      });
      setIsDrawing(false);
      onDrawingStateChange?.(false);
      onStrokesChange?.(
        strokesRef.current,
        canvasMode,
        canvas?.width || 800,
        canvas?.height || 320
      );
    }
    currentStrokeRef.current = null;
    lastPos.current = null;
    lastVel.current = null;
  };

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 bg-slate-950 p-6 flex flex-col'
          : 'bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-lg p-4 mb-6 flex flex-col shadow-2xs'
      }
    >
      {/* Top Header & Mode Switcher */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-100">
              {t('touchPadTitle')}
            </h2>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
              ·
            </span>
            <span
              data-testid="canvas-measurement-status"
              className={`text-xs font-mono tabular-nums font-medium ${
                isDrawing
                  ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {isReplaying || (replayStrokes && replayStrokes.length > 0)
                ? `● Replay Preview (${strokesRef.current.length} saved ${strokesRef.current.length === 1 ? 'stroke' : 'strokes'})`
                : isFusionTestActive
                ? isDrawing || externalPenPoint?.penDown === 1
                  ? `● 90s Fusion Active · On-Paper (pen_down = 1 · ${sampleCount} pts)`
                  : `○ 90s Fusion Active · In-Air Resting (pen_up = 0 · ${sampleCount} pts)`
                : isDrawing
                ? `● Measuring Active Stroke (${sampleCount} pts)`
                : sampleCount > 0
                ? `○ Stroke Paused (${sampleCount} pts captured — draw to continue or save section)`
                : '○ Standby — Draw on Spiral or Free-Draw Canvas to Start Measurement'}
            </span>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
            {isReplaying || (replayStrokes && replayStrokes.length > 0)
              ? 'Showing replayed session drawing. Click Clear Replay to reset the canvas and return to live testing.'
              : isFusionTestActive
              ? 'Dual-stream t = 0 fusion active: capturing both in-air resting tremor (pen_up) and on-paper kinetic strokes (pen_down) for 200 Hz post-completion analysis.'
              : 'Tremor measurement activates strictly while you draw on the trackpad canvas below and pauses when the pen lifts.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Guided Spiral vs. Blank Free-Draw Segmented Toggle */}
          <div
            role="group"
            aria-label="Trackpad Canvas Mode"
            className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700 text-xs"
          >
            <button
              type="button"
              onClick={() => handleSwitchMode('spiral')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                canvasMode === 'spiral'
                  ? 'bg-white text-slate-900 dark:bg-slate-700 dark:text-white font-semibold shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Compass size={13} />
              <span>Guided Spiral</span>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchMode('freedraw')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                canvasMode === 'freedraw'
                  ? 'bg-white text-slate-900 dark:bg-slate-700 dark:text-white font-semibold shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Edit3 size={13} />
              <span>Blank Free-Draw</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-md transition-colors flex-shrink-0 border border-slate-200 dark:border-slate-700"
            title={isFullscreen ? t('exitFullscreen') : t('enterFullscreen')}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {/* Interactive Drawing Surface */}
      <div
        className={`w-full ${
          isFullscreen ? 'flex-1' : 'h-80'
        } bg-slate-950 rounded-lg overflow-hidden border border-slate-800 cursor-crosshair min-h-0 relative`}
      >
        {!hasDrawn && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center pointer-events-none z-10">
            <div className="bg-slate-900/90 border border-slate-700 text-slate-200 text-xs px-3 py-1 rounded shadow-md flex items-center space-x-2 font-mono">
              <span className="text-sky-400">●</span>
              <span>
                {canvasMode === 'spiral'
                  ? t('traceSpiralHint')
                  : 'Press & draw freely with your pen or trackpad to start tremor measurement'}
              </span>
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={800}
          height={320}
          className="w-full h-full touch-none block"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrawingStroke}
          onPointerLeave={stopDrawingStroke}
          onPointerCancel={stopDrawingStroke}
        />
      </div>

      {/* Bottom Action Bar: Record / Save Drawing Section / Clear Canvas */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
          {sampleCount >= 12
            ? `Ready to save complete section (${sampleCount} sensor pts + ${strokesRef.current.length} drawing ${strokesRef.current.length === 1 ? 'stroke' : 'strokes'})`
            : `Draw on the ${canvasMode === 'spiral' ? 'spiral' : 'free-draw'} canvas (min 12 samples) to record a section`}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onToggleRecording && (
            <button
              type="button"
              onClick={onToggleRecording}
              className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                isRecording
                  ? 'bg-red-600 hover:bg-red-700 text-white font-semibold'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
              }`}
            >
              {isRecording ? (
                <>
                  <Square size={12} className="fill-current" />
                  <span>Stop & Save Recording</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-600" />
                  <span>Record Section</span>
                </>
              )}
            </button>
          )}

          {onSaveDrawingSession && (
            <button
              type="button"
              onClick={() => {
                onSaveDrawingSession();
                resetCanvasSurface(canvasMode);
              }}
              disabled={sampleCount < 12}
              className="px-3.5 py-1.5 bg-sky-700 hover:bg-sky-800 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors rounded-md text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
              title="Save drawing, all raw sensor readings, and all calculated tremor biomarkers as a recorded section"
            >
              <Save size={13} />
              <span>Save Drawing Session</span>
            </button>
          )}

          {(isReplaying || (replayStrokes && replayStrokes.length > 0)) && onClearReplay && (
            <button
              type="button"
              onClick={() => {
                resetCanvasSurface(canvasMode);
                onClearReplay();
              }}
              className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800 transition-colors rounded-md text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Trash2 size={13} />
              <span>Clear Replay</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              resetCanvasSurface(canvasMode);
              onClearData?.();
            }}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors rounded-md text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Trash2 size={13} />
            <span>{t('clearCanvas')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
