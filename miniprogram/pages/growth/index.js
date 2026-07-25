const store = require('../../utils/store')
Page({
  data: { state: {}, students: [], current: {}, ledger: [], ranking: [], delta: '5', reason: '' },
  onShow() { this.refresh() },
  refresh() { const state = store.get(); const current = store.student(state, state.selectedStudentId); const students = store.visibleStudents(state).map(x => Object.assign({}, x, { selected: x.id === state.selectedStudentId })); const ranking = state.students.filter(x => x.ranking && x.active).map(x => Object.assign({}, x, { week: state.ledger.filter(l => l.studentId === x.id && l.delta > 0 && !l.reversed && l.type !== '撤销冲正').reduce((sum, l) => sum + l.delta, 0) })).sort((a, b) => b.week - a.week); this.setData({ state, students, current, ranking, ledger: state.ledger.filter(x => state.role === 'guardian' ? x.studentId === state.selectedStudentId : true) }) },
  selectStudent(e) { const result = store.selectStudent(e.currentTarget.dataset.id); if (result.error) wx.showToast({ title: result.error, icon: 'none' }); this.refresh() },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  adjust() { const delta = Number(this.data.delta); if (!Number.isFinite(delta) || !delta || !this.data.reason.trim()) return wx.showToast({ title: '请填写积分和原因', icon: 'none' }); const res = store.addPoints(this.data.current.id, delta, '人工调整', this.data.reason); if (res.error) return wx.showToast({ title: res.error, icon: 'none' }); this.setData({ reason: '' }); wx.showToast({ title: '积分流水已写入', icon: 'success' }); this.refresh() },
  reverse(e) { wx.showModal({ title: '确认冲正', content: '原流水会保留，并产生一笔反向流水。', success: res => { if (res.confirm) { const result = store.reverseLedger(e.currentTarget.dataset.id); wx.showToast({ title: result.error || '冲正成功', icon: result.error ? 'none' : 'success' }); this.refresh() } } }) }
})
