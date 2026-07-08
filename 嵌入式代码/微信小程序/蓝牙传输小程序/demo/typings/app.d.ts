import { BleManager } from '../utils/bleManager';

declare global {
  interface AppGlobalData {
    connectedDevice: string;
    isConnected: boolean;
    bleManager: BleManager;
  }

  interface WechatApp {
    globalData: AppGlobalData;
    connectDevice(deviceName: string): void;
    disconnectDevice(): void;
  }

  function getApp(): WechatApp;
}