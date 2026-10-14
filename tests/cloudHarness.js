const fs = require('fs')
const vm = require('vm')
const path = require('path')
const clone = (value) => structuredClone(value)
const createHarness = (file, initial = {}) => {
  let docs = new Map(Object.entries(clone(initial)))
  let queue = Promise.resolve()
  const state = { context: { OPENID: 'admin', SOURCE: 'wx_client' }, readError: null, failWrite: '', sendError: null, sendHook: null, sent: [] }
  const collection = (store) => ({
    doc(id) {
      return {
        async get() {
          if (state.readError) throw state.readError
          if (!store.has(id)) throw Object.assign(new Error('document does not exist'), { code: 'DATABASE_DOCUMENT_NOT_EXIST' })
          return { data: { ...clone(store.get(id)), _id: id } }
        },
        async set({ data }) {
          if (id === state.failWrite) throw new Error('injected write failure')
          store.set(id, clone(data)); return {}
        },
        async update({ data }) {
          if (id === state.failWrite) throw new Error('injected write failure')
          if (!store.has(id)) throw new Error('document does not exist')
          store.set(id, { ...store.get(id), ...clone(data) }); return { stats: { updated: 1 } }
        },
        async remove() { store.delete(id) }
      }
    },
    where(filter) {
      let offset = 0; let limit = 100; let order = ''
      const matches = () => [...store].filter(([id, data]) => Object.entries(filter).every(([key, value]) => {
        const field = key === '_id' ? id : data[key]
        if (value && value.op === 'gt') return field > value.value
        if (value && value.op === 'gte') return field >= value.value
        if (value && value.op === 'lte') return field <= value.value
        if (value && value.op === 'neq') return field !== value.value
        return field === value
      }))
      const query = {
        skip(n) { offset = n; return query }, limit(n) { limit = n; return query }, orderBy(field) { order = field; return query },
        async get() {
          if (state.readError) throw state.readError
          const rows = matches()
          if (order) rows.sort((a, b) => (order === '_id' ? a[0].localeCompare(b[0]) : String(a[1][order]).localeCompare(String(b[1][order]))))
          return { data: rows.slice(offset, offset + limit).map(([id, data]) => ({ ...clone(data), _id: id })) }
        }
      }
      return query
    }
  })
  const db = {
    collection: () => collection(docs), command: { gt: (value) => ({ op: 'gt', value }), gte: (value) => ({ op: 'gte', value }), lte: (value) => ({ op: 'lte', value }), neq: (value) => ({ op: 'neq', value }) },
    runTransaction(callback) {
      // Serial transactions model the database's conflict-retry guarantee.
      // Failed transactions discard every write in the draft.
      const operation = queue.then(async () => {
        const draft = new Map([...docs].map(([id, data]) => [id, clone(data)]))
        const result = await callback({ collection: () => collection(draft) })
        docs.clear(); draft.forEach((data, id) => docs.set(id, data))
        return { result, errMsg: 'runTransaction:ok' }
      })
      queue = operation.catch(() => {})
      return operation
    }
  }
  const cloud = {
    init() {}, DYNAMIC_CURRENT_ENV: 'test', database: () => db, getWXContext: () => clone(state.context),
    openapi: { subscribeMessage: { async send(message) {
      state.sent.push(clone(message))
      if (state.sendHook) await state.sendHook()
      if (state.sendError) throw state.sendError
    } } }
  }
  const fullPath = path.resolve(file)
  const context = { require: (name) => name === 'wx-server-sdk' ? cloud : name.startsWith('.') ? require(path.resolve(path.dirname(fullPath), name)) : require(name), exports: {}, process: { env: { SYNC_ACCESS_KEY_HASH: require('crypto').createHash('sha256').update('master').digest('hex') } }, Buffer, Date, Intl, Set, Map, Promise }
  vm.runInNewContext(fs.readFileSync(fullPath, 'utf8'), context, { filename: fullPath })
  return { main: context.exports.main, state, docs: () => docs }
}
module.exports = { createHarness }
