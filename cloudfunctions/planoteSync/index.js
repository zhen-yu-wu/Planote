const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const items = db.collection('items')
const PAGE_SIZE = 100
const MAX_RECORDS = 1000
const { validateItem } = require('./itemValidation')
const OWNER_DOCUMENT_ID = 'sync_owner'
const NOTIFY_CONFIG_ID = 'notify_config'
const DEFAULT_NOTIFY_TEMPLATE_ID = 'WDghYFVSF0JgZSuRSYvL_6NstPBjfCOT8TvJNP5u7Jw'
const NOTIFY_TEMPLATE_FIELDS = { reminder: 'thing2', taskName: 'thing31', deadlineTime: 'time38', urgency: 'thing8', remark: 'thing11' }

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex')
const attemptDocumentId = (openid) => `a_${hash(openid).slice(0, 30)}`
const itemDocumentId = (openid, itemId) => `i_${hash(`${openid}:${itemId}`).slice(0, 30)}`
const response = (ok, data = {}) => ({ ok, ...data })

const getDocument = async (id, collection = items) => {
  try {
    const result = await collection.doc(id).get()
    return result.data || null
  } catch (error) {
    if (error.code === 'DATABASE_DOCUMENT_NOT_EXIST' || /\bdocument\b(?![.])(?:\s+[\w'".-]+){0,3}\s+(?:not found|(?:does|is) not exists?|not exists?)\b|文档[^：:]*不存在/i.test(error.errMsg || error.message || '')) return null
    throw error
  }
}

const transact = async (callback) => {
  const result = await db.runTransaction(callback)
  return result && Object.prototype.hasOwnProperty.call(result, 'result') ? result.result : result
}

const keyDocumentId = (keyId) => `sync_key_${keyId}`
const grantDocumentId = (openid) => `sync_grant_${hash(openid).slice(0, 24)}`
const notifyDocumentId = (openid) => `notify_${hash(openid).slice(0, 24)}`

const getAccess = async (openid) => {
  const owner = await getDocument(OWNER_DOCUMENT_ID)
  if (owner && ['syncOwner', 'syncAdmin'].includes(owner.recordType) && owner.ownerOpenid === openid) {
    return { authorized: true, role: 'admin', expiresAt: 0 }
  }
  const grant = await getDocument(grantDocumentId(openid))
  if (!grant || grant.recordType !== 'syncGrant' || grant.ownerOpenid !== openid) {
    return { authorized: false, role: 'none', code: 'UNAUTHORIZED', message: '当前账号尚未获得同步权限' }
  }
  const key = await getDocument(keyDocumentId(grant.keyId))
  if (!key || key.recordType !== 'syncKey' || key.revokedAt || key.claimedBy !== openid || !Number.isFinite(Number(key.expiresAt))) {
    return { authorized: false, role: 'none', code: 'ACCESS_REVOKED', message: '同步密钥已被管理员收回' }
  }
  if (Number(key.expiresAt) !== 0 && Number(key.expiresAt) <= Date.now()) {
    return { authorized: false, role: 'none', code: 'ACCESS_EXPIRED', message: '同步权限已过期，请联系管理员获取新密钥' }
  }
  return { authorized: true, role: 'member', expiresAt: Number(key.expiresAt), keyId: key.keyId }
}

const verifyKey = async (openid, key) => {
  const expected = String(process.env.SYNC_ACCESS_KEY_HASH || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(expected)) return response(false, { code: 'CONFIG_MISSING', message: '服务端尚未配置同步密钥' })
  const attempt = await getDocument(attemptDocumentId(openid))
  if (attempt && Number(attempt.lockedUntil) > Date.now()) return response(false, { code: 'TOO_MANY_ATTEMPTS', message: '验证次数过多，请稍后再试' })
  const owner = await getDocument(OWNER_DOCUMENT_ID)
  if (owner) {
    const currentAccess = await getAccess(openid)
    if (currentAccess.authorized) return response(true, currentAccess)
    const actual = hash(String(key || ''))
    const matches = await getAll(items.where({ recordType: 'syncKey', keyHash: actual }))
    const accessKey = matches[0]
    if (!accessKey) return recordFailedAttempt(openid, '同步密钥不正确')
    return transact(async (transaction) => {
      const collection = transaction.collection('items')
      const current = await getDocument(accessKey._id, collection)
      if (!current || current.revokedAt) return response(false, { code: 'ACCESS_REVOKED', message: '该同步密钥已被收回' })
      if (!Number.isFinite(Number(current.expiresAt))) return response(false, { code: 'INVALID_EXPIRY', message: '密钥有效期配置异常，请联系管理员' })
      if (Number(current.expiresAt) !== 0 && Number(current.expiresAt) <= Date.now()) return response(false, { code: 'ACCESS_EXPIRED', message: '该同步密钥已过期' })
      if (current.claimedBy && current.claimedBy !== openid) return response(false, { code: 'KEY_USED', message: '该同步密钥已被其他账号使用' })
      const now = Date.now()
      await collection.doc(current._id).update({ data: { claimedBy: openid, claimedAt: current.claimedAt || now, updatedAt: now } })
      await collection.doc(grantDocumentId(openid)).set({ data: { recordType: 'syncGrant', ownerOpenid: openid, keyId: current.keyId, createdAt: now, updatedAt: now } })
      return response(true, { authorized: true, role: 'member', expiresAt: Number(current.expiresAt) })
    })
  }
  const actual = hash(String(key || ''))
  if (!crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))) return recordFailedAttempt(openid, '同步密钥不正确')
  const now = Date.now()
  const initialized = await transact(async (transaction) => {
    const collection = transaction.collection('items')
    const current = await getDocument(OWNER_DOCUMENT_ID, collection)
    if (current && current.ownerOpenid !== openid) return false
    if (!current) await collection.doc(OWNER_DOCUMENT_ID).set({ data: { recordType: 'syncAdmin', ownerOpenid: openid, verifiedAt: now, updatedAt: now } })
    return true
  })
  if (!initialized) return response(false, { code: 'ADMIN_EXISTS', message: '管理员已设置，请使用分发密钥' })
  try { await items.doc(attemptDocumentId(openid)).remove() } catch (error) {}
  return response(true, { authorized: true, role: 'admin', expiresAt: 0 })
}

const recordFailedAttempt = async (openid, invalidMessage) => transact(async (transaction) => {
  const collection = transaction.collection('items')
  const id = attemptDocumentId(openid)
  const current = await getDocument(id, collection)
  const now = Date.now()
  if (current && Number(current.lockedUntil) > now) return response(false, { code: 'TOO_MANY_ATTEMPTS', message: '验证次数过多，请稍后再试' })
  const failedAttempts = (Number(current && current.failedAttempts) || 0) + 1
  const lockedUntil = failedAttempts >= 5 ? now + 15 * 60 * 1000 : 0
  await collection.doc(id).set({ data: { recordType: 'syncAttempt', ownerOpenid: openid, failedAttempts: lockedUntil ? 0 : failedAttempts, lockedUntil, updatedAt: now } })
  return response(false, { code: lockedUntil ? 'TOO_MANY_ATTEMPTS' : 'INVALID_KEY', message: lockedUntil ? '验证次数过多，请稍后再试' : invalidMessage })
})

const requireAdmin = async (openid) => {
  const access = await getAccess(openid)
  return access.authorized && access.role === 'admin'
}

const listKeys = async (openid) => {
  if (!(await requireAdmin(openid))) return response(false, { code: 'ADMIN_REQUIRED', message: '仅管理员可以管理分发密钥' })
  const records = await getAll(items.where({ recordType: 'syncKey' }))
  return response(true, { keys: records.map(({ _id, keyHash, claimedBy, ownerOpenid, _openid, ...item }) => ({ ...item, claimed: Boolean(claimedBy) })).sort((a, b) => b.createdAt - a.createdAt) })
}

const createKey = async (openid, event) => {
  if (!(await requireAdmin(openid))) return response(false, { code: 'ADMIN_REQUIRED', message: '仅管理员可以创建分发密钥' })
  const expiresAt = Number(event.expiresAt)
  if (!Number.isFinite(expiresAt) || (expiresAt !== 0 && expiresAt <= Date.now())) return response(false, { code: 'INVALID_EXPIRY', message: '过期时间必须晚于当前时间' })
  const label = String(event.label || '未命名密钥').trim().slice(0, 30) || '未命名密钥'
  const rawKey = `MD-${crypto.randomBytes(12).toString('base64url')}`
  const keyId = crypto.randomBytes(8).toString('hex')
  const now = Date.now()
  await items.doc(keyDocumentId(keyId)).set({ data: {
    recordType: 'syncKey', keyId, label, keyHash: hash(rawKey), keyPreview: `${rawKey.slice(0, 5)}••••${rawKey.slice(-4)}`,
    expiresAt, revokedAt: 0, claimedBy: '', claimedAt: 0, createdAt: now, updatedAt: now, ownerOpenid: openid
  } })
  return response(true, { key: rawKey, item: { keyId, label, keyPreview: `${rawKey.slice(0, 5)}••••${rawKey.slice(-4)}`, expiresAt, revokedAt: 0, claimed: false, createdAt: now } })
}

const revokeKey = async (openid, keyId) => {
  if (!(await requireAdmin(openid))) return response(false, { code: 'ADMIN_REQUIRED', message: '仅管理员可以收回分发密钥' })
  const document = await getDocument(keyDocumentId(String(keyId || '')))
  if (!document || document.recordType !== 'syncKey') return response(false, { code: 'NOT_FOUND', message: '没有找到这把密钥' })
  const now = Date.now()
  await items.doc(document._id).update({ data: { revokedAt: now, updatedAt: now } })
  return response(true, { revokedAt: now })
}

const notificationDefaults = {
  enabled: false,
  time: '08:00',
  scopes: { today: true, week: true, overdue: true },
  subscriptionReady: false,
  subscriptionCredits: 0,
  subscriptionRevision: 0,
  lastSentDate: '',
  lastAttemptDate: '',
  lastSentAt: 0,
  lastSendStatus: ''
}

const getNotificationSettings = async (openid) => {
  const access = await getAccess(openid)
  if (!access.authorized) return response(false, { code: access.code, message: access.message })
  const [settings, config] = await Promise.all([getDocument(notifyDocumentId(openid)), getDocument(NOTIFY_CONFIG_ID)])
  const safeConfig = config && config.recordType === 'notifyConfig' ? config : { templateId: DEFAULT_NOTIFY_TEMPLATE_ID, longTerm: false }
  return response(true, {
    settings: { ...notificationDefaults, ...(settings && settings.recordType === 'notifySettings' ? settings : {}), _id: undefined, ownerOpenid: undefined },
    templateConfigured: Boolean(safeConfig.templateId),
    templateId: safeConfig.templateId || '',
    longTerm: Boolean(safeConfig.longTerm),
    role: access.role
  })
}

const saveNotificationSettings = async (openid, event) => {
  const access = await getAccess(openid)
  if (!access.authorized) return response(false, { code: access.code, message: access.message })
  const time = String(event.time || '')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return response(false, { code: 'INVALID_TIME', message: '提醒时间格式不正确' })
  const scopes = {
    today: Boolean(event.scopes && event.scopes.today),
    week: Boolean(event.scopes && event.scopes.week),
    overdue: Boolean(event.scopes && event.scopes.overdue)
  }
  const miniprogramState = ['developer', 'trial', 'formal'].includes(event.miniprogramState) ? event.miniprogramState : 'developer'
  if (!scopes.today && !scopes.week && !scopes.overdue) return response(false, { code: 'INVALID_SCOPES', message: '请至少选择一种通知内容' })
  return transact(async (transaction) => {
    const collection = transaction.collection('items')
    const previous = await getDocument(notifyDocumentId(openid), collection)
    const now = Date.now()
    const data = {
      ...notificationDefaults,
      ...(previous && previous.recordType === 'notifySettings' ? previous : {}),
      recordType: 'notifySettings', ownerOpenid: openid, enabled: Boolean(event.enabled), time, scopes, miniprogramState,
      createdAt: previous && previous.createdAt ? previous.createdAt : now, updatedAt: now
    }
    delete data._id
    delete data._openid
    await collection.doc(notifyDocumentId(openid)).set({ data })
    return response(true, { settings: data })
  })
}

const markNotificationSubscribed = async (openid, event = {}) => {
  const access = await getAccess(openid)
  if (!access.authorized) return response(false, { code: access.code, message: access.message })
  const config = await getDocument(NOTIFY_CONFIG_ID)
  const templateId = config && config.recordType === 'notifyConfig' ? config.templateId : DEFAULT_NOTIFY_TEMPLATE_ID
  if (!templateId) return response(false, { code: 'TEMPLATE_MISSING', message: '管理员尚未配置微信订阅消息模板' })
  return transact(async (transaction) => {
    const collection = transaction.collection('items')
    const previous = await getDocument(notifyDocumentId(openid), collection)
    const now = Date.now()
    const data = {
      ...notificationDefaults,
      ...(previous && previous.recordType === 'notifySettings' ? previous : {}),
      recordType: 'notifySettings', ownerOpenid: openid, subscriptionReady: true,
      subscriptionCredits: Math.min(100, (Number(previous && previous.subscriptionCredits) || (previous && previous.subscriptionReady ? 1 : 0)) + 1),
      subscriptionRevision: (Number(previous && previous.subscriptionRevision) || 0) + 1,
      miniprogramState: ['developer', 'trial', 'formal'].includes(event && event.miniprogramState) ? event.miniprogramState : ((previous && previous.miniprogramState) || 'developer'),
      createdAt: previous && previous.createdAt ? previous.createdAt : now, updatedAt: now
    }
    delete data._id
    delete data._openid
    await collection.doc(notifyDocumentId(openid)).set({ data })
    return response(true, { subscriptionReady: true })
  })
}

const saveNotificationTemplate = async (openid, event) => {
  if (!(await requireAdmin(openid))) return response(false, { code: 'ADMIN_REQUIRED', message: '仅管理员可以配置通知模板' })
  const templateId = String(event.templateId || '').trim()
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(templateId)) return response(false, { code: 'INVALID_TEMPLATE', message: '订阅消息模板 ID 格式不正确' })
  const now = Date.now()
  await items.doc(NOTIFY_CONFIG_ID).set({ data: {
    recordType: 'notifyConfig', templateId, longTerm: Boolean(event.longTerm),
    fields: NOTIFY_TEMPLATE_FIELDS,
    updatedAt: now, ownerOpenid: openid
  } })
  return response(true, { templateConfigured: true, templateId, longTerm: Boolean(event.longTerm) })
}

const getAll = async (query) => {
  const records = []
  let offset = 0
  while (true) {
    const result = await query.skip(offset).limit(PAGE_SIZE).get()
    const page = result.data || []
    records.push(...page)
    if (page.length < PAGE_SIZE) return records
    offset += page.length
  }
}

const sanitize = (record, checkClock = false) => {
  try { return validateItem(record, { allowDeleted: true, checkClock }) } catch (error) { return null }
}
const writeRecord = async (openid, local) => transact(async (transaction) => {
  const collection = transaction.collection('items')
  const documentId = itemDocumentId(openid, local.id)
  const document = await getDocument(documentId, collection)
  const remote = document ? sanitize({ ...document, id: document.itemId }) : null
  if (document && !remote) throw new Error('云端事项格式异常，请联系维护者；未覆盖原始数据')
  // Ties prefer the persisted version; concurrent retries always re-read inside the transaction.
  const winner = !remote || local.updatedAt > remote.updatedAt ? local : remote
  const uploaded = winner === local
  if (uploaded) {
    const data = { ...winner, recordType: 'item', ownerOpenid: openid, itemId: winner.id, serverUpdatedAt: Date.now() }
    delete data.id
    await collection.doc(documentId).set({ data })
  }
  return { record: winner, uploaded }
})
const migrateLegacy = async (openid) => {
  const documents = await getAll(items.where({ _openid: openid }))
  for (const document of documents) {
    if (document.recordType && document.recordType !== 'item') continue
    if (document.recordType === 'item') continue
    const record = sanitize({ ...document, id: document.itemId || document.id || document._id })
    if (!record) throw new Error('旧版云端数据需要修复，未删除原始记录')
    await writeRecord(openid, record)
    if (document._id !== itemDocumentId(openid, record.id)) await items.doc(document._id).remove()
  }
}
const pullItems = async (openid, cursor = '', since = 0) => {
  if (typeof cursor !== 'string' || cursor.length > 128) return response(false, { code: 'INVALID_CURSOR', message: '分页参数无效' })
  if (!Number.isSafeInteger(since) || since < 0 || since > Date.now() + 300000) return response(false, { code: 'INVALID_CURSOR', message: '同步时间参数无效' })
  // Inclusive lower bound catches updates that share a millisecond with the previous read.
  // The next checkpoint is the beginning of the first page, never its end.
  const serverTime = Date.now()
  const filter = { ownerOpenid: openid, recordType: 'item' }
  if (cursor) filter._id = db.command.gt(cursor)
  if (since) filter.serverUpdatedAt = db.command.gte(since)
  const result = await items.where(filter).orderBy('_id', 'asc').limit(PAGE_SIZE).get()
  const page = result.data || []
  const records = page.map((doc) => sanitize({ ...doc, id: doc.itemId }))
  if (records.some((record) => !record)) return response(false, { code: 'INVALID_REMOTE_DATA', message: '云端存在格式异常的事项，本机数据未被替换' })
  return response(true, { records, serverTime, cursor: page.length === PAGE_SIZE ? page[page.length - 1]._id : '', hasMore: page.length === PAGE_SIZE })
}
const syncItems = async (openid, incoming, options = {}) => {
  if (!Array.isArray(incoming) || incoming.length > MAX_RECORDS || Buffer.byteLength(JSON.stringify(incoming), 'utf8') > 2 * 1024 * 1024) return response(false, { code: 'INVALID_DATA', message: '单批同步数据过大，请更新小程序后重试' })
  let records
  try { records = incoming.map((record) => validateItem(record, { allowDeleted: true, checkClock: true })) }
  catch (error) { return response(false, { code: 'INVALID_DATA', message: error.message }) }
  if (new Set(records.map((record) => record.id)).size !== records.length) return response(false, { code: 'INVALID_DATA', message: '同步事项 ID 重复' })
  if (options.migrateLegacy || !options.uploadOnly) await migrateLegacy(openid)
  let uploaded = 0
  const accepted = []
  for (let index = 0; index < records.length; index += 5) {
    const results = await Promise.all(records.slice(index, index + 5).map((record) => writeRecord(openid, record)))
    uploaded += results.filter((result) => result.uploaded).length
    accepted.push(...results.map((result) => result.record))
  }
  if (options.uploadOnly) return response(true, { uploaded, records: accepted })
  // Compatibility for previous clients; new clients download in bounded pages.
  const remote = await getAll(items.where({ ownerOpenid: openid, recordType: 'item' }))
  const merged = remote.map((doc) => sanitize({ ...doc, id: doc.itemId }))
  if (merged.some((record) => !record)) return response(false, { code: 'INVALID_REMOTE_DATA', message: '云端数据格式异常' })
  return response(true, { authorized: true, records: merged, uploaded, downloaded: merged.length })
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return response(false, { code: 'UNAUTHORIZED', message: '无法识别当前微信账号' })
  const action = event && event.action
  if (action === 'status') return response(true, await getAccess(OPENID))
  if (action === 'verify') return verifyKey(OPENID, event.key)
  if (action === 'listKeys') return listKeys(OPENID)
  if (action === 'createKey') return createKey(OPENID, event)
  if (action === 'revokeKey') return revokeKey(OPENID, event.keyId)
  if (action === 'getNotificationSettings') return getNotificationSettings(OPENID)
  if (action === 'saveNotificationSettings') return saveNotificationSettings(OPENID, event)
  if (action === 'markNotificationSubscribed') return markNotificationSubscribed(OPENID, event)
  if (action === 'saveNotificationTemplate') return saveNotificationTemplate(OPENID, event)
  if (!['sync', 'pull'].includes(action)) return response(false, { code: 'INVALID_ACTION', message: '不支持的操作' })
  const access = await getAccess(OPENID)
  if (!access.authorized) return response(false, { code: access.code, message: access.message })
  if (action === 'pull') return pullItems(OPENID, event.cursor || '', event.since || 0)
  return syncItems(OPENID, event.records, event)
}
