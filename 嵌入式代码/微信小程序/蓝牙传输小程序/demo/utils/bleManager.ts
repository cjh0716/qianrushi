interface Device {
  name: string;
  deviceId: string;
  RSSI?: number;
}

interface BleManagerOptions {
  serviceUUID?: string;
  characteristicUUID?: string;
}

class BleManager {
  private isScanning = false;
  private isConnected = false;
  private connectedDeviceId = '';
  private connectedDeviceName = '';
  private serviceUUID: string = '0000ffe0-0000-1000-8000-00805f9b34fb';
  private characteristicUUID: string = '0000ffe1-0000-1000-8000-00805f9b34fb';
  private onDeviceFound?: (devices: Device[]) => void;
  private onConnectionStateChange?: (connected: boolean, deviceName: string) => void;
  private devices: Device[] = [];

  constructor(options?: BleManagerOptions) {
    if (options?.serviceUUID) {
      this.serviceUUID = options.serviceUUID;
    }
    if (options?.characteristicUUID) {
      this.characteristicUUID = options.characteristicUUID;
    }
  }

  setDeviceFoundCallback(callback: (devices: Device[]) => void) {
    this.onDeviceFound = callback;
  }

  setConnectionStateCallback(callback: (connected: boolean, deviceName: string) => void) {
    this.onConnectionStateChange = callback;
  }

  async openAdapter(): Promise<boolean> {
    return new Promise((resolve) => {
      wx.openBluetoothAdapter({
        success: () => {
          this.setupEventListeners();
          resolve(true);
        },
        fail: (err) => {
          console.error('蓝牙适配器打开失败:', err);
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

  private setupEventListeners() {
    wx.onBluetoothDeviceFound((res) => {
      const device = res.devices[0];
      if (device.name && device.name.startsWith('ESP32')) {
        const existingDevice = this.devices.find(d => d.deviceId === device.deviceId);
        if (!existingDevice) {
          this.devices.push({
            name: device.name,
            deviceId: device.deviceId,
            RSSI: device.RSSI
          });
          this.onDeviceFound?.(this.devices);
        }
      }
    });

    wx.onBLEConnectionStateChange((res) => {
      this.isConnected = res.connected;
      if (!res.connected) {
        this.connectedDeviceId = '';
        this.onConnectionStateChange?.(false, '');
        wx.showToast({ title: '设备已断开', icon: 'none' });
      }
    });
  }

  async startSearch(): Promise<void> {
    if (this.isScanning) return;

    await this.openAdapter();
    
    this.devices = [];
    this.isScanning = true;

    return new Promise((resolve) => {
      wx.startBluetoothDevicesDiscovery({
        services: [this.serviceUUID],
        allowDuplicatesKey: false,
        success: () => {
          setTimeout(() => {
            this.stopSearch();
            resolve();
          }, 3000);
        },
        fail: (err) => {
          console.error('蓝牙搜索失败:', err);
          this.isScanning = false;
          wx.showToast({ title: '搜索失败', icon: 'none' });
          resolve();
        }
      });
    });
  }

  stopSearch(): void {
    if (!this.isScanning) return;
    
    this.isScanning = false;
    wx.stopBluetoothDevicesDiscovery({
      success: () => {
        console.log('蓝牙搜索已停止');
      }
    });
  }

  getDevices(): Device[] {
    return this.devices;
  }

  async connectDevice(deviceId: string, deviceName: string): Promise<boolean> {
    if (this.isConnected) {
      await this.disconnectDevice();
    }

    return new Promise((resolve) => {
      wx.createBLEConnection({
        deviceId,
        timeout: 5000,
        success: async () => {
          this.isConnected = true;
          this.connectedDeviceId = deviceId;
          this.connectedDeviceName = deviceName;
          
          await this.getDeviceServices(deviceId);
          
          this.onConnectionStateChange?.(true, deviceName);
          resolve(true);
        },
        fail: (err) => {
          console.error('连接设备失败:', err);
          wx.showToast({ title: '连接失败', icon: 'none' });
          resolve(false);
        }
      });
    });
  }

  private async getDeviceServices(deviceId: string): Promise<void> {
    return new Promise((resolve) => {
      wx.getBLEDeviceServices({
        deviceId,
        success: (res) => {
          const service = res.services.find(s => s.uuid.toLowerCase() === this.serviceUUID.toLowerCase());
          if (service) {
            this.getDeviceCharacteristics(deviceId, service.uuid);
          }
          resolve();
        },
        fail: () => {
          resolve();
        }
      });
    });
  }

  private async getDeviceCharacteristics(deviceId: string, serviceId: string): Promise<void> {
    return new Promise((resolve) => {
      wx.getBLEDeviceCharacteristics({
        deviceId,
        serviceId,
        success: () => {
          resolve();
        },
        fail: () => {
          resolve();
        }
      });
    });
  }

  async disconnectDevice(): Promise<void> {
    if (!this.isConnected || !this.connectedDeviceId) return;

    return new Promise((resolve) => {
      wx.closeBLEConnection({
        deviceId: this.connectedDeviceId,
        success: () => {
          this.isConnected = false;
          this.connectedDeviceId = '';
          this.connectedDeviceName = '';
          this.onConnectionStateChange?.(false, '');
          resolve();
        },
        fail: () => {
          this.isConnected = false;
          this.connectedDeviceId = '';
          this.connectedDeviceName = '';
          resolve();
        }
      });
    });
  }

  async sendData(data: string): Promise<boolean> {
    if (!this.isConnected || !this.connectedDeviceId) {
      wx.showToast({ title: '请先连接设备', icon: 'none' });
      return false;
    }

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
          resolve(true);
        },
        fail: (err) => {
          console.error('发送数据失败:', err);
          wx.showToast({ title: '发送失败', icon: 'none' });
          resolve(false);
        }
      });
    });
  }

  getConnectionState(): { isConnected: boolean; deviceName: string } {
    return {
      isConnected: this.isConnected,
      deviceName: this.connectedDeviceName
    };
  }

  closeAdapter(): void {
    this.stopSearch();
    this.disconnectDevice();
    wx.closeBluetoothAdapter({
      success: () => {
        console.log('蓝牙适配器已关闭');
      }
    });
  }
}

export { BleManager, Device };
export default BleManager;