const store = require('../../utils/store')
Page({
  data: { state: {}, students: [], list: [], subjectIndex: 0, subjects: ['数学', '语文', '英语', '其他'], content: '', note: '', image: false },
  onShow() { this.refresh() },
  refresh() { const state = store.get(); const students = store.visibleStudents(state).map(x => Object.assign({}, x, { selected: x.id === state.selectedStudentId })); const list = state.role === 'guardian' ? state.homework.filter(x => x.studentId === state.selectedStudentId) : state.homework.map(x => Object.assign({}, x, { studentName: store.student(state, x.studentId).nickname })); this.setData({ state, students, list }) },
  selectStudent(e) { const result = store.selectStudent(e.currentTarget.dataset.id); if (result.error) wx.showToast({ title: result.error, icon: 'none' }); this.refresh() },
  subjectChange(e) { this.setData({ subjectIndex: Number(e.detail.value) }) },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  chooseImage() { wx.chooseImage({ count: 1, sizeType: ['compressed'], success: () => { this.setData({ image: true }); wx.showToast({ title: '图片已选择', icon: 'success' }) } }) },
  submit() { if (!this.data.content.trim() && !this.data.image) return wx.showToast({ title: '请填写作业或选择图片', icon: 'none' }); const result = store.addHomework({ studentId: this.data.state.selectedStudentId, subject: this.data.subjects[this.data.subjectIndex], content: this.data.content || '已上传作业图片', note: this.data.note, image: this.data.image }); if (result.error) return wx.showToast({ title: result.error, icon: 'none' }); this.setData({ content: '', note: '', image: false }); wx.showToast({ title: '已进入老师工作台', icon: 'success' }); this.refresh() },
  nextStatus(e) { const current = e.currentTarget.dataset.status; const status = current === '待确认' ? '辅导中' : current === '辅导中' ? '已完成' : current; const result = store.updateHomework(e.currentTarget.dataset.id, status); wx.showToast({ title: result.error || (status === '已完成' ? '作业已完成' : '已开始辅导'), icon: result.error ? 'none' : 'success' }); this.refresh() },
  saveFeedback(e) { const result = store.updateHomework(e.currentTarget.dataset.id, e.currentTarget.dataset.status, e.detail.value); wx.showToast({ title: result.error || '反馈已保存', icon: result.error ? 'none' : 'success' }); this.refresh() },
  reward(e) { const result = store.rewardHomework(e.currentTarget.dataset.id); if (result.error) return wx.showToast({ title: result.error, icon: 'none' }); wx.showToast({ title: '已奖励 5 积分', icon: 'success' }); this.refresh() }
})
