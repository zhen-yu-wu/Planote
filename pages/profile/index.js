const itemService = require('../../services/itemService')

Page({
  data: { total: 0, active: 0, completed: 0 },
  onShow() {
    const items = itemService.getAll()
    const completed = items.filter((item) => item.completed).length
    this.setData({ total: items.length, active: items.length - completed, completed })
  },
  exportData() {
    const data = JSON.stringify({ app: '我的日序', version: 1, exportedAt: new Date().toISOString(), items: itemService.getAll() }, null, 2)
    wx.setClipboardData({ data, success: () => wx.showToast({ title: '备份已复制' }) })
  },
  importData() {
    wx.navigateTo({ url: '/pages/import/index' })
  },
  clearData() {
    wx.showModal({
      title: '清空全部数据？', content: '所有想法、任务和日程都会被永久删除，此操作无法恢复。', confirmText: '清空', confirmColor: '#C14E38',
      success: ({ confirm }) => { if (confirm) { itemService.clearAll(); this.onShow(); wx.showToast({ title: '已清空' }) } }
    })
  },
  showAbout() {
    wx.showModal({ title: '关于我的日序', content: '一个专注于今天、本周与长期目标的个人工作台。\n\n当前版本的数据仅保存在本机。', showCancel: false, confirmText: '知道了' })
  }
})
