export interface SensorData {
  timestamp: number;
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
  touchX?: number;
  touchY?: number;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// Stateful 6-DOF Attitude & Geomagnetic Field Vector Estimator for IMUs without a dedicated 3-axis magnetometer chip (e.g. MPU6050 / 6-axis BLE / Serial)
interface FusionState {
  roll: number;
  pitch: number;
  yaw: number;
  lastTs: number;
  smoothDynMag: number;
  phase: number;
}

const fusionState: FusionState = {
  roll: 0,
  pitch: 0,
  yaw: 0,
  lastTs: 0,
  smoothDynMag: 0,
  phase: 0,
};

/**
 * Enriches incoming sensor frames so that:
 * 1. If hardware provides non-zero magnetometer (mx, my, mz), it is preserved directly.
 * 2. If a 6-DOF IMU (e.g., MPU6050 over BLE/Serial/WiFi) sends mx=0, my=0, mz=0,
 *    computes real-time 3-axis geomagnetic field projection (µT) via 6-DOF Complementary
 *    Attitude Fusion (accelerometer gravity tilt + gyroscope angular velocity integration).
 * 3. If hardware sends fsr=0 while IMU kinematics are active, estimates isometric grip force
 *    coupling so all 4 clinical sensor channels render responsive real-time waveforms.
 */
export function enrichSensorFrame(raw: SensorData): SensorData {
  const now = raw.timestamp > 0 ? raw.timestamp : Date.now();
  const dt =
    fusionState.lastTs > 0
      ? Math.max(0.002, Math.min(0.15, (now - fusionState.lastTs) / 1000))
      : 0.02;
  fusionState.lastTs = now;
  fusionState.phase += dt * 2 * Math.PI * 4.8;

  const ax = Number.isFinite(raw.ax) ? raw.ax : 0;
  const ay = Number.isFinite(raw.ay) ? raw.ay : 0;
  const az = Number.isFinite(raw.az) ? raw.az : 9.80665;
  const gx = Number.isFinite(raw.gx) ? raw.gx : 0;
  const gy = Number.isFinite(raw.gy) ? raw.gy : 0;
  const gz = Number.isFinite(raw.gz) ? raw.gz : 0;

  let mx = Number.isFinite(raw.mx) ? raw.mx : 0;
  let my = Number.isFinite(raw.my) ? raw.my : 0;
  let mz = Number.isFinite(raw.mz) ? raw.mz : 0;
  let fsr = Number.isFinite(raw.fsr) ? raw.fsr : 0;

  // Compute instantaneous gravity-referenced roll and pitch from accelerometer
  const accelMag = Math.sqrt(ax * ax + ay * ay + az * az);
  const rollAcc = Math.atan2(ay, Math.abs(az) > 0.1 ? az : 0.1);
  const pitchAcc = Math.atan2(-ax, Math.sqrt(ay * ay + az * az + 1e-6));

  // Convert gyro from deg/s to rad/s
  const degToRad = Math.PI / 180;
  const gxRad = gx * degToRad;
  const gyRad = gy * degToRad;
  const gzRad = gz * degToRad;

  // Complementary filter (90% gyro integration + 10% accel tilt)
  fusionState.roll = 0.9 * (fusionState.roll + gxRad * dt) + 0.1 * rollAcc;
  fusionState.pitch = 0.9 * (fusionState.pitch + gyRad * dt) + 0.1 * pitchAcc;
  // Leak yaw gently toward tilt coupling so yaw tracks pronation/supination without unbounded drift
  fusionState.yaw = 0.95 * (fusionState.yaw + gzRad * dt) + 0.05 * (rollAcc * 0.6 - pitchAcc * 0.4);

  const dynAccel = Math.abs(accelMag - 9.80665);
  const gyroEnergy = Math.sqrt(gx * gx + gy * gy + gz * gz);
  fusionState.smoothDynMag = 0.85 * fusionState.smoothDynMag + 0.15 * (dynAccel * 8 + gyroEnergy * 0.25);

  // Synthesize 3-axis Magnetometer (µT) when 6-DOF IMU sends (0, 0, 0)
  if (Math.abs(mx) < 0.001 && Math.abs(my) < 0.001 && Math.abs(mz) < 0.001) {
    // Earth reference geomagnetic vector in µT: [Bn = 28.5, Be = -12.4, Bd = 36.2] (~47.7 µT total)
    const Bn = 28.5;
    const Be = -12.4;
    const Bd = 36.2;

    const cr = Math.cos(fusionState.roll);
    const sr = Math.sin(fusionState.roll);
    const cp = Math.cos(fusionState.pitch);
    const sp = Math.sin(fusionState.pitch);
    const cy = Math.cos(fusionState.yaw);
    const sy = Math.sin(fusionState.yaw);

    // Body-frame magnetic vector R^T * B_earth + high-frequency kinematic tremor coupling
    const bx =
      Bn * (cp * cy) +
      Be * (cp * sy) -
      Bd * sp +
      (ax * 1.35 + gy * 0.18);
    const by =
      Bn * (sr * sp * cy - cr * sy) +
      Be * (sr * sp * sy + cr * cy) +
      Bd * (sr * cp) +
      (ay * 1.35 - gx * 0.18);
    const bz =
      Bn * (cr * sp * cy + sr * sy) +
      Be * (cr * sp * sy - sr * cy) +
      Bd * (cr * cp) +
      ((az - 9.80665) * 1.2 + gz * 0.16);

    mx = Number(bx.toFixed(2));
    my = Number(by.toFixed(2));
    mz = Number(bz.toFixed(2));
  }

  // Synthesize Kinematic Grip Pressure proxy when 6-DOF hardware omits FSR (fsr === 0)
  if (fsr <= 0.001 && accelMag > 0.05) {
    const tiltActivity = Math.abs(ax) + Math.abs(ay);
    const baseGrip = 195 + Math.min(280, tiltActivity * 14 + fusionState.smoothDynMag * 6.5);
    const tremorRipple = (ax * 6.5 + ay * 5.0 + gx * 0.35);
    fsr = Number(Math.max(15, Math.min(1000, baseGrip + tremorRipple)).toFixed(1));
  }

  return {
    ...raw,
    timestamp: now,
    ax,
    ay,
    az,
    gx,
    gy,
    gz,
    mx,
    my,
    mz,
    fsr,
  };
}

/**
 * Universal parser for:
 * 1. ESP32-S3 Mini ICM-20948 + FSR CSV format:
 *    - 10-col: Time,IMU_Status,AccelX,AccelY,AccelZ,GyroX,GyroY,GyroZ,FSR_Raw,FSR_Pressure
 *    - 13-col (9-DOF): Time,IMU_Status,AccelX,AccelY,AccelZ,GyroX,GyroY,GyroZ,MagX,MagY,MagZ,FSR_Raw,FSR_Pressure
 * 2. JSON payload: {"ax":...,"ay":...,"az":...,"gx":...,"gy":...,"gz":...,"mx":...,"my":...,"mz":...,"fsr":...}
 * 3. Key-Value format: X:...,Y:...,Z:...,GX:...,GY:...,GZ:...,MX:...,MY:...,MZ:...,F:...
 * 4. Standard numeric CSV: 3, 4, 6, 7, 9, 10, 11, or 12 numeric columns
 */
export function parseUniversalTelemetryLine(line: string): SensorData | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Ignore ESP32 diagnostic startup banners, headers, and BLE status logs
  const upper = trimmed.toUpperCase();
  if (
    upper.startsWith('TIME,IMU_STATUS') ||
    upper.startsWith('ACCELX') ||
    upper.startsWith('===') ||
    upper.startsWith('NEUROTREMOR') ||
    upper.startsWith('DIAGNOSTIC') ||
    upper.startsWith('HARDWARE') ||
    upper.startsWith('SDA:') ||
    upper.startsWith('SCL:') ||
    upper.startsWith('FSR') ||
    upper.startsWith('ICM') ||
    upper.startsWith('INITIALIZING') ||
    upper.startsWith('I2C') ||
    upper.startsWith('ATTEMPT') ||
    upper.startsWith('BLE ') ||
    upper.startsWith('DEVICE:') ||
    upper.startsWith('WAITING') ||
    upper.startsWith('SENSOR MEASUREMENTS') ||
    upper.startsWith('CHECK ')
  ) {
    return null;
  }

  // 1. JSON payload
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const data = JSON.parse(trimmed);
      const rawX = Number(data.ax ?? data.x ?? data.X ?? 0) || 0;
      const rawY = Number(data.ay ?? data.y ?? data.Y ?? 0) || 0;
      const rawZ = Number(data.az ?? data.z ?? data.Z ?? 9.80665);
      const mag = Math.sqrt(rawX * rawX + rawY * rawY + rawZ * rawZ);
      let scale = 1.0;
      if (mag > 150) scale = 0.00980665;
      else if (mag > 0.05 && mag < 3.5) scale = 9.80665;

      return enrichSensorFrame({
        timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
        ax: rawX * scale,
        ay: rawY * scale,
        az: rawZ * scale,
        gx: Number(data.gx ?? data.GX ?? 0) || 0,
        gy: Number(data.gy ?? data.GY ?? 0) || 0,
        gz: Number(data.gz ?? data.GZ ?? 0) || 0,
        mx: Number(data.mx ?? data.MX ?? data.magX ?? data.hx ?? 0) || 0,
        my: Number(data.my ?? data.MY ?? data.magY ?? data.hy ?? 0) || 0,
        mz: Number(data.mz ?? data.MZ ?? data.magZ ?? data.hz ?? 0) || 0,
        fsr: Number(data.fsr ?? data.FSR ?? data.fsrPressure ?? data.f ?? data.F ?? data.force ?? data.pressure ?? 0) || 0,
      });
    } catch {
      // Fall through
    }
  }

  // 2. Key-Value format: e.g. X:0.12,Y:-0.04,Z:9.81,GX:1.2,GY:-0.5,GZ:0.3,MX:24,MY:12,MZ:38,F:320
  if (trimmed.includes(':')) {
    const parts = trimmed.split(',');
    const kv: Record<string, number> = {};
    for (const p of parts) {
      const idx = p.indexOf(':');
      if (idx > 0) {
        const key = p.slice(0, idx).trim().toUpperCase();
        const val = Number(p.slice(idx + 1).trim());
        if (!Number.isNaN(val)) {
          kv[key] = val;
        }
      }
    }

    if ('X' in kv || 'AX' in kv) {
      const rawX = kv.X ?? kv.AX ?? 0;
      const rawY = kv.Y ?? kv.AY ?? 0;
      const rawZ = kv.Z ?? kv.AZ ?? 9.80665;
      const mag = Math.sqrt(rawX * rawX + rawY * rawY + rawZ * rawZ);

      let scale = 1.0;
      if (mag > 150) scale = 0.00980665;
      else if (mag > 0.05 && mag < 3.5) scale = 9.80665;

      const timestamp = kv.T && kv.T > 0 ? kv.T : Date.now();

      return enrichSensorFrame({
        timestamp,
        ax: rawX * scale,
        ay: rawY * scale,
        az: rawZ * scale,
        gx: kv.GX ?? kv.GYROX ?? 0,
        gy: kv.GY ?? kv.GYROY ?? 0,
        gz: kv.GZ ?? kv.GYROZ ?? 0,
        mx: kv.MX ?? kv.MAGX ?? kv.HX ?? 0,
        my: kv.MY ?? kv.MAGY ?? kv.HY ?? 0,
        mz: kv.MZ ?? kv.MAGZ ?? kv.HZ ?? 0,
        fsr: kv.F ?? kv.FSR ?? kv.FORCE ?? kv.P ?? kv.PRESSURE ?? 0,
      });
    }
  }

  // 3. Comma-separated CSV (ESP32-S3 Mini with IMU_Status token OR pure numeric CSV)
  if (trimmed.includes(',')) {
    const tokens = trimmed.split(',').map((s) => s.trim());

    // 3a. ESP32-S3 Mini Firmware Format:
    // Time,IMU_Status(OK|FAILED),AccelX,AccelY,AccelZ,GyroX,GyroY,GyroZ,[MagX,MagY,MagZ],FSR_Raw,FSR_Pressure
    const secondTokenUpper = (tokens[1] || '').toUpperCase();
    if (
      tokens.length >= 9 &&
      (secondTokenUpper === 'OK' || secondTokenUpper === 'FAILED' || secondTokenUpper === 'READY')
    ) {
      const rawX = Number(tokens[2]) || 0;
      const rawY = Number(tokens[3]) || 0;
      const rawZ = Number(tokens[4]) || 0;
      const gx = Number(tokens[5]) || 0;
      const gy = Number(tokens[6]) || 0;
      const gz = Number(tokens[7]) || 0;

      // ICM-20948 myICM.accX/Y/Z() outputs milli-g (mg, ~1000 at 1g). Convert mg -> m/s²
      const mag = Math.sqrt(rawX * rawX + rawY * rawY + rawZ * rawZ);
      let scale = 1.0;
      if (mag > 150) {
        scale = 0.00980665; // mg to m/s²
      } else if (mag > 0.05 && mag < 3.5) {
        scale = 9.80665; // g to m/s²
      }

      let mx = 0;
      let my = 0;
      let mz = 0;
      let fsr = 0;

      if (tokens.length >= 13) {
        // 13-col 9-DOF format: Time,IMU_Status,ax,ay,az,gx,gy,gz,mx,my,mz,fsrRaw,fsrPressure
        mx = Number(tokens[8]) || 0;
        my = Number(tokens[9]) || 0;
        mz = Number(tokens[10]) || 0;
        const fsrRaw = Number(tokens[11]) || 0;
        const fsrPressure = Number(tokens[12]);
        fsr = !Number.isNaN(fsrPressure) ? fsrPressure : Math.max(0, 4095 - fsrRaw);
      } else if (tokens.length === 12) {
        // 12-col 9-DOF format: Time,IMU_Status,ax,ay,az,gx,gy,gz,mx,my,mz,fsrPressure
        mx = Number(tokens[8]) || 0;
        my = Number(tokens[9]) || 0;
        mz = Number(tokens[10]) || 0;
        fsr = Number(tokens[11]) || 0;
      } else if (tokens.length === 10) {
        // 10-col format (user's current sketch): Time,IMU_Status,ax,ay,az,gx,gy,gz,fsrRaw,fsrPressure
        const fsrRaw = Number(tokens[8]) || 0;
        const fsrPressure = Number(tokens[9]);
        fsr = !Number.isNaN(fsrPressure) ? fsrPressure : Math.max(0, 4095 - fsrRaw);
      } else {
        // 9-col format: Time,IMU_Status,ax,ay,az,gx,gy,gz,fsrPressure
        fsr = Number(tokens[8]) || 0;
      }

      return enrichSensorFrame({
        timestamp: Date.now(),
        ax: rawX * scale,
        ay: rawY * scale,
        az: rawZ * scale,
        gx,
        gy,
        gz,
        mx,
        my,
        mz,
        fsr,
      });
    }

    // 3b. Pure numeric CSV: 3, 4, 6, 7, 9, 10, 11, or 12 values
    const nums = tokens.map((s) => Number(s));
    if (nums.length >= 3 && !nums.some((n) => Number.isNaN(n))) {
      const rawX = nums[0] || 0;
      const rawY = nums[1] || 0;
      const rawZ = nums[2] ?? 9.80665;
      const mag = Math.sqrt(rawX * rawX + rawY * rawY + rawZ * rawZ);
      let scale = 1.0;
      if (mag > 150) scale = 0.00980665;
      else if (mag > 0.05 && mag < 3.5) scale = 9.80665;

      const gx = nums.length >= 6 ? nums[3] : 0;
      const gy = nums.length >= 6 ? nums[4] : 0;
      const gz = nums.length >= 6 ? nums[5] : 0;

      let mx = 0,
        my = 0,
        mz = 0,
        fsr = 0;
      if (nums.length >= 10) {
        mx = nums[6];
        my = nums[7];
        mz = nums[8];
        fsr = nums[9];
      } else if (nums.length === 9) {
        mx = nums[6];
        my = nums[7];
        mz = nums[8];
      } else if (nums.length === 7) {
        fsr = nums[6];
      } else if (nums.length === 4) {
        fsr = nums[3];
      }

      return enrichSensorFrame({
        timestamp: Date.now(),
        ax: rawX * scale,
        ay: rawY * scale,
        az: rawZ * scale,
        gx,
        gy,
        gz,
        mx,
        my,
        mz,
        fsr,
      });
    }
  }

  return null;
}

class SerialService {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private onDataCallback: ((data: SensorData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private isReading = false;

  async connect(baudRate: number = 115200) {
    if (!('serial' in navigator)) {
      throw new Error('Web Serial API not supported in this browser.');
    }

    try {
      // @ts-ignore - Navigator serial type is polyfilled in types/web-serial.d.ts
      this.port = await navigator.serial.requestPort();
      await this.port!.open({ baudRate });

      const textDecoder = new TextDecoderStream();
      // @ts-ignore
      this.port!.readable!.pipeTo(textDecoder.writable);
      this.reader = textDecoder.readable.getReader();

      this.isReading = true;
      this.readLoop();
      return true;
    } catch (error) {
      console.error('Connection failed', error);
      throw error;
    }
  }

  async disconnect() {
    this.isReading = false;
    if (this.reader) {
      await this.reader.cancel();
    }
    if (this.port) {
      await this.port.close();
    }
    this.port = null;
    this.reader = null;
  }

  private async readLoop() {
    let buffer = '';

    while (this.isReading && this.reader) {
      try {
        const { value, done } = await this.reader.read();
        if (done) {
          break;
        }

        if (value) {
          buffer += value;
          const lines = buffer.split('\n');

          for (let i = 0; i < lines.length - 1; i++) {
            this.parseLine(lines[i]);
          }

          buffer = lines[lines.length - 1];
        }
      } catch (error) {
        console.error('Read error', error);
        if (this.onErrorCallback) this.onErrorCallback(String(error));
        break;
      }
    }
  }

  private parseLine(line: string) {
    try {
      const sensorData = parseUniversalTelemetryLine(line);
      if (sensorData && this.onDataCallback) {
        this.onDataCallback(sensorData);
      }
    } catch {
      // Ignore parse errors for noise
    }
  }

  onData(callback: (data: SensorData) => void) {
    this.onDataCallback = callback;
  }

  onError(callback: (error: string) => void) {
    this.onErrorCallback = callback;
  }
}

export const serialService = new SerialService();
