const itemService = require('../../services/itemService')
const actions = require('../../services/pageActions')
const { getWeekRange } = require('../../utils/date')

Page({
  data: {
    filter: 'all', scope: 'all', sortMode: 'smart', sortLabel: '智能排序', items: [], query: '', status: 'all', currentPeriod: false, limit: 50, totalCount: 0,
    filters: [{ key: 'all', label: '全部' }, { key: 'idea', label: '想法' }, { key: 'todo', label: '待办' }, { key: 'chore', label: '琐事' }, { key: 'schedule', label: '日程' }],
    scopes: [{ key: 'all', label: '全部' }, { key: 'day', label: '日' }, { key: 'week', label: '周' }, { key: 'year', label: '年' }]
  },
  onShow() {
    const pending = getApp().globalData.inboxFilter
    if (pending) { this.setData({ ...pending, query: '', status: 'all', limit: 50 }); delete getApp().globalData.inboxFilter }
    this.loadItems()
    itemService.sync().then((result) => { if (!result.skipped) this.loadItems() }).catch(() => {}).finally(() => actions.syncStatus(this))
  },
  onPullDownRefresh() { return actions.refresh(this, this.loadItems) },
  loadItems() {
    let items = itemService.getAll()
    if (this.data.filter !== 'all') items = items.filter((item) => item.type === this.data.filter)
    if (this.data.filter === 'todo' && this.data.scope !== 'all') items = items.filter((item) => item.taskScope === this.data.scope)
    if (this.data.currentPeriod) {
      const now = new Date()
      const week = getWeekRange(now)
      items = items.filter((item) => this.data.scope === 'week' ? item.weekYear === week.weekYear && item.weekNumber === week.weekNumber : item.year === now.getFullYear())
    }
    if (this.data.status !== 'all') items = items.filter((item) => this.data.status === 'done' ? item.completed : !item.completed)
    const query = this.data.query.trim().toLowerCase()
    if (query) items = items.filter((item) => `${item.title} ${item.content || ''}`.toLowerCase().includes(query))
    items = itemService.sortForInbox(items, this.data.sortMode)
    let previousGroup = null
    const decorated = items.map((item) => {
      const result = this.decorate(item)
      if (this.data.sortMode !== 'taskDate') return result
      const taskDate = itemService.inboxDate(item)
      const statusText = item.type === 'idea' ? (item.completed ? '已完成想法' : '想法') : item.completed ? '已完成' : '未完成'
      const groupKey = `${statusText}-${taskDate || 'none'}`
      const dateGroupText = `${taskDate || '未设置日期'} · ${statusText}`
      const showDateGroup = groupKey !== previousGroup
      previousGroup = groupKey
      return { ...result, dateGroupText, showDateGroup }
    })
    this.setData({ items: decorated.slice(0, this.data.limit), totalCount: decorated.length, hasMore: decorated.length > this.data.limit })
  },
  decorate(item) {
    const typeLabel = item.type === 'idea' ? '想法' : item.type === 'chore' ? '琐事' : item.type === 'schedule' ? '日程' : ({ day: '日任务', week: '周任务', year: '年任务' }[item.taskScope] || '待办')
    let timeText = ''
    if (item.type === 'schedule') timeText = `${item.date} ${item.startTime || ''}`
    else if (item.type === 'chore') timeText = item.date
    else if (item.taskScope === 'week') timeText = `${item.weekYear} 年第 ${item.weekNumber} 周`
    else if (item.taskScope === 'year') {
      const range = item.yearStartDate && item.yearEndDate ? `${item.yearStartDate} 至 ${item.yearEndDate}` : `${item.year} 年`
      timeText = `${range}${item.progress === null ? '' : ` · ${item.progress}%`}`
    }
    else timeText = item.deadlineDate ? `截止 ${item.deadlineDate}${item.deadlineTime ? ` ${item.deadlineTime}` : ''}` : item.date
    return { ...item, typeLabel, timeText }
  },
  setFilter(event) { this.setData({ filter: event.currentTarget.dataset.key, scope: 'all', currentPeriod: false, limit: 50 }); this.loadItems() },
  setScope(event) { this.setData({ scope: event.currentTarget.dataset.key, currentPeriod: false, limit: 50 }); this.loadItems() },
  search(event) { this.setData({ query: event.detail.value, limit: 50 }); this.loadItems() },
  setStatus(event) { this.setData({ status: event.currentTarget.dataset.status, limit: 50 }); this.loadItems() },
  clearPeriod() { this.setData({ currentPeriod: false }); this.loadItems() },
  loadMore() { this.setData({ limit: this.data.limit + 50 }); this.loadItems() },
  onReachBottom() { if (this.data.hasMore) this.loadMore() },
  chooseSort() {
    const modes = ['smart', 'taskDate', 'recent', 'deadline']
    const labels = ['智能排序', '任务日期', '最近更新', '截止时间']
    wx.showActionSheet({
      itemList: labels,
      success: ({ tapIndex }) => {
        this.setData({ sortMode: modes[tapIndex], sortLabel: labels[tapIndex] })
        this.loadItems()
      }
    })
  },
  openItem(event) { wx.navigateTo({ url: `/pages/editor/index?id=${event.currentTarget.dataset.id}` }) },
  toggleCompleted(event) { actions.toggle(this, event.currentTarget.dataset.id, this.loadItems) },
  undoCompleted() { actions.undo(this) },
  onUnload() { actions.cleanup(this) },

  showActions(event) {
    const id = event.currentTarget.dataset.id
    wx.showActionSheet({ itemList: ['编辑', '删除'], success: ({ tapIndex }) => {
      if (tapIndex === 0) wx.navigateTo({ url: `/pages/editor/index?id=${id}` })
      else wx.showModal({ title: '删除事项？', content: '删除后无法恢复。', confirmColor: '#C14E38', success: ({ confirm }) => { if (confirm) { itemService.remove(id); this.loadItems() } } })
    } })
  },
  quickAdd() {
    const params = ['type=idea', 'type=todo&scope=day', 'type=todo&scope=week', 'type=todo&scope=year', 'type=chore', 'type=schedule']
    wx.showActionSheet({ itemList: ['想法', '日任务', '周任务', '年任务', '琐事', '日程'], success: ({ tapIndex }) => wx.navigateTo({ url: `/pages/editor/index?${params[tapIndex]}` }) })
  }
})
