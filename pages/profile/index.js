const itemService = require('../../services/itemService')
const SUPPORT_QR_IMAGE = '/assets/images/developer-wechat.jpg'

const accessLabel = (access) => {
  if (access.authorized) return access.role === 'admin' ? '管理员' : '已授权'
  if (access.accessCode === 'ACCESS_EXPIRED' || access.code === 'ACCESS_EXPIRED') return '已过期'
  if (access.accessCode === 'ACCESS_REVOKED' || access.code === 'ACCESS_REVOKED') return '已收回'
  return access.accessMessage || access.message || '未授权'
}

Page({
  data: { total: 0, active: 0, completed: 0, autoSync: true, syncAuthorized: false, syncRole: 'none', accessStatus: '检查中…', accessStatusClass: 'checking', syncStatus: '立即同步', syncStatusClass: '', lastSyncText: '尚未同步', showSupport: false, supportFirstView: false, supportQrImage: SUPPORT_QR_IMAGE, hasRecovery: false, syncError: '', restorePaused: false },
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
      hasRecovery: Boolean(itemService.getRecovery()),
      syncError: settings.lastError || '',
      restorePaused: Boolean(settings.restorePaused),
      syncAuthorized: settings.authorized,
      syncRole: settings.role,
      accessStatus: settings.accessCheckedAt ? accessLabel(settings) : '检查中…',
      accessStatusClass: settings.authorized ? 'connected' : 'checking',
      lastSyncText: this.formatSyncTime(meta.lastSyncedAt)
    })
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
    if (itemService.getSyncSettings().restorePaused) return this.confirmResume(() => this.syncNow())
    this.setData({ syncStatus: '同步中…', syncStatusClass: 'checking' })
    itemService.sync({ force: true, manual: true }).then((result) => {
      const detail = result.stale ? '同步期间发生了新的修改，已保留本机内容，正在再次同步。' : `已上传 ${result.uploaded || 0} 项，已接收 ${result.downloaded || 0} 项。`
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
    if (enabled && itemService.getSyncSettings().restorePaused) return this.confirmResume(() => this.onShow())
    itemService.setAutoSync(enabled)
    this.setData({ autoSync: enabled })
    wx.showToast({ title: enabled ? '已开启自动同步' : '已关闭自动同步', icon: 'none' })
  },
  confirmResume(then) {
    wx.showModal({ title: '重新同步恢复后的记录？', content: '本机恢复内容将与云端重新合并。同 ID 的较新云端版本可能替换恢复内容，云端其他记录也会下载。若希望保留备份为独立副本，请用“作为新事项合并”导入。', confirmText: '重新同步', success: ({ confirm }) => { if (confirm) { itemService.setAutoSync(true); this.onShow(); if (then) then() } else this.setData({ autoSync: false }) } })
  },
  restoreBackup() {
    wx.showModal({ title: '恢复操作前的快照？', content: '将覆盖本机事项并暂停同步，不修改云端。当前本机数据也会保存为新的快照。', confirmText: '恢复', success: ({ confirm }) => {
      if (!confirm) return
      try { itemService.restoreRecovery(); this.onShow(); wx.showToast({ title: '已恢复本机快照', icon: 'none' }) }
      catch (error) { wx.showModal({ title: '恢复失败', content: error.message, showCancel: false }) }
    } })
  },
  openPrivacy() { wx.navigateTo({ url: '/pages/privacy/index' }) },
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
  previewSupportQr() {
    wx.getImageInfo({
      src: SUPPORT_QR_IMAGE,
      success: ({ path }) => wx.previewImage({
        current: path,
        urls: [path],
        fail: () => wx.showToast({ title: '图片暂时无法打开，请稍后再试', icon: 'none' })
      }),
      fail: () => wx.showToast({ title: '图片暂时无法打开，请稍后再试', icon: 'none' })
    })
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
      title: '清空本机已知事项？', content: '将清空当前设备已加载的事项，开启同步时会删除云端对应记录。未加载的云端事项不受影响，可能再次下载。操作前会保留恢复快照。', confirmText: '清空', confirmColor: '#C14E38',
      success: ({ confirm }) => { if (confirm) { try { itemService.clearAll(); this.onShow(); wx.showToast({ title: '已清空已知事项', icon: 'none' }) } catch (error) { wx.showModal({ title: '清空失败', content: error.message, showCancel: false }) } } }
    })
  },
  showAbout() {
    wx.showModal({ title: '关于我的日序', content: '一个专注于今天、本周与长期目标的个人工作台。\n\n数据优先保存在本机；获得权限并开启同步后，才会同步至微信云开发。', showCancel: false, confirmText: '知道了' })
  }
})
