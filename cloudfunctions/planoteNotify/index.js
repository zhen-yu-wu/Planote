const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const items = db.collection('items')
const CONFIG_ID = 'notify_config'
const OWNER_ID = 'sync_owner'
const PAGE_SIZE = 100
const DEFAULT_TEMPLATE_ID = 'WDghYFVSF0JgZSuRSYvL_6NstPBjfCOT8TvJNP5u7Jw'

const getDocument = async (id) => {
  try {
    const result = await items.doc(id).get()
    return result.data || null
  } catch (error) {
    return null
  }
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

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex')
const grantDocumentId = (openid) => `sync_grant_${hash(openid).slice(0, 24)}`
const keyDocumentId = (keyId) => `sync_key_${keyId}`

const hasSyncAccess = async (openid) => {
  const owner = await getDocument(OWNER_ID)
  if (owner && ['syncOwner', 'syncAdmin'].includes(owner.recordType) && owner.ownerOpenid === openid) return true
  const grant = await getDocument(grantDocumentId(openid))
  if (!grant || grant.recordType !== 'syncGrant' || grant.ownerOpenid !== openid) return false
  const key = await getDocument(keyDocumentId(grant.keyId))
  return Boolean(key && key.recordType === 'syncKey' && !key.revokedAt && Number(key.expiresAt) > Date.now())
}

const shanghaiNow = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {})
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

const isOverdue = (item, today, currentTime) => {
  if (item.completed || item.deleted) return false
  if (item.deadlineDate && item.deadlineDate < today) return true
  if (item.deadlineDate === today && item.deadlineTime && item.deadlineTime < currentTime) return true
  if (item.type === 'chore') return Boolean(item.date && item.date < today)
  if (item.type !== 'todo') return false
  if (item.taskScope === 'day') return Boolean(item.date && item.date < today)
  if (item.taskScope === 'week') return Boolean(item.weekEndDate && item.weekEndDate < today)
  if (item.taskScope === 'year') return Boolean(item.yearEndDate && item.yearEndDate < today)
  return false
}

const summarize = (records, settings, today, currentTime) => {
  const active = records.filter((item) => item.recordType === 'item' && !item.completed && !item.deleted)
  const todayItems = active.filter((item) =>
    (item.type === 'todo' && item.taskScope === 'day' && item.date === today) ||
    (item.type === 'chore' && item.date === today)
  )
  const weekItems = active.filter((item) => item.type === 'todo' && item.taskScope === 'week' && item.weekStartDate <= today && item.weekEndDate >= today)
  const overdueItems = active.filter((item) => isOverdue(item, today, currentTime))
  const scopes = settings.scopes || {}
  const selected = []
  if (scopes.overdue) selected.push(...overdueItems)
  if (scopes.today) selected.push(...todayItems)
  if (scopes.week) selected.push(...weekItems)
  const unique = [...new Map(selected.map((item) => [item.itemId || item._id, item])).values()]
  unique.sort((a, b) => {
    const overdueDiff = Number(isOverdue(b, today, currentTime)) - Number(isOverdue(a, today, currentTime))
    if (overdueDiff) return overdueDiff
    const aDeadline = `${a.deadlineDate || '9999-12-31'} ${a.deadlineTime || '23:59'}`
    const bDeadline = `${b.deadlineDate || '9999-12-31'} ${b.deadlineTime || '23:59'}`
    if (aDeadline !== bDeadline) return aDeadline.localeCompare(bDeadline)
    return (Number(b.urgency) || 0) - (Number(a.urgency) || 0) || (Number(b.importance) || 0) - (Number(a.importance) || 0)
  })
  const primary = unique[0]
  const urgency = Number(primary && primary.urgency) || 1
  const titles = unique.slice(1, 3).map((item) => item.title).filter(Boolean)
  return {
    reminder: `今日${scopes.today ? todayItems.length : '-'}·本周${scopes.week ? weekItems.length : '-'}·滞留${scopes.overdue ? overdueItems.length : '-'}`.slice(0, 20),
    taskName: primary && primary.title ? primary.title.slice(0, 20) : '暂无待处理事项',
    deadlineTime: (primary && /^([01]\d|2[0-3]):[0-5]\d$/.test(primary.deadlineTime || '') ? primary.deadlineTime : settings.time || '08:00'),
    urgency: primary ? `${urgency >= 3 ? '高' : urgency === 2 ? '中' : '低'}紧急` : '无',
    remark: titles.length ? `随后：${titles.join('、')}`.slice(0, 20) : (primary ? '请按计划及时处理' : '今日事项均已完成')
  }
}

const updateSetting = (id, data) => items.doc(id).update({ data: { ...data, updatedAt: Date.now() } })

const sendOne = async (settings, config, today, currentTime, requestedState = '') => {
  if (!(await hasSyncAccess(settings.ownerOpenid))) {
    await updateSetting(settings._id, { enabled: false, subscriptionReady: false, lastSendStatus: 'access_invalid', lastSendError: '同步权限已过期或被收回' })
    return { ok: false, code: 'ACCESS_INVALID' }
  }
  const records = await getAll(items.where({ ownerOpenid: settings.ownerOpenid, recordType: 'item' }))
  const summary = summarize(records, settings, today, currentTime)
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: settings.ownerOpenid,
      templateId: config.templateId,
      page: 'pages/today/index',
      miniprogramState: ['developer', 'trial', 'formal'].includes(requestedState) ? requestedState : (settings.miniprogramState || process.env.MINIPROGRAM_STATE || 'developer'),
      lang: 'zh_CN',
      data: {
        thing2: { value: summary.reminder },
        thing31: { value: summary.taskName },
        time38: { value: summary.deadlineTime },
        thing8: { value: summary.urgency },
        thing11: { value: summary.remark }
      }
    })
    await updateSetting(settings._id, {
      lastSentDate: today, lastSentAt: Date.now(), lastSendStatus: 'success', lastSendError: '',
      subscriptionReady: Boolean(config.longTerm)
    })
    return { ok: true }
  } catch (error) {
    const code = Number(error.errCode || error.errcode || 0)
    await updateSetting(settings._id, {
      lastSendStatus: 'failed', lastSendError: String(error.errMsg || error.message || '发送失败').slice(0, 120),
      subscriptionReady: code === 43101 ? false : settings.subscriptionReady
    })
    return { ok: false, code, message: String(error.errMsg || error.message || '发送失败').slice(0, 120) }
  }
}

exports.main = async (event = {}) => {
  const storedConfig = await getDocument(CONFIG_ID)
  const config = storedConfig && storedConfig.recordType === 'notifyConfig'
    ? { ...storedConfig, templateId: storedConfig.templateId || DEFAULT_TEMPLATE_ID }
    : { recordType: 'notifyConfig', templateId: DEFAULT_TEMPLATE_ID, longTerm: false }
  const now = shanghaiNow()
  if (event.action === 'test') {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) return { ok: false, code: 'UNAUTHORIZED', message: '无法识别当前微信账号' }
    const setting = await getDocument(`notify_${hash(OPENID).slice(0, 24)}`)
    if (!setting || !setting.enabled) return { ok: false, code: 'NOT_ENABLED', message: '请先开启并保存每日通知' }
    if (!setting.subscriptionReady) return { ok: false, code: 'SUBSCRIPTION_REQUIRED', message: '没有可用的订阅额度，请先点击“立即续订”' }
    return sendOne(setting, config, now.date, now.time, event.miniprogramState)
  }
  const settings = await getAll(items.where({ recordType: 'notifySettings', enabled: true, subscriptionReady: true }))
  const due = settings.filter((item) => item.time <= now.time && item.lastSentDate !== now.date)
  const results = []
  for (let index = 0; index < due.length; index += 5) {
    results.push(...await Promise.all(due.slice(index, index + 5).map((item) => sendOne(item, config, now.date, now.time))))
  }
  return { ok: true, due: due.length, sent: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length }
}
