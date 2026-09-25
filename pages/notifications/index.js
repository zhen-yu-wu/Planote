const itemService = require('../../services/itemService')

const defaultSettings = {
  enabled: false,
  time: '08:00',
  scopes: { today: true, week: true, overdue: true },
  subscriptionReady: false,
  lastSentDate: '',
  lastSendStatus: ''
}

Page({
  data: {
    loading: true, authorized: false, isAdmin: false, templateConfigured: false, templateId: '', templateInput: '', longTerm: false,
    settings: defaultSettings, saving: false, subscribing: false, testing: false, serviceUnavailable: false
  },
  onShow() {
    const access = itemService.getSyncSettings()
    if (!access.authorized) {
      this.setData({ loading: false, authorized: false })
      return
    }
    this.setData({ authorized: true, isAdmin: access.role === 'admin' })
    this.loadSettings()
  },
  loadSettings() {
    this.setData({ loading: true, serviceUnavailable: false })
    itemService.getNotificationSettings().then((result) => {
      this.setData({
        settings: { ...defaultSettings, ...(result.settings || {}), scopes: { ...defaultSettings.scopes, ...((result.settings && result.settings.scopes) || {}) } },
        templateConfigured: result.templateConfigured,
        templateId: result.templateId || '',
        templateInput: result.templateId || this.data.templateInput,
        longTerm: Boolean(result.longTerm),
        isAdmin: result.role === 'admin'
      })
    }).catch((error) => {
      const unsupported = error.code === 'SYNC_FAILED' || /(不支持|未知操作)/.test(error.message || '')
      this.setData({ serviceUnavailable: true })
      if (!unsupported) wx.showModal({ title: '无法读取通知设置', content: error.message || '请稍后再试', showCancel: false })
    })
      .finally(() => this.setData({ loading: false }))
  },
  retryLoad() { this.loadSettings() },
  setTime(event) { this.setData({ 'settings.time': event.detail.value }) },
  setScope(event) { this.setData({ [`settings.scopes.${event.currentTarget.dataset.scope}`]: event.detail.value }) },
  setTemplateInput(event) { this.setData({ templateInput: event.detail.value }) },
  setLongTerm(event) { this.setData({ longTerm: event.detail.value }) },
  persist(enabled = this.data.settings.enabled) {
    const scopes = this.data.settings.scopes
    if (!scopes.today && !scopes.week && !scopes.overdue) return Promise.reject(new Error('请至少选择一种通知内容'))
    return itemService.saveNotificationSettings({ enabled, time: this.data.settings.time, scopes })
  },
  savePreferences() {
    if (this.data.saving) return
    this.setData({ saving: true })
    this.persist().then(() => wx.showToast({ title: '设置已保存', icon: 'success' }))
      .catch((error) => wx.showModal({ title: '保存失败', content: error.message || '请稍后再试', showCancel: false }))
      .finally(() => this.setData({ saving: false }))
  },
  toggleEnabled(event) {
    const enabled = event.detail.value
    if (!enabled) {
      this.setData({ 'settings.enabled': false })
      this.persist(false).then(() => wx.showToast({ title: '已关闭通知', icon: 'none' }))
        .catch((error) => wx.showModal({ title: '关闭失败', content: error.message || '请稍后再试', showCancel: false }))
      return
    }
    this.setData({ 'settings.enabled': false })
    if (!this.data.templateConfigured) return wx.showModal({ title: '通知尚未就绪', content: '管理员需要先配置微信订阅消息模板。', showCancel: false })
    this.requestSubscription(true)
  },
  renewSubscription() { this.requestSubscription(false) },
  testNotification() {
    if (this.data.testing) return
    if (!this.data.settings.enabled) return wx.showModal({ title: '请先开启通知', content: '开启并同意微信订阅后，才能发送测试通知。', showCancel: false })
    if (!this.data.settings.subscriptionReady) return wx.showModal({ title: '需要续订', content: '当前没有可用的订阅额度，请先点击“立即续订”。', showCancel: false })
    wx.showModal({
      title: '发送测试通知？', content: '将立即发送一条微信服务通知，并消耗一次订阅额度。', confirmText: '立即发送', confirmColor: '#397356',
      success: ({ confirm }) => {
        if (!confirm) return
        this.setData({ testing: true })
        itemService.testNotification().then(() => {
          wx.showModal({ title: '测试通知已发送', content: '请前往微信“服务通知”查看。一次性订阅已使用，需要再次续订才能接收下一次提醒。', showCancel: false })
        }).catch((error) => {
          wx.showModal({ title: '测试发送失败', content: error.message || '请稍后再试', showCancel: false })
        }).finally(() => {
          this.setData({ testing: false })
          this.loadSettings()
        })
      }
    })
  },
  requestSubscription(enableAfter) {
    if (this.data.subscribing) return
    if (!wx.requestSubscribeMessage) return wx.showModal({ title: '当前微信版本不支持', content: '请升级微信后再开启通知。', showCancel: false })
    this.setData({ subscribing: true })
    wx.requestSubscribeMessage({
      tmplIds: [this.data.templateId],
      success: (result) => {
        if (result[this.data.templateId] !== 'accept') {
          wx.showModal({ title: '未获得通知权限', content: '你没有同意本次订阅，微信将不会发送提醒。', showCancel: false })
          return
        }
        const save = enableAfter ? this.persist(true) : Promise.resolve()
        save.then(() => itemService.markNotificationSubscribed()).then(() => {
          this.setData({ 'settings.enabled': enableAfter ? true : this.data.settings.enabled, 'settings.subscriptionReady': true })
          wx.showToast({ title: enableAfter ? '通知已开启' : '已续订下一次提醒', icon: 'success' })
        }).catch((error) => wx.showModal({ title: '订阅保存失败', content: error.message || '请稍后再试', showCancel: false }))
      },
      fail: (error) => wx.showModal({ title: '无法申请通知', content: error.errMsg || '请在微信设置中检查订阅消息权限', showCancel: false }),
      complete: () => this.setData({ subscribing: false })
    })
  },
  saveTemplate() {
    const templateId = this.data.templateInput.trim()
    if (!templateId) return wx.showToast({ title: '请输入模板 ID', icon: 'none' })
    this.setData({ saving: true })
    itemService.saveNotificationTemplate(templateId, this.data.longTerm).then((result) => {
      this.setData({ templateConfigured: true, templateId: result.templateId })
      wx.showToast({ title: '模板已配置', icon: 'success' })
    }).catch((error) => wx.showModal({ title: '配置失败', content: error.message || '请检查模板 ID', showCancel: false }))
      .finally(() => this.setData({ saving: false }))
  }
})
