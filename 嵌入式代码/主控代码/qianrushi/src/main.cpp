#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <esp_timer.h>

// ========== 舵机配置 ==========
#define SERVO_PIN        19
#define LEDC_CHANNEL     0
#define LEDC_TIMER       0
#define LEDC_FREQ        50
#define LEDC_RES         12

// ========== 步进电机配置 ==========
#define EN_PIN           4
#define STEP_PIN         5
#define DIR_PIN          6

// ========== UART配置 ==========
HardwareSerial uartSerial(1);
#define UART_RX_PIN 13
#define UART_TX_PIN 12
#define BAUD_RATE   115200

// ========== DHT11 和激光配置 ==========
#define DHT11_PIN   16
#define LASER_PIN   18
#define RECV_PIN    17

// ========== 蓝牙配置 ==========
#define BLE_DEVICE_NAME "ESP32_BLE_Device"
#define SERVICE_UUID "0000ffe0-0000-1000-8000-00805f9b34fb"
#define CHARACTERISTIC_UUID "0000ffe1-0000-1000-8000-00805f9b34fb"
#define LED_PIN 2

// ========== 天气 API 配置 ==========
const char* WEATHER_API_URL = "http://apis.juhe.cn/simpleWeather/query";
const char* WEATHER_API_KEY = "183c1abe49ee112e2275ef6ad535e591";

// ========== OneNET MQTT 配置 ==========
const char* mqtt_server   = "mqtts.heclouds.com";
const int   mqtt_port     = 1883;
const char* product_id    = "Qzi8cVS19V";
const char* device_name   = "ESP";
const char* token         = "version=2018-10-31&res=products%2FQzi8cVS19V%2Fdevices%2FESP&et=1814862645&method=md5&sign=Q4D%2BrOhnAlXY%2Fp8vSc7DWQ%3D%3D";
const char* property_topic = "$sys/Qzi8cVS19V/ESP/thing/property/post";

// ========== 统计数据 ==========
int total = 0;
int grate = 0;
int bad = 0;
const int REPORT_INTERVAL = 10;
int lastReportedTotal = 0;

// ========== 舵机状态 ==========
int current_angle = 0;           
int target_angle = 0;            
int bad_count = 0;               
unsigned long action_time = 0;
bool pending = false;
unsigned long ignore_until = 0;
bool servo_moving = false;

// ========== 舵机平滑移动 ==========
unsigned long last_servo_update = 0;
const int SERVO_STEP = 5;        
const int SERVO_DELAY = 8;       

// ========== 激光状态 ==========
bool laser_blocked = false;
unsigned long last_laser_check = 0;
const unsigned long LASER_CHECK_INTERVAL = 100;

// ========== 蓝牙状态 ==========
BLEServer* pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;
bool configReceived = false;
bool isProcessing = false;
bool shouldConnectWiFi = false;

// ========== WiFi/MQTT 客户端 ==========
WiFiClient espClient;
PubSubClient mqttClient(espClient);

// ========== 配置数据结构 ==========
struct ConfigData {
  char cityPinyin[64];
  char cityChinese[64];
  char ssid[64];
  char password[64];
  bool isValid;
} receivedConfig;

// ========== 天气数据结构 ==========
struct WeatherData {
  char city[64];
  char temperature[16];
  char humidity[16];
  char info[32];
  char infoEn[32];
  bool isValid;
} weatherData;

// ========== 温湿度数据 ==========
int lastTemp = 0;
int lastHum = 0;
bool hasWeatherData = false;
bool weatherUploaded = false;

// ========== 步进电机定时器 ==========
esp_timer_handle_t step_timer = NULL;

// ========== 函数声明 ==========
void setupStepMotor();
void IRAM_ATTR step_timer_callback(void* arg);
void setServoAngle(int angle);
int angleToDuty(int angle);
void processGrade(uint8_t grade);
void resetCounters();
void smoothServoMove();
void moveServoTo(int angle);
bool readDHT11(int* temp, int* hum);
void delay_us_esp(uint32_t us);
void readTemperatureHumidity();
void checkLaserStatus();
void parseConfigData(const char* jsonStr);
bool connectWiFi(const char* ssid, const char* password);
bool queryWeather(const char* city);
bool connectMQTT();
void publishWeatherToONETEN();
void publishCocoonDataToONETEN();
void sendResponse(const char* message);
void connectWiFiAndStart();
const char* mapPinyinToChinese(const char* pinyin);
const char* translateWeatherToEnglish(const char* weatherChinese);

// ========== 步进电机定时器回调 ==========
void IRAM_ATTR step_timer_callback(void* arg) {
  static bool step_state = false;
  step_state = !step_state;
  digitalWrite(STEP_PIN, step_state);
}

// ========== 步进电机初始化 ==========
void setupStepMotor() {
  Serial.println("⚙️ 初始化步进电机...");
  pinMode(EN_PIN, OUTPUT);
  pinMode(STEP_PIN, OUTPUT);
  pinMode(DIR_PIN, OUTPUT);
  digitalWrite(EN_PIN, LOW);   // 使能
  digitalWrite(DIR_PIN, LOW);  // 方向
  digitalWrite(STEP_PIN, LOW);
  
  // 创建定时器，每25微秒触发一次
  const esp_timer_create_args_t timer_args = {
    .callback = &step_timer_callback,
    .arg = NULL,
    .dispatch_method = ESP_TIMER_TASK,
    .name = "step_timer"
  };
  
  esp_timer_create(&timer_args, &step_timer);
  esp_timer_start_periodic(step_timer, 25);
  Serial.println("✅ 步进电机已启动 (定时器模式)");
}

// ========== 舵机辅助函数 ==========
int angleToDuty(int angle) {
  if (angle < 0) angle = 0;
  if (angle > 180) angle = 180;
  float pulse = (angle / 180.0) * 2.0 + 0.5;
  int duty = (pulse / 20.0) * ((1 << LEDC_RES) - 1);
  return duty;
}

void setServoAngle(int angle) {
  if (angle < 0) angle = 0;
  if (angle > 180) angle = 180;
  int duty = angleToDuty(angle);
  ledcWrite(LEDC_CHANNEL, duty);
}

void moveServoTo(int angle) {
  if (angle < 0) angle = 0;
  if (angle > 180) angle = 180;
  target_angle = angle;
  servo_moving = true;
  Serial.printf("🔄 舵机转向: %d°\n", angle);
}

void smoothServoMove() {
  if (millis() - last_servo_update < SERVO_DELAY) return;
  
  if (servo_moving && current_angle != target_angle) {
    if (abs(current_angle - target_angle) <= SERVO_STEP) {
      current_angle = target_angle;
      servo_moving = false;
      Serial.printf("✅ 舵机到达: %d°\n", current_angle);
    } else if (current_angle < target_angle) {
      current_angle += SERVO_STEP;
    } else {
      current_angle -= SERVO_STEP;
    }
    setServoAngle(current_angle);
    last_servo_update = millis();
  }
}

// ========== 处理坏茧 ==========
void handleBadCocoon() {
  if (millis() < ignore_until) return;
  ignore_until = millis() + 800;

  bad_count++;
  int new_target;
  if (bad_count % 2 == 1) {
    new_target = 180;
  } else {
    new_target = 0;
  }

  action_time = millis() + 2300;
  pending = true;
  Serial.printf("❌ 坏茧 #%d，%.1f秒后转向 %d°\n", bad_count, 2.3, new_target);
}

// ========== 处理等级 ==========
void processGrade(uint8_t grade) {
  if (grade == 1) {
    grate++;
    Serial.printf("🌟 好茧 (特级) - 好茧总数: %d\n", grate);
  } else if (grade == 2) {
    Serial.println("⚠️ 次茧 - 忽略");
    return;
  } else if (grade == 3) {
    bad++;
    Serial.printf("💀 坏茧 (劣质) - 坏茧总数: %d\n", bad);
    handleBadCocoon();
  } else {
    Serial.printf("❓ 未知等级: %d\n", grade);
    return;
  }

  total++;
  Serial.printf("📊 统计: 总=%d, 好=%d, 坏=%d\n", total, grate, bad);

  if (total - lastReportedTotal >= REPORT_INTERVAL) {
    lastReportedTotal = total;
    Serial.println("📤 上报蚕茧数据到OneNET...");
    publishCocoonDataToONETEN();
  }
}

void resetCounters() {
  grate = 0;
  bad = 0;
  total = 0;
  lastReportedTotal = 0;
  Serial.println("🔄 计数器已重置");
}

// ========== DHT11 相关函数 ==========
void delay_us_esp(uint32_t us) {
  uint64_t start = esp_timer_get_time();
  while (esp_timer_get_time() - start < us) {}
}

bool readDHT11(int* temp, int* hum) {
  uint8_t data[5] = {0};
  uint8_t i = 0, j = 0;
  
  pinMode(DHT11_PIN, OUTPUT);
  digitalWrite(DHT11_PIN, LOW);
  delay(20);
  digitalWrite(DHT11_PIN, HIGH);
  delay_us_esp(30);
  
  pinMode(DHT11_PIN, INPUT_PULLUP);
  
  uint64_t timeout = esp_timer_get_time() + 100000;
  while (digitalRead(DHT11_PIN) == HIGH) {
    if (esp_timer_get_time() > timeout) return false;
  }
  while (digitalRead(DHT11_PIN) == LOW) {
    if (esp_timer_get_time() > timeout) return false;
  }
  while (digitalRead(DHT11_PIN) == HIGH) {
    if (esp_timer_get_time() > timeout) return false;
  }
  
  for (i = 0; i < 5; i++) {
    for (j = 0; j < 8; j++) {
      while (digitalRead(DHT11_PIN) == LOW) {
        if (esp_timer_get_time() > timeout) return false;
      }
      delay_us_esp(30);
      if (digitalRead(DHT11_PIN) == HIGH) {
        data[i] |= (1 << (7 - j));
      }
      while (digitalRead(DHT11_PIN) == HIGH) {
        if (esp_timer_get_time() > timeout) return false;
      }
    }
  }
  
  if ((data[0] + data[1] + data[2] + data[3]) != data[4]) {
    return false;
  }
  
  *hum = (int)data[0];
  *temp = (int)data[2];
  return true;
}

void readTemperatureHumidity() {
  static unsigned long last_read = 0;
  if (millis() - last_read < 5000) return;
  
  int temp = 0;
  int hum = 0;
  
  if (readDHT11(&temp, &hum)) {
    lastTemp = temp;
    lastHum = hum;
    Serial.printf("🌡️ 温度: %d°C, 湿度: %d%%\n", temp, hum);
  } else {
    Serial.println("❌ DHT11读取失败");
  }
  last_read = millis();
}

// ========== 激光检测 ==========
void checkLaserStatus() {
  if (millis() - last_laser_check < LASER_CHECK_INTERVAL) return;
  last_laser_check = millis();
  
  bool current_status = digitalRead(RECV_PIN);
  if (current_status == LOW) {
    if (laser_blocked) {
      Serial.println("🔦 激光信号恢复");
    }
    laser_blocked = false;
  } else {
    if (!laser_blocked) {
      Serial.println("🚫 激光被遮挡！");
    }
    laser_blocked = true;
  }
}

// ========== 蓝牙回调类 ==========
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      Serial.println("📱 蓝牙设备已连接");
    };

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      Serial.println("📱 蓝牙设备已断开");
      BLEDevice::getAdvertising()->start();
      Serial.println("📡 重新开始蓝牙广播");
    }
};

class MyCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      std::string value = pCharacteristic->getValue();
      if (value.length() > 0 && value.length() < 512) {
        char buffer[512];
        strncpy(buffer, value.c_str(), sizeof(buffer) - 1);
        buffer[sizeof(buffer) - 1] = '\0';
        Serial.printf("📩 收到蓝牙配置: %s\n", buffer);
        parseConfigData(buffer);
      }
    }
};

// ========== 城市映射 ==========
const char* mapPinyinToChinese(const char* pinyin) {
  struct CityMap {
    const char* pinyin;
    const char* chinese;
  };
  
  static const CityMap cityMap[] = {
    {"hangzhou", "杭州"}, {"beijing", "北京"}, {"shanghai", "上海"},
    {"guangzhou", "广州"}, {"shenzhen", "深圳"}, {"chengdu", "成都"},
    {"wuhan", "武汉"}, {"nanjing", "南京"}, {"chongqing", "重庆"},
    {"xian", "西安"}, {"tianjin", "天津"}, {"suzhou", "苏州"}
  };
  
  String pinyinLower = String(pinyin);
  pinyinLower.toLowerCase();
  
  for (int i = 0; i < sizeof(cityMap) / sizeof(cityMap[0]); i++) {
    if (pinyinLower == cityMap[i].pinyin) {
      return cityMap[i].chinese;
    }
  }
  return pinyin;
}

// ========== 天气翻译 ==========
const char* translateWeatherToEnglish(const char* weatherChinese) {
  struct WeatherMap {
    const char* chinese;
    const char* english;
  };
  
  static const WeatherMap weatherMap[] = {
    {"晴", "sunny"}, {"多云", "cloudy"}, {"阴", "overcast"},
    {"小雨", "light_rain"}, {"中雨", "moderate_rain"}, {"大雨", "heavy_rain"},
    {"雷阵雨", "thunderstorm"}, {"阵雨", "shower"}, {"雨", "rainy"},
    {"雪", "snowy"}, {"小雪", "light_snow"}, {"雾", "foggy"}
  };
  
  for (int i = 0; i < sizeof(weatherMap) / sizeof(weatherMap[0]); i++) {
    if (strstr(weatherChinese, weatherMap[i].chinese) != NULL) {
      return weatherMap[i].english;
    }
  }
  return weatherChinese;
}

// ========== 解析配置数据 ==========
void parseConfigData(const char* jsonStr) {
  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, jsonStr);
  
  if (error) {
    Serial.printf("❌ JSON解析失败: %s\n", error.c_str());
    return;
  }
  
  const char* cityPinyin = doc["city"];
  const char* ssid = doc["ssid"];
  const char* password = doc["password"];
  
  if (cityPinyin && ssid && password) {
    strncpy(receivedConfig.cityPinyin, cityPinyin, sizeof(receivedConfig.cityPinyin) - 1);
    const char* chineseCity = mapPinyinToChinese(cityPinyin);
    strncpy(receivedConfig.cityChinese, chineseCity, sizeof(receivedConfig.cityChinese) - 1);
    strncpy(receivedConfig.ssid, ssid, sizeof(receivedConfig.ssid) - 1);
    strncpy(receivedConfig.password, password, sizeof(receivedConfig.password) - 1);
    receivedConfig.isValid = true;
    configReceived = true;
    
    Serial.println("✅ 配置接收成功!");
    Serial.printf("   🏙️ 城市: %s (拼音: %s)\n", receivedConfig.cityChinese, receivedConfig.cityPinyin);
    Serial.printf("   📶 WiFi: %s\n", receivedConfig.ssid);
    
    shouldConnectWiFi = true;
  } else {
    Serial.println("❌ 配置数据不完整");
    receivedConfig.isValid = false;
  }
}

// ========== 发送响应 ==========
void sendResponse(const char* message) {
  if (deviceConnected && pCharacteristic) {
    pCharacteristic->setValue(message);
    pCharacteristic->notify();
    Serial.printf("📤 已发送响应: %s\n", message);
  }
}

// ========== WiFi 连接 ==========
bool connectWiFi(const char* ssid, const char* password) {
  Serial.printf("📡 正在连接 WiFi: %s\n", ssid);
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("✅ WiFi 连接成功! IP: %s\n", WiFi.localIP().toString().c_str());
    return true;
  } else {
    Serial.println("❌ WiFi 连接失败!");
    return false;
  }
}

// ========== 查询天气 ==========
bool queryWeather(const char* city) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ WiFi 未连接，无法查询天气");
    return false;
  }
  
  Serial.printf("🌤️ 查询 %s 天气...\n", city);
  
  HTTPClient http;
  String url = String(WEATHER_API_URL) + "?city=" + String(city) + "&key=" + WEATHER_API_KEY;
  http.begin(url);
  
  int httpCode = http.GET();
  
  if (httpCode != 200) {
    Serial.printf("❌ 天气查询失败 (HTTP %d)\n", httpCode);
    http.end();
    return false;
  }
  
  String response = http.getString();
  http.end();
  
  DynamicJsonDocument doc(2048);
  DeserializationError error = deserializeJson(doc, response);
  
  if (error) {
    Serial.printf("❌ JSON解析失败: %s\n", error.c_str());
    return false;
  }
  
  int errorCode = doc["error_code"];
  if (errorCode != 0) {
    Serial.printf("❌ API错误码: %d\n", errorCode);
    return false;
  }
  
  const char* temp = doc["result"]["realtime"]["temperature"];
  const char* humidity = doc["result"]["realtime"]["humidity"];
  const char* info = doc["result"]["realtime"]["info"];
  
  if (temp) strncpy(weatherData.temperature, temp, sizeof(weatherData.temperature) - 1);
  if (humidity) strncpy(weatherData.humidity, humidity, sizeof(weatherData.humidity) - 1);
  if (info) {
    strncpy(weatherData.info, info, sizeof(weatherData.info) - 1);
    const char* infoEn = translateWeatherToEnglish(info);
    strncpy(weatherData.infoEn, infoEn, sizeof(weatherData.infoEn) - 1);
  }
  weatherData.isValid = true;
  
  Serial.printf("✅ 天气: %s°C, %s%%, %s\n", weatherData.temperature, weatherData.humidity, weatherData.info);
  return true;
}

// ========== MQTT 连接 ==========
bool connectMQTT() {
  Serial.printf("📡 连接 OneNET MQTT (%s:%d)...\n", mqtt_server, mqtt_port);
  mqttClient.setServer(mqtt_server, mqtt_port);
  
  int retry = 0;
  while (!mqttClient.connected() && retry < 5) {
    if (mqttClient.connect(device_name, product_id, token)) {
      Serial.println("✅ MQTT 连接成功!");
      return true;
    } else {
      Serial.printf("❌ MQTT 连接失败 (rc=%d), 重试 %d/5\n", mqttClient.state(), retry + 1);
      retry++;
      delay(3000);
    }
  }
  Serial.println("❌ MQTT 连接失败，已达最大重试次数");
  return false;
}

// ========== 上传天气数据到 OneNET ==========
void publishWeatherToONETEN() {
  if (!mqttClient.connected()) {
    Serial.println("❌ MQTT未连接，跳过天气上报");
    return;
  }
  
  Serial.println("📤 上传天气数据到 OneNET...");
  
  DynamicJsonDocument doc(512);
  doc["id"] = "123456789";
  doc["version"] = "1.0";
  
  JsonObject params = doc.createNestedObject("params");
  params["city"]["value"] = receivedConfig.cityPinyin;
  params["humidity"]["value"] = weatherData.humidity;
  params["info"]["value"] = weatherData.infoEn;
  params["ssid"]["value"] = receivedConfig.ssid;
  params["temperature"]["value"] = weatherData.temperature;
  
  String payload;
  serializeJson(doc, payload);
  
  if (mqttClient.publish(property_topic, payload.c_str())) {
    weatherUploaded = true;
    Serial.printf("✅ 天气数据上报成功: %s\n", payload.c_str());
  } else {
    Serial.println("❌ 天气数据上报失败");
  }
}

// ========== 上传蚕茧数据到 OneNET ==========
void publishCocoonDataToONETEN() {
  if (!mqttClient.connected()) {
    Serial.println("📡 MQTT未连接，尝试重新连接...");
    if (!connectMQTT()) {
      Serial.println("❌ MQTT重连失败，跳过上报");
      return;
    }
  }
  
  readTemperatureHumidity();
  
  DynamicJsonDocument doc(512);
  doc["id"] = "123456789";
  doc["version"] = "1.0";
  
  JsonObject params = doc.createNestedObject("params");
  params["total"]["value"] = total;
  params["hum"]["value"] = lastHum;
  params["grate"]["value"] = grate;
  params["bad"]["value"] = bad;
  params["temp"]["value"] = lastTemp;
  
  String payload;
  serializeJson(doc, payload);
  
  if (mqttClient.publish(property_topic, payload.c_str())) {
    Serial.printf("✅ 蚕茧数据上报成功: %s\n", payload.c_str());
  } else {
    Serial.println("❌ 蚕茧数据上报失败");
  }
}

// ========== 连接WiFi并启动 ==========
void connectWiFiAndStart() {
  if (!receivedConfig.isValid) {
    Serial.println("❌ 配置无效，跳过连接");
    isProcessing = false;
    shouldConnectWiFi = false;
    return;
  }
  
  Serial.println("========================================");
  Serial.println("🔧 开始执行WiFi连接和天气查询...");
  
  if (connectWiFi(receivedConfig.ssid, receivedConfig.password)) {
    if (queryWeather(receivedConfig.cityChinese)) {
      if (connectMQTT()) {
        publishWeatherToONETEN();
        sendResponse("{\"status\":\"success\",\"message\":\"配置完成\"}");
      } else {
        sendResponse("{\"status\":\"error\",\"message\":\"MQTT连接失败\"}");
      }
    } else {
      sendResponse("{\"status\":\"error\",\"message\":\"天气查询失败\"}");
    }
  } else {
    sendResponse("{\"status\":\"error\",\"message\":\"WiFi连接失败\"}");
  }
  
  Serial.println("========================================");
  isProcessing = false;
  shouldConnectWiFi = false;
}

// ========== MQTT 回调 ==========
void callback(char* topic, byte* payload, unsigned int length) {
  // 处理MQTT消息（如需）
}

// ========== 初始化 ==========
void setup() {
  Serial.begin(115200);
  uartSerial.begin(BAUD_RATE, SERIAL_8N1, UART_RX_PIN, UART_TX_PIN);
  delay(1000);

  Serial.println("========================================");
  Serial.println("🚀 ESP32 综合控制系统启动");
  Serial.println("========================================");

  // 步进电机 - 使用定时器中断
  setupStepMotor();

  // 舵机
  Serial.println("⚙️ 初始化舵机...");
  ledcSetup(LEDC_CHANNEL, LEDC_FREQ, LEDC_RES);
  ledcAttachPin(SERVO_PIN, LEDC_CHANNEL);
  current_angle = 0;
  target_angle = 0;
  servo_moving = false;
  setServoAngle(0);
  delay(500);
  Serial.println("✅ 舵机初始化完成 (0°)");

  // 激光
  Serial.println("⚙️ 初始化激光模块...");
  pinMode(LASER_PIN, OUTPUT);
  pinMode(RECV_PIN, INPUT_PULLUP);
  digitalWrite(LASER_PIN, HIGH);
  Serial.println("✅ 激光已开启");

  // 蓝牙
  Serial.println("⚙️ 初始化蓝牙...");
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);
  
  receivedConfig.isValid = false;
  weatherData.isValid = false;
  isProcessing = false;
  shouldConnectWiFi = false;
  weatherUploaded = false;
  lastReportedTotal = 0;
  
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);
  
  BLEDevice::init(BLE_DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());
  
  BLEService *pService = pServer->createService(SERVICE_UUID);
  
  pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setCallbacks(new MyCallbacks());
  
  pService->start();
  
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x20);
  pAdvertising->setMaxPreferred(0x40);
  
  BLEAdvertisementData advertisementData;
  advertisementData.setName(BLE_DEVICE_NAME);
  advertisementData.setFlags(0x06);
  pAdvertising->setAdvertisementData(advertisementData);
  
  BLEDevice::startAdvertising();
  
  mqttClient.setCallback(callback);

  Serial.println("========================================");
  Serial.println("✅ 系统就绪!");
  Serial.printf("📱 BLE名称: %s\n", BLE_DEVICE_NAME);
  Serial.println("📌 等待蓝牙配置或MaixCam数据...");
  Serial.println("========================================");
  Serial.println();
}

// ========== 主循环 ==========
void loop() {
  // 步进电机由定时器控制，无需在loop中处理
  
  // 舵机平滑移动
  smoothServoMove();

  // 舵机动作执行
  if (pending && millis() >= action_time) {
    int target = (bad_count % 2 == 1) ? 180 : 0;
    moveServoTo(target);
    pending = false;
  }

  // 激光检测
  checkLaserStatus();

  // 温湿度读取
  readTemperatureHumidity();

  // 蓝牙连接管理
  if (!deviceConnected && oldDeviceConnected) {
    delay(500);
    BLEDevice::getAdvertising()->start();
    Serial.println("📡 重新开始蓝牙广播");
    oldDeviceConnected = deviceConnected;
  }
  
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
  }
  
  if (shouldConnectWiFi && !isProcessing) {
    isProcessing = true;
    connectWiFiAndStart();
  }
  
  if (mqttClient.connected()) {
    mqttClient.loop();
  }

  // MaixCam数据接收
  if (uartSerial.available() >= 3) {
    uint8_t head1 = uartSerial.read();
    uint8_t head2 = uartSerial.read();
    if (head1 == 0xAA && head2 == 0xBB) {
      uint8_t grade = uartSerial.read();
      if (grade >= 1 && grade <= 3) {
        processGrade(grade);
      } else {
        Serial.printf("❌ 无效等级: %d\n", grade);
      }
    } else {
      while (uartSerial.available()) uartSerial.read();
    }
  }
}