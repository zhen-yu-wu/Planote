const itemService = require('../../services/itemService')
const { parseDate, WEEKDAYS } = require('../../utils/date')

Page({
  data: {
    dateText: '', greeting: '', summaryText: '', handledToday: 0, todayTotal: 0, todayProgress: 0,
    scheduleDone: 0, scheduleTotal: 0, choreDone: 0, choreTotal: 0,
    focus: [], overdueTodos: [], schedules: [], chores: [], dayTodos: [], weekTodos: [], yearTodos: [], completedToday: [], completingId: '',
    dayDone: 0, dayTotal: 0, weekDone: 0, weekTotal: 0
  },

  onShow() {
    this.loadDashboard()
    itemService.sync().then((result) => { if (!result.skipped) this.loadDashboard() }).catch(() => {})
  },
  onPullDownRefresh() { this.loadDashboard(); wx.stopPullDownRefresh() },

  loadDashboard() {
    const now = new Date()
    const dashboard = itemService.getDashboard(now)
    const date = parseDate(dashboard.today)
    const hour = now.getHours()
    const greeting = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
    const decorate = (item) => this.decorateItem(item, dashboard.today)
    const focusIds = new Set(dashboard.focus.map((item) => item.id))
    const remainingSchedules = dashboard.schedules.filter((item) => !item.completed && !focusIds.has(item.id))
    const remainingDayTodos = dashboard.dayTodos.filter((item) => !item.completed && !focusIds.has(item.id))
    const remainingWeekTodos = dashboard.weekTodos.filter((item) => !item.completed && !focusIds.has(item.id))
    const remainingOverdueTodos = dashboard.overdueTodos.filter((item) => !focusIds.has(item.id))
    const activeYearTodos = dashboard.yearTodos.filter((item) => !item.completed)
    const activeToday = dashboard.dayTodos.filter((item) => !item.completed).length +
      dashboard.schedules.filter((item) => !item.completed).length +
      dashboard.todayChores.filter((item) => !item.completed).length
    const scheduleDone = dashboard.schedules.filter((item) => item.completed).length
    const dayDone = dashboard.dayTodos.filter((item) => item.completed).length
    const choreDone = dashboard.todayChores.filter((item) => item.completed).length
    const todayTotal = dashboard.dayTodos.length + dashboard.schedules.length + dashboard.todayChores.length
    const handledToday = dayDone + scheduleDone + choreDone
    this.setData({
      dateText: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日  ${WEEKDAYS[date.getDay()]}`,
      greeting,
      summaryText: dashboard.overdueTodos.length ?
        `今天还有 ${activeToday} 项 · ${dashboard.overdueTodos.length} 项逾期` :
        activeToday ? `今天还有 ${activeToday} 项待处理` : '今天的安排都处理好了',
      handledToday,
      todayTotal,
      todayProgress: todayTotal ? Math.round(handledToday / todayTotal * 100) : 0,
      scheduleDone,
      scheduleTotal: dashboard.schedules.length,
      choreDone,
      choreTotal: dashboard.todayChores.length,
      focus: dashboard.focus.map(decorate),
      overdueTodos: remainingOverdueTodos.map(decorate),
      schedules: remainingSchedules.map(decorate),
      chores: dashboard.pendingChores.map(decorate),
      dayTodos: remainingDayTodos.map(decorate),
      weekTodos: remainingWeekTodos.slice(0, 5).map(decorate),
      yearTodos: activeYearTodos.slice(0, 3).map(decorate),
      completedToday: dashboard.completedToday.map(decorate),
      dayDone,
      dayTotal: dashboard.dayTodos.length,
      weekDone: dashboard.weekTodos.filter((item) => item.completed).length,
      weekTotal: dashboard.weekTodos.length
    })
  },

  decorateItem(item, today) {
    let subText = ''
    let statusClass = 'pill-green'
    if (item.type === 'schedule') subText = `${item.startTime || '全天'}${item.endTime ? ` - ${item.endTime}` : ''}`
    else if (item.type === 'chore') subText = item.date && item.date < today ? `之前未完成 · ${item.date}` : '今日琐事'
    else if (item.deadlineDate) {
      const overdue = item.deadlineDate < today && !item.completed
      subText = overdue ? `已逾期 · ${item.deadlineDate}` : `截止 ${item.deadlineDate === today ? '今天' : item.deadlineDate}${item.deadlineTime ? ` ${item.deadlineTime}` : ''}`
      statusClass = overdue ? 'pill-red' : item.deadlineDate === today ? 'pill-orange' : 'pill-green'
    } else if (item.taskScope === 'day' && item.date && item.date < today && !item.completed) {
      subText = `已逾期 · ${item.date}`
      statusClass = 'pill-red'
    } else if (item.taskScope === 'week') subText = `第 ${item.weekNumber} 周 · 至 ${item.weekEndDate.slice(5)}`
    else if (item.taskScope === 'year') subText = `${item.year} 年目标`
    else subText = ['低', '中', '高'][item.urgency - 1] + '紧急'
    const scopeText = item.type === 'schedule' ? '日程' : item.type === 'chore' ? '琐事' :
      ({ day: '日任务', week: '周任务', year: '年任务' }[item.taskScope] || '任务')
    const compactDate = (value) => value ? value.slice(5).replace('-', '.') : '未设置'
    return {
      ...item,
      subText,
      statusClass,
      urgencyText: ['低紧急', '中紧急', '高紧急'][item.urgency - 1] || '中紧急',
      scopeText,
      yearRangeText: item.taskScope === 'year' ? `${compactDate(item.yearStartDate)} — ${compactDate(item.yearEndDate)}` : '',
      displayProgress: item.progress === null ? 0 : item.progress
    }
  },

  toggleCompleted(event) {
    const id = event.currentTarget.dataset.id
    const item = itemService.getById(id)
    if (!item) return
    if (item.completed) {
      itemService.toggleCompleted(id)
      wx.showToast({ title: '已恢复', icon: 'none' })
      this.loadDashboard()
      return
    }
    wx.showModal({
      title: '确认完成？',
      content: `“${item.title}”将移入今日已完成。`,
      confirmText: '完成',
      confirmColor: '#2F6B4F',
      success: ({ confirm }) => {
        if (!confirm) return
        this.setData({ completingId: id })
        setTimeout(() => {
          itemService.toggleCompleted(id)
          this.setData({ completingId: '' })
          this.loadDashboard()
        }, 460)
      }
    })
  },

  changeGoalProgress(event) {
    const { id, index } = event.currentTarget.dataset
    const touch = event.changedTouches && event.changedTouches[0]
    const tapX = touch ? touch.clientX : event.detail.x
    this.createSelectorQuery().select(`.goal-progress-${index}`).boundingClientRect((rect) => {
      if (!rect) return
      const item = itemService.getById(id)
      if (!item || item.taskScope !== 'year') return
      const current = item.progress === null ? 0 : Number(item.progress)
      const increase = tapX >= rect.left + rect.width / 2
      const next = Math.max(0, Math.min(100, current + (increase ? 5 : -5)))
      if (next === current) {
        wx.showToast({ title: increase ? '进度已到 100%' : '进度已到 0%', icon: 'none', duration: 700 })
        return
      }
      itemService.save({ ...item, progress: next })
      this.loadDashboard()
    }).exec()
  },

  openItem(event) { wx.navigateTo({ url: `/pages/editor/index?id=${event.currentTarget.dataset.id}` }) },

  showItemActions(event) {
    const id = event.currentTarget.dataset.id
    wx.showActionSheet({
      itemList: ['编辑', '删除'],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) this.openItem({ currentTarget: { dataset: { id } } })
        if (tapIndex === 1) this.confirmRemove(id)
      }
    })
  },

  confirmRemove(id) {
    wx.showModal({
      title: '删除事项？', content: '删除后无法恢复。', confirmColor: '#C14E38',
      success: ({ confirm }) => { if (confirm) { itemService.remove(id); this.loadDashboard() } }
    })
  },

  quickAdd() {
    const choices = ['想法', '日任务', '周任务', '年任务', '琐事', '日程']
    const params = ['type=idea', 'type=todo&scope=day', 'type=todo&scope=week', 'type=todo&scope=year', 'type=chore', 'type=schedule']
    wx.showActionSheet({ itemList: choices, success: ({ tapIndex }) => wx.navigateTo({ url: `/pages/editor/index?${params[tapIndex]}` }) })
  },

  viewAllWeek() { wx.switchTab({ url: '/pages/inbox/index' }) }
})
