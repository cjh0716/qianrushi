import { Device } from '../../utils/bleManager';

Page({
  data: {
    devices: [] as Device[],
    isSearching: false,
    isConnected: false,
    connectedDevice: '',
    showGuide: false
  },

  onLoad() {
    this.checkShowGuide();
    
    const app = getApp();
    console.log('📱 页面加载，BLE管理器:', app.globalData.bleManager);
    
    app.globalData.bleManager.setDeviceFoundCallback((devices) => {
      console.log('📱 设备发现回调触发，设备数量:', devices.length);
      this.setData({ devices });
    });
    app.globalData.bleManager.setConnectionStateCallback((connected, deviceName) => {
      console.log('🔗 连接状态变化:', connected, deviceName);
      if (connected) {
        app.connectDevice(deviceName);
      } else {
        app.disconnectDevice();
      }
      this.setData({
        isConnected: connected,
        connectedDevice: deviceName
      });
    });
  },

  onShow() {
    const app = getApp();
    this.setData({
      isConnected: app.globalData.isConnected,
      connectedDevice: app.globalData.connectedDevice
    });
    console.log('📱 页面显示，连接状态:', app.globalData.isConnected);
  },

  checkShowGuide() {
    const hasShown = wx.getStorageSync('has_shown_guide');
    if (!hasShown) {
      this.setData({ showGuide: true });
    }
  },

  goToConfig() {
    wx.navigateTo({
      url: '/pages/config/config'
    });
  },

  closeGuide() {
    this.setData({ showGuide: false });
    wx.setStorageSync('has_shown_guide', 'true');
  },

  async startSearch() {
    console.log('🔍 点击搜索按钮');
    
    if (this.data.isSearching) {
      console.log('⏹️ 停止搜索');
      getApp().globalData.bleManager.stopSearch();
      this.setData({ isSearching: false });
      return;
    }

    this.setData({ isSearching: true, devices: [] });
    console.log('🔍 开始搜索蓝牙设备...');

    try {
      // 先检查蓝牙适配器是否可用
      try {
        console.log('📡 尝试打开蓝牙适配器...');
        await wx.openBluetoothAdapter();
        console.log('✅ 蓝牙适配器打开成功');
      } catch (err) {
        console.error('❌ 蓝牙适配器打开失败:', err);
        wx.showToast({
          title: '请开启手机蓝牙',
          icon: 'none'
        });
        this.setData({ isSearching: false });
        return;
      }

      console.log('📡 调用 bleManager.startSearch()...');
      await getApp().globalData.bleManager.startSearch();
      console.log('✅ 搜索完成');
      
      this.setData({ isSearching: false });
      const devices = getApp().globalData.bleManager.getDevices();
      console.log('📱 发现的设备列表:', devices);
      
      if (devices.length === 0) {
        wx.showToast({ title: '未发现设备', icon: 'none' });
        console.log('❌ 未发现任何设备');
      } else {
        wx.showToast({ title: `发现 ${devices.length} 个设备`, icon: 'success' });
        console.log(`✅ 发现 ${devices.length} 个设备`);
      }
    } catch (err) {
      console.error('❌ 搜索失败:', err);
      wx.showToast({
        title: '搜索失败: ' + (err as any).errMsg || '未知错误',
        icon: 'none'
      });
      this.setData({ isSearching: false });
    }
  },

  async connectDevice(e: { currentTarget: { dataset: { deviceid: string; devicename: string } } }) {
    const deviceId = e.currentTarget.dataset.deviceid;
    const deviceName = e.currentTarget.dataset.devicename;
    
    console.log('🔗 尝试连接设备:', deviceName, deviceId);
    wx.showLoading({ title: `正在连接 ${deviceName}...` });

    try {
      const success = await getApp().globalData.bleManager.connectDevice(deviceId, deviceName);
      wx.hideLoading();
      if (success) {
        console.log('✅ 连接成功:', deviceName);
        wx.showToast({ title: `成功连接 ${deviceName}`, icon: 'success' });
      } else {
        console.log('❌ 连接失败');
      }
    } catch (err) {
      wx.hideLoading();
      console.error('❌ 连接失败:', err);
      wx.showToast({
        title: '连接失败',
        icon: 'none'
      });
    }
  },

  async disconnectDevice() {
    console.log('🔗 断开连接');
    await getApp().globalData.bleManager.disconnectDevice();
    const app = getApp();
    app.disconnectDevice();
    this.setData({
      isConnected: false,
      connectedDevice: ''
    });
    wx.showToast({ title: '已断开连接', icon: 'none' });
  },

  onUnload() {
    console.log('📱 页面卸载');
    getApp().globalData.bleManager.closeAdapter();
  }
});