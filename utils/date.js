const pad = (value) => String(value).padStart(2, '0')

const toDateString = (date) => {
  const value = date || new Date()
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

const parseDate = (value) => {
  if (!value) return null
  const parts = value.split('-').map(Number)
  return new Date(parts[0], parts[1] - 1, parts[2])
}

const getISOWeek = (date) => {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = target.getDay() || 7
  target.setDate(target.getDate() + 4 - day)
  const weekYear = target.getFullYear()
  const yearStart = new Date(weekYear, 0, 1)
  const weekNumber = Math.ceil((((target - yearStart) / 86400000) + 1) / 7)
  return { weekYear, weekNumber }
}

const getWeekRange = (date) => {
  const current = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = current.getDay() || 7
  const start = new Date(current)
  start.setDate(current.getDate() - day + 1)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start: toDateString(start), end: toDateString(end), ...getISOWeek(current) }
}

const combineDateTime = (date, time, endOfDay) => {
  if (!date) return null
  const parsed = parseDate(date)
  const parts = (time || (endOfDay ? '23:59' : '00:00')).split(':').map(Number)
  parsed.setHours(parts[0], parts[1], endOfDay ? 59 : 0, 0)
  return parsed
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

module.exports = { pad, toDateString, parseDate, getISOWeek, getWeekRange, combineDateTime, WEEKDAYS }
