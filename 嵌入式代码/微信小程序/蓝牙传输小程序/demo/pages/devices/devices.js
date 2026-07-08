Page({
  data: {
    devices: [],
    isSearching: false,
    isConnected: false,
    connectedDevice: '',
    showGuide: false
  },

  onLoad() {
    this.checkShowGuide();
    
    const app = getApp();
    app.globalData.bleManager.setDeviceFoundCallback((devices) => {
      this.setData({ devices });
    });
    app.globalData.bleManager.setConnectionStateCallback((connected, deviceName) => {
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
    if (this.data.isSearching) {
      getApp().globalData.bleManager.stopSearch();
      this.setData({ isSearching: false });
      return;
    }

    this.setData({ isSearching: true, devices: [] });

    try {
      await getApp().globalData.bleManager.startSearch();
      this.setData({ isSearching: false });
      const devices = getApp().globalData.bleManager.getDevices();
      if (devices.length === 0) {
        wx.showToast({ title: '未发现设备', icon: 'none' });
      } else {
        wx.showToast({ title: '发现 ' + devices.length + ' 个设备', icon: 'success' });
      }
    } catch (err) {
      console.error('搜索失败:', err);
      this.setData({ isSearching: false });
    }
  },

  async connectDevice(e) {
    const deviceId = e.currentTarget.dataset.deviceid;
    const deviceName = e.currentTarget.dataset.devicename;
    
    wx.showLoading({ title: '正在连接 ' + deviceName + '...' });

    try {
      const success = await getApp().globalData.bleManager.connectDevice(deviceId, deviceName);
      wx.hideLoading();
      if (success) {
        wx.showToast({ title: '成功连接 ' + deviceName, icon: 'success' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('连接失败:', err);
    }
  },

  async disconnectDevice() {
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
    getApp().globalData.bleManager.closeAdapter();
  }
});