const store = require('../../utils/store')
Page({
  data: { state: {}, students: [], list: [], subjects: ['数学', '语文', '英语'], subjectIndex: 0, knowledge: '', note: '', image: false },
  onShow() { this.refresh() },
  refresh() { const state = store.get(); const students = store.visibleStudents(state).map(x => Object.assign({}, x, { selected: x.id === state.selectedStudentId })); const list = (state.role === 'guardian' ? state.mistakes.filter(x => x.studentId === state.selectedStudentId) : state.mistakes).map(x => Object.assign({}, x, { studentName: store.student(state, x.studentId).nickname })); this.setData({ state, students, list }) },
  selectStudent(e) { const result = store.selectStudent(e.currentTarget.dataset.id); if (result.error) wx.showToast({ title: result.error, icon: 'none' }); this.refresh() },
  subjectChange(e) { this.setData({ subjectIndex: Number(e.detail.value) }) },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  chooseImage() { wx.chooseImage({ count: 1, sizeType: ['compressed'], success: () => this.setData({ image: true }) }) },
  submit() { if (!this.data.knowledge.trim() || !this.data.note.trim()) return wx.showToast({ title: '请填写知识点和错因', icon: 'none' }); const result = store.addMistake({ studentId: this.data.state.selectedStudentId, subject: this.data.subjects[this.data.subjectIndex], knowledge: this.data.knowledge, note: this.data.note, image: this.data.image }); if (result.error) return wx.showToast({ title: result.error, icon: 'none' }); this.setData({ knowledge: '', note: '', image: false }); wx.showToast({ title: '错题已保存', icon: 'success' }); this.refresh() },
  advance(e) { const result = store.advanceMistake(e.currentTarget.dataset.id); wx.showToast({ title: result.error || '订正状态已更新', icon: result.error ? 'none' : 'success' }); this.refresh() }
})
