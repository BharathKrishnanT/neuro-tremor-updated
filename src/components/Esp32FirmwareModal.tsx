import React, { useState } from 'react';
import { X, Copy, Check, Download, Cpu, Terminal } from 'lucide-react';

interface Esp32FirmwareModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ESP32_S3_9DOF_FIRMWARE = `/*
 * NEUROTREMOR PEN
 * 9-DOF Diagnostic + BLE Telemetry Firmware
 *
 * Target: ESP32-S3 Mini
 * Sensors: ICM-20948 (Accel + Gyro + AK09916 Magnetometer) + FSR
 *
 * FINAL PIN CONFIGURATION:
 * SDA_PIN = GPIO 11
 * SCL_PIN = GPIO 12
 * FSR_PIN = GPIO 1
 * AD0_VAL = 1 (0x69)
 *
 * Output:
 * USB Serial: 115200 baud
 * BLE GATT Notifications (20-byte chunked CSV)
 * Nominal sampling interval: 20 ms (50 Hz)
 */

#include <Wire.h>
#include "ICM_20948.h"

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ==================================================
// 1. PIN CONFIGURATION
// ==================================================

#define SDA_PIN 11
#define SCL_PIN 12
#define FSR_PIN 1

#define AD0_VAL 1

// ==================================================
// 2. SENSOR CONFIGURATION
// ==================================================

#define ADC_MAX 4095
#define FSR_SAMPLES 10

#define SAMPLE_INTERVAL_MS 20

// false = Direct ADC reading
// true  = Inverted ADC reading
#define FSR_INVERT false

ICM_20948_I2C myICM;

bool imuInitialized = false;

// 9-DOF IMU data (Accel + Gyro + Magnetometer)
float ax = 0.0; // milli-g (mg)
float ay = 0.0; // milli-g (mg)
float az = 0.0; // milli-g (mg)

float gx = 0.0; // deg/s (DPS)
float gy = 0.0; // deg/s (DPS)
float gz = 0.0; // deg/s (DPS)

float mx = 0.0; // microteslas (uT) - AK09916 Magnetometer
float my = 0.0; // microteslas (uT)
float mz = 0.0; // microteslas (uT)

// ==================================================
// 3. BLE UUID CONFIGURATION
// ==================================================

#define SERVICE_UUID \\
"4fafc201-1fb5-459e-8fcc-c5c9c331914b"

#define CHARACTERISTIC_UUID \\
"beb5483e-36e1-4688-b7f5-ea07361b26a8"

#define BATTERY_SERVICE_UUID \\
"0000180f-0000-1000-8000-00805f9b34fb"

#define BATTERY_LEVEL_UUID \\
"00002a19-0000-1000-8000-00805f9b34fb"

// ==================================================
// 4. BLE OBJECTS
// ==================================================

BLEServer* pServer = nullptr;

BLECharacteristic* pCharacteristic = nullptr;

BLECharacteristic* pBatteryCharacteristic = nullptr;

volatile bool deviceConnected = false;
volatile bool streamingActive = false;

bool oldDeviceConnected = false;

unsigned long lastBatteryUpdate = 0;

// Simulated battery level
uint8_t simulatedBatteryLevel = 98;

// ==================================================
// 5. BLE SERVER CALLBACKS
// ==================================================

class MyServerCallbacks : public BLEServerCallbacks {

  void onConnect(BLEServer* server) {

    deviceConnected = true;
    streamingActive = false;

    Serial.println("BLE CLIENT CONNECTED");
  }

  void onDisconnect(BLEServer* server) {

    deviceConnected = false;
    streamingActive = false;

    Serial.println("BLE CLIENT DISCONNECTED");
  }
};

// ==================================================
// 6. BLE NOTIFICATION CALLBACK
// ==================================================

class Telemetry2902Callbacks : public BLEDescriptorCallbacks {

  void onWrite(BLEDescriptor* descriptor) {

    uint8_t* value = descriptor->getValue();

    size_t length = descriptor->getLength();

    if (value != nullptr &&
        length >= 2 &&
        (value[0] & 0x01)) {

      streamingActive = true;

      Serial.println("BLE STREAM ENABLED");
    }
    else {

      streamingActive = false;

      Serial.println("BLE STREAM DISABLED");
    }
  }
};

// ==================================================
// 7. FSR SENSOR READING
// ==================================================

int readFSR() {

  long total = 0;

  for (int i = 0; i < FSR_SAMPLES; i++) {

    total += analogRead(FSR_PIN);

    delayMicroseconds(200);
  }

  return total / FSR_SAMPLES;
}

// ==================================================
// 8. FSR PRESSURE PROCESSING
// ==================================================

int calculateFSRPressure(int fsrRaw) {

  int pressure;

#if FSR_INVERT

  pressure = ADC_MAX - fsrRaw;

#else

  pressure = fsrRaw;

#endif

  return constrain(pressure, 0, ADC_MAX);
}

// ==================================================
// 9. ICM-20948 9-DOF INITIALIZATION
// ==================================================

void initializeIMU() {

  Serial.println();
  Serial.println("INITIALIZING ICM-20948 (9-DOF + MAGNETOMETER)...");

  for (int attempt = 1; attempt <= 5; attempt++) {

    myICM.begin(Wire, AD0_VAL);

    Serial.print("Attempt ");
    Serial.print(attempt);
    Serial.print(": ");

    Serial.println(myICM.statusString());

    if (myICM.status == ICM_20948_Stat_Ok) {

      imuInitialized = true;

      // Enable onboard AK09916 3-axis magnetometer
      myICM.startupMagnetometer();

      break;
    }

    delay(500);
  }

  if (imuInitialized) {

    Serial.println("ICM-20948 READY");
  }
  else {

    Serial.println("ICM-20948 INITIALIZATION FAILED");

    Serial.println("Check SDA, SCL, AD0, VCC and GND.");
  }
}

// ==================================================
// 10. BLE INITIALIZATION
// ==================================================

void initializeBLE() {

  Serial.println();
  Serial.println("INITIALIZING BLE...");

  BLEDevice::init("NeuroTremor Pen");

  BLEDevice::setMTU(256);

  pServer = BLEDevice::createServer();

  pServer->setCallbacks(
    new MyServerCallbacks()
  );

  // ----------------------------------------------
  // TELEMETRY SERVICE
  // ----------------------------------------------

  BLEService* pService =
    pServer->createService(SERVICE_UUID);

  pCharacteristic =
    pService->createCharacteristic(
      CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ |
      BLECharacteristic::PROPERTY_NOTIFY
    );

  BLE2902* telemetryDescriptor = new BLE2902();

  telemetryDescriptor->setCallbacks(
    new Telemetry2902Callbacks()
  );

  pCharacteristic->addDescriptor(
    telemetryDescriptor
  );

  pService->start();

  // ----------------------------------------------
  // BATTERY SERVICE
  // ----------------------------------------------

  BLEService* pBatteryService =
    pServer->createService(BATTERY_SERVICE_UUID);

  pBatteryCharacteristic =
    pBatteryService->createCharacteristic(
      BATTERY_LEVEL_UUID,
      BLECharacteristic::PROPERTY_READ |
      BLECharacteristic::PROPERTY_NOTIFY
    );

  pBatteryCharacteristic->addDescriptor(
    new BLE2902()
  );

  pBatteryCharacteristic->setValue(
    &simulatedBatteryLevel,
    1
  );

  pBatteryService->start();

  // ----------------------------------------------
  // BLE ADVERTISING
  // ----------------------------------------------

  BLEAdvertising* advertising =
    BLEDevice::getAdvertising();

  BLEAdvertisementData advData;

  advData.setFlags(0x06);

  advData.setCompleteServices(
    BLEUUID(SERVICE_UUID)
  );

  advertising->setAdvertisementData(advData);

  BLEAdvertisementData scanData;

  scanData.setName("NeuroTremor Pen");

  advertising->setScanResponseData(scanData);

  advertising->setScanResponse(true);

  BLEDevice::startAdvertising();

  Serial.println("BLE INITIALIZED");

  Serial.println("Device: NeuroTremor Pen");

  Serial.println("Waiting for connection...");
}

// ==================================================
// 11. BLE CONNECTION MANAGEMENT
// ==================================================

void manageBLEConnection() {

  if (!deviceConnected && oldDeviceConnected) {

    delay(300);

    pServer->startAdvertising();

    oldDeviceConnected = false;

    Serial.println("BLE ADVERTISING RESTARTED");
  }

  if (deviceConnected && !oldDeviceConnected) {

    oldDeviceConnected = true;

    Serial.println("BLE CONNECTION ACTIVE");
  }
}

// ==================================================
// 12. BATTERY SERVICE UPDATE
// ==================================================

void updateBatteryService() {

  unsigned long now = millis();

  if (deviceConnected &&
      now - lastBatteryUpdate >= 15000) {

    lastBatteryUpdate = now;

    if (pBatteryCharacteristic != nullptr) {

      pBatteryCharacteristic->setValue(
        &simulatedBatteryLevel,
        1
      );

      pBatteryCharacteristic->notify();
    }
  }
}

// ==================================================
// 13. BLE TELEMETRY TRANSMISSION
// ==================================================

void sendBLETelemetry(const char* csvLine) {

  if (!deviceConnected || !streamingActive) {

    return;
  }

  if (pCharacteristic == nullptr) {

    return;
  }

  char payload[220];

  int written = snprintf(
    payload,
    sizeof(payload),
    "%s\\n",
    csvLine
  );

  if (written <= 0 ||
      written >= (int)sizeof(payload)) {

    return;
  }

  size_t totalLength = strlen(payload);

  const size_t CHUNK_SIZE = 20;

  for (size_t offset = 0;
       offset < totalLength;
       offset += CHUNK_SIZE) {

    if (!deviceConnected || !streamingActive) {

      break;
    }

    size_t remaining = totalLength - offset;

    size_t chunkLength =
      (remaining > CHUNK_SIZE)
      ? CHUNK_SIZE
      : remaining;

    pCharacteristic->setValue(
      (uint8_t*)(payload + offset),
      chunkLength
    );

    pCharacteristic->notify();

    delay(2);
  }
}

// ==================================================
// 14. SENSOR ACQUISITION (9-DOF + FSR)
// ==================================================

void acquireSensors() {

  // ----------------------------------------------
  // READ 9-DOF IMU (ACCEL + GYRO + MAGNETOMETER)
  // ----------------------------------------------

  if (imuInitialized && myICM.dataReady()) {

    myICM.getAGMT();

    ax = myICM.accX();
    ay = myICM.accY();
    az = myICM.accZ();

    gx = myICM.gyrX();
    gy = myICM.gyrY();
    gz = myICM.gyrZ();

    mx = myICM.magX();
    my = myICM.magY();
    mz = myICM.magZ();
  }

  // ----------------------------------------------
  // READ FSR
  // ----------------------------------------------

  int fsrRaw = readFSR();

  int fsrPressure = calculateFSRPressure(fsrRaw);

  // ----------------------------------------------
  // FORMAT CSV (13 COLUMNS)
  // ----------------------------------------------

  unsigned long currentMillis = millis();

  const char* imuStatus =
    imuInitialized ? "OK" : "FAILED";

  char csvLine[200];

  snprintf(
    csvLine,
    sizeof(csvLine),
    "%lu,%s,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.2f,%.2f,%.2f,%d,%d",
    currentMillis,
    imuStatus,
    ax,
    ay,
    az,
    gx,
    gy,
    gz,
    mx,
    my,
    mz,
    fsrRaw,
    fsrPressure
  );

  // USB SERIAL
  Serial.println(csvLine);

  // BLE TELEMETRY
  sendBLETelemetry(csvLine);
}

// ==================================================
// 15. SETUP
// ==================================================

void setup() {

  Serial.begin(115200);

  delay(2000);

  Serial.println();

  Serial.println("======================================");
  Serial.println("       NEUROTREMOR PEN");
  Serial.println("  9-DOF DIAGNOSTIC + BLE TELEMETRY");
  Serial.println("======================================");

  // I2C INITIALIZATION
  Wire.begin(SDA_PIN, SCL_PIN);

  Wire.setClock(400000);

  Serial.println("I2C INITIALIZED");

  // FSR ADC INITIALIZATION
  analogReadResolution(12);

  analogSetPinAttenuation(
    FSR_PIN,
    ADC_11db
  );

  pinMode(FSR_PIN, INPUT);

  Serial.println("FSR ADC INITIALIZED");

  // IMU INITIALIZATION
  initializeIMU();

  // BLE INITIALIZATION
  initializeBLE();

  // CSV HEADER
  Serial.println();

  Serial.println(
    "Time,IMU_Status,AccelX,AccelY,AccelZ,"
    "GyroX,GyroY,GyroZ,MagX,MagY,MagZ,FSR_Raw,FSR_Pressure"
  );

  Serial.println("SENSOR MEASUREMENTS STARTED");

  lastBatteryUpdate = millis();
}

// ==================================================
// 16. MAIN LOOP
// ==================================================

void loop() {

  manageBLEConnection();

  updateBatteryService();

  static unsigned long lastSampleTime = 0;

  unsigned long currentTime = millis();

  if (currentTime - lastSampleTime >=
      SAMPLE_INTERVAL_MS) {

    lastSampleTime = currentTime;

    acquireSensors();
  }
}
`;

export const Esp32FirmwareModal: React.FC<Esp32FirmwareModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(ESP32_S3_9DOF_FIRMWARE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {}
  };

  const handleDownload = () => {
    const blob = new Blob([ESP32_S3_9DOF_FIRMWARE], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'NeuroTremor_ESP32S3_ICM20948_9DOF.ino';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-4xl w-full max-h-[88vh] flex flex-col shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 flex items-center justify-center text-sky-700 dark:text-sky-400">
              <Cpu size={16} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                ESP32-S3 Mini Firmware · 9-DOF ICM-20948 + FSR (USB Serial & BLE)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                SDA: GPIO 11 · SCL: GPIO 12 · FSR: GPIO 1 · ICM-20948: 0x69 (AD0=1) · 50 Hz
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-sky-700 hover:bg-sky-800 text-white transition-colors"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? 'Copied Sketch' : 'Copy Sketch'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <Download size={14} />
              <span>Download .ino</span>
            </button>
            <button
              onClick={onClose}
              aria-label="Close Firmware Modal"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-sky-600 dark:text-sky-400 shrink-0" />
            <span>
              Enables <code className="font-mono text-slate-800 dark:text-slate-200">myICM.startupMagnetometer()</code> and outputs <code className="font-mono text-slate-800 dark:text-slate-200">mx, my, mz</code> (µT) alongside <code className="font-mono text-slate-800 dark:text-slate-200">ax, ay, az</code> (mg), <code className="font-mono text-slate-800 dark:text-slate-200">gx, gy, gz</code> (°/s), and <code className="font-mono text-slate-800 dark:text-slate-200">fsrPressure</code> (0–4095).
            </span>
          </div>
          <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
            Backward-compatible with 10-column & 13-column CSV
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-slate-950 text-slate-100 font-mono text-xs leading-relaxed">
          <pre className="whitespace-pre-wrap select-all">{ESP32_S3_9DOF_FIRMWARE}</pre>
        </div>
      </div>
    </div>
  );
};
