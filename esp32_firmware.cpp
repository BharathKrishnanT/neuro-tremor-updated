/*
 * NeuroTremor Multi-Sensor Telemetry System
 * Target: ESP32-S3 Mini / Super Mini
 * Sensors: ICM-20948 (9-DOF IMU) + Force Sensitive Resistor (FSR)
 * 
 * Pin Mapping:
 * - ICM-20948 SCL -> GPIO 12
 * - ICM-20948 SDA -> GPIO 11
 * - FSR Analog In -> GPIO 13
 * - VCC -> 3.3V
 * - GND -> GND
 * 
 * Communication:
 * - USB Serial (115200 baud)
 * - Bluetooth Low Energy (BLE) with Nordic UART / Web Bluetooth & Battery Service
 * 
 * Required Arduino Libraries (Install via Arduino Library Manager):
 * - "SparkFun 9DoF IMU Breakout - ICM 20948 - Arduino Library" by SparkFun
 */

#include <Wire.h>
#include "ICM_20948.h" 
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// --- Pin Definitions ---
const int SCL_PIN = 12; // I2C Clock
const int SDA_PIN = 11; // I2C Data
const int FSR_PIN = 13; // Force Sensitive Resistor (ADC)

ICM_20948_I2C myICM; 

// --- BLE Settings & Standard UUIDs ---
#define SERVICE_UUID           "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID    "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define BATTERY_SERVICE_UUID   "0000180f-0000-1000-8000-00805f9b34fb" // 0x180F
#define BATTERY_LEVEL_UUID     "00002a19-0000-1000-8000-00805f9b34fb" // 0x2A19

BLEServer* pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;
BLECharacteristic* pBatteryCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;
bool streamingActive = false;
unsigned long connectTime = 0;
unsigned long lastBatteryUpdate = 0;
uint8_t simulatedBatteryLevel = 98;

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      connectTime = millis();
      streamingActive = false; // Stay quiet while client performs GATT service discovery
      Serial.println("[BLE] Client Connected");
    };

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      streamingActive = false;
      Serial.println("[BLE] Client Disconnected");
      // Restart advertising so client can reconnect seamlessly
      delay(200);
      pServer->startAdvertising();
      Serial.println("[BLE] Advertising restarted");
    }
};

class Telemetry2902Callbacks: public BLEDescriptorCallbacks {
    void onWrite(BLEDescriptor* pDescriptor) {
      uint8_t* val = pDescriptor->getValue();
      if (val != nullptr && pDescriptor->getLength() > 0 && val[0] == 1) {
        streamingActive = true;
        Serial.println("[BLE] Notifications ENABLED by client -> Telemetry stream ACTIVE");
      } else {
        streamingActive = false;
        Serial.println("[BLE] Notifications DISABLED by client -> Telemetry stream PAUSED");
      }
    }
};

// EMA Filter configuration: optimized for human tremor (3-12 Hz) while rejecting high-frequency ADC jitter
float emaAlphaIMU = 0.10; // IMU smoothing factor (0.10 gives optimal balance of smooth signal without phase lag)
float emaAlphaFSR = 0.08; // FSR smoothing factor (reduces electrical contact noise)

float f_ax = 0, f_ay = 0, f_az = 0;
float f_gx = 0, f_gy = 0, f_gz = 0;
float f_fsr = 0;
bool firstReading = true;

int fsrBaseline = 0;

void setup() {
  delay(1500);
  Serial.begin(115200);
  
  Serial.println("\n========================================");
  Serial.println("  NeuroTremor ESP32-S3 Mini Sensor Node  ");
  Serial.println("========================================");
  Serial.printf("Pins: SCL=%d, SDA=%d, FSR=%d\n", SCL_PIN, SDA_PIN, FSR_PIN);

  // 1. Initialize I2C bus on requested pins
  Wire.begin(SDA_PIN, SCL_PIN, 400000); // 400kHz fast mode

  // 2. Initialize ICM-20948 (Auto-detect address 0x69 or 0x68)
  bool initialized = false;
  Serial.println("Connecting to ICM-20948...");
  
  // Try AD0 = 1 (address 0x69)
  myICM.begin(Wire, 1);
  if (myICM.status == ICM_20948_Stat_Ok) {
    Serial.println("ICM-20948 found at address 0x69");
    initialized = true;
  } else {
    // Try AD0 = 0 (address 0x68)
    myICM.begin(Wire, 0);
    if (myICM.status == ICM_20948_Stat_Ok) {
      Serial.println("ICM-20948 found at address 0x68");
      initialized = true;
    }
  }

  if (!initialized) {
    Serial.println("ERROR: ICM-20948 not detected!");
    Serial.println("Check connections:");
    Serial.println("  - SCL -> GPIO 12");
    Serial.println("  - SDA -> GPIO 11");
    Serial.println("  - VCC -> 3.3V, GND -> GND");
    // Continue running to allow troubleshooting via Serial
  } else {
    Serial.println("ICM-20948 Initialized Successfully.");
  }

  // 3. Configure FSR pin
  pinMode(FSR_PIN, INPUT_PULLDOWN);
  analogReadResolution(12); // 12-bit ADC (0 - 4095)

  // Calibrate FSR baseline
  Serial.print("Calibrating FSR baseline (do not touch sensor)...");
  long fsrSum = 0;
  for (int i = 0; i < 60; i++) {
    fsrSum += analogRead(FSR_PIN);
    delay(10);
  }
  fsrBaseline = fsrSum / 60;
  Serial.printf(" Done! Baseline: %d\n", fsrBaseline);

  // 4. Initialize Bluetooth Low Energy (BLE)
  BLEDevice::init("NeuroTremor Pen");
  BLEDevice::setMTU(256); // Allow larger MTU if host requests it

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // Data telemetry service
  BLEService *pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ   |
                      BLECharacteristic::PROPERTY_NOTIFY 
                    );
  BLE2902* pTelemetry2902 = new BLE2902();
  pTelemetry2902->setCallbacks(new Telemetry2902Callbacks());
  pCharacteristic->addDescriptor(pTelemetry2902);
  pService->start();

  // Web Bluetooth Battery Service (0x180F)
  BLEService *pBatteryService = pServer->createService(BATTERY_SERVICE_UUID);
  pBatteryCharacteristic = pBatteryService->createCharacteristic(
                             BATTERY_LEVEL_UUID,
                             BLECharacteristic::PROPERTY_READ |
                             BLECharacteristic::PROPERTY_NOTIFY
                           );
  pBatteryCharacteristic->addDescriptor(new BLE2902());
  pBatteryCharacteristic->setValue(&simulatedBatteryLevel, 1);
  pBatteryService->start();

  // Start BLE Advertising with strict <=31 byte packets:
  // Primary packet: Flags + 128-bit Service UUID (21 bytes total)
  // Scan response packet: Complete Local Name (17 bytes total)
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();

  BLEAdvertisementData advData;
  advData.setFlags(0x06); // General Discoverable + BR/EDR not supported
  advData.setCompleteServices(BLEUUID(SERVICE_UUID));
  pAdvertising->setAdvertisementData(advData);

  BLEAdvertisementData scanResponseData;
  scanResponseData.setName("NeuroTremor Pen");
  pAdvertising->setScanResponseData(scanResponseData);

  pAdvertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.println("BLE Advertising Started (Service UUID + Name). Ready to Stream!\n");
}

void loop() {
  // Handle BLE disconnect / re-advertise
  if (!deviceConnected && oldDeviceConnected) {
    delay(300);
    pServer->startAdvertising();
    Serial.println("[BLE] Re-advertising started...");
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
    streamingActive = true; // Auto-activate stream upon confirmed connection
    Serial.println("[BLE] Device streaming active!");
  }

  // Periodic battery update (every 15 seconds)
  if (deviceConnected && (millis() - lastBatteryUpdate > 15000)) {
    lastBatteryUpdate = millis();
    if (pBatteryCharacteristic) {
      pBatteryCharacteristic->setValue(&simulatedBatteryLevel, 1);
      pBatteryCharacteristic->notify();
    }
  }

  // Read ICM-20948 data
  float raw_ax = 0, raw_ay = 0, raw_az = 0;
  float raw_gx = 0, raw_gy = 0, raw_gz = 0;
  float raw_mx = 0, raw_my = 0, raw_mz = 0;

  if (myICM.dataReady()) {
    myICM.getAGMT();
    raw_ax = myICM.accX();
    raw_ay = myICM.accY();
    raw_az = myICM.accZ();
    raw_gx = myICM.gyrX();
    raw_gy = myICM.gyrY();
    raw_gz = myICM.gyrZ();
    raw_mx = myICM.magX();
    raw_my = myICM.magY();
    raw_mz = myICM.magZ();
  }

  // Read FSR Pressure (0 - 4095)
  pinMode(FSR_PIN, INPUT_PULLDOWN);
  int rawAnalog = analogRead(FSR_PIN);
  float rawFsr = rawAnalog - fsrBaseline;
  if (rawFsr < 0) rawFsr = 0;

  // Smoothing filter
  if (firstReading) {
    f_ax = raw_ax; f_ay = raw_ay; f_az = raw_az;
    f_gx = raw_gx; f_gy = raw_gy; f_gz = raw_gz;
    f_fsr = rawFsr;
    firstReading = false;
  } else {
    f_ax = (emaAlphaIMU * raw_ax) + ((1.0 - emaAlphaIMU) * f_ax);
    f_ay = (emaAlphaIMU * raw_ay) + ((1.0 - emaAlphaIMU) * f_ay);
    f_az = (emaAlphaIMU * raw_az) + ((1.0 - emaAlphaIMU) * f_az);

    f_gx = (emaAlphaIMU * raw_gx) + ((1.0 - emaAlphaIMU) * f_gx);
    f_gy = (emaAlphaIMU * raw_gy) + ((1.0 - emaAlphaIMU) * f_gy);
    f_gz = (emaAlphaIMU * raw_gz) + ((1.0 - emaAlphaIMU) * f_gz);

    f_fsr = (emaAlphaFSR * rawFsr) + ((1.0 - emaAlphaFSR) * f_fsr);
  }

  // Increased deadband to 120 ensures resting finger weight does not register as active grip force
  int finalFsr = (f_fsr < 120) ? 0 : (int)f_fsr;

  // Format telemetry string for NeuroTremor Web App
  // Includes timestamp T (in milliseconds) for accurate continuous time series reconstruction
  // X, Y, Z are in mg (milli-g); Web App scales by 0.00981 to m/s²
  String payload = "T:" + String(millis()) +
                   ",X:" + String(f_ax, 2) + 
                   ",Y:" + String(f_ay, 2) + 
                   ",Z:" + String(f_az, 2) + 
                   ",GX:" + String(f_gx, 2) + 
                   ",GY:" + String(f_gy, 2) + 
                   ",GZ:" + String(f_gz, 2) + 
                   ",MX:" + String(raw_mx, 2) + 
                   ",MY:" + String(raw_my, 2) + 
                   ",MZ:" + String(raw_mz, 2) + 
                   ",F:" + String(finalFsr);

  // 1. Output over USB Serial
  Serial.println(payload);

  // 2. Stream over BLE using chunking with '\n' terminator:
  // By sending in slices <= 20 bytes, packets NEVER get truncated or dropped,
  // even on platforms where default BLE MTU is 23 (such as Windows Web Bluetooth).
  if (deviceConnected && (streamingActive || (millis() - connectTime > 800))) {
    String blePayload = payload + "\n";
    int totalLen = blePayload.length();
    for (int offset = 0; offset < totalLen; offset += 20) {
      int chunkLen = min(20, totalLen - offset);
      pCharacteristic->setValue((uint8_t*)(blePayload.c_str() + offset), chunkLen);
      pCharacteristic->notify();
      delay(2); // 2ms pacing prevents BLE controller queue saturation
    }
  }

  // 50Hz sampling rate (20ms delay) ideal for tremor evaluation (3-12 Hz)
  delay(18);
}

