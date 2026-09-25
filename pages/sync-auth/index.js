const itemService = require('../../services/itemService')

Page({
  data: { key: '', submitting: false },
  setKey(event) { this.setData({ key: event.detail.value }) },
  verify() {
    const key = this.data.key.trim()
    if (!key) return wx.showToast({ title: '请输入同步密钥', icon: 'none' })
    if (this.data.submitting) return
    this.setData({ submitting: true })
    itemService.verifySyncAccess(key).then(() => {
      itemService.setAutoSync(true)
      wx.showToast({ title: '验证成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    }).catch((error) => {
      const message = error.code === 'INVALID_KEY' ? '同步密钥不正确' : error.message || '验证失败，请稍后重试'
      wx.showModal({ title: '验证失败', content: message, showCancel: false })
    }).finally(() => this.setData({ submitting: false, key: '' }))
  }
})
