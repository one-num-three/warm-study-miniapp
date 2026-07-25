const store = require('../../utils/store')
const roleNames = { guardian: '家长·林妈妈', staff: '老师·日常管理', owner: '妈妈·负责人' }
Page({
  data: { state: {}, roles: ['guardian', 'staff', 'owner'], roleNames, students: [], notices: [], statusCounts: [] },
  onShow() { this.refresh() },
  refresh() { const state = store.get(); const statuses = ['待到班', '已到班', '辅导中', '待接', '已接走']; const students = store.visibleStudents(state).map(x => Object.assign({}, x, { initial: x.nickname.slice(0, 1), guardiansText: x.guardians.join('、') })); this.setData({ state, students, notices: state.notices.filter(x => state.role !== 'guardian' || x.studentId === 's1'), statusCounts: statuses.map(name => ({ name, count: state.students.filter(x => x.status === name).length })) }) },
  chooseRole(e) { const result = store.changeRole(e.currentTarget.dataset.role); if (result.error) wx.showToast({ title: result.error, icon: 'none' }); this.refresh() },
  selectStudent(e) { const result = store.selectStudent(e.currentTarget.dataset.id); if (result.error) wx.showToast({ title: result.error, icon: 'none' }); this.refresh() },
  updateStatus(e) { const { id, status } = e.currentTarget.dataset; const result = store.updateSession(id, status); wx.showToast({ title: result.error || '今日状态已更新', icon: result.error ? 'none' : 'success' }); this.refresh() },
  remind(e) { const { id, minutes } = e.currentTarget.dataset; const now = new Date(); now.setMinutes(now.getMinutes() + Number(minutes)); const eta = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`; wx.showModal({ title: '确认接娃提醒', content: `将发送“预计 ${eta} 可以来接”的提醒`, success: res => { if (res.confirm) { const result = store.sendNotice(id, eta); wx.showToast({ title: result.error || '提醒已记录', icon: result.error ? 'none' : 'success' }); this.refresh() } } }) },
  customRemind(e) { const id = e.currentTarget.dataset.id; wx.showModal({ title: '自定义提醒', editable: true, placeholderText: '例如 17:45', success: res => { if (res.confirm) { const result = store.sendNotice(id, res.content); wx.showToast({ title: result.error || '提醒已记录', icon: result.error ? 'none' : 'success' }); this.refresh() } } }) },
  reset() { wx.showModal({ title: '恢复示例数据', content: '将清除本机本次演示的所有改动。', success: res => { if (res.confirm) { store.reset(); this.refresh(); wx.showToast({ title: '已恢复', icon: 'success' }) } } }) }
})
