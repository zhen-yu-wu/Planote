const ENV_ID = 'my-day-d2g6hzuuw3b26a7d1'
const FUNCTION_NAME = 'planoteSync'

const getMiniProgramState = () => {
  try {
    const version = wx.getAccountInfoSync().miniProgram.envVersion
    return version === 'release' ? 'formal' : version === 'trial' ? 'trial' : 'developer'
  } catch (error) {
    return 'developer'
  }
}

const callFunction = (name, action, data = {}) => {
  if (!wx.cloud) return Promise.reject(new Error('当前基础库不支持云开发'))
  return wx.cloud.callFunction({ name, data: { action, ...data } }).then((response) => {
    const result = response.result || {}
    if (result.ok) return result
    const error = new Error(result.message || '云同步服务暂时不可用')
    error.code = result.code || 'SYNC_FAILED'
    throw error
  })
}

const call = (action, data = {}) => callFunction(FUNCTION_NAME, action, data)

const getAccessStatus = () => call('status')
const verifyAccessKey = (key) => call('verify', { key })
const syncItems = async (records, { since = 0 } = {}) => {
  let uploaded = 0
  const received = new Map()
  // Every batch stays below the function payload limit, including deletion markers.
  for (let index = 0; index < Math.max(1, records.length); index += 100) {
    const result = await call('sync', { records: records.slice(index, index + 100), uploadOnly: true, migrateLegacy: index === 0 })
    uploaded += result.uploaded || 0
    ;(result.records || []).forEach((record) => received.set(record.id, record))
  }
  let serverTime = 0
  let cursor = ''
  do {
    const result = await call('pull', { cursor, since })
    if (!Array.isArray(result.records)) throw new Error('同步响应不完整，本机数据未被替换')
    if (!serverTime) serverTime = result.serverTime || 0
    result.records.forEach((record) => received.set(record.id, record))
    if (result.hasMore && (!result.cursor || result.cursor === cursor)) throw new Error('同步分页异常，本机数据未被替换')
    cursor = result.hasMore ? result.cursor : ''
  } while (cursor)
  return { records: Array.from(received.values()), uploaded, serverTime, full: !since }
}
const listAccessKeys = () => call('listKeys')
const createAccessKey = (label, expiresAt) => call('createKey', { label, expiresAt })
const revokeAccessKey = (keyId) => call('revokeKey', { keyId })
const getNotificationSettings = () => call('getNotificationSettings')
const saveNotificationSettings = (settings) => call('saveNotificationSettings', { ...settings, miniprogramState: getMiniProgramState() })
const markNotificationSubscribed = () => call('markNotificationSubscribed', { miniprogramState: getMiniProgramState() })
const saveNotificationTemplate = (templateId, longTerm) => call('saveNotificationTemplate', { templateId, longTerm })
const testNotification = () => callFunction('planoteNotify', 'test', { miniprogramState: getMiniProgramState() })

module.exports = {
  ENV_ID, FUNCTION_NAME, getAccessStatus, verifyAccessKey, syncItems, listAccessKeys, createAccessKey, revokeAccessKey,
  getNotificationSettings, saveNotificationSettings, markNotificationSubscribed, saveNotificationTemplate, testNotification
}
