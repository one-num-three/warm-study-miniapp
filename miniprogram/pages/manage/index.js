const store = require('../../utils/store')
Page({
  data: { state: {}, section: 'students', students: [], bindings: [], audit: [], products: [], permissionRows: [], studentName: '', studentGrade: '', bindingStudent: '', bindingRelation: '' },
  onShow() { this.refresh() },
  refresh() { const state = store.get(); const students = state.students.map(x => Object.assign({}, x, { guardiansText: x.guardians.join('、') })); this.setData({ state, students, bindings: state.bindings, audit: state.audit, products: state.products, permissionRows: [ { name: '妈妈 · 超级管理员', detail: '学生、积分、商品、兑换撤销、权限、审计', label: '全部权限' }, { name: '王老师 · 日常管理', detail: '作业、到班、接娃提醒、作业奖励、错题、现场兑换', label: '日常权限' }, { name: '林妈妈 · 家长', detail: '提交作业、查看孩子、错题上传、成长与商店', label: '仅本人孩子' } ] }) },
  chooseSection(e) { this.setData({ section: e.currentTarget.dataset.section }) },
  review(e) { const result = store.reviewBinding(e.currentTarget.dataset.id, e.currentTarget.dataset.status); wx.showToast({ title: result.error || '审核已保存', icon: result.error ? 'none' : 'success' }); this.refresh() },
  toggleStudent(e) { const item = this.data.students.find(x => x.id === e.currentTarget.dataset.id); const result = store.toggleStudent(item.id); if (result.error) return wx.showToast({ title: result.error, icon: 'none' }); const updated = result.state.students.find(x => x.id === item.id); wx.showToast({ title: updated.active ? '学生已启用' : '学生已停用', icon: 'success' }); this.refresh() },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  addStudent() { const result = store.addStudent({ name: this.data.studentName.trim(), grade: this.data.studentGrade.trim() }); if (result.error) return wx.showToast({ title: result.error, icon: 'none' }); this.setData({ studentName: '', studentGrade: '' }); wx.showToast({ title: '学生已新增', icon: 'success' }); this.refresh() },
  applyBinding() { const result = store.applyBinding({ student: this.data.bindingStudent.trim(), relation: this.data.bindingRelation.trim() }); if (result.error) return wx.showToast({ title: result.error, icon: 'none' }); this.setData({ bindingStudent: '', bindingRelation: '' }); wx.showToast({ title: '申请已提交', icon: 'success' }); this.refresh() }
})
