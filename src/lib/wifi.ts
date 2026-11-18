import { SensorData, parseUniversalTelemetryLine } from './serial';

class WiFiService {
  private ws: WebSocket | null = null;
  private onDataCallback: ((data: SensorData) => void) | null = null;
  private onErrorCallback: ((err: string) => void) | null = null;
  private onDisconnectCallback: (() => void) | null = null;
  
  // Default IP for ESP32 Access Point
  private ip = '192.168.4.1'; 
  private port = 81;

  // Validate IPv4 or local hostname
  private isValidHost(host: string): boolean {
    if (!host || typeof host !== 'string') return false;
    const trimmed = host.trim();
    if (trimmed.length > 255) return false;
    // IPv4 pattern: 4 octets 0-255
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipMatch = trimmed.match(ipv4Regex);
    if (ipMatch) {
      return ipMatch.slice(1, 5).every(octet => {
        const num = parseInt(octet, 10);
        return num >= 0 && num <= 255 && String(num) === octet;
      });
    }
    // Local hostname / mDNS pattern (e.g., esp32.local or localhost)
    const hostRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return hostRegex.test(trimmed);
  }

  async connect(ipAddress?: string) {
    if (ipAddress) {
      const sanitized = ipAddress.trim();
      if (!this.isValidHost(sanitized)) {
        throw new Error("Invalid IP address or hostname format.");
      }
      this.ip = sanitized;
    }

    return new Promise<void>((resolve, reject) => {
      try {
        // NOTE: If the app is hosted on HTTPS, modern browsers will block
        // a connection to an insecure ws:// address due to Mixed Content policies.
        // For testing WiFi out of the box, we recommend running this app locally
        // via "npm run dev" or using localhost.
        this.ws = new WebSocket(`ws://${this.ip}:${this.port}/`);

        this.ws.onopen = () => {
          console.log("WebSocket connected to", this.ip);
          resolve();
        };

        this.ws.onmessage = (event) => {
          const data = event.data;
          this.parseData(data);
        };

        this.ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          if (this.onErrorCallback) this.onErrorCallback("WebSocket error. Ensure you are connected to the ESP32 WiFi network and your browser allows insecure websockets (mixed content).");
          reject(error);
        };

        this.ws.onclose = () => {
          console.log("WebSocket connection closed");
          if (this.onDisconnectCallback) this.onDisconnectCallback();
        };

      } catch (err: any) {
        reject(err);
      }
    });
  }

  private parseData(text: string) {
    try {
      const lines = String(text).split('\n');
      for (const line of lines) {
        const sensorData = parseUniversalTelemetryLine(line);
        if (sensorData && this.onDataCallback) {
          this.onDataCallback(sensorData);
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  onData(callback: (data: SensorData) => void) {
    this.onDataCallback = callback;
  }

  onError(callback: (err: string) => void) {
    this.onErrorCallback = callback;
  }
  
  onDisconnect(callback: () => void) {
    this.onDisconnectCallback = callback;
  }
}

export const wifiService = new WiFiService();
