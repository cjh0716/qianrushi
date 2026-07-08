import { BleManager } from './utils/bleManager';

const bleManager = new BleManager();

App({
  globalData: {
    connectedDevice: '',
    isConnected: false,
    bleManager
  },

  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-d1gop9ls2d7d4f7eb',
        traceUser: true
      });
    }
  },

  onShow() {
  },

  onHide() {
  },

  connectDevice(deviceName: string) {
    this.globalData.connectedDevice = deviceName;
    this.globalData.isConnected = true;
  },

  disconnectDevice() {
    this.globalData.connectedDevice = '';
    this.globalData.isConnected = false;
  }
});