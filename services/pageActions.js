const itemService = require('./itemService')
const syncStatus = (page) => {
  const settings = itemService.getSyncSettings()
  page.setData({ syncError: settings.authorized ? settings.lastError || '' : '' })
}
const toggle = (page, id, refresh) => {
  try {
    const previous = itemService.getById(id)
    if (!previous) return
    const saved = itemService.toggleCompleted(id)
    if (page._undoTimer) clearTimeout(page._undoTimer)
    page._undoAction = { id, completed: previous.completed, updatedAt: saved.updatedAt, progress: previous.progress, refresh }
    page.setData({ undoVisible: true, undoMessage: saved.completed ? '已完成' : '已恢复' })
    refresh.call(page)
    page._undoTimer = setTimeout(() => { page._undoAction = null; page.setData({ undoVisible: false }) }, 6000)
  } catch (error) { wx.showToast({ title: error.message || '保存失败', icon: 'none' }) }
}
const cleanup = (page) => { if (page._undoTimer) clearTimeout(page._undoTimer); page._undoAction = null }
const undo = (page) => {
  const action = page._undoAction
  if (!action) return
  try {
    const current = itemService.getById(action.id)
    if (!current || current.updatedAt !== action.updatedAt) throw new Error('事项已发生新修改，请进入编辑页调整')
    itemService.save({ ...current, completed: action.completed, progress: action.progress })
    action.refresh.call(page)
  } catch (error) { wx.showToast({ title: error.message, icon: 'none' }) }
  cleanup(page); page.setData({ undoVisible: false })
}
const refresh = (page, load) => {
  load.call(page)
  const settings = itemService.getSyncSettings()
  const promise = settings.authorized && !settings.restorePaused ? itemService.sync({ force: true, manual: true }) : Promise.resolve({ skipped: true })
  return promise.then(() => load.call(page)).catch((error) => wx.showToast({ title: error.message || '同步失败，本机记录已保留', icon: 'none' })).finally(() => { syncStatus(page); wx.stopPullDownRefresh() })
}
module.exports = { toggle, undo, cleanup, refresh, syncStatus }
