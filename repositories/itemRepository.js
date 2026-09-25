const STORAGE_KEY = 'planote_items_v1'
const SYNC_META_KEY = 'planote_sync_meta_v1'

const read = () => {
  const items = wx.getStorageSync(STORAGE_KEY)
  return Array.isArray(items) ? items : []
}

const write = (items) => wx.setStorageSync(STORAGE_KEY, items)
const readSyncMeta = () => {
  const value = wx.getStorageSync(SYNC_META_KEY)
  return value && typeof value === 'object' ? { deletions: {}, lastSyncedAt: 0, revision: 0, ...value } : { deletions: {}, lastSyncedAt: 0, revision: 0 }
}
const writeSyncMeta = (meta) => wx.setStorageSync(SYNC_META_KEY, meta)
const markChanged = (id) => {
  const meta = readSyncMeta()
  delete meta.deletions[id]
  meta.revision += 1
  writeSyncMeta(meta)
}

const getAll = () => read().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
const getById = (id) => read().find((item) => item.id === id) || null

const add = (item) => {
  const items = read()
  items.push(item)
  write(items)
  markChanged(item.id)
  return item
}

const update = (item) => {
  const items = read()
  const index = items.findIndex((entry) => entry.id === item.id)
  if (index < 0) throw new Error('事项不存在')
  items[index] = item
  write(items)
  markChanged(item.id)
  return item
}

const remove = (id) => {
  const items = read()
  const next = items.filter((item) => item.id !== id)
  write(next)
  if (next.length !== items.length) {
    const meta = readSyncMeta()
    meta.deletions[id] = Date.now()
    meta.revision += 1
    writeSyncMeta(meta)
  }
  return next.length !== items.length
}

const clear = () => {
  const items = read()
  const meta = readSyncMeta()
  const deletedAt = Date.now()
  items.forEach((item) => { meta.deletions[item.id] = deletedAt })
  meta.revision += 1
  write([])
  writeSyncMeta(meta)
}
const replaceAll = (items) => {
  const previous = read()
  const incomingIds = new Set(items.map((item) => item.id))
  const meta = readSyncMeta()
  const deletedAt = Date.now()
  previous.forEach((item) => { if (!incomingIds.has(item.id)) meta.deletions[item.id] = deletedAt })
  items.forEach((item) => { delete meta.deletions[item.id] })
  meta.revision += 1
  write(items)
  writeSyncMeta(meta)
}

const getSyncMeta = () => readSyncMeta()
const replaceFromSync = (items, deletions, lastSyncedAt, expectedRevision) => {
  const current = readSyncMeta()
  if (expectedRevision !== undefined && current.revision !== expectedRevision) return false
  write(items)
  writeSyncMeta({ deletions: deletions || {}, lastSyncedAt: lastSyncedAt || Date.now(), revision: current.revision })
  return true
}

const getByDate = (date) => read().filter((item) =>
  item.date === date || item.deadlineDate === date
)
const getTodos = () => read().filter((item) => item.type === 'todo')
const getSchedules = () => read().filter((item) => item.type === 'schedule')
const getIdeas = () => read().filter((item) => item.type === 'idea')
const getChores = () => read().filter((item) => item.type === 'chore')

module.exports = { getAll, getById, add, update, remove, clear, replaceAll, getByDate, getTodos, getSchedules, getIdeas, getChores, getSyncMeta, replaceFromSync }
