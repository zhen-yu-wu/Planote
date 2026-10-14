Page({
  eraseLocal() {
    wx.showModal({ title: '删除本机数据及备份？', content: '将删除本机事项、旧版事项缓存及恢复快照，并暂停同步。云端记录和授权不受影响，重新同步会下载云端内容。本操作无法撤销，请先导出需要保留的内容。', confirmText: '删除本机', confirmColor: '#C14E38', success: ({ confirm }) => {
      if (!confirm) return
      try { require('../../services/itemService').forgetLocalData(); wx.showToast({ title: '本机事项及备份已删除', icon: 'none' }) }
      catch (error) { wx.showModal({ title: '删除未完成', content: error.message, showCancel: false }) }
    } })
  },
  openContract() {
    if (!wx.openPrivacyContract) return wx.showToast({ title: '请升级微信后查看平台隐私指引', icon: 'none' })
    wx.openPrivacyContract({ fail: () => wx.showModal({ title: '暂时无法打开', content: '平台隐私指引尚未配置或当前版本不支持。你可以阅读本页的数据说明并联系维护者。', showCancel: false }) })
  },
  contact() { wx.previewImage({ current: '/assets/images/developer-wechat.jpg', urls: ['/assets/images/developer-wechat.jpg'] }) }
})
