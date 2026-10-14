const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const { createHarness } = require('./cloudHarness')
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
const itemId = (user, id) => 'i_' + hash(`${user}:${id}`).slice(0, 30)
const grantId = (user) => 'sync_grant_' + hash(user).slice(0, 24)
const notifyId = (user) => 'notify_' + hash(user).slice(0, 24)
const owner = { sync_owner: { recordType: 'syncAdmin', ownerOpenid: 'admin' } }
const record = (id, updatedAt, title = id) => ({ id, type: 'chore', title, date: '2026-10-13', updatedAt })
let passed = 0
const test = async (name, fn) => { await fn(); passed += 1; console.log('PASS', name) }

const main = async () => {
  await test('concurrent stale upload cannot overwrite newer cloud record', async () => {
    const h = createHarness('cloudfunctions/planoteSync/index.js', owner)
    await Promise.all([h.main({ action: 'sync', records: [record('x', 300)], uploadOnly: true }), h.main({ action: 'sync', records: [record('x', 200)], uploadOnly: true })])
    assert.equal(h.docs().get(itemId('admin', 'x')).updatedAt, 300)
    await h.main({ action: 'sync', records: [record('x', 300, 'conflicting tie')], uploadOnly: true })
    assert.equal(h.docs().get(itemId('admin', 'x')).title, 'x')
  })
  await test('cloud synchronization respects user isolation', async () => {
    const h = createHarness('cloudfunctions/planoteSync/index.js', { ...owner, secret: { recordType: 'item', ownerOpenid: 'another', itemId: 'secret', ...record('secret', 400) } })
    const result = await h.main({ action: 'pull' })
    assert.equal(result.records.length, 0)
    h.state.context.OPENID = 'stranger'
    assert.equal((await h.main({ action: 'sync', records: [record('x', 100)] })).code, 'UNAUTHORIZED')
  })
  await test('invalid types, duplicate IDs, large payloads and future clock rejected before writes', async () => {
    const h = createHarness('cloudfunctions/planoteSync/index.js', owner)
    for (const records of [[{ ...record('x', 100), deadlineDate: 123 }], [record('x', 100), record('x', 200)], [record('x', Date.now() + 600000)], [{ ...record('x', 100), content: 'x'.repeat(1001) }]]) {
      assert.equal((await h.main({ action: 'sync', records, uploadOnly: true })).code, 'INVALID_DATA')
    }
    assert.equal(h.docs().size, 1)
  })
  await test('database outage is propagated rather than treated as empty owner', async () => {
    const h = createHarness('cloudfunctions/planoteSync/index.js', owner)
    h.state.readError = new Error('database unavailable')
    await assert.rejects(h.main({ action: 'verify', key: 'master' }), /unavailable/)
    assert.equal(h.docs().get('sync_owner').ownerOpenid, 'admin')
  })
  await test('key claim and grant rollback together; same owner can retry', async () => {
    const h = createHarness('cloudfunctions/planoteSync/index.js', { ...owner, sync_key_k: { recordType: 'syncKey', keyId: 'k', keyHash: hash('key'), expiresAt: 0, claimedBy: '' } })
    h.state.context.OPENID = 'member'; h.state.failWrite = grantId('member')
    await assert.rejects(h.main({ action: 'verify', key: 'key' }), /write failure/)
    assert.equal(h.docs().get('sync_key_k').claimedBy, '')
    h.state.failWrite = ''
    h.docs().get('sync_key_k').claimedBy = 'member'
    assert.equal((await h.main({ action: 'verify', key: 'key' })).authorized, true)
    assert.equal(h.docs().get(grantId('member')).keyId, 'k')
    assert.equal((await h.main({ action: 'status' })).expiresAt, 0)
  })
  await test('concurrent failed key attempts enforce lockout', async () => {
    const h = createHarness('cloudfunctions/planoteSync/index.js', owner)
    h.state.context.OPENID = 'member'
    await Promise.all(Array.from({ length: 5 }, () => h.main({ action: 'verify', key: 'wrong' })))
    assert.equal((await h.main({ action: 'verify', key: 'wrong' })).code, 'TOO_MANY_ATTEMPTS')
  })
  await test('client cannot spoof timer payload or call batch entry', async () => {
    const h = createHarness('cloudfunctions/planoteNotify/index.js', owner)
    for (const event of [{}, { action: 'unexpected' }, { Type: 'Timer', TriggerName: 'planoteDailyReminder' }]) assert.equal((await h.main(event)).code, 'FORBIDDEN')
    assert.equal(h.state.sent.length, 0)
  })
  const reminderData = () => ({ ...owner, [notifyId('admin')]: { recordType: 'notifySettings', ownerOpenid: 'admin', enabled: true, subscriptionReady: true, time: '00:00', scopes: { today: true }, lastSentDate: '' }, [itemId('admin', 'meeting')]: { recordType: 'item', ownerOpenid: 'admin', itemId: 'meeting', type: 'schedule', title: '今日会议', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), completed: false } })
  await test('concurrent timer runs send once and include today schedule', async () => {
    const h = createHarness('cloudfunctions/planoteNotify/index.js', reminderData())
    h.state.context = { SOURCE: 'wx_trigger' }
    await Promise.all([h.main({ Type: 'Timer', TriggerName: 'planoteDailyReminder' }), h.main({ Type: 'Timer', TriggerName: 'planoteDailyReminder' })])
    assert.equal(h.state.sent.length, 1)
    assert.equal(h.state.sent[0].data.thing31.value, '今日会议')
    assert.equal(h.docs().get(notifyId('admin')).subscriptionReady, false)
  })
  await test('ambiguous send failure is not retried', async () => {
    const h = createHarness('cloudfunctions/planoteNotify/index.js', reminderData())
    h.state.context = { SOURCE: 'wx_trigger' }; h.state.sendError = new Error('network timeout')
    await h.main({ Type: 'Timer', TriggerName: 'planoteDailyReminder' })
    h.docs().get(notifyId('admin')).subscriptionReady = true
    await h.main({ Type: 'Timer', TriggerName: 'planoteDailyReminder' })
    assert.equal(h.state.sent.length, 1)
  })
  await test('renewal during send is preserved', async () => {
    const h = createHarness('cloudfunctions/planoteNotify/index.js', reminderData())
    h.state.context = { SOURCE: 'wx_trigger' }
    h.state.sendHook = async () => { h.docs().get(notifyId('admin')).subscriptionReady = true }
    await h.main({ Type: 'Timer', TriggerName: 'planoteDailyReminder' })
    assert.equal(h.docs().get(notifyId('admin')).subscriptionReady, true)
  })
  await test('more than 1000 records including deletions sync through bounded batches', async () => {
    const h = createHarness('cloudfunctions/planoteSync/index.js', owner)
    global.wx = { cloud: { callFunction: async ({ data }) => ({ result: await h.main(data) }) } }
    const client = require('../services/cloudService')
    const incoming = Array.from({ length: 1001 }, (_, i) => i % 2 ? record('r' + i, 100) : { id: 'r' + i, deleted: true, updatedAt: 100 })
    const result = await client.syncItems(incoming)
    assert.equal(result.records.length, 1001)
    assert.equal(new Set(result.records.map((entry) => entry.id)).size, 1001)
  })
  const storage = {}
  let failStorage = false
  global.wx = { getStorageSync: (key) => storage[key] && structuredClone(storage[key]), setStorageSync: (key, value) => { if (failStorage && key === 'planote_state_v2') throw new Error('storage full'); storage[key] = structuredClone(value) }, showToast() {}, cloud: null }
  const repository = require('../repositories/itemRepository')
  const service = require('../services/itemService')
  await test('invalid backup cannot overwrite valid local records', async () => {
    const saved = service.save({ type: 'idea', title: 'keep', content: '' })
    assert.throws(() => service.importItems([{ ...record('bad', 100), deadlineDate: 123 }]), /日期/)
    assert.equal(repository.getById(saved.id).title, 'keep')
    assert.throws(() => service.prepareImport([{ ...record('bad', 100), date: '2026-02-30' }]), /日期/)
  })
  await test('merge restores a deleted identity as independent new item', async () => {
    service.importItems([record('old-id', 1)], { mode: 'merge' })
    assert.equal(repository.getById('old-id'), null)
    assert(repository.getAll().some((entry) => entry.title === 'old-id' && entry.id !== 'old-id'))
    assert(repository.getRecovery())
  })
  await test('local restoration pauses all automatic and manual sync', async () => {
    service.importItems([record('restore', 1)], { mode: 'local' })
    assert.equal(service.getSyncSettings().restorePaused, true)
    assert.equal(service.getSyncSettings().autoSync, false)
    assert.equal(repository.getAll().length, 1)
    assert.equal(repository.getSyncMeta().deletions['old-id'], undefined)
    assert.equal((await service.sync()).restorePaused, true)
    await assert.rejects(service.sync({ manual: true }), /暂停同步/)
  })
  await test('item and sync revision commit atomically on storage failure', async () => {
    const before = repository.getSyncMeta().revision
    failStorage = true
    assert.throws(() => service.save({ type: 'idea', title: 'should not exist', content: '' }), /storage full/)
    failStorage = false
    assert.equal(repository.getSyncMeta().revision, before)
    assert.equal(repository.getAll().length, 1)
  })
  await test('editor scope switch clears hidden deadline and double save does not duplicate', async () => {
    let definition; global.Page = (page) => { definition = page }
    global.wx.setNavigationBarTitle = () => {}
    require('../pages/editor/index')
    const page = { ...definition, data: structuredClone(definition.data), setData(update) { for (const [key, value] of Object.entries(update)) { if (key.startsWith('form.')) this.data.form[key.slice(5)] = value; else this.data[key] = value } } }
    page.onLoad({ type: 'todo', scope: 'day' })
    page.chooseScope({ currentTarget: { dataset: { value: 'year' } } })
    assert.equal(page.data.form.deadlineDate, '')
    page.data.form.title = 'year goal'
    const before = repository.getAll().length
    const timer = global.setTimeout; global.setTimeout = () => 0
    try { page.save(); page.save() } finally { global.setTimeout = timer }
    assert.equal(repository.getAll().length, before + 1)
    assert.equal(page.data.saving, true)
  })
  await test('same-day deadline is consistently overdue on dashboard', async () => {
    const now = new Date(2026, 9, 13, 15, 0)
    service.save({ type: 'todo', taskScope: 'day', title: 'expired', content: '', date: '2026-10-13', deadlineDate: '2026-10-13', deadlineTime: '09:00' })
    assert(service.getDashboard(now).overdueTodos.some((item) => item.title === 'expired'))
  })
  await test('validation source matches deployed cloud-function copy', async () => {
    assert.equal(fs.readFileSync('utils/itemValidation.js', 'utf8'), fs.readFileSync('cloudfunctions/planoteSync/itemValidation.js', 'utf8'))
  })
  await test('repeated subscriptions accumulate and sending consumes one', async () => {
    const h = createHarness('cloudfunctions/planoteSync/index.js', { ...owner, [notifyId('admin')]: { recordType: 'notifySettings', ownerOpenid: 'admin', enabled: true, time: '00:00', subscriptionReady: false, scopes: { today: true } } })
    await h.main({ action: 'markNotificationSubscribed' })
    await h.main({ action: 'markNotificationSubscribed' })
    assert.equal(h.docs().get(notifyId('admin')).subscriptionCredits, 2)
    const notify = createHarness('cloudfunctions/planoteNotify/index.js', Object.fromEntries(h.docs()))
    notify.state.context = { SOURCE: 'wx_trigger' }
    await notify.main({ Type: 'Timer', TriggerName: 'planoteDailyReminder' })
    assert.equal(notify.docs().get(notifyId('admin')).subscriptionCredits, 1)
    assert.equal(notify.docs().get(notifyId('admin')).subscriptionReady, true)
  })
  await test('failed download page leaves local items and revision untouched', async () => {
    storage.planote_sync_settings_v1 = { authorized: true, autoSync: false, role: 'admin', restorePaused: false }
    let pages = 0
    global.wx.cloud = { callFunction: async ({ data }) => {
      if (data.action === 'sync') return { result: { ok: true, uploaded: data.records.length } }
      pages += 1
      if (pages === 1) return { result: { ok: true, records: [record('remote-page', 500)], hasMore: true, cursor: 'next' } }
      return { result: { ok: false, message: 'second page failed' } }
    } }
    const before = repository.getAll(), revision = repository.getSyncMeta().revision
    await assert.rejects(service.sync({ force: true, manual: true }), /second page failed/)
    assert.deepEqual(repository.getAll(), before)
    assert.equal(repository.getSyncMeta().revision, revision)
    assert.match(service.getSyncSettings().lastError, /second page failed/)
    global.wx.cloud = null
  })
  await test('undo restores completion and annual progress without overwriting later edits', async () => {
    const actions = require('../services/pageActions')
    const goal = service.save({ type: 'todo', taskScope: 'year', title: 'undo goal', content: '', year: 2026, yearStartDate: '2026-01-01', yearEndDate: '2026-12-31', progress: 35 })
    const page = { data: {}, setData(update) { Object.assign(this.data, update) } }
    actions.toggle(page, goal.id, () => {})
    assert.equal(service.getById(goal.id).progress, 100)
    actions.undo(page)
    assert.equal(service.getById(goal.id).completed, false)
    assert.equal(service.getById(goal.id).progress, 35)
    actions.toggle(page, goal.id, () => {})
    service.save({ ...service.getById(goal.id), title: 'changed later' })
    actions.undo(page)
    assert.equal(service.getById(goal.id).completed, true)
    assert.equal(service.getById(goal.id).title, 'changed later')
  })
  await test('incremental cloud reads filter unchanged items but return upload conflict winner', async () => {
    const initial = { ...owner }
    initial[itemId('admin', 'old')] = { ...record('old', 100, 'persisted'), itemId: 'old', recordType: 'item', ownerOpenid: 'admin', serverUpdatedAt: 100 }
    initial[itemId('admin', 'changed')] = { ...record('changed', 300), itemId: 'changed', recordType: 'item', ownerOpenid: 'admin', serverUpdatedAt: 300 }
    const h = createHarness('cloudfunctions/planoteSync/index.js', initial)
    const delta = await h.main({ action: 'pull', since: 200 })
    assert.equal(delta.records.length, 1)
    assert.equal(delta.records[0].id, 'changed')
    const previousWx = global.wx
    global.wx = { cloud: { callFunction: async ({ data }) => ({ result: await h.main(data) }) } }
    try {
      const result = await require('../services/cloudService').syncItems([record('old', 100, 'tie should lose')], { since: 200 })
      assert.equal(result.full, false)
      assert.equal(result.records.find((item) => item.id === 'old').title, 'persisted')
    } finally { global.wx = previousWx }
  })
  await test('incremental client applies changes and retains unchanged local items', async () => {
    repository.replaceFromSync([record('keep', 100), record('change', 100)], {}, Date.now(), undefined, 1000)
    storage.planote_sync_settings_v1 = { authorized: true, autoSync: false, role: 'admin', restorePaused: false }
    let uploaded = null
    global.wx.cloud = { callFunction: async ({ data }) => {
      if (data.action === 'sync') { uploaded = data.records; return { result: { ok: true, uploaded: 0, records: [] } } }
      assert.equal(data.since, 1000)
      return { result: { ok: true, records: [record('change', 200, 'cloud changed')], serverTime: 2000, hasMore: false } }
    } }
    await service.sync({ force: true, manual: true })
    assert.equal(uploaded.length, 0)
    assert.equal(repository.getById('keep').title, 'keep')
    assert.equal(repository.getById('change').title, 'cloud changed')
    assert.equal(repository.getSyncMeta().cloudSince, 2000)
    global.wx.cloud = null
  })
  await test('local erasure removes legacy caches and recovery without uploading deletes', async () => {
    storage.planote_items_v1 = [record('legacy', 100)]
    storage.planote_sync_meta_v1 = { deletions: {} }
    repository.saveRecovery()
    global.wx.removeStorageSync = (key) => { delete storage[key] }
    service.forgetLocalData()
    assert.equal(repository.getAll().length, 0)
    assert.equal(repository.getRecovery(), null)
    assert.equal(storage.planote_items_v1, undefined)
    assert.equal(storage.planote_sync_meta_v1, undefined)
    assert.deepEqual(repository.getSyncMeta().deletions, {})
    assert.equal(service.getSyncSettings().restorePaused, true)
  })
  console.log(`Reliability checks passed: ${passed}`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
