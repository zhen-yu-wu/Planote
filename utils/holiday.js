// 2026 statutory schedule: 国务院办公厅 国办发明电〔2025〕7号
// https://www.gov.cn/gongbao/2025/issue_12406/202511/content_7048922.html

const pad = (value) => String(value).padStart(2, '0')

const FIXED_FESTIVALS = {
  '01-01': { name: '元旦', description: '新年第一天' },
  '03-08': { name: '妇女节', description: '国际劳动妇女节' },
  '03-12': { name: '植树节', description: '全民义务植树纪念日' },
  '05-01': { name: '劳动节', description: '国际劳动节' },
  '05-04': { name: '青年节', description: '五四青年节' },
  '06-01': { name: '儿童节', description: '国际儿童节' },
  '07-01': { name: '建党节', description: '中国共产党建党纪念日' },
  '08-01': { name: '建军节', description: '中国人民解放军建军纪念日' },
  '09-10': { name: '教师节', description: '中国教师节' },
  '10-01': { name: '国庆节', description: '中华人民共和国国庆节' },
  '12-13': { name: '公祭日', description: '南京大屠杀死难者国家公祭日' }
}

const YEAR_FESTIVALS = {
  2026: {
    '2026-02-16': { name: '除夕', description: '农历除夕' },
    '2026-02-17': { name: '春节', description: '农历正月初一' },
    '2026-03-03': { name: '元宵节', description: '农历正月十五' },
    '2026-04-05': { name: '清明节', description: '传统清明节' },
    '2026-06-19': { name: '端午节', description: '农历五月初五' },
    '2026-09-25': { name: '中秋节', description: '农历八月十五' }
  }
}

const OFFICIAL_2026 = {
  ranges: [
    ['2026-01-01', '2026-01-03', '元旦假期'],
    ['2026-02-15', '2026-02-23', '春节假期'],
    ['2026-04-04', '2026-04-06', '清明假期'],
    ['2026-05-01', '2026-05-05', '劳动节假期'],
    ['2026-06-19', '2026-06-21', '端午假期'],
    ['2026-09-25', '2026-09-27', '中秋假期'],
    ['2026-10-01', '2026-10-07', '国庆假期']
  ],
  workdays: {
    '2026-01-04': '元旦调休',
    '2026-02-14': '春节调休',
    '2026-02-28': '春节调休',
    '2026-05-09': '劳动节调休',
    '2026-09-20': '国庆节调休',
    '2026-10-10': '国庆节调休'
  }
}

const addDays = (dateString, count) => {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day + count)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const buildRestDays = () => {
  const result = {}
  OFFICIAL_2026.ranges.forEach(([start, end, name]) => {
    let current = start
    while (current <= end) {
      result[current] = name
      current = addDays(current, 1)
    }
  })
  return result
}

const REST_DAYS_2026 = buildRestDays()

const getHolidayInfo = (dateString) => {
  if (!dateString) return null
  const year = Number(dateString.slice(0, 4))
  const fixed = FIXED_FESTIVALS[dateString.slice(5)]
  const yearly = YEAR_FESTIVALS[year] && YEAR_FESTIVALS[year][dateString]
  const festival = yearly || fixed
  const workdayName = year === 2026 ? OFFICIAL_2026.workdays[dateString] : ''
  const restName = year === 2026 ? REST_DAYS_2026[dateString] : ''

  if (workdayName) {
    return {
      name: festival ? festival.name : '调休上班',
      shortName: festival ? festival.name : '班',
      description: `${workdayName}上班${festival ? ` · ${festival.description}` : ''}`,
      kind: 'work',
      isWorkday: true,
      isRestDay: false
    }
  }
  if (restName) {
    return {
      name: festival ? festival.name : restName,
      shortName: festival ? festival.name : '休',
      description: `${restName} · 法定休假${festival ? ` · ${festival.description}` : ''}`,
      kind: 'rest',
      isWorkday: false,
      isRestDay: true
    }
  }
  if (festival) {
    return {
      ...festival,
      shortName: festival.name,
      kind: 'festival',
      isWorkday: false,
      isRestDay: false
    }
  }
  return null
}

module.exports = { getHolidayInfo }
