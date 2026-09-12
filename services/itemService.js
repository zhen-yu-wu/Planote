const repository = require('../repositories/itemRepository')
const { toDateString, getWeekRange, combineDateTime } = require('../utils/date')

const defaults = {
  type: 'idea', taskScope: '', title: '', content: '', date: '',
  startTime: '', endTime: '', deadlineDate: '', deadlineTime: '',
  urgency: 2, importance: 2, completed: false,
  completedAt: null,
  weekYear: null, weekNumber: null, weekStartDate: '', weekEndDate: '',
  year: null, yearStartDate: '', yearEndDate: '', progress: null
}

const id = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const normalize = (item) => {
  const normalized = { ...defaults, ...item }
  if (normalized.type === 'todo' && normalized.taskScope === 'year') {
    normalized.year = Number(normalized.year) || new Date().getFullYear()
    normalized.yearStartDate = normalized.yearStartDate || `${normalized.year}-01-01`
    normalized.yearEndDate = normalized.yearEndDate || `${normalized.year}-12-31`
  }
  return normalized
}
const getAll = () => repository.getAll().map(normalize)
const getById = (itemId) => {
  const item = repository.getById(itemId)
  return item ? normalize(item) : null
}

const save = (draft) => {
  const now = Date.now()
  const item = normalize({ ...draft, updatedAt: now })
  const previous = item.id ? repository.getById(item.id) : null
  if (!item.title.trim()) throw new Error('请填写标题')
  item.title = item.title.trim()
  item.content = item.content.trim()
  if (item.type === 'todo' && !item.taskScope) item.taskScope = 'day'
  if (item.type === 'todo' && item.taskScope === 'week') {
    const range = getWeekRange(item.weekStartDate ? new Date(`${item.weekStartDate}T00:00:00`) : new Date())
    item.weekYear = Number(item.weekYear) || range.weekYear
    item.weekNumber = Number(item.weekNumber) || range.weekNumber
    item.weekStartDate = item.weekStartDate || range.start
    item.weekEndDate = item.weekEndDate || range.end
  }
  if (item.type === 'todo' && item.taskScope === 'year') {
    item.year = Number(item.year) || new Date().getFullYear()
    item.yearStartDate = item.yearStartDate || `${item.year}-01-01`
    item.yearEndDate = item.yearEndDate || `${item.year}-12-31`
    if (!item.yearStartDate.startsWith(`${item.year}-`) || !item.yearEndDate.startsWith(`${item.year}-`)) {
      throw new Error('日期范围应在目标年份内')
    }
    if (item.yearEndDate < item.yearStartDate) throw new Error('结束日期不能早于开始日期')
    item.progress = item.progress === '' || item.progress === null ? null : Math.max(0, Math.min(100, Number(item.progress)))
  }
  if (item.completed && (!previous || !previous.completed)) item.completedAt = now
  if (!item.completed) item.completedAt = null
  if (item.id) return repository.update(item)
  item.id = id()
  item.createdAt = now
  return repository.add(item)
}

const toggleCompleted = (itemId) => {
  const item = getById(itemId)
  if (!item) throw new Error('事项不存在')
  item.completed = !item.completed
  item.completedAt = item.completed ? Date.now() : null
  if (item.taskScope === 'year' && item.completed) item.progress = 100
  return save(item)
}

const remove = (itemId) => repository.remove(itemId)
const clearAll = () => repository.clear()

const prepareImport = (raw) => {
  let payload
  try {
    payload = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (error) {
    throw new Error('剪贴板内容不是有效的 JSON 备份')
  }
  const source = Array.isArray(payload) ? payload : payload && payload.items
  if (!Array.isArray(source)) throw new Error('备份中没有找到事项数据')
  const allowedTypes = ['idea', 'todo', 'schedule']
  const seenIds = new Set()
  const now = Date.now()
  return source.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`第 ${index + 1} 条事项格式无效`)
    if (!allowedTypes.includes(entry.type)) throw new Error(`第 ${index + 1} 条事项类型无效`)
    if (typeof entry.title !== 'string' || !entry.title.trim()) throw new Error(`第 ${index + 1} 条事项缺少标题`)
    let itemId = typeof entry.id === 'string' && entry.id ? entry.id : id()
    if (seenIds.has(itemId)) itemId = id()
    seenIds.add(itemId)
    const urgency = Math.max(1, Math.min(3, Number(entry.urgency) || 2))
    const importance = Math.max(1, Math.min(3, Number(entry.importance) || 2))
    return normalize({
      ...entry,
      id: itemId,
      title: entry.title.trim(),
      content: typeof entry.content === 'string' ? entry.content : '',
      urgency,
      importance,
      completed: Boolean(entry.completed),
      createdAt: Number(entry.createdAt) || now,
      updatedAt: Number(entry.updatedAt) || now
    })
  })
}

const importItems = (items) => {
  if (!Array.isArray(items)) throw new Error('导入数据无效')
  repository.replaceAll(items)
  return items.length
}

const inboxTime = (item) => {
  if (item.deadlineDate) return combineDateTime(item.deadlineDate, item.deadlineTime, true)
  if (item.type === 'schedule' && item.date) return combineDateTime(item.date, item.startTime, false)
  if (item.taskScope === 'day' && item.date) return combineDateTime(item.date, '', true)
  if (item.taskScope === 'week' && item.weekEndDate) return combineDateTime(item.weekEndDate, '', true)
  if (item.taskScope === 'year' && item.yearEndDate) return combineDateTime(item.yearEndDate, '', true)
  if (item.taskScope === 'year' && item.year) return new Date(Number(item.year), 11, 31, 23, 59, 59)
  return null
}

const inboxDate = (item) => {
  if (item.type === 'schedule') return item.date || ''
  if (item.taskScope === 'day') return item.date || item.deadlineDate || ''
  if (item.taskScope === 'week') return item.weekStartDate || item.deadlineDate || ''
  if (item.taskScope === 'year') return item.yearStartDate || ''
  return item.date || item.deadlineDate || ''
}

const sortForInbox = (items, mode = 'smart', now = new Date()) => {
  const list = [...items]
  if (mode === 'recent') return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  if (mode === 'taskDate') {
    return list.sort((a, b) => {
      if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed)
      const leftDate = inboxDate(a) || '9999-12-31'
      const rightDate = inboxDate(b) || '9999-12-31'
      return leftDate.localeCompare(rightDate) ||
        (b.urgency || 2) - (a.urgency || 2) ||
        (b.importance || 2) - (a.importance || 2) ||
        (b.updatedAt || 0) - (a.updatedAt || 0)
    })
  }
  if (mode === 'deadline') {
    return list.sort((a, b) => {
      if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed)
      const left = inboxTime(a)
      const right = inboxTime(b)
      const leftTime = left ? left.getTime() : Number.POSITIVE_INFINITY
      const rightTime = right ? right.getTime() : Number.POSITIVE_INFINITY
      return leftTime - rightTime || (b.updatedAt || 0) - (a.updatedAt || 0)
    })
  }

  const today = toDateString(now)
  const todayEnd = combineDateTime(today, '', true).getTime()
  const soonEnd = now.getTime() + 72 * 3600000
  const smartRank = (item) => {
    if (item.completed) return 7
    if (item.type === 'idea') return 6
    const date = inboxTime(item)
    const time = date ? date.getTime() : Number.POSITIVE_INFINITY
    const overdueDay = item.taskScope === 'day' && item.date && item.date < today
    if (time < now.getTime() || overdueDay) return 0
    if (item.deadlineDate && time <= todayEnd) return 1
    if (item.deadlineDate && time <= soonEnd) return 2
    if (item.urgency === 3 && item.importance === 3) return 3
    if (item.type === 'schedule' && item.date === today) return 4
    return 5
  }
  return list.sort((a, b) => {
    const rankDifference = smartRank(a) - smartRank(b)
    if (rankDifference) return rankDifference
    if (a.completed && b.completed) return (b.completedAt || b.updatedAt || 0) - (a.completedAt || a.updatedAt || 0)
    const urgencyDifference = (b.urgency || 2) - (a.urgency || 2)
    if (urgencyDifference) return urgencyDifference
    const importanceDifference = (b.importance || 2) - (a.importance || 2)
    if (importanceDifference) return importanceDifference
    const left = inboxTime(a)
    const right = inboxTime(b)
    const timeDifference = (left ? left.getTime() : Number.POSITIVE_INFINITY) - (right ? right.getTime() : Number.POSITIVE_INFINITY)
    return timeDifference || (b.updatedAt || 0) - (a.updatedAt || 0)
  })
}

const priorityScore = (item, now) => {
  let score = (item.urgency || 2) * 16 + (item.importance || 2) * 13
  const deadline = combineDateTime(item.deadlineDate, item.deadlineTime, true)
  if (deadline) {
    const hours = (deadline - now) / 3600000
    if (hours < 0) score += 1000
    else if (hours <= 24) score += 500
    else if (hours <= 72) score += 180
  }
  if (item.type === 'schedule' && item.date === toDateString(now)) score += 320
  if (item.type === 'todo' && item.taskScope === 'day' && item.date === toDateString(now)) score += 280
  return score
}

const focusDeadline = (item) => {
  if (item.deadlineDate) return combineDateTime(item.deadlineDate, item.deadlineTime, true)
  if (item.type === 'schedule' && item.date) return combineDateTime(item.date, item.startTime, false)
  if (item.taskScope === 'day' && item.date) return combineDateTime(item.date, '', true)
  if (item.taskScope === 'week' && item.weekEndDate) return combineDateTime(item.weekEndDate, '', true)
  return null
}

const compareFocus = (a, b, now, today) => {
  const todayEnd = combineDateTime(today, '', true).getTime()
  const soonEnd = now.getTime() + 72 * 3600000
  const rank = (item) => {
    const deadline = focusDeadline(item)
    const time = deadline ? deadline.getTime() : Number.POSITIVE_INFINITY
    const isExplicitDeadline = Boolean(item.deadlineDate)
    const isPastDayTask = item.taskScope === 'day' && item.date && item.date < today
    const isPastSchedule = item.type === 'schedule' && time < now.getTime()
    let bucket = 3
    if ((isExplicitDeadline && time < now.getTime()) || isPastDayTask || isPastSchedule) bucket = 0
    else if (isExplicitDeadline && time <= todayEnd) bucket = 1
    else if (isExplicitDeadline && time <= soonEnd) bucket = 2
    return { bucket, time }
  }
  const left = rank(a)
  const right = rank(b)
  return left.bucket - right.bucket ||
    (b.urgency || 2) - (a.urgency || 2) ||
    left.time - right.time ||
    (b.importance || 2) - (a.importance || 2) ||
    (a.createdAt || 0) - (b.createdAt || 0)
}

const getDashboard = (now = new Date()) => {
  const today = toDateString(now)
  const week = getWeekRange(now)
  const all = getAll()
  const active = all.filter((item) => !item.completed)
  const schedules = all.filter((item) => item.type === 'schedule' && item.date === today)
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
  const dayTodos = all.filter((item) => item.type === 'todo' && item.taskScope === 'day' && item.date === today)
    .sort((a, b) => priorityScore(b, now) - priorityScore(a, now))
  const weekTodos = all.filter((item) => item.type === 'todo' && item.taskScope === 'week' &&
    item.weekYear === week.weekYear && item.weekNumber === week.weekNumber)
    .sort((a, b) => Number(a.completed) - Number(b.completed) || priorityScore(b, now) - priorityScore(a, now))
  const yearTodos = all.filter((item) => item.type === 'todo' && item.taskScope === 'year' && item.year === now.getFullYear())
    .sort((a, b) => Number(a.completed) - Number(b.completed) || (b.importance || 0) - (a.importance || 0))

  const overdueTodos = active.filter((item) => {
    if (item.type !== 'todo') return false
    if (item.deadlineDate && item.deadlineDate < today) return true
    if (item.taskScope === 'day') return Boolean(item.date && item.date < today)
    if (item.taskScope === 'week') return Boolean(item.weekEndDate && item.weekEndDate < today)
    if (item.taskScope === 'year') return Boolean(item.yearEndDate && item.yearEndDate < today)
    return false
  }).sort((a, b) => compareFocus(a, b, now, today))

  const focusCandidates = active.filter((item) => {
    if (item.type === 'schedule') return false
    if (item.type !== 'todo') return false
    if (item.taskScope === 'year') return Boolean(item.yearEndDate && item.yearEndDate < today)
    if (item.taskScope === 'week') {
      const isCurrentWeek = item.weekYear === week.weekYear && item.weekNumber === week.weekNumber
      const isOverdue = (item.weekEndDate && item.weekEndDate < today) || (item.deadlineDate && item.deadlineDate < today)
      return isCurrentWeek || isOverdue
    }
    const deadline = combineDateTime(item.deadlineDate, item.deadlineTime, true)
    const dueSoon = deadline && deadline.getTime() <= now.getTime() + 72 * 3600000
    return Boolean(item.date && item.date <= today) || dueSoon
  }).sort((a, b) => compareFocus(a, b, now, today)).slice(0, 3)

  const completedToday = all.filter((item) => {
    if (!item.completed || item.type === 'idea') return false
    if (item.completedAt) return toDateString(new Date(item.completedAt)) === today
    return item.date === today
  }).sort((a, b) => (b.completedAt || b.updatedAt || 0) - (a.completedAt || a.updatedAt || 0))

  return { today, week, schedules, dayTodos, weekTodos, yearTodos, overdueTodos, focus: focusCandidates, completedToday }
}

module.exports = { getAll, getById, save, remove, clearAll, prepareImport, importItems, inboxDate, sortForInbox, toggleCompleted, getDashboard, priorityScore }
