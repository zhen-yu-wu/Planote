const STORAGE_KEY = 'planote_items_v1'

const read = () => {
  const items = wx.getStorageSync(STORAGE_KEY)
  return Array.isArray(items) ? items : []
}

const write = (items) => wx.setStorageSync(STORAGE_KEY, items)

const getAll = () => read().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
const getById = (id) => read().find((item) => item.id === id) || null

const add = (item) => {
  const items = read()
  items.push(item)
  write(items)
  return item
}

const update = (item) => {
  const items = read()
  const index = items.findIndex((entry) => entry.id === item.id)
  if (index < 0) throw new Error('事项不存在')
  items[index] = item
  write(items)
  return item
}

const remove = (id) => {
  const items = read()
  const next = items.filter((item) => item.id !== id)
  write(next)
  return next.length !== items.length
}

const clear = () => write([])
const replaceAll = (items) => write(items)

const getByDate = (date) => read().filter((item) =>
  item.date === date || item.deadlineDate === date
)
const getTodos = () => read().filter((item) => item.type === 'todo')
const getSchedules = () => read().filter((item) => item.type === 'schedule')
const getIdeas = () => read().filter((item) => item.type === 'idea')

module.exports = { getAll, getById, add, update, remove, clear, replaceAll, getByDate, getTodos, getSchedules, getIdeas }
