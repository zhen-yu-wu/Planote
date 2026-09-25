App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({ env: 'my-day-d2g6hzuuw3b26a7d1', traceUser: true })
      this.globalData.cloudAvailable = true
    }
  },
  globalData: {
    appName: '我的日序',
    cloudAvailable: false
  }
})
