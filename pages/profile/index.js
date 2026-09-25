const itemService = require('../../services/itemService')
const SUPPORT_INTRO_SEEN_KEY = 'my_day_support_intro_seen_v1'

const accessLabel = (access) => {
  if (access.authorized) return access.role === 'admin' ? '管理员' : '已授权'
  if (access.accessCode === 'ACCESS_EXPIRED' || access.code === 'ACCESS_EXPIRED') return '已过期'
  if (access.accessCode === 'ACCESS_REVOKED' || access.code === 'ACCESS_REVOKED') return '已收回'
  return access.accessMessage || access.message || '未授权'
}

Page({
  data: { total: 0, active: 0, completed: 0, autoSync: true, syncAuthorized: false, syncRole: 'none', accessStatus: '检查中…', accessStatusClass: 'checking', syncStatus: '立即同步', syncStatusClass: '', lastSyncText: '尚未同步', showSupport: false, supportFirstView: false },
  onShow() {
    const items = itemService.getAll()
    const completed = items.filter((item) => item.completed).length
    const meta = itemService.getSyncMeta()
    const settings = itemService.getSyncSettings()
    this.setData({
      total: items.length,
      active: items.length - completed,
      completed,
      autoSync: settings.autoSync,
      syncAuthorized: settings.authorized,
      syncRole: settings.role,
      accessStatus: settings.accessCheckedAt ? accessLabel(settings) : '检查中…',
      accessStatusClass: settings.authorized ? 'connected' : 'checking',
      lastSyncText: this.formatSyncTime(meta.lastSyncedAt)
    })
    if (!wx.getStorageSync(SUPPORT_INTRO_SEEN_KEY)) {
      wx.setStorageSync(SUPPORT_INTRO_SEEN_KEY, Date.now())
      this.setData({ showSupport: true, supportFirstView: true })
    }
    const accessRecentlyChecked = settings.accessCheckedAt && Date.now() - settings.accessCheckedAt < 5 * 60 * 1000 && (!settings.authorized || settings.role !== 'none')
    if (accessRecentlyChecked) return
    itemService.refreshSyncAccess().then((result) => {
      this.setData({ syncAuthorized: result.authorized, syncRole: result.role || 'none', accessStatus: accessLabel(result), accessStatusClass: result.authorized ? 'connected' : 'locked' })
    }).catch(() => {
      this.setData({ accessStatus: '服务未就绪', accessStatusClass: 'failed' })
    })
  },
  formatSyncTime(timestamp) {
    if (!timestamp) return '尚未同步'
    const date = new Date(timestamp)
    const pad = (value) => String(value).padStart(2, '0')
    return `上次同步 ${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
  },
  syncNow() {
    if (!this.data.syncAuthorized) return this.openSyncAuth()
    this.setData({ syncStatus: '同步中…', syncStatusClass: 'checking' })
    itemService.sync({ force: true, manual: true }).then((result) => {
      const detail = `已上传 ${result.uploaded || 0} 项，已接收 ${result.downloaded || 0} 项。`
      this.setData({ syncStatus: '同步完成', syncStatusClass: 'connected', lastSyncText: this.formatSyncTime(result.lastSyncedAt) })
      this.onShow()
      wx.showModal({ title: '同步完成', content: detail, showCancel: false, confirmText: '知道了' })
    }).catch((error) => {
      if (error.code === 'UNAUTHORIZED') {
        this.setData({ syncAuthorized: false, accessStatus: '未授权', accessStatusClass: 'locked' })
      }
      this.setData({ syncStatus: '同步失败', syncStatusClass: 'failed' })
      wx.showModal({ title: '同步失败', content: error.errMsg || error.message || '请检查网络与数据库权限', showCancel: false })
    })
  },
  setAutoSync(event) {
    const enabled = event.detail.value
    if (enabled && !this.data.syncAuthorized) {
      this.setData({ autoSync: false })
      this.openSyncAuth()
      return
    }
    itemService.setAutoSync(enabled)
    this.setData({ autoSync: enabled })
    wx.showToast({ title: enabled ? '已开启自动同步' : '已关闭自动同步', icon: 'none' })
  },
  openSyncAuth() {
    if (this.data.syncAuthorized) return wx.showToast({ title: '当前账号已获得同步权限', icon: 'none' })
    wx.navigateTo({ url: '/pages/sync-auth/index' })
  },
  openKeyManager() {
    wx.navigateTo({ url: '/pages/access-keys/index' })
  },
  openNotifications() {
    wx.navigateTo({ url: '/pages/notifications/index' })
  },
  openSupport() {
    this.setData({ showSupport: true, supportFirstView: false })
  },
  closeSupport() {
    this.setData({ showSupport: false })
  },
  keepSupportOpen() {},
  preventSupportMove() {},
  exportData() {
    const data = JSON.stringify({ app: '我的日序', version: 2, exportedAt: new Date().toISOString(), items: itemService.getAll() }, null, 2)
    wx.setClipboardData({ data, success: () => wx.showToast({ title: '备份已复制' }) })
  },
  importData() {
    wx.navigateTo({ url: '/pages/import/index' })
  },
  clearData() {
    wx.showModal({
      title: '清空全部数据？', content: '所有事项都会从本机删除，并在下次同步时同步删除到云端。此操作无法恢复。', confirmText: '清空', confirmColor: '#C14E38',
      success: ({ confirm }) => { if (confirm) { itemService.clearAll(); this.onShow(); wx.showToast({ title: '已清空' }) } }
    })
  },
  showAbout() {
    wx.showModal({ title: '关于我的日序', content: '一个专注于今天、本周与长期目标的个人工作台。\n\n数据会优先保存在本机，并在网络可用时同步至微信云开发。', showCancel: false, confirmText: '知道了' })
  }
})
