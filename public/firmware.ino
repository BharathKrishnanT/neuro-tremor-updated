#include <Wire.h>
#include "ICM_20948.h" 
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// --- Pin Definitions for ESP32-S3 Mini ---
const int SCL_PIN = 12; // ICM-20948 SCL
const int SDA_PIN = 11; // ICM-20948 SDA
const int FSR_PIN = 13; // Force Sensitive Resistor (ADC)

ICM_20948_I2C myICM; 

// --- BLE UUIDs ---
#define SERVICE_UUID           "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID    "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define BATTERY_SERVICE_UUID   "0000180f-0000-1000-8000-00805f9b34fb"
#define BATTERY_LEVEL_UUID     "00002a19-0000-1000-8000-00805f9b34fb"

BLEServer* pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;
BLECharacteristic* pBatteryCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;
bool streamingActive = false;
unsigned long connectTime = 0;
uint8_t batteryLevel = 98;

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      connectTime = millis();
      streamingActive = false;
      Serial.println("[BLE] Connected");
    };

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      streamingActive = false;
      Serial.println("[BLE] Disconnected");
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
        Serial.println("[BLE] Notifications enabled by client");
      } else {
        streamingActive = false;
        Serial.println("[BLE] Notifications disabled");
      }
    }
};

// EMA Filter configuration: optimized for human tremor (3-12 Hz) while rejecting high-frequency ADC jitter
float emaAlphaIMU = 0.10;
float emaAlphaFSR = 0.08;
float f_ax = 0, f_ay = 0, f_az = 0;
float f_gx = 0, f_gy = 0, f_gz = 0;
float f_fsr = 0;
bool firstReading = true;
int fsrBaseline = 0;

void setup() {
  delay(1500);
  Serial.begin(115200);

  // 1. I2C Initialization on requested pins (SCL: 12, SDA: 11)
  Wire.begin(SDA_PIN, SCL_PIN, 400000);

  // 2. ICM-20948 Auto-detection (0x69 or 0x68)
  bool initialized = false;
  myICM.begin(Wire, 1); // Try 0x69
  if (myICM.status == ICM_20948_Stat_Ok) {
    initialized = true;
  } else {
    myICM.begin(Wire, 0); // Try 0x68
    if (myICM.status == ICM_20948_Stat_Ok) {
      initialized = true;
    }
  }

  if (!initialized) {
    Serial.println("ICM-20948 Initialization Failed! Verify wiring: SCL->12, SDA->11");
  } else {
    Serial.println("ICM-20948 Online");
  }

  // 3. FSR Setup (Pin 13)
  pinMode(FSR_PIN, INPUT_PULLDOWN);
  analogReadResolution(12);
  
  long fsrSum = 0;
  for (int i = 0; i < 50; i++) {
    fsrSum += analogRead(FSR_PIN);
    delay(10);
  }
  fsrBaseline = fsrSum / 50;

  // 4. BLE Initialization
  BLEDevice::init("NeuroTremor Pen");
  BLEDevice::setMTU(256);

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
                    );
  BLE2902* pTelemetry2902 = new BLE2902();
  pTelemetry2902->setCallbacks(new Telemetry2902Callbacks());
  pCharacteristic->addDescriptor(pTelemetry2902);
  pService->start();

  // Battery Service
  BLEService *pBatteryService = pServer->createService(BATTERY_SERVICE_UUID);
  pBatteryCharacteristic = pBatteryService->createCharacteristic(
                             BATTERY_LEVEL_UUID,
                             BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
                           );
  pBatteryCharacteristic->addDescriptor(new BLE2902());
  pBatteryCharacteristic->setValue(&batteryLevel, 1);
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

  Serial.println("Ready to Stream (USB Serial + BLE)");
}

void loop() {
  if (!deviceConnected && oldDeviceConnected) {
    delay(300);
    pServer->startAdvertising();
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
    streamingActive = true;
    Serial.println("[BLE] Streaming Active!");
  }

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

  pinMode(FSR_PIN, INPUT_PULLDOWN);
  float rawFsr = analogRead(FSR_PIN) - fsrBaseline;
  if (rawFsr < 0) rawFsr = 0;

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

  int finalFsr = (f_fsr < 120) ? 0 : (int)f_fsr;

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

  // USB Serial Output
  Serial.println(payload);

  // BLE Output in <= 20-byte chunks with '\n' to prevent truncation on MTU 23
  if (deviceConnected && (streamingActive || (millis() - connectTime > 800))) {
    String blePayload = payload + "\n";
    int totalLen = blePayload.length();
    for (int offset = 0; offset < totalLen; offset += 20) {
      int chunkLen = min(20, totalLen - offset);
      pCharacteristic->setValue((uint8_t*)(blePayload.c_str() + offset), chunkLen);
      pCharacteristic->notify();
      delay(2);
    }
  }

  delay(18); // ~50 Hz sampling rate
}
