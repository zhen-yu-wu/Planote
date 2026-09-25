const itemService = require('../../services/itemService')
const { toDateString, getWeekRange } = require('../../utils/date')

const typeNames = { idea: '想法', todo: '任务', chore: '琐事', schedule: '日程' }

Page({
  data: {
    isEdit: false,
    form: {},
    urgencyLabels: ['低', '中', '高'],
    importanceLabels: ['低', '中', '高']
  },

  onLoad(options) {
    if (options.id) {
      const item = itemService.getById(options.id)
      if (!item) return wx.showToast({ title: '事项不存在', icon: 'none' })
      if (item.taskScope === 'year') {
        item.yearStartDate = item.yearStartDate || `${item.year}-01-01`
        item.yearEndDate = item.yearEndDate || `${item.year}-12-31`
      }
      this.setData({ isEdit: true, form: item })
      wx.setNavigationBarTitle({ title: `编辑${typeNames[item.type]}` })
      return
    }
    const now = new Date()
    const today = options.date || toDateString(now)
    const week = getWeekRange(now)
    const type = options.type || 'idea'
    const scope = type === 'todo' ? (options.scope || 'day') : ''
    this.setData({
      form: {
        type, taskScope: scope, title: '', content: '', date: type === 'idea' ? '' : today,
        startTime: '', endTime: '', deadlineDate: type === 'todo' && scope === 'day' ? today : '', deadlineTime: '',
        urgency: 2, importance: 2, completed: false,
        weekYear: week.weekYear, weekNumber: week.weekNumber,
        weekStartDate: week.start, weekEndDate: week.end,
        year: now.getFullYear(), yearStartDate: `${now.getFullYear()}-01-01`, yearEndDate: `${now.getFullYear()}-12-31`, progress: null
      }
    })
    wx.setNavigationBarTitle({ title: `新增${typeNames[type]}` })
  },

  setField(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: event.detail.value })
  },

  setBoolean(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: event.detail.value })
  },

  chooseType(event) {
    const type = event.currentTarget.dataset.value
    const update = { 'form.type': type }
    if (type === 'todo' && !this.data.form.taskScope) update['form.taskScope'] = 'day'
    if ((type === 'chore' || type === 'schedule') && !this.data.form.date) update['form.date'] = toDateString(new Date())
    this.setData(update)
    wx.setNavigationBarTitle({ title: `${this.data.isEdit ? '编辑' : '新增'}${typeNames[type]}` })
  },

  chooseScope(event) {
    const scope = event.currentTarget.dataset.value
    const update = { 'form.taskScope': scope }
    if (scope === 'day' && !this.data.form.date) update['form.date'] = toDateString(new Date())
    this.setData(update)
  },

  setUrgency(event) { this.setData({ 'form.urgency': Number(event.currentTarget.dataset.value) }) },
  setImportance(event) { this.setData({ 'form.importance': Number(event.currentTarget.dataset.value) }) },
  setProgress(event) { this.setData({ 'form.progress': Number(event.detail.value) }) },

  onWeekStartChange(event) {
    const date = new Date(`${event.detail.value}T00:00:00`)
    const range = getWeekRange(date)
    this.setData({
      'form.weekYear': range.weekYear, 'form.weekNumber': range.weekNumber,
      'form.weekStartDate': range.start, 'form.weekEndDate': range.end
    })
  },

  onYearChange(event) {
    const year = Number(String(event.detail.value).slice(0, 4))
    this.setData({
      'form.year': year,
      'form.yearStartDate': `${year}-01-01`,
      'form.yearEndDate': `${year}-12-31`
    })
  },

  save() {
    const form = this.data.form
    if (!form.title || !form.title.trim()) return wx.showToast({ title: '请填写标题', icon: 'none' })
    if (form.type === 'schedule' && !form.date) return wx.showToast({ title: '请选择日程日期', icon: 'none' })
    if (form.type === 'schedule' && form.startTime && form.endTime && form.endTime <= form.startTime) {
      return wx.showToast({ title: '结束时间应晚于开始时间', icon: 'none' })
    }
    if (form.type === 'todo' && form.taskScope === 'year' && form.yearStartDate && form.yearEndDate && form.yearEndDate < form.yearStartDate) {
      return wx.showToast({ title: '结束日期不能早于开始日期', icon: 'none' })
    }
    try {
      itemService.save(form)
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 350)
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败', icon: 'none' })
    }
  },

  remove() {
    wx.showModal({
      title: '删除事项？', content: '删除后无法恢复。', confirmColor: '#C14E38',
      success: ({ confirm }) => {
        if (!confirm) return
        itemService.remove(this.data.form.id)
        wx.navigateBack()
      }
    })
  }
})
