import { SensorData, enrichSensorFrame, parseUniversalTelemetryLine } from './serial';

export const BLE_SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
export const BLE_CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
export const BLE_BATTERY_SERVICE_UUID = "0000180f-0000-1000-8000-00805f9b34fb";
export const BLE_BATTERY_CHARACTERISTIC_UUID = "00002a19-0000-1000-8000-00805f9b34fb";

export interface BLEStats {
  packetsReceived: number;
  bytesReceived: number;
  lastPacketTime: number;
  sampleRateHz: number;
}

class BLEService {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private batteryCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private onDataCallback: ((data: SensorData) => void) | null = null;
  private onBatteryCallback: ((level: number) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private onDisconnectCallback: (() => void) | null = null;
  private onStatusCallback: ((status: string) => void) | null = null;
  private isConnecting: boolean = false;
  private isConnected: boolean = false;
  private boundDisconnectHandler: (() => void) | null = null;

  // Stream reassembly & telemetry buffer
  private streamBuffer: string = "";
  private packetsReceived: number = 0;
  private bytesReceived: number = 0;
  private lastPacketTime: number = 0;
  private packetTimes: number[] = [];

  getDeviceName(): string | undefined {
    return this.device?.name || (this.isConnected ? "NeuroTremor Pen" : undefined);
  }

  isDeviceConnected(): boolean {
    return this.isConnected && Boolean(this.server?.connected);
  }

  getStats(): BLEStats {
    const now = Date.now();
    // Filter packets in the last 1 second to calculate real-time sample rate
    const recent = this.packetTimes.filter((t) => now - t < 1000);
    return {
      packetsReceived: this.packetsReceived,
      bytesReceived: this.bytesReceived,
      lastPacketTime: this.lastPacketTime,
      sampleRateHz: recent.length,
    };
  }

  private notifyStatus(status: string) {
    if (this.onStatusCallback) {
      this.onStatusCallback(status);
    }
  }

  async connect(options?: { scanAll?: boolean }): Promise<boolean> {
    if (!("bluetooth" in navigator)) {
      throw new Error(
        "Web Bluetooth API is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Chrome for Android."
      );
    }

    try {
      this.isConnecting = true;
      this.streamBuffer = "";
      this.packetsReceived = 0;
      this.bytesReceived = 0;
      this.packetTimes = [];
      this.notifyStatus("Requesting Bluetooth device...");

      console.log("[BLE] Requesting Bluetooth device with options:", options);

      let device: BluetoothDevice;
      if (options?.scanAll) {
        // Broad scan fallback: shows all discoverable Bluetooth devices
        device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [
            BLE_SERVICE_UUID,
            BLE_BATTERY_SERVICE_UUID,
            "battery_service",
          ],
        });
      } else {
        // Targeted scan: matches by Service UUID or Name prefixes
        try {
          device = await navigator.bluetooth.requestDevice({
            filters: [
              { services: [BLE_SERVICE_UUID] },
              { name: "NeuroTremor Pen" },
              { namePrefix: "NeuroTremor" },
              { namePrefix: "Neuro" },
              { namePrefix: "ESP" },
            ],
            optionalServices: [
              BLE_SERVICE_UUID,
              BLE_BATTERY_SERVICE_UUID,
              "battery_service",
            ],
          });
        } catch (filterErr: any) {
          // If no device was found matching the filter, try acceptAllDevices fallback
          if (
            filterErr.name === "NotFoundError" &&
            !filterErr.message?.toLowerCase().includes("cancelled") &&
            !filterErr.message?.toLowerCase().includes("canceled")
          ) {
            console.log("[BLE] Filtered scan found no devices, retrying with acceptAllDevices...");
            this.notifyStatus("Scanning all Bluetooth devices...");
            device = await navigator.bluetooth.requestDevice({
              acceptAllDevices: true,
              optionalServices: [
                BLE_SERVICE_UUID,
                BLE_BATTERY_SERVICE_UUID,
                "battery_service",
              ],
            });
          } else {
            throw filterErr;
          }
        }
      }

      this.device = device;
      console.log("[BLE] Device selected:", device.name || "Unnamed Device", device.id);
      this.notifyStatus(`Device selected: ${device.name || "ESP32 Device"}`);

      // Bind and attach disconnect listener
      if (this.boundDisconnectHandler && this.device) {
        this.device.removeEventListener('gattserverdisconnected', this.boundDisconnectHandler);
      }
      this.boundDisconnectHandler = this.handleBluetoothDisconnect.bind(this);
      device.addEventListener('gattserverdisconnected', this.boundDisconnectHandler);

      if (!device.gatt) {
        throw new Error("GATT is not supported on the selected Bluetooth device.");
      }

      let telemetryService: BluetoothRemoteGATTService | null = null;
      let telemetryCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;

      // Resilient connection & service retrieval loop with exponential backoff
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          this.notifyStatus(`Connecting to GATT server (attempt ${attempt}/${maxRetries})...`);
          console.log(`[BLE] Connecting attempt ${attempt}/${maxRetries}...`);

          if (!this.server || !this.server.connected || !device.gatt.connected) {
            this.server = await device.gatt.connect();
            // Settling delay for host OS BLE stack to enumerate GATT handles
            await new Promise((res) => setTimeout(res, 400));
          }

          if (!this.server || !this.server.connected) {
            throw new Error("GATT server disconnected during handshake.");
          }

          this.notifyStatus("Discovering Telemetry service...");
          telemetryService = await this.server.getPrimaryService(BLE_SERVICE_UUID);
          console.log("[BLE] Telemetry service found!");

          this.notifyStatus("Retrieving Telemetry characteristic...");
          telemetryCharacteristic = await telemetryService.getCharacteristic(BLE_CHARACTERISTIC_UUID);
          console.log("[BLE] Telemetry characteristic found!");

          if (telemetryService && telemetryCharacteristic) {
            break;
          }
        } catch (attemptErr: any) {
          console.warn(`[BLE] Connection attempt ${attempt} warning:`, attemptErr.message || attemptErr);
          if (attempt === maxRetries) {
            throw attemptErr;
          }
          await new Promise((res) => setTimeout(res, 600 * attempt));
        }
      }

      if (!telemetryCharacteristic) {
        throw new Error(
          `Could not access Telemetry characteristic (${BLE_CHARACTERISTIC_UUID}). Verify ESP32 firmware is flashed and advertising.`
        );
      }

      this.notifyStatus("Subscribing to real-time data notifications...");
      await telemetryCharacteristic.startNotifications();
      telemetryCharacteristic.addEventListener(
        'characteristicvaluechanged',
        this.handleNotifications.bind(this)
      );
      this.characteristic = telemetryCharacteristic;
      console.log("[BLE] Telemetry notifications started successfully");

      // Optional standard battery service (0x180F)
      try {
        if (this.server && this.server.connected) {
          let batteryService: BluetoothRemoteGATTService | null = null;
          try {
            batteryService = await this.server.getPrimaryService(BLE_BATTERY_SERVICE_UUID);
          } catch {
            try {
              batteryService = await this.server.getPrimaryService('battery_service');
            } catch {
              // Not fatal
            }
          }

          if (batteryService) {
            let batteryChar: BluetoothRemoteGATTCharacteristic | null = null;
            try {
              batteryChar = await batteryService.getCharacteristic(BLE_BATTERY_CHARACTERISTIC_UUID);
            } catch {
              try {
                batteryChar = await batteryService.getCharacteristic('battery_level');
              } catch {
                // Ignore
              }
            }

            if (batteryChar) {
              this.batteryCharacteristic = batteryChar;
              try {
                const batteryValue = await (batteryChar as any).readValue();
                const level = batteryValue.getUint8(0);
                if (this.onBatteryCallback) this.onBatteryCallback(level);
              } catch (readErr) {
                console.warn("[BLE] Battery initial read notice:", readErr);
              }

              try {
                await batteryChar.startNotifications();
                batteryChar.addEventListener('characteristicvaluechanged', this.handleBatteryNotification.bind(this));
              } catch (notifyErr) {
                console.warn("[BLE] Battery notifications not supported:", notifyErr);
              }
            }
          }
        }
      } catch (batteryError) {
        console.warn("[BLE] Battery service skipped:", batteryError);
      }

      this.isConnected = true;
      this.isConnecting = false;
      this.notifyStatus("Connected & streaming!");

      console.log("=================================");
      console.log(" NeuroTremor BLE CONNECTED & STREAMING");
      console.log("=================================");

      return true;
    } catch (error: any) {
      this.isConnecting = false;
      this.isConnected = false;
      this.notifyStatus("Connection failed");
      console.error("[BLE] Connection failed:", error);
      throw error;
    }
  }

  async disconnect() {
    this.isConnecting = false;
    this.isConnected = false;
    this.streamBuffer = "";
    if (this.device && this.device.gatt?.connected) {
      try {
        this.device.gatt.disconnect();
      } catch (e) {
        console.warn("[BLE] Error disconnecting GATT:", e);
      }
    }
    this.server = null;
    this.characteristic = null;
    this.batteryCharacteristic = null;
    this.notifyStatus("Disconnected");
  }

  private handleBluetoothDisconnect() {
    console.warn("[BLE] Device disconnected unexpectedly");
    const wasConnected = this.isConnected;
    this.isConnecting = false;
    this.isConnected = false;
    this.streamBuffer = "";
    this.server = null;
    this.characteristic = null;
    this.batteryCharacteristic = null;

    if (this.onDisconnectCallback) {
      this.onDisconnectCallback();
    }
    if (wasConnected && this.onErrorCallback) {
      this.onErrorCallback("Bluetooth connection lost. Check ESP32 power or reconnect.");
    }
  }

  private handleBatteryNotification(event: Event) {
    const char = event.target as BluetoothRemoteGATTCharacteristic;
    if (!char || !char.value) return;
    const batteryLevel = char.value.getUint8(0);
    if (this.onBatteryCallback) this.onBatteryCallback(batteryLevel);
  }

  private handleNotifications(event: Event) {
    const char = event.target as BluetoothRemoteGATTCharacteristic;
    if (!char || !char.value) return;

    const now = Date.now();
    this.bytesReceived += char.value.byteLength;
    this.lastPacketTime = now;

    // 1. Binary Packet Detection: Magic Header 0xAA 0x55 (Fastest, zero MTU chunking needed)
    if (
      char.value.byteLength >= 16 &&
      char.value.getUint8(0) === 0xaa &&
      char.value.getUint8(1) === 0x55
    ) {
      this.parseBinaryPacket(char.value);
      return;
    }

    // 2. Text Stream: decode and reassemble 20-byte ESP32-S3 BLE GATT chunks until '\n'
    const decoder = new TextDecoder('utf-8');
    const chunk = decoder.decode(char.value);

    this.streamBuffer += chunk;

    if (this.streamBuffer.includes('\n')) {
      const lines = this.streamBuffer.split('\n');
      // Process all complete newline-terminated CSV/KV/JSON lines
      for (let i = 0; i < lines.length - 1; i++) {
        this.parseLine(lines[i]);
      }
      // Retain trailing uncompleted line fragment for next 20-byte chunk
      this.streamBuffer = lines[lines.length - 1];
    } else {
      // Direct parsing fallback if standalone un-chunked packet contains a full KV reading
      if (
        this.streamBuffer.includes('X:') &&
        this.streamBuffer.includes('Y:') &&
        this.streamBuffer.includes('Z:')
      ) {
        this.parseLine(this.streamBuffer);
        this.streamBuffer = "";
      } else if (this.streamBuffer.length > 512) {
        // Prevent buffer bloat if data is corrupted
        this.streamBuffer = "";
      }
    }
  }

  private recordFrameParsed() {
    const now = Date.now();
    this.packetsReceived++;
    this.lastPacketTime = now;
    this.packetTimes.push(now);
    if (this.packetTimes.length > 120) {
      this.packetTimes.shift();
    }
  }

  private parseBinaryPacket(dataView: DataView) {
    try {
      const rawAx = dataView.getInt16(2, true);
      const rawAy = dataView.getInt16(4, true);
      const rawAz = dataView.getInt16(6, true);

      const rawGx = dataView.getInt16(8, true);
      const rawGy = dataView.getInt16(10, true);
      const rawGz = dataView.getInt16(12, true);

      // Support both 16-byte (6-DOF + FSR) and 22-byte (9-DOF + FSR) binary packets
      let rawMx = 0;
      let rawMy = 0;
      let rawMz = 0;
      let rawFsr = 0;

      if (dataView.byteLength >= 22) {
        rawMx = dataView.getInt16(14, true) * 0.1;
        rawMy = dataView.getInt16(16, true) * 0.1;
        rawMz = dataView.getInt16(18, true) * 0.1;
        rawFsr = dataView.getUint16(20, true);
      } else {
        rawFsr = dataView.getUint16(14, true);
      }

      const mag = Math.sqrt(rawAx * rawAx + rawAy * rawAy + rawAz * rawAz);
      let scale = 1.0;
      if (mag > 150) {
        scale = 0.00980665;
      } else if (mag > 0.05 && mag < 3.5) {
        scale = 9.80665;
      }

      const sensorData = enrichSensorFrame({
        timestamp: Date.now(),
        ax: rawAx * scale,
        ay: rawAy * scale,
        az: rawAz * scale,
        gx: rawGx * 0.1,
        gy: rawGy * 0.1,
        gz: rawGz * 0.1,
        mx: rawMx,
        my: rawMy,
        mz: rawMz,
        fsr: rawFsr,
      });

      this.recordFrameParsed();
      if (this.onDataCallback) {
        this.onDataCallback(sensorData);
      }
    } catch (e) {
      // Ignore binary parse error
    }
  }

  private parseLine(line: string) {
    try {
      const sensorData = parseUniversalTelemetryLine(line);
      if (sensorData) {
        this.recordFrameParsed();
        if (this.onDataCallback) {
          this.onDataCallback(sensorData);
        }
      }
    } catch (e) {
      // Ignore line parse noise
    }
  }

  onData(callback: (data: SensorData) => void) {
    this.onDataCallback = callback;
  }

  onBattery(callback: (level: number) => void) {
    this.onBatteryCallback = callback;
  }

  onError(callback: (error: string) => void) {
    this.onErrorCallback = callback;
  }

  onDisconnect(callback: () => void) {
    this.onDisconnectCallback = callback;
  }

  onStatus(callback: (status: string) => void) {
    this.onStatusCallback = callback;
  }
}

export const bleService = new BLEService();

