const itemService = require('../../services/itemService')

Page({
  data: { content: '', characterCount: 0 },

  onInput(event) {
    const content = event.detail.value
    this.setData({ content, characterCount: content.length })
  },

  pasteFromClipboard() {
    wx.getClipboardData({
      success: ({ data }) => {
        if (!data) return wx.showToast({ title: '剪贴板为空', icon: 'none' })
        this.setData({ content: data, characterCount: data.length })
        wx.showToast({ title: '已粘贴', icon: 'success' })
      },
      fail: () => wx.showToast({ title: '无法读取剪贴板', icon: 'none' })
    })
  },

  clearContent() {
    this.setData({ content: '', characterCount: 0 })
  },

  importBackup() {
    const raw = this.data.content.trim()
    if (!raw) return wx.showToast({ title: '请先粘贴备份内容', icon: 'none' })
    let items
    try {
      items = itemService.prepareImport(raw)
    } catch (error) {
      wx.showModal({ title: '无法导入', content: error.message || '备份格式不正确', showCancel: false })
      return
    }
    wx.showModal({
      title: '确认导入？',
      content: `检测到 ${items.length} 条事项。继续后将覆盖当前设备中的全部数据。`,
      confirmText: '确认导入',
      confirmColor: '#2F6B4F',
      success: ({ confirm }) => {
        if (!confirm) return
        itemService.importItems(items)
        wx.showToast({ title: `已导入 ${items.length} 条`, icon: 'none' })
        setTimeout(() => wx.navigateBack(), 450)
      }
    })
  }
})
