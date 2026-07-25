const store = require('../../utils/store')
Page({
  data: { state: {}, products: [], students: [], selectedProduct: '', redemptions: [], productName: '', productCost: '', productStock: '' },
  onShow() { this.refresh() },
  refresh() { const state = store.get(); this.setData({ state, products: state.products.map(x => Object.assign({}, x, { initial: x.name.slice(0, 1) })), students: store.visibleStudents(state).map(x => Object.assign({}, x, { selected: x.id === state.selectedStudentId })), redemptions: state.redemptions.map(x => Object.assign({}, x, { studentName: store.student(state, x.studentId).nickname })) }) },
  selectStudent(e) { const result = store.selectStudent(e.currentTarget.dataset.id); if (result.error) wx.showToast({ title: result.error, icon: 'none' }); this.refresh() },
  redeem(e) { const product = e.currentTarget.dataset.name; wx.showModal({ title: '现场兑换确认', content: `确认由老师为当前孩子兑换「${product}」吗？`, success: modal => { if (modal.confirm) { const result = store.redeem(this.data.state.selectedStudentId, e.currentTarget.dataset.id); wx.showToast({ title: result.error || '兑换完成', icon: result.error ? 'none' : 'success' }); this.refresh() } } }) },
  toggleSale(e) { const product = this.data.products.find(x => x.id === e.currentTarget.dataset.id); const result = store.setProduct(product.id, 'onSale', !product.onSale); wx.showToast({ title: result.error || '商品状态已更新', icon: result.error ? 'none' : 'success' }); this.refresh() },
  addStock(e) { const product = this.data.products.find(x => x.id === e.currentTarget.dataset.id); const result = store.setProduct(product.id, 'stock', product.stock + 1); wx.showToast({ title: result.error || '库存 +1', icon: result.error ? 'none' : 'success' }); this.refresh() },
  reverse(e) { wx.showModal({ title: '撤销本次兑换', content: '积分和库存会恢复，兑换记录会保留为已撤销。', success: modal => { if (modal.confirm) { const result = store.reverseRedemption(e.currentTarget.dataset.id); wx.showToast({ title: result.error || '兑换已撤销', icon: result.error ? 'none' : 'success' }); this.refresh() } } }) },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  addProduct() { const result = store.addProduct({ name: this.data.productName.trim(), cost: this.data.productCost, stock: this.data.productStock }); if (result.error) return wx.showToast({ title: result.error, icon: 'none' }); this.setData({ productName: '', productCost: '', productStock: '' }); wx.showToast({ title: '商品已上架', icon: 'success' }); this.refresh() }
})
