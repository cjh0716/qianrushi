class BleManager {
  constructor(options) {
    this.isScanning = false;
    this.isConnected = false;
    this.connectedDeviceId = '';
    this.connectedDeviceName = '';
    this.serviceUUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
    this.characteristicUUID = '0000ffe1-0000-1000-8000-00805f9b34fb';
    this.onDeviceFound = undefined;
    this.onConnectionStateChange = undefined;
    this.devices = [];
    this.allDevices = []; // 用于调试，记录所有发现的设备

    if (options && options.serviceUUID) {
      this.serviceUUID = options.serviceUUID;
    }
    if (options && options.characteristicUUID) {
      this.characteristicUUID = options.characteristicUUID;
    }
  }

  setDeviceFoundCallback(callback) {
    this.onDeviceFound = callback;
  }

  setConnectionStateCallback(callback) {
    this.onConnectionStateChange = callback;
  }

  async openAdapter() {
    return new Promise((resolve) => {
      wx.openBluetoothAdapter({
        success: () => {
          console.log('✅ 蓝牙适配器打开成功');
          this.setupEventListeners();
          resolve(true);
        },
        fail: (err) => {
          console.error('❌ 蓝牙适配器打开失败:', err);
          wx.showModal({
            title: '蓝牙未开启',
            content: '请先开启蓝牙功能',
            showCancel: false
          });
          resolve(false);
        }
      });
    });
  }

  setupEventListeners() {
    // 设备发现监听 - 收集所有设备用于调试
    wx.onBluetoothDeviceFound((res) => {
      console.log('🔍 发现设备原始数据:', JSON.stringify(res));
      
      res.devices.forEach(device => {
        const deviceInfo = {
          name: device.name || '未命名',
          deviceId: device.deviceId,
          RSSI: device.RSSI,
          localName: device.localName || '无'
        };
        console.log('📱 发现设备:', deviceInfo);
        
        // 记录所有设备到 allDevices（用于调试）
        const existingAll = this.allDevices.find(d => d.deviceId === device.deviceId);
        if (!existingAll) {
          this.allDevices.push(deviceInfo);
          console.log('📋 所有设备列表（' + this.allDevices.length + '个）:', this.allDevices.map(d => d.name).join(', '));
        }
        
        // 修改：暂时不过滤，收集所有设备到 devices 列表
        // 这样页面上会显示所有设备
        const existingDevice = this.devices.find(d => d.deviceId === device.deviceId);
        if (!existingDevice) {
          this.devices.push({
            name: device.name || '未命名',
            deviceId: device.deviceId,
            RSSI: device.RSSI
          });
          console.log('📋 已添加到显示列表，当前设备数:', this.devices.length);
          
          if (this.onDeviceFound) {
            this.onDeviceFound(this.devices);
          }
        } else {
          console.log('⏭️ 设备已存在，跳过');
        }
      });
    });

    // 连接状态变化监听
    wx.onBLEConnectionStateChange((res) => {
      console.log('🔗 连接状态变化:', res);
      this.isConnected = res.connected;
      if (!res.connected) {
        this.connectedDeviceId = '';
        this.connectedDeviceName = '';
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange(false, '');
        }
        wx.showToast({ title: '设备已断开', icon: 'none' });
      } else {
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange(true, this.connectedDeviceName);
        }
      }
    });
  }

  async startSearch() {
    console.log('🔍 开始搜索蓝牙设备...');
    
    if (this.isScanning) {
      console.log('⏳ 已在搜索中');
      return;
    }

    const opened = await this.openAdapter();
    if (!opened) {
      console.log('❌ 蓝牙适配器打开失败，无法搜索');
      return;
    }
    
    this.devices = [];
    this.allDevices = []; // 清空调试列表
    this.isScanning = true;
    console.log('📋 已清空设备列表');

    return new Promise((resolve) => {
      // 修改：不指定 services，搜索所有设备
      console.log('📡 开始蓝牙设备发现（搜索所有设备）...');
      
      wx.startBluetoothDevicesDiscovery({
        // services: [this.serviceUUID],  // 注释掉，搜索所有设备
        allowDuplicatesKey: false,
        success: () => {
          console.log('✅ 蓝牙搜索已启动，持续5秒...');
          
          setTimeout(() => {
            console.log('⏹️ 搜索时间到，停止搜索');
            this.stopSearch();
            console.log('📱 搜索完成，共发现', this.devices.length, '个设备');
            console.log('📱 显示设备列表:', this.devices.map(d => d.name).join(', '));
            console.log('📱 所有发现的设备:', this.allDevices.map(d => d.name).join(', '));
            resolve();
          }, 5000);
        },
        fail: (err) => {
          console.error('❌ 蓝牙搜索启动失败:', err);
          this.isScanning = false;
          wx.showToast({ 
            title: '搜索失败: ' + (err.errMsg || '未知错误'), 
            icon: 'none' 
          });
          resolve();
        }
      });
    });
  }

  stopSearch() {
    if (!this.isScanning) return;
    
    this.isScanning = false;
    wx.stopBluetoothDevicesDiscovery({
      success: () => {
        console.log('✅ 蓝牙搜索已停止');
      },
      fail: (err) => {
        console.error('❌ 停止搜索失败:', err);
      }
    });
  }

  getDevices() {
    return this.devices;
  }

  async connectDevice(deviceId, deviceName) {
    console.log('🔗 尝试连接设备:', deviceName, deviceId);
    
    if (this.isConnected) {
      console.log('⏳ 已有连接，先断开');
      await this.disconnectDevice();
    }

    return new Promise((resolve) => {
      wx.createBLEConnection({
        deviceId,
        timeout: 5000,
        success: async () => {
          console.log('✅ BLE连接创建成功');
          this.isConnected = true;
          this.connectedDeviceId = deviceId;
          this.connectedDeviceName = deviceName;
          
          await this.getDeviceServices(deviceId);
          
          if (this.onConnectionStateChange) {
            this.onConnectionStateChange(true, deviceName);
          }
          resolve(true);
        },
        fail: (err) => {
          console.error('❌ 连接设备失败:', err);
          wx.showToast({ 
            title: '连接失败: ' + (err.errMsg || '未知错误'), 
            icon: 'none' 
          });
          resolve(false);
        }
      });
    });
  }

  async getDeviceServices(deviceId) {
    console.log('📡 获取设备服务...');
    return new Promise((resolve) => {
      wx.getBLEDeviceServices({
        deviceId,
        success: (res) => {
          console.log('📋 发现的服务:', res.services.map(s => s.uuid));
          const service = res.services.find(s => s.uuid.toLowerCase() === this.serviceUUID.toLowerCase());
          if (service) {
            console.log('✅ 找到目标服务:', service.uuid);
            this.getDeviceCharacteristics(deviceId, service.uuid);
          } else {
            console.log('❌ 未找到目标服务');
          }
          resolve();
        },
        fail: (err) => {
          console.error('❌ 获取服务失败:', err);
          resolve();
        }
      });
    });
  }

  async getDeviceCharacteristics(deviceId, serviceId) {
    console.log('📡 获取特征值...');
    return new Promise((resolve) => {
      wx.getBLEDeviceCharacteristics({
        deviceId,
        serviceId,
        success: (res) => {
          console.log('📋 发现的特征值:', res.characteristics.map(c => c.uuid));
          const char = res.characteristics.find(c => 
            c.uuid.toLowerCase() === this.characteristicUUID.toLowerCase()
          );
          if (char) {
            console.log('✅ 找到目标特征值:', char.uuid);
            wx.notifyBLECharacteristicValueChange({
              deviceId,
              serviceId,
              characteristicId: char.uuid,
              state: true,
              success: () => {
                console.log('✅ 已启用notify');
              },
              fail: (err) => {
                console.log('⚠️ 启用notify失败:', err);
              }
            });
          } else {
            console.log('❌ 未找到目标特征值');
          }
          resolve();
        },
        fail: (err) => {
          console.error('❌ 获取特征值失败:', err);
          resolve();
        }
      });
    });
  }

  async disconnectDevice() {
    console.log('🔗 断开连接...');
    if (!this.isConnected || !this.connectedDeviceId) {
      console.log('⏳ 未连接，无需断开');
      return;
    }

    return new Promise((resolve) => {
      wx.closeBLEConnection({
        deviceId: this.connectedDeviceId,
        success: () => {
          console.log('✅ 连接已断开');
          this.isConnected = false;
          this.connectedDeviceId = '';
          this.connectedDeviceName = '';
          if (this.onConnectionStateChange) {
            this.onConnectionStateChange(false, '');
          }
          resolve();
        },
        fail: (err) => {
          console.error('❌ 断开连接失败:', err);
          this.isConnected = false;
          this.connectedDeviceId = '';
          this.connectedDeviceName = '';
          resolve();
        }
      });
    });
  }

  async sendData(data) {
    if (!this.isConnected || !this.connectedDeviceId) {
      wx.showToast({ title: '请先连接设备', icon: 'none' });
      return false;
    }

    console.log('📤 发送数据:', data);

    return new Promise((resolve) => {
      const buffer = new ArrayBuffer(data.length);
      const dataView = new DataView(buffer);
      for (let i = 0; i < data.length; i++) {
        dataView.setUint8(i, data.charCodeAt(i));
      }

      wx.writeBLECharacteristicValue({
        deviceId: this.connectedDeviceId,
        serviceId: this.serviceUUID,
        characteristicId: this.characteristicUUID,
        value: buffer,
        success: () => {
          console.log('✅ 数据发送成功');
          resolve(true);
        },
        fail: (err) => {
          console.error('❌ 发送数据失败:', err);
          wx.showToast({ 
            title: '发送失败: ' + (err.errMsg || '未知错误'), 
            icon: 'none' 
          });
          resolve(false);
        }
      });
    });
  }

  getConnectionState() {
    return {
      isConnected: this.isConnected,
      deviceName: this.connectedDeviceName
    };
  }

  closeAdapter() {
    console.log('🔚 关闭蓝牙适配器');
    this.stopSearch();
    this.disconnectDevice();
    wx.closeBluetoothAdapter({
      success: () => {
        console.log('✅ 蓝牙适配器已关闭');
      },
      fail: (err) => {
        console.error('❌ 关闭适配器失败:', err);
      }
    });
  }
}

module.exports = {
  BleManager
};