const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const items = db.collection('items')
const PAGE_SIZE = 100
const MAX_RECORDS = 1000
const ALLOWED_TYPES = new Set(['idea', 'todo', 'chore', 'schedule'])
const OWNER_DOCUMENT_ID = 'sync_owner'
const NOTIFY_CONFIG_ID = 'notify_config'
const DEFAULT_NOTIFY_TEMPLATE_ID = 'WDghYFVSF0JgZSuRSYvL_6NstPBjfCOT8TvJNP5u7Jw'
const NOTIFY_TEMPLATE_FIELDS = { reminder: 'thing2', taskName: 'thing31', deadlineTime: 'time38', urgency: 'thing8', remark: 'thing11' }

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex')
const attemptDocumentId = (openid) => `a_${hash(openid).slice(0, 30)}`
const itemDocumentId = (openid, itemId) => `i_${hash(`${openid}:${itemId}`).slice(0, 30)}`
const response = (ok, data = {}) => ({ ok, ...data })

const getDocument = async (id) => {
  try {
    const result = await items.doc(id).get()
    return result.data || null
  } catch (error) {
    return null
  }
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
  if (!key || key.recordType !== 'syncKey' || key.revokedAt) {
    return { authorized: false, role: 'none', code: 'ACCESS_REVOKED', message: '同步密钥已被管理员收回' }
  }
  if (Number(key.expiresAt) <= Date.now()) {
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
    if (accessKey.revokedAt) return response(false, { code: 'ACCESS_REVOKED', message: '该同步密钥已被管理员收回' })
    if (Number(accessKey.expiresAt) <= Date.now()) return response(false, { code: 'ACCESS_EXPIRED', message: '该同步密钥已过期，请联系管理员获取新密钥' })
    if (accessKey.claimedBy && accessKey.claimedBy !== openid) return response(false, { code: 'KEY_USED', message: '该同步密钥已被其他账号使用' })
    const now = Date.now()
    const claim = await items.where({ _id: accessKey._id, claimedBy: '' }).update({ data: { claimedBy: openid, claimedAt: now, updatedAt: now } })
    if (!claim.stats || claim.stats.updated !== 1) return response(false, { code: 'KEY_USED', message: '该同步密钥已被其他账号使用' })
    await items.doc(grantDocumentId(openid)).set({ data: { recordType: 'syncGrant', ownerOpenid: openid, keyId: accessKey.keyId, createdAt: now, updatedAt: now } })
    return response(true, { authorized: true, role: 'member', expiresAt: Number(accessKey.expiresAt) })
  }
  const actual = hash(String(key || ''))
  if (!crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))) return recordFailedAttempt(openid, '同步密钥不正确')
  const now = Date.now()
  await items.doc(OWNER_DOCUMENT_ID).set({ data: { recordType: 'syncAdmin', ownerOpenid: openid, verifiedAt: now, updatedAt: now } })
  try { await items.doc(attemptDocumentId(openid)).remove() } catch (error) {}
  return response(true, { authorized: true, role: 'admin', expiresAt: 0 })
}

const recordFailedAttempt = async (openid, invalidMessage) => {
  const id = attemptDocumentId(openid)
  const current = await getDocument(id)
  const now = Date.now()
  if (current && Number(current.lockedUntil) > now) {
    return response(false, { code: 'TOO_MANY_ATTEMPTS', message: '验证次数过多，请稍后再试' })
  }
  const failedAttempts = (Number(current && current.failedAttempts) || 0) + 1
  const lockedUntil = failedAttempts >= 5 ? now + 15 * 60 * 1000 : 0
  await items.doc(id).set({ data: { recordType: 'syncAttempt', ownerOpenid: openid, failedAttempts: lockedUntil ? 0 : failedAttempts, lockedUntil, updatedAt: now } })
  return response(false, { code: lockedUntil ? 'TOO_MANY_ATTEMPTS' : 'INVALID_KEY', message: lockedUntil ? '验证次数过多，请稍后再试' : invalidMessage })
}

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
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return response(false, { code: 'INVALID_EXPIRY', message: '过期时间必须晚于当前时间' })
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
  lastSentDate: '',
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
  const previous = await getDocument(notifyDocumentId(openid))
  const now = Date.now()
  const data = {
    ...notificationDefaults,
    ...(previous && previous.recordType === 'notifySettings' ? previous : {}),
    recordType: 'notifySettings', ownerOpenid: openid, enabled: Boolean(event.enabled), time, scopes, miniprogramState,
    createdAt: previous && previous.createdAt ? previous.createdAt : now, updatedAt: now
  }
  delete data._id
  delete data._openid
  await items.doc(notifyDocumentId(openid)).set({ data })
  return response(true, { settings: data })
}

const markNotificationSubscribed = async (openid, event = {}) => {
  const access = await getAccess(openid)
  if (!access.authorized) return response(false, { code: access.code, message: access.message })
  const config = await getDocument(NOTIFY_CONFIG_ID)
  const templateId = config && config.recordType === 'notifyConfig' ? config.templateId : DEFAULT_NOTIFY_TEMPLATE_ID
  if (!templateId) return response(false, { code: 'TEMPLATE_MISSING', message: '管理员尚未配置微信订阅消息模板' })
  const previous = await getDocument(notifyDocumentId(openid))
  const now = Date.now()
  const data = {
    ...notificationDefaults,
    ...(previous && previous.recordType === 'notifySettings' ? previous : {}),
    recordType: 'notifySettings', ownerOpenid: openid, subscriptionReady: true,
    miniprogramState: ['developer', 'trial', 'formal'].includes(event && event.miniprogramState) ? event.miniprogramState : ((previous && previous.miniprogramState) || 'developer'),
    createdAt: previous && previous.createdAt ? previous.createdAt : now, updatedAt: now
  }
  delete data._id
  delete data._openid
  await items.doc(notifyDocumentId(openid)).set({ data })
  return response(true, { subscriptionReady: true })
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

const sanitize = (record) => {
  if (!record || typeof record !== 'object') return null
  const id = typeof record.id === 'string' ? record.id.slice(0, 128) : ''
  if (!id) return null
  const updatedAt = Math.max(0, Number(record.updatedAt) || 0)
  if (record.deleted) return { id, deleted: true, updatedAt }
  if (!ALLOWED_TYPES.has(record.type) || typeof record.title !== 'string') return null
  const clean = JSON.parse(JSON.stringify(record))
  delete clean._id
  delete clean._openid
  delete clean.recordType
  delete clean.ownerOpenid
  delete clean.itemId
  clean.id = id
  clean.deleted = false
  clean.updatedAt = updatedAt
  clean.title = clean.title.slice(0, 80)
  if (typeof clean.content === 'string') clean.content = clean.content.slice(0, 1000)
  return clean
}

const syncItems = async (openid, incoming) => {
  if (!Array.isArray(incoming) || incoming.length > MAX_RECORDS) {
    return response(false, { code: 'INVALID_DATA', message: '同步数据格式无效或数量过多' })
  }
  const localRecords = incoming.map(sanitize).filter(Boolean)
  if (localRecords.length !== incoming.length) return response(false, { code: 'INVALID_DATA', message: '同步数据中包含无效事项' })

  const owned = await getAll(items.where({ ownerOpenid: openid }))
  const legacy = await getAll(items.where({ _openid: openid }))
  const remoteMap = new Map()
  const addRemote = (document) => {
    if (document.recordType && document.recordType !== 'item') return
    const clean = sanitize({ ...document, id: document.itemId || document.id || document._id })
    if (!clean) return
    const previous = remoteMap.get(clean.id)
    if (!previous || clean.updatedAt >= previous.record.updatedAt) remoteMap.set(clean.id, { record: clean, documentId: document._id, legacy: document.recordType !== 'item' })
  }
  owned.forEach(addRemote)
  legacy.forEach(addRemote)

  const localMap = new Map(localRecords.map((record) => [record.id, record]))
  const ids = new Set([...localMap.keys(), ...remoteMap.keys()])
  const merged = []
  const writes = []
  let uploaded = 0
  let downloaded = 0

  ids.forEach((id) => {
    const local = localMap.get(id)
    const remoteEntry = remoteMap.get(id)
    const remote = remoteEntry && remoteEntry.record
    const localTime = local ? local.updatedAt : -1
    const remoteTime = remote ? remote.updatedAt : -1
    const winner = !remote || (local && localTime >= remoteTime) ? local : remote
    if (!winner) return
    merged.push(winner)
    if (!remote || localTime > remoteTime || (remoteEntry && remoteEntry.legacy)) {
      writes.push(winner)
      if (!remote || localTime > remoteTime) uploaded += 1
    } else if (!local || remoteTime > localTime) downloaded += 1
  })

  for (let index = 0; index < writes.length; index += 10) {
    await Promise.all(writes.slice(index, index + 10).map((record) => {
      const data = { ...record, recordType: 'item', ownerOpenid: openid, itemId: record.id }
      delete data.id
      return items.doc(itemDocumentId(openid, record.id)).set({ data })
    }))
  }
  const legacyIds = legacy.filter((document) => document.recordType !== 'item').map((document) => document._id)
  for (let index = 0; index < legacyIds.length; index += 10) {
    await Promise.all(legacyIds.slice(index, index + 10).map((id) => items.doc(id).remove()))
  }
  return response(true, { authorized: true, records: merged, uploaded, downloaded })
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
  if (action !== 'sync') return response(false, { code: 'INVALID_ACTION', message: '不支持的操作' })
  const access = await getAccess(OPENID)
  if (!access.authorized) return response(false, { code: access.code, message: access.message })
  return syncItems(OPENID, event.records)
}
