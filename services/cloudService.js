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
const syncItems = (records) => call('sync', { records })
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
