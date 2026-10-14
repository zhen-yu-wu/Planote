const itemService = require('../../services/itemService')

Page({
  data: { content: '', characterCount: 0, mode: 'merge', importing: false },
  setMode(event) { this.setData({ mode: event.currentTarget.dataset.mode }) },

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
    if (this.data.importing) return
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
      content: `检测到 ${items.length} 条事项。${this.data.mode === 'merge' ? '将作为新事项加入，保留现有内容；开启自动同步时会上传到云端。重复导入会产生副本。' : '将覆盖本机事项并暂停同步，不修改云端数据。重新同步后云端事项可能再次合并。'}操作前会保留一份恢复快照。`,
      confirmText: '确认导入',
      confirmColor: '#2F6B4F',
      success: ({ confirm }) => {
        if (!confirm) return
        this.setData({ importing: true })
        try {
          itemService.importItems(items, { mode: this.data.mode })
          wx.showToast({ title: `已导入 ${items.length} 条`, icon: 'none' })
          setTimeout(() => wx.navigateBack(), 450)
        } catch (error) {
          this.setData({ importing: false })
          wx.showModal({ title: '导入失败', content: error.message || '本机存储空间不足', showCancel: false })
        }
      }
    })
  }
})
