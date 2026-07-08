interface HistoryItem {
  city: string;
  ssid: string;
  password: string;
}

Page({
  data: {
    isConnected: false,
    connectedDevice: '',
    city: '',
    ssid: '',
    password: '',
    showPassword: false,
    errors: {
      city: '',
      ssid: '',
      password: ''
    },
    canSend: false,
    showStatus: false,
    statusType: 'success' as 'success' | 'error',
    statusMessage: '',
    history: [] as HistoryItem[]
  },

  onLoad() {
    this.loadHistoryData();
  },

  goBack() {
    wx.navigateBack();
  },

  onShow() {
    const app = getApp();
    this.setData({
      isConnected: app.globalData.isConnected,
      connectedDevice: app.globalData.connectedDevice
    });
    this.checkInputValidity();
  },

  onCityInput(e: any) {
    this.setData({ city: e.detail.value });
    this.clearError('city');
    this.checkInputValidity();
  },

  onSsidInput(e: any) {
    this.setData({ ssid: e.detail.value });
    this.clearError('ssid');
    this.checkInputValidity();
  },

  onPasswordInput(e: any) {
    this.setData({ password: e.detail.value });
    this.clearError('password');
    this.checkInputValidity();
  },

  validateCity() {
    const { city } = this.data;
    if (!city.trim()) {
      this.setData({ 'errors.city': '城市名称不能为空' });
    } else {
      this.clearError('city');
    }
    this.checkInputValidity();
  },

  validateSsid() {
    const { ssid } = this.data;
    if (!ssid.trim()) {
      this.setData({ 'errors.ssid': 'WiFi名称不能为空' });
    } else {
      this.clearError('ssid');
    }
    this.checkInputValidity();
  },

  validatePassword() {
    const { password } = this.data;
    if (!password.trim()) {
      this.setData({ 'errors.password': 'WiFi密码不能为空' });
    } else {
      this.clearError('password');
    }
    this.checkInputValidity();
  },

  clearError(field: 'city' | 'ssid' | 'password') {
    this.setData({ [`errors.${field}`]: '' });
  },

  checkInputValidity() {
    const { isConnected, city, ssid, password } = this.data;
    const canSend = isConnected && city.trim() && ssid.trim() && password.trim();
    this.setData({ canSend });
  },

  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword });
  },

  async sendConfig() {
    this.validateCity();
    this.validateSsid();
    this.validatePassword();

    const { city, ssid, password, errors } = this.data;
    if (!city.trim() || !ssid.trim() || !password.trim() || errors.city || errors.ssid || errors.password) {
      wx.showToast({ title: '请填写完整配置信息', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '正在发送配置...' });

    try {
      const configData = JSON.stringify({ city: city.trim(), ssid: ssid.trim(), password: password.trim() });
      const success = await getApp().globalData.bleManager.sendData(configData);

      wx.hideLoading();

      if (success) {
        this.saveToHistory(city.trim(), ssid.trim(), password.trim());

        this.setData({
          city: '',
          ssid: '',
          password: '',
          showStatus: true,
          statusType: 'success',
          statusMessage: '配置发送成功！设备正在连接WiFi...'
        });
      } else {
        this.setData({
          showStatus: true,
          statusType: 'error',
          statusMessage: '配置发送失败，请检查设备连接后重试'
        });
      }

      setTimeout(() => {
        this.setData({ showStatus: false });
      }, 3000);

      this.checkInputValidity();
    } catch (err) {
      wx.hideLoading();
      this.setData({
        showStatus: true,
        statusType: 'error',
        statusMessage: '发送异常，请重试'
      });
      setTimeout(() => {
        this.setData({ showStatus: false });
      }, 3000);
    }
  },

  loadHistoryData() {
    try {
      const historyStr = wx.getStorageSync('config_history');
      const history = historyStr ? JSON.parse(historyStr) : [
        { city: '北京', ssid: 'HomeWiFi', password: '12345678' },
        { city: '上海', ssid: 'OfficeWiFi', password: '87654321' },
        { city: '广州', ssid: 'ApartmentWiFi', password: 'abcdefgh' }
      ];
      this.setData({ history });
    } catch (e) {
      this.setData({
        history: [
          { city: '北京', ssid: 'HomeWiFi', password: '12345678' },
          { city: '上海', ssid: 'OfficeWiFi', password: '87654321' },
          { city: '广州', ssid: 'ApartmentWiFi', password: 'abcdefgh' }
        ]
      });
    }
  },

  saveToHistory(city: string, ssid: string, password: string) {
    let { history } = this.data;
    history = [{ city, ssid, password }, ...history.filter(h => h.city !== city)].slice(0, 10);
    this.setData({ history });
    wx.setStorageSync('config_history', JSON.stringify(history));
  },

  loadHistory(e: any) {
    const { city, ssid, password } = e.currentTarget.dataset;
    this.setData({
      city,
      ssid,
      password,
      errors: { city: '', ssid: '', password: '' }
    });
    this.checkInputValidity();
    wx.showToast({ title: '已加载历史配置', icon: 'none' });
  },

  deleteHistory(e: any) {
    e.stopPropagation();
    const { city } = e.currentTarget.dataset;
    let { history } = this.data;
    history = history.filter(h => h.city !== city);
    this.setData({ history });
    wx.setStorageSync('config_history', JSON.stringify(history));
    wx.showToast({ title: '已删除历史记录', icon: 'none' });
  }
});