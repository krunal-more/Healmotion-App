HealMotion - Real ESP32 Interface

Open:
  index.html

Default ESP32:
  Wi-Fi SSID: HealMotion_ESP32
  IP: 192.168.4.1
  WebSocket: ws://192.168.4.1/ws

Important:
  This interface has no demo mode and no fake health values.
  Live values remain -- until ESP32 telemetry is received.

Default first-use passwords:
  Admin: admin123
  Movement: 1234

Change both from Admin Panel before final demonstration.

Arduino firmware:
  firmware/HealMotion_ESP32/HealMotion_ESP32.ino

Arduino libraries:
  ESP32 board package
  WebSockets by Markus Sattler / Links2004
  ArduinoJson
  SparkFun MAX3010x Sensor Library
  Adafruit MLX90614 Library
  Adafruit BusIO
