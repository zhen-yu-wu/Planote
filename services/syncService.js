const repository = require('../repositories/itemRepository')
const cloudService = require('./cloudService')

const SYNC_SETTINGS_KEY = 'planote_sync_settings_v1'
let running = null
let timer = null
let resyncRequested = false

const getSettings = () => {
  const value = wx.getStorageSync(SYNC_SETTINGS_KEY)
  const defaults = { autoSync: true, authorized: false, role: 'none', expiresAt: 0, accessCode: '', accessMessage: '', accessCheckedAt: 0, notifiedAccessCode: '' }
  return value && typeof value === 'object' ? { ...defaults, ...value } : defaults
}

const saveSettings = (settings) => wx.setStorageSync(SYNC_SETTINGS_KEY, settings)

const setAutoSync = (enabled) => {
  saveSettings({ ...getSettings(), autoSync: Boolean(enabled) })
  if (enabled) schedule()
}

const setAccess = (result = {}) => {
  const current = getSettings()
  saveSettings({
    ...current, authorized: Boolean(result.authorized), role: result.role || 'none', expiresAt: Number(result.expiresAt) || 0,
    accessCode: result.code || '', accessMessage: result.message || '', accessCheckedAt: Date.now(),
    notifiedAccessCode: result.authorized ? '' : current.notifiedAccessCode
  })
}

const refreshAccessStatus = () => cloudService.getAccessStatus().then((result) => {
  setAccess(result)
  return result
})

const verifyAccessKey = (key) => cloudService.verifyAccessKey(key).then((result) => {
  setAccess(result)
  return result
})

const localRecords = () => {
  const meta = repository.getSyncMeta()
  const records = repository.getAll().map((item) => ({ ...item, deleted: false }))
  Object.keys(meta.deletions || {}).forEach((id) => {
    records.push({ id, deleted: true, updatedAt: Number(meta.deletions[id]) || 0 })
  })
  return { records, meta }
}

const sync = ({ force = false, manual = false } = {}) => {
  if (!wx.cloud) return Promise.reject(new Error('当前基础库不支持云开发'))
  const settings = getSettings()
  if (!manual && !settings.autoSync) return Promise.resolve({ skipped: true, disabled: true })
  if (!manual && !settings.authorized) {
    const recentlyChecked = settings.accessCheckedAt && Date.now() - settings.accessCheckedAt < 24 * 60 * 60 * 1000
    if (recentlyChecked) return Promise.resolve({ skipped: true, unauthorized: true })
    return refreshAccessStatus().then((authorized) => authorized ? sync({ force }) : { skipped: true, unauthorized: true })
  }
  if (running) return running
  const snapshot = localRecords()
  if (!force && snapshot.meta.lastSyncedAt && Date.now() - snapshot.meta.lastSyncedAt < 30000) {
    return Promise.resolve({ skipped: true, lastSyncedAt: snapshot.meta.lastSyncedAt })
  }

  running = cloudService.syncItems(snapshot.records).then((result) => {
    setAccess({ ...getSettings(), authorized: true })
    const items = []
    const deletions = {}
    ;(result.records || []).forEach((record) => {
      if (record.deleted) deletions[record.id] = Number(record.updatedAt) || Date.now()
      else {
        const item = { ...record }
        delete item.deleted
        items.push(item)
      }
    })
    const lastSyncedAt = Date.now()
    const applied = repository.replaceFromSync(items, deletions, lastSyncedAt, snapshot.meta.revision)
    if (!applied) resyncRequested = true
    return { skipped: false, stale: !applied, uploaded: result.uploaded || 0, downloaded: result.downloaded || 0, total: items.length, lastSyncedAt: applied ? lastSyncedAt : snapshot.meta.lastSyncedAt }
  }).catch((error) => {
    if (['UNAUTHORIZED', 'ACCESS_EXPIRED', 'ACCESS_REVOKED'].includes(error.code)) {
      const previous = getSettings()
      setAccess({ authorized: false, code: error.code, message: error.message })
      if (!manual && ['ACCESS_EXPIRED', 'ACCESS_REVOKED'].includes(error.code) && previous.notifiedAccessCode !== error.code) {
        saveSettings({ ...getSettings(), notifiedAccessCode: error.code })
        wx.showModal({ title: error.code === 'ACCESS_EXPIRED' ? '同步权限已过期' : '同步权限已被收回', content: error.message, showCancel: false, confirmText: '知道了' })
      }
    }
    throw error
  }).finally(() => {
    running = null
    if (resyncRequested) {
      resyncRequested = false
      schedule()
    }
  })
  return running
}

const schedule = () => {
  const settings = getSettings()
  if (!wx.cloud || !settings.autoSync || !settings.authorized) return
  if (running) {
    resyncRequested = true
    return
  }
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    sync({ force: true }).catch(() => {})
  }, 800)
}

const listAccessKeys = () => cloudService.listAccessKeys()
const createAccessKey = (label, expiresAt) => cloudService.createAccessKey(label, expiresAt)
const revokeAccessKey = (keyId) => cloudService.revokeAccessKey(keyId)
const getNotificationSettings = () => cloudService.getNotificationSettings()
const saveNotificationSettings = (settings) => cloudService.saveNotificationSettings(settings)
const markNotificationSubscribed = () => cloudService.markNotificationSubscribed()
const saveNotificationTemplate = (templateId, longTerm) => cloudService.saveNotificationTemplate(templateId, longTerm)
const testNotification = () => cloudService.testNotification()

module.exports = {
  sync, schedule, getSettings, setAutoSync, refreshAccessStatus, verifyAccessKey, listAccessKeys, createAccessKey, revokeAccessKey,
  getNotificationSettings, saveNotificationSettings, markNotificationSubscribed, saveNotificationTemplate, testNotification
}
