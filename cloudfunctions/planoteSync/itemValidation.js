const DATE_FIELDS = ['date', 'deadlineDate', 'weekStartDate', 'weekEndDate', 'yearStartDate', 'yearEndDate']
const TIME_FIELDS = ['startTime', 'endTime', 'deadlineTime']
const validDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return year >= 1900 && year <= 9999 && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}
const validTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
const timestamp = (value, label, fallback = 0) => {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label}无效`)
  return value
}
const validateItem = (entry, { allowDeleted = false, now = Date.now(), checkClock = false } = {}) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('事项格式无效')
  if (typeof entry.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(entry.id) || ['__proto__', 'constructor', 'prototype'].includes(entry.id)) throw new Error('事项 ID 无效')
  const updatedAt = timestamp(entry.updatedAt, '更新时间', now)
  if (checkClock && updatedAt > now + 5 * 60 * 1000) throw new Error('事项时间晚于服务器时间，请校准设备时间后重新保存')
  if (entry.deleted !== undefined && typeof entry.deleted !== 'boolean') throw new Error('删除状态无效')
  if (allowDeleted && entry.deleted) return { id: entry.id, updatedAt, deleted: true }
  if (!['idea', 'todo', 'chore', 'schedule'].includes(entry.type)) throw new Error('事项类型无效')
  if (typeof entry.title !== 'string' || !entry.title.trim() || entry.title.length > 80) throw new Error('标题须为 1–80 个字符')
  if (entry.content !== undefined && (typeof entry.content !== 'string' || entry.content.length > 1000)) throw new Error('补充说明不能超过 1000 个字符')
  const item = { id: entry.id, type: entry.type, title: entry.title.trim(), content: (entry.content || '').trim(), updatedAt, createdAt: timestamp(entry.createdAt, '创建时间', updatedAt), completed: entry.completed === undefined ? false : entry.completed, completedAt: entry.completedAt === undefined || entry.completedAt === null ? null : timestamp(entry.completedAt, '完成时间') }
  if (typeof item.completed !== 'boolean') throw new Error('完成状态无效')
  DATE_FIELDS.forEach((field) => {
    const value = entry[field] === undefined ? '' : entry[field]
    if (value !== '' && !validDate(value)) throw new Error(`${field} 日期无效`)
    item[field] = value
  })
  TIME_FIELDS.forEach((field) => {
    const value = entry[field] === undefined ? '' : entry[field]
    if (value !== '' && !validTime(value)) throw new Error(`${field} 时间无效`)
    item[field] = value
  })
  ;['urgency', 'importance'].forEach((field) => {
    const value = entry[field] === undefined ? 2 : entry[field]
    if (![1, 2, 3].includes(value)) throw new Error('优先程度无效')
    item[field] = value
  })
  item.taskScope = entry.taskScope || (item.type === 'todo' ? 'day' : '')
  if (item.type === 'todo' && !['day', 'week', 'year'].includes(item.taskScope)) throw new Error('任务层级无效')
  item.weekYear = entry.weekYear === undefined ? null : entry.weekYear
  item.weekNumber = entry.weekNumber === undefined ? null : entry.weekNumber
  item.year = entry.year === undefined ? null : entry.year
  item.progress = entry.progress === undefined || entry.progress === '' ? null : entry.progress
  if (item.progress !== null && (typeof item.progress !== 'number' || !Number.isFinite(item.progress) || item.progress < 0 || item.progress > 100)) throw new Error('年度进度无效')
  if (item.type === 'schedule' && (!item.date || (item.startTime && item.endTime && item.endTime <= item.startTime))) throw new Error('日程日期或时间范围无效')
  if (item.type === 'todo' && item.taskScope === 'day' && !item.date) throw new Error('请设置日任务所属日期')
  if (item.type === 'todo' && item.taskScope === 'week') {
    if (!Number.isInteger(item.weekYear) || item.weekYear < 1900 || item.weekYear > 9999 || !Number.isInteger(item.weekNumber) || item.weekNumber < 1 || item.weekNumber > 53 || !item.weekStartDate || !item.weekEndDate || item.weekEndDate < item.weekStartDate) throw new Error('所属周或周日期范围无效')
  }
  if (item.type === 'todo' && item.taskScope === 'year') {
    if (!Number.isInteger(item.year) || item.year < 1900 || item.year > 9999 || !item.yearStartDate || !item.yearEndDate || !item.yearStartDate.startsWith(`${item.year}-`) || !item.yearEndDate.startsWith(`${item.year}-`) || item.yearEndDate < item.yearStartDate) throw new Error('年度日期范围无效')
    item.deadlineDate = ''; item.deadlineTime = ''
  }
  if (item.type !== 'todo') { item.taskScope = ''; item.deadlineDate = ''; item.deadlineTime = '' }
  if (item.type !== 'schedule') { item.startTime = ''; item.endTime = '' }
  if (item.type === 'idea' || (item.type === 'todo' && item.taskScope !== 'day')) item.date = ''
  if (item.type !== 'todo' || item.taskScope !== 'week') { item.weekYear = null; item.weekNumber = null; item.weekStartDate = ''; item.weekEndDate = '' }
  if (item.type !== 'todo' || item.taskScope !== 'year') { item.year = null; item.yearStartDate = ''; item.yearEndDate = ''; item.progress = null }
  if (!item.completed) item.completedAt = null
  return item
}
module.exports = { validateItem, validDate, validTime }
