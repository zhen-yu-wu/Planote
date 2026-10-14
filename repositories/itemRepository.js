const STATE_KEY = 'planote_state_v2'
const RECOVERY_KEY = 'planote_recovery_v1'
const clone = (value) => JSON.parse(JSON.stringify(value))
const defaults = () => ({ deletions: {}, dirtyIds: {}, lastSyncedAt: 0, cloudSince: 0, revision: 0 })
const readState = () => {
  const state = wx.getStorageSync(STATE_KEY)
  if (state && state.version === 2 && Array.isArray(state.items) && state.meta) return clone(state)
  const items = wx.getStorageSync('planote_items_v1')
  const meta = wx.getStorageSync('planote_sync_meta_v1')
  return { version: 2, items: Array.isArray(items) ? clone(items) : [], meta: { ...defaults(), ...(meta && typeof meta === 'object' ? clone(meta) : {}), lastSyncedAt: 0 } }
}
const commit = (state) => wx.setStorageSync(STATE_KEY, state)
const saveRecovery = () => wx.setStorageSync(RECOVERY_KEY, { savedAt: Date.now(), state: readState() })
const getRecovery = () => wx.getStorageSync(RECOVERY_KEY) || null
const forgetLocalData = () => {
  const revision = readState().meta.revision + 1
  // Keep an empty v2 state even if removing a legacy cache fails; never fall back to it.
  commit({ version: 2, items: [], meta: { ...defaults(), revision } })
  let failed = false
  for (const key of ['planote_items_v1', 'planote_sync_meta_v1', RECOVERY_KEY]) {
    try { wx.removeStorageSync(key) } catch (error) { failed = true }
  }
  if (failed) throw new Error('本机事项已清除，但部分旧缓存未能删除，请重试')
}
const markChanged = (state, id) => {
  delete state.meta.deletions[id]
  state.meta.dirtyIds = state.meta.dirtyIds || {}
  state.meta.dirtyIds[id] = true
  state.meta.revision += 1
}
const getAll = () => readState().items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
const getById = (id) => readState().items.find((item) => item.id === id) || null
const add = (item) => {
  const state = readState()
  if (state.items.some((entry) => entry.id === item.id)) throw new Error('事项 ID 已存在')
  state.items.push(item); markChanged(state, item.id); commit(state)
  return item
}
const update = (item) => {
  const state = readState()
  const index = state.items.findIndex((entry) => entry.id === item.id)
  if (index < 0) throw new Error('事项不存在')
  state.items[index] = item; markChanged(state, item.id); commit(state)
  return item
}
const remove = (id) => {
  const state = readState()
  const item = state.items.find((entry) => entry.id === id)
  if (!item) return false
  state.items = state.items.filter((entry) => entry.id !== id)
  state.meta.deletions[id] = Math.max(Date.now(), (item.updatedAt || 0) + 1)
  state.meta.dirtyIds = state.meta.dirtyIds || {}; state.meta.dirtyIds[id] = true
  state.meta.revision += 1; commit(state)
  return true
}
const clear = () => {
  saveRecovery()
  const state = readState()
  state.meta.dirtyIds = state.meta.dirtyIds || {}
  state.items.forEach((item) => { state.meta.deletions[item.id] = Math.max(Date.now(), (item.updatedAt || 0) + 1); state.meta.dirtyIds[item.id] = true })
  state.items = []; state.meta.revision += 1; commit(state)
}
const replaceAll = (items, { localOnly = false } = {}) => {
  const state = readState()
  const ids = new Set(items.map((item) => item.id))
  state.meta.dirtyIds = state.meta.dirtyIds || {}
  if (localOnly) state.meta = { ...defaults(), revision: state.meta.revision }
  else state.items.forEach((item) => { if (!ids.has(item.id)) { state.meta.deletions[item.id] = Math.max(Date.now(), (item.updatedAt || 0) + 1); state.meta.dirtyIds[item.id] = true } })
  state.items = items
  items.forEach((item) => { markChanged(state, item.id) })
  state.meta.revision += 1; commit(state)
}
const getSyncMeta = () => ({ ...defaults(), ...readState().meta })
const replaceFromSync = (items, deletions, lastSyncedAt, expectedRevision, cloudSince = 0) => {
  const state = readState()
  if (expectedRevision !== undefined && state.meta.revision !== expectedRevision) return false
  commit({ version: 2, items, meta: { ...defaults(), cloudSince, deletions: deletions || {}, lastSyncedAt: lastSyncedAt === undefined ? Date.now() : lastSyncedAt, revision: state.meta.revision } })
  return true
}
const getByDate = (date) => getAll().filter((item) => item.date === date || item.deadlineDate === date)
const getTodos = () => getAll().filter((item) => item.type === 'todo')
const getSchedules = () => getAll().filter((item) => item.type === 'schedule')
const getIdeas = () => getAll().filter((item) => item.type === 'idea')
const getChores = () => getAll().filter((item) => item.type === 'chore')
module.exports = { getAll, getById, add, update, remove, clear, replaceAll, getByDate, getTodos, getSchedules, getIdeas, getChores, getSyncMeta, replaceFromSync, saveRecovery, getRecovery, forgetLocalData }
