const itemService = require('../../services/itemService')
const { pad, toDateString } = require('../../utils/date')
const { getHolidayInfo } = require('../../utils/holiday')

Page({
  data: { year: 0, month: 0, title: '', days: [], selectedDate: '', selectedLabel: '', selectedItems: [], selectedHoliday: null },
  onLoad() {
    const now = new Date()
    this.setData({ year: now.getFullYear(), month: now.getMonth() + 1, selectedDate: toDateString(now) })
  },
  onShow() {
    if (this.data.year) this.buildMonth()
    itemService.sync().then((result) => { if (!result.skipped && this.data.year) this.buildMonth() }).catch(() => {})
  },
  buildMonth() {
    const { year, month, selectedDate } = this.data
    const firstDay = new Date(year, month - 1, 1).getDay()
    const count = new Date(year, month, 0).getDate()
    const all = itemService.getAll()
    const today = toDateString(new Date())
    const days = []
    for (let i = 0; i < firstDay; i += 1) days.push({ key: `blank-${i}`, blank: true })
    for (let day = 1; day <= count; day += 1) {
      const date = `${year}-${pad(month)}-${pad(day)}`
      const related = all.filter((item) => item.date === date || item.deadlineDate === date)
      const holiday = getHolidayInfo(date)
      const weekday = new Date(year, month - 1, day).getDay()
      days.push({
        key: date, day, date, isToday: date === today, selected: date === selectedDate,
        isWeekend: weekday === 0 || weekday === 6,
        hasSchedule: related.some((i) => i.type === 'schedule'),
        hasTodo: related.some((i) => i.type === 'todo'),
        hasChore: related.some((i) => i.type === 'chore'),
        holidayLabel: holiday ? holiday.shortName : '',
        holidayKind: holiday ? holiday.kind : ''
      })
    }
    this.setData({ title: `${year}年 ${month}月`, days })
    this.loadSelected()
  },
  loadSelected() {
    const { selectedDate } = this.data
    const all = itemService.getAll()
    const items = all.filter((item) => item.date === selectedDate || item.deadlineDate === selectedDate)
      .sort((a, b) => (a.startTime || a.deadlineTime || '99:99').localeCompare(b.startTime || b.deadlineTime || '99:99'))
      .map((item) => ({
        ...item,
        typeLabel: item.type === 'schedule' ? '日程' : item.type === 'todo' ? '待办' : item.type === 'chore' ? '琐事' : '想法',
        timeText: item.type === 'schedule' ? `${item.startTime || '全天'}${item.endTime ? ` - ${item.endTime}` : ''}` :
          item.type === 'chore' ? '当天处理' : item.deadlineDate === selectedDate ? `${item.deadlineTime || '当天'} 截止` : '当天任务'
      }))
    const parts = selectedDate.split('-').map(Number)
    this.setData({ selectedLabel: `${parts[1]}月${parts[2]}日`, selectedItems: items, selectedHoliday: getHolidayInfo(selectedDate) })
  },
  selectDay(event) {
    const date = event.currentTarget.dataset.date
    if (!date) return
    this.setData({ selectedDate: date })
    this.buildMonth()
  },
  previousMonth() {
    let { year, month } = this.data
    month -= 1
    if (month === 0) { month = 12; year -= 1 }
    this.setData({ year, month, selectedDate: `${year}-${pad(month)}-01` })
    this.buildMonth()
  },
  nextMonth() {
    let { year, month } = this.data
    month += 1
    if (month === 13) { month = 1; year += 1 }
    this.setData({ year, month, selectedDate: `${year}-${pad(month)}-01` })
    this.buildMonth()
  },
  openItem(event) { wx.navigateTo({ url: `/pages/editor/index?id=${event.currentTarget.dataset.id}` }) },
  toggleCompleted(event) {
    const id = event.currentTarget.dataset.id
    const item = itemService.getById(id)
    if (!item) return
    if (item.completed) {
      itemService.toggleCompleted(id)
      wx.showToast({ title: '已恢复', icon: 'none' })
      this.buildMonth()
      return
    }
    wx.showModal({
      title: '确认完成？',
      content: `确定将“${item.title}”标记为已完成吗？`,
      confirmText: '完成',
      confirmColor: '#2F6B4F',
      success: ({ confirm }) => {
        if (!confirm) return
        itemService.toggleCompleted(id)
        this.buildMonth()
      }
    })
  },
  quickAdd() {
    wx.showActionSheet({ itemList: ['日任务', '琐事', '日程', '想法'], success: ({ tapIndex }) => {
      const date = this.data.selectedDate
      const params = [`type=todo&scope=day&date=${date}`, `type=chore&date=${date}`, `type=schedule&date=${date}`, 'type=idea'][tapIndex]
      wx.navigateTo({ url: `/pages/editor/index?${params}` })
    } })
  }
})
