// ========== 第一部分：常量与工具函数 (逻辑独立，便于管理) ==========
const CONFIG = {
  AUTH_INFO: "version=2018-10-31&res=userid%2F516419&et=1814696870&method=md5&sign=79%2BbHe5lbLRwLtja%2Bk2P8Q%3D%3D", //鉴权信息（前面生成的token)
  PRODUCT_ID: "Qzi8cVS19V", //产品id
  DEVICE_NAME: "ESP", //设备名称
  API_BASE_URL: "https://iot-api.heclouds.com", //API基础地址
  DATA_REFRESH_INTERVAL: 5000,  //数据获取周期（建议和单片机上报数据周期一致）
  STATUS_QUERY_LIMIT: 1,  //获取多少条设备信息（建议1条）
  STATUS_QUERY_RANGE_MS: 7 * 24 * 60 * 60 * 1000, // 一周的毫秒数
};

/**
 * 值类型转换器
 * 将OneNET API返回的字符串值，根据本地定义的type转换为正确的JavaScript类型。
 * @param {string} rawValue - API返回的原始字符串值
 * @param {string} type - 本地定义的数据类型 ('bool', 'int32', 'float', 'string'等)
 * @returns {any} 转换后的值
 */
const valueConverter = (rawValue, type) => {
  switch (type) {
    case 'bool':
      return rawValue === 'true';
    case 'int32':
      return parseInt(rawValue, 10) || 0;
    case 'float':
      return parseFloat(rawValue) || 0.0;
    case 'string':
      return String(rawValue) || '';
    // 可根据需要扩展其他类型，如 'enum' 等
    default:
      return rawValue; // 默认返回字符串
  }
};

/**
 * 生成设备状态查询的时间范围
 * @returns {{start_time: number, end_time: number}}
 */
const getStatusQueryTimestamps = () => {
  const now = Date.now();
  return {
    start_time: now - CONFIG.STATUS_QUERY_RANGE_MS,
    end_time: now
  };
};

// ========== 第二部分：Page 定义 (专注于页面逻辑) ==========
Page({
  data: {
    // 设备属性定义与值存储
    // 结构：{identifier: "唯一标识", value: 初始值, type: "数据类型"}
    deviceData: [
      { identifier: "temperature", value: "", type: "string" },  //天气温度
      { identifier: "humidity", value: "", type: "string" },  //天气湿度
      { identifier: "info", value: "", type: "string" },   //天气
      { identifier: "city", value: "", type: "string" },  //所在城市
      { identifier: "temp", value: "", type: "string" },   //设备温度
      { identifier: "hum", value: "", type: "string" },   //设备湿度
      { identifier: "ssid", value: "", type: "string" },   //当前WIFI
      { identifier: "total", value: 0, type: "int32" },   //当前识别蚕茧数
      { identifier: "grate", value: 0, type: "int32" },   //好茧数
      { identifier: "bad", value: 0, type: "int32" },   //坏茧数
    ],
    // 视图层绑定映射
    deviceValueMap: {},
    // 设备状态历史
    deviceStatusLog: [],
    // 计算属性 - 好茧率
    percentage: 0,
    // 页面标题
    pageTitle: '蚕茧分选系统',
    // 最后更新时间
    lastUpdateTime: '',
  },

  dataRefreshTimer: null,

  onLoad(options) {
    this.fetchAllDeviceInfo();
    this.startDataRefreshTimer();     // 页面加载时，开始轮询
  },

  onUnload() {
    this.clearDataRefreshTimer();   // 页面卸载时，清理定时器
  },

  /**
   * 启动数据刷新定时器
   */
  startDataRefreshTimer() {
    // 先清除可能已存在的定时器，避免重复
    this.clearDataRefreshTimer();
    // 启动新的定时器
    this.dataRefreshTimer = setInterval(() => {
      this.fetchAllDeviceInfo();
    }, CONFIG.DATA_REFRESH_INTERVAL);
    console.log('数据轮询定时器已启动，间隔：', CONFIG.DATA_REFRESH_INTERVAL, 'ms');
  },

  /**
   * 清除数据刷新定时器
   */
  clearDataRefreshTimer() {
    if (this.dataRefreshTimer) {
      clearInterval(this.dataRefreshTimer);
      this.dataRefreshTimer = null;
      console.log('数据轮询定时器已清除');
    }
  },

  /**
   * 获取所有设备信息（属性 + 状态）
   */
  fetchAllDeviceInfo() {
    this.fetchDeviceProperties();
    this.fetchDeviceStatus();
  },

  /**
   * 获取设备最新属性
   */
  async fetchDeviceProperties() {
    const url = `${CONFIG.API_BASE_URL}/thingmodel/query-device-property?product_id=${CONFIG.PRODUCT_ID}&device_name=${CONFIG.DEVICE_NAME}`;

    try {
      const res = await this.wxRequest({ url, method: 'GET' });
      console.log("设备属性数据获取成功：", res.data);

      if (res.data.code === 0 && res.data.data) {
        this.updateLocalDeviceData(res.data.data);
        // 更新计算属性
        this.updateCalculatedData();
        // 更新最后更新时间
        this.updateLastUpdateTime();
      } else {
        this.showToast(res.data.msg || '数据获取异常', 'none');
      }
    } catch (error) {
      console.error("设备属性请求失败：", error);
      this.showToast('网络请求失败', 'none');
    }
  },

  /**
   * 根据服务器响应，更新本地 data 
   * @param {Array} remoteDataArray - 服务器返回的属性数组
   */
  updateLocalDeviceData(remoteDataArray) {
    const deviceDataUpdates = {};
    const valueMapUpdates = {};

    remoteDataArray.forEach(remoteItem => {
      const localIndex = this.data.deviceData.findIndex(localItem => localItem.identifier === remoteItem.identifier);

      if (localIndex !== -1) {
        const targetType = this.data.deviceData[localIndex].type;
        const processedValue = valueConverter(remoteItem.value, targetType);

        deviceDataUpdates[`deviceData[${localIndex}].value`] = processedValue;
        valueMapUpdates[`deviceValueMap.${remoteItem.identifier}`] = processedValue;
      } else {
        console.warn(`收到未定义的设备属性：${remoteItem.identifier}，已忽略，如需使用，请在 data.deviceData 中定义。`);
      }
    });

    if (Object.keys(deviceDataUpdates).length > 0) this.setData(deviceDataUpdates);
    if (Object.keys(valueMapUpdates).length > 0) this.setData(valueMapUpdates);
  },

  /**
   * 更新计算数据（好茧率等）
   */
  updateCalculatedData() {
    const total = this.getDeviceValue('total');
    const grate = this.getDeviceValue('grate');
    let percentage = 0;
    
    if (total > 0 && grate >= 0) {
      percentage = Math.round((grate / total) * 100);
    }
    
    this.setData({ percentage });
    console.log('好茧率已更新：', percentage + '%');
  },

  /**
   * 更新最后更新时间
   */
  updateLastUpdateTime() {
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    this.setData({ lastUpdateTime: timeStr });
  },

  /**
   * 获取指定设备的当前值
   * @param {string} identifier - 属性标识符
   * @returns {any} 设备值
   */
  getDeviceValue(identifier) {
    const item = this.data.deviceData.find(d => d.identifier === identifier);
    return item ? item.value : undefined;
  },

  /**
   * 获取设备在线状态
   */
  async fetchDeviceStatus() {
    const { start_time, end_time } = getStatusQueryTimestamps();
    const url = `${CONFIG.API_BASE_URL}/device/status-history?product_id=${CONFIG.PRODUCT_ID}&device_name=${CONFIG.DEVICE_NAME}&start_time=${start_time}&end_time=${end_time}&limit=${CONFIG.STATUS_QUERY_LIMIT}`;

    try {
      const res = await this.wxRequest({ url, method: 'GET' });
      this.setData({ deviceStatusLog: res.data });
    } catch (error) {
      console.error("设备状态请求失败：", error);
    }
  },

  /**
   * 设置设备属性
   */
  async onenet_set_device_property(event) {
    const param_name = event.currentTarget.dataset.param;
    const new_value = event.detail.value;

    wx.showLoading({ title: '设置中...', mask: true }); // 显示加载中

    const requestData = {
      product_id: CONFIG.PRODUCT_ID,
      device_name: CONFIG.DEVICE_NAME,
      params: { [param_name]: new_value }
    };

    try {
      const res = await this.wxRequest({
        url: `${CONFIG.API_BASE_URL}/thingmodel/set-device-property`,
        method: 'POST',
        data: requestData
      });

      console.log('属性设置请求返回：', res.data);
      wx.hideLoading();
      if (res.data && res.data.code === 0) {
        this.showToast('设置成功', 'success');
        this.updatePropertyImmediately(param_name, new_value); // 立即更新UI
        this.startDataRefreshTimer();
        console.log('因设备属性变更，数据轮询定时器已重置');
      } else {
        wx.showToast({ title: res.data.msg || '设置失败', icon: 'none', duration: 2000 });
      }
    } catch (error) {
      console.error('属性设置请求失败：', error);
      wx.hideLoading();
      wx.showToast({ title: '网络错误，设置失败', icon: 'none', duration: 2000 });
    }
  },

  /**
   * 设置成功后，立即更新本地数据 
   * @param {string} identifier - 属性标识符
   * @param {any} newValue - 新值
   */
  updatePropertyImmediately(identifier, newValue) {
    const localIndex = this.data.deviceData.findIndex(item => item.identifier === identifier);
    if (localIndex !== -1) {
      // 根据类型转换值
      const targetType = this.data.deviceData[localIndex].type;
      const processedValue = valueConverter(String(newValue), targetType);
      
      this.setData({
        [`deviceData[${localIndex}].value`]: processedValue,
        [`deviceValueMap.${identifier}`]: processedValue
      });
      
      // 如果更新的是蚕茧数据，重新计算好茧率
      if (identifier === 'total' || identifier === 'grate') {
        this.updateCalculatedData();
      }
    }
  },

  // ========== 第三部分：界面事件处理 ==========
  
  /**
   * 手动刷新数据（下拉刷新或按钮点击）
   */
  onRefreshData() {
    wx.showLoading({ title: '刷新中...', mask: true });
    this.fetchAllDeviceInfo();
    setTimeout(() => {
      wx.hideLoading();
      this.showToast('刷新完成', 'success');
    }, 500);
  },

  /**
   * 查看蚕茧分选详情
   */
  onViewCocoonDetail() {
    const total = this.getDeviceValue('total');
    const grate = this.getDeviceValue('grate');
    const bad = this.getDeviceValue('bad');
    const percentage = this.data.percentage;
    
    wx.showModal({
      title: '蚕茧分选详情',
      content: `总数量：${total}个\n好茧：${grate}个\n坏茧：${bad}个\n好茧率：${percentage}%`,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /**
   * 查看天气详情
   */
  onViewWeather() {
    const temperature = this.getDeviceValue('temperature');
    const humidity = this.getDeviceValue('humidity');
    const info = this.getDeviceValue('info');
    const city = this.getDeviceValue('city');
    
    wx.showModal({
      title: '天气信息',
      content: `城市：${city}\n温度：${temperature}°C\n湿度：${humidity}%\n天气：${info}`,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /**
   * 查看设备信息
   */
  onViewDeviceInfo() {
    const temp = this.getDeviceValue('temp');
    const hum = this.getDeviceValue('hum');
    const ssid = this.getDeviceValue('ssid');
    
    wx.showModal({
      title: '设备信息',
      content: `设备温度：${temp}°C\n设备湿度：${hum}%\nWiFi：${ssid}`,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /**
   * 重置统计数据（需要设备支持）
   */
  async onResetStatistics() {
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '确认重置',
        content: '确定要重置所有统计数据吗？',
        success: (res) => resolve(res.confirm)
      });
    });

    if (confirmed) {
      wx.showLoading({ title: '重置中...', mask: true });
      
      // 这里假设设备有重置功能，通过设置一个属性来触发
      const requestData = {
        product_id: CONFIG.PRODUCT_ID,
        device_name: CONFIG.DEVICE_NAME,
        params: { reset: 1 }
      };

      try {
        const res = await this.wxRequest({
          url: `${CONFIG.API_BASE_URL}/thingmodel/set-device-property`,
          method: 'POST',
          data: requestData
        });

        wx.hideLoading();
        if (res.data && res.data.code === 0) {
          this.showToast('重置成功', 'success');
          // 延迟刷新数据
          setTimeout(() => {
            this.fetchAllDeviceInfo();
          }, 1000);
        } else {
          this.showToast(res.data.msg || '重置失败', 'none');
        }
      } catch (error) {
        wx.hideLoading();
        this.showToast('网络错误，重置失败', 'none');
        console.error('重置请求失败：', error);
      }
    }
  },

  // ========== 第四部分：基础工具方法 (提升复用性) ==========
  /**
   * 封装的 wx.request 方法，返回 Promise
   * @param {Object} options - wx.request 的参数
   * @returns {Promise}
   */
  wxRequest(options) {
    return new Promise((resolve, reject) => {
      wx.request({
        ...options,
        header: {
          'Authorization': CONFIG.AUTH_INFO,
          'content-type': 'application/json',
          ...options.header, // 允许覆盖默认header
        },
        success: (res) => resolve(res),
        fail: (err) => reject(err)
      });
    });
  },

  /**
   * 显示Toast提示的快捷方法（仅普通toast，不处理loading）
   * @param {string} title - 提示文字
   * @param {string} icon - 图标 ('success', 'none')
   * @param {boolean} [mask=false] - 是否显示透明蒙层
   */
  showToast(title, icon = 'none', mask = false) {
    wx.showToast({ title, icon, duration: icon === 'success' ? 1500 : 2000, mask });
  },
});