const itemService = require('../../services/itemService')

const pad = (value) => String(value).padStart(2, '0')
const dateValue = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const timeText = (timestamp) => {
  const date = new Date(timestamp)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

Page({
  data: { label: '', expiryDate: '', expiryTime: '23:59', minDate: '', keys: [], loading: true, creating: false },
  onLoad() {
    const today = new Date()
    const defaultExpiry = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
    this.setData({ minDate: dateValue(today), expiryDate: dateValue(defaultExpiry) })
  },
  onShow() { this.loadKeys() },
  setLabel(event) { this.setData({ label: event.detail.value }) },
  setExpiryDate(event) { this.setData({ expiryDate: event.detail.value }) },
  setExpiryTime(event) { this.setData({ expiryTime: event.detail.value }) },
  loadKeys() {
    this.setData({ loading: true })
    itemService.listSyncAccessKeys().then((result) => {
      const now = Date.now()
      const keys = (result.keys || []).map((item) => {
        const revoked = Boolean(item.revokedAt)
        const expired = !revoked && Number(item.expiresAt) <= now
        return {
          ...item,
          createdText: timeText(item.createdAt),
          expiryText: timeText(item.expiresAt),
          status: revoked ? '已收回' : expired ? '已过期' : item.claimed ? '使用中' : '待使用',
          statusClass: revoked ? 'revoked' : expired ? 'expired' : item.claimed ? 'claimed' : 'active',
          canRevoke: !revoked && !expired
        }
      })
      this.setData({ keys })
    }).catch((error) => {
      wx.showModal({ title: '无法读取密钥', content: error.message || '请确认当前账号是管理员', showCancel: false })
    }).finally(() => this.setData({ loading: false }))
  },
  createKey() {
    if (this.data.creating) return
    const expiresAt = new Date(`${this.data.expiryDate}T${this.data.expiryTime}:00`).getTime()
    if (!expiresAt || expiresAt <= Date.now()) return wx.showToast({ title: '请选择未来的过期时间', icon: 'none' })
    const label = this.data.label.trim() || '未命名密钥'
    wx.showModal({
      title: '创建分发密钥？',
      content: `用途：${label}\n有效期至：${timeText(expiresAt)}\n\n每把密钥仅能绑定一个微信账号，原始密钥只显示一次。`,
      confirmText: '创建',
      confirmColor: '#397356',
      success: ({ confirm }) => {
        if (!confirm) return
        this.setData({ creating: true })
        itemService.createSyncAccessKey(label, expiresAt).then((result) => {
          this.setData({ label: '' })
          this.loadKeys()
          wx.showModal({
            title: '密钥创建成功',
            content: `${result.key}\n\n请立即复制并妥善发送给受邀用户，关闭后无法再次查看完整密钥。`,
            confirmText: '复制密钥',
            cancelText: '关闭',
            success: ({ confirm: copy }) => { if (copy) wx.setClipboardData({ data: result.key }) }
          })
        }).catch((error) => wx.showModal({ title: '创建失败', content: error.message || '请稍后再试', showCancel: false }))
          .finally(() => this.setData({ creating: false }))
      }
    })
  },
  revokeKey(event) {
    const keyId = event.currentTarget.dataset.keyId
    const label = event.currentTarget.dataset.label
    wx.showModal({
      title: '收回这把密钥？',
      content: `“${label}”被收回后，已使用它授权的账号也会立即失去同步权限。`,
      confirmText: '确认收回',
      confirmColor: '#C14E38',
      success: ({ confirm }) => {
        if (!confirm) return
        itemService.revokeSyncAccessKey(keyId).then(() => {
          wx.showToast({ title: '已收回', icon: 'success' })
          this.loadKeys()
        }).catch((error) => wx.showModal({ title: '收回失败', content: error.message || '请稍后再试', showCancel: false }))
      }
    })
  }
})
