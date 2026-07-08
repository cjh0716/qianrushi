from maix import camera, display, nn, time, uart, gpio, pinmap

# 打开屏幕 + 摄像头
disp = display.Display()
cam = camera.Camera()

# 正确打开串口
uart0 = uart.UART("/dev/ttyS0", 115200)

# 正确加载 YOLOv8 mud 模型
detector = nn.YOLOv8("/root/models/my_cocoon_int8.mud")

# 等级映射：class_id → 发送给Arduino的等级
# class_id: 0=坏茧 → 发送3, 1=好茧 → 发送1
GRADE_MAP = {
    0: 3,  # 坏茧 → 劣质
    1: 1,  # 好茧 → 特级
}

# 防重复发送
last_res = -1
locked = False
last_send_time = 0
SEND_COOLDOWN = 1000  # 1秒冷却

# 配置补光灯
pinmap.set_pin_function("B3", "GPIOB3")
flash = gpio.GPIO("GPIOB3", gpio.Mode.OUT)
# flash.value(1)  # 需要时取消注释

print("=" * 40)
print("🚀 蚕茧识别系统启动")
print("📌 识别规则: class_id=0→坏茧, class_id=1→好茧")
print("📌 发送格式: 0xAA 0xBB <grade>")
print("📌 等级映射: 坏茧→3, 好茧→1")
print("=" * 40)

# 实时监测
while True:
    img = cam.read()
    objs = detector.detect(img, conf_th=0.3)
    disp.show(img)

    now = -1
    if objs and len(objs) > 0:
        now = objs[0].class_id

    current_time = time.time_ms()

    # 检测到坏茧 (class_id=0)
    if now == 0 and last_res != 0 and not locked:
        # 发送3字节帧：0xAA 0xBB 0x03
        data = bytes([0xAA, 0xBB, 0x03])
        uart0.write(data)
        print(f"✅ 坏茧 → 已发送: {data.hex().upper()}")
        locked = True
        last_send_time = current_time

    # 检测到好茧 (class_id=1)
    elif now == 1 and last_res != 1:
        # 发送3字节帧：0xAA 0xBB 0x01
        data = bytes([0xAA, 0xBB, 0x01])
        uart0.write(data)
        print(f"✅ 好茧 → 已发送: {data.hex().upper()}")
        last_send_time = current_time

    # 没有物体 → 解锁
    if now == -1:
        locked = False

    last_res = now
    time.sleep_ms(50)