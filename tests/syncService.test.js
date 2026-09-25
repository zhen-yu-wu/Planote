const assert = require('assert')

const storage = {
  planote_sync_settings_v1: { autoSync: true, authorized: true, accessCheckedAt: Date.now() }
}
let lastSyncPayload = null
let revokedKeyId = ''

global.wx = {
  getStorageSync: (key) => storage[key],
  setStorageSync: (key, value) => { storage[key] = value },
  cloud: {
    callFunction: ({ data }) => {
      if (data.action === 'status') return Promise.resolve({ result: { ok: true, authorized: true, role: 'admin', expiresAt: 0 } })
      if (data.action === 'verify') return Promise.resolve({ result: data.key === 'test-key' ? { ok: true, authorized: true, role: 'admin', expiresAt: 0 } : { ok: false, code: 'INVALID_KEY', message: '同步密钥不正确' } })
      if (data.action === 'listKeys') return Promise.resolve({ result: { ok: true, keys: [{ keyId: 'key-1', label: '测试', expiresAt: 9999999999999 }] } })
      if (data.action === 'createKey') return Promise.resolve({ result: { ok: true, key: 'MD-test', item: { keyId: 'key-2', label: data.label, expiresAt: data.expiresAt } } })
      if (data.action === 'revokeKey') { revokedKeyId = data.keyId; return Promise.resolve({ result: { ok: true, revokedAt: Date.now() } }) }
      if (data.action === 'getNotificationSettings') return Promise.resolve({ result: { ok: true, templateConfigured: true, templateId: 'template-test-1234567890', longTerm: false, settings: { enabled: true, time: '08:30', scopes: { today: true, week: true, overdue: true }, subscriptionReady: false } } })
      if (data.action === 'saveNotificationSettings') return Promise.resolve({ result: { ok: true, settings: data } })
      if (data.action === 'markNotificationSubscribed') return Promise.resolve({ result: { ok: true, subscriptionReady: true } })
      if (data.action === 'saveNotificationTemplate') return Promise.resolve({ result: { ok: true, templateConfigured: true, templateId: data.templateId, longTerm: data.longTerm } })
      lastSyncPayload = data.records
      return Promise.resolve({ result: {
        ok: true,
        authorized: true,
        uploaded: 2,
        downloaded: 2,
        records: [
          { id: 'remote-new', title: '云端新版', type: 'chore', date: '2026-09-14', updatedAt: 300, deleted: false },
          { id: 'remote-deleted', updatedAt: 400, deleted: true },
          { id: 'local-new', title: '本地新版', type: 'chore', date: '2026-09-14', updatedAt: 500, deleted: false },
          { id: 'local-deleted', updatedAt: 600, deleted: true }
        ]
      } })
    }
  }
}

const repository = require('../repositories/itemRepository')
const syncService = require('../services/syncService')

repository.replaceFromSync([
  { id: 'remote-new', title: '本地旧版', type: 'chore', date: '2026-09-14', updatedAt: 200 },
  { id: 'remote-deleted', title: '本地待删', type: 'chore', date: '2026-09-14', updatedAt: 200 },
  { id: 'local-new', title: '本地新版', type: 'chore', date: '2026-09-14', updatedAt: 500 }
], { 'local-deleted': 600 }, 0)

syncService.sync({ force: true }).then((result) => {
  const items = repository.getAll()
  assert.strictEqual(lastSyncPayload.some((item) => item.id === 'local-deleted' && item.deleted), true)
  assert.strictEqual(items.find((item) => item.id === 'remote-new').title, '云端新版')
  assert.strictEqual(items.some((item) => item.id === 'remote-deleted'), false)
  assert.strictEqual(result.uploaded, 2)
  assert.strictEqual(result.downloaded, 2)

  const revision = repository.getSyncMeta().revision
  repository.add({ id: 'during-sync', title: '同步期间新增', type: 'chore', updatedAt: 700 })
  assert.strictEqual(repository.replaceFromSync([], {}, Date.now(), revision), false)
  assert.strictEqual(repository.getById('during-sync').title, '同步期间新增')

  syncService.setAutoSync(false)
  return syncService.sync()
}).then((result) => {
  assert.strictEqual(result.disabled, true)
  return syncService.verifyAccessKey('test-key')
}).then((result) => {
  assert.strictEqual(result.authorized, true)
  assert.strictEqual(syncService.getSettings().authorized, true)
  assert.strictEqual(syncService.getSettings().role, 'admin')
  return syncService.listAccessKeys()
}).then((result) => {
  assert.strictEqual(result.keys[0].keyId, 'key-1')
  return syncService.createAccessKey('备用手机', 9999999999999)
}).then((result) => {
  assert.strictEqual(result.key, 'MD-test')
  return syncService.revokeAccessKey('key-1')
}).then(() => {
  assert.strictEqual(revokedKeyId, 'key-1')
  return syncService.getNotificationSettings()
}).then((result) => {
  assert.strictEqual(result.settings.time, '08:30')
  return syncService.saveNotificationSettings({ enabled: true, time: '09:00', scopes: { today: true, week: false, overdue: true } })
}).then((result) => {
  assert.strictEqual(result.settings.time, '09:00')
  return syncService.markNotificationSubscribed()
}).then((result) => {
  assert.strictEqual(result.subscriptionReady, true)
  console.log('sync-auth-notification-key-management-and-merge-ok')
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
