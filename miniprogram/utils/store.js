const KEY = 'warm-study-miniapp-v1'
const seed = {
  role: 'guardian', selectedStudentId: 's1', guideSeen: false,
  students: [
    { id: 's1', name: '林小满', nickname: '小满', grade: '三年级', points: 86, status: '辅导中', ranking: true, guardians: ['林妈妈', '林爸爸'], active: true },
    { id: 's2', name: '陈一诺', nickname: '一诺', grade: '四年级', points: 72, status: '待接', ranking: true, guardians: ['陈妈妈'], active: true },
    { id: 's3', name: '周子安', nickname: '子安', grade: '二年级', points: 61, status: '已到班', ranking: true, guardians: ['周妈妈'], active: true },
    { id: 's4', name: '沈嘉禾', nickname: '嘉禾', grade: '五年级', points: 48, status: '待到班', ranking: false, guardians: ['沈妈妈'], active: true }
  ],
  homework: [
    { id: 'h1', studentId: 's1', subject: '数学', content: '练习册第32页第1—6题', status: '辅导中', feedback: '正在订正应用题。', createdAt: '16:05' },
    { id: 'h2', studentId: 's1', subject: '语文', content: '完成《荷花》生字词与阅读题', status: '待确认', feedback: '', createdAt: '16:05' },
    { id: 'h3', studentId: 's2', subject: '英语', content: 'Unit 4 单词抄写与听力', status: '已完成', feedback: '书写认真，听力全对。', createdAt: '15:40' }
  ],
  ledger: [
    { id: 'l1', studentId: 's1', delta: 10, type: '作业奖励', reason: '昨日全部作业完成', at: '07-14 18:08' },
    { id: 'l2', studentId: 's1', delta: 6, type: '错题订正', reason: '分数应用题订正完成', at: '07-13 17:40' },
    { id: 'l3', studentId: 's2', delta: 8, type: '表现奖励', reason: '主动完成复习', at: '07-14 17:30' }
  ],
  products: [
    { id: 'p1', name: '植萃绘画本', cost: 20, stock: 8, onSale: true },
    { id: 'p2', name: '小鹿书签', cost: 35, stock: 3, onSale: true },
    { id: 'p3', name: '周末电影券', cost: 60, stock: 2, onSale: true },
    { id: 'p4', name: '彩色便签套装', cost: 15, stock: 0, onSale: false }
  ],
  redemptions: [],
  mistakes: [
    { id: 'm1', studentId: 's1', subject: '数学', knowledge: '分数应用题', note: '单位“1”找错，已经订正一次。', status: '已订正', at: '07-14' },
    { id: 'm2', studentId: 's1', subject: '语文', knowledge: '比喻句辨析', note: '需要复习本体、喻体和比喻词。', status: '待订正', at: '07-13' }
  ],
  bindings: [ { id: 'b1', guardian: '李妈妈', student: '李昀泽', relation: '母亲', status: '待审核' }, { id: 'b2', guardian: '周爸爸', student: '周子安', relation: '父亲', status: '待审核' } ],
  notices: [ { id: 'n1', studentId: 's2', eta: '17:30', status: '已发送', at: '17:00' } ],
  audit: [ { id: 'a1', actor: '妈妈', action: '发放积分', target: '林小满', detail: '+10，昨日全部作业完成', at: '07-14 18:08' } ]
}
function clone(v) { return JSON.parse(JSON.stringify(v)) }
function init() { if (!wx.getStorageSync(KEY)) wx.setStorageSync(KEY, clone(seed)) }
function get() { return clone(wx.getStorageSync(KEY) || seed) }
function save(state) { wx.setStorageSync(KEY, clone(state)); return state }
function id(prefix) { return prefix + Date.now().toString(36) }
function time() { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
function student(state, studentId) { return state.students.find(x => x.id === studentId) }
function isManager(state) { return state.role === 'owner' || state.role === 'staff' }
function canAccessStudent(state, studentId) { return state.role !== 'guardian' || studentId === 's1' }
function visibleStudents(state) { return state.students.filter(x => canAccessStudent(state, x.id) && x.active) }
function result(state, error) { return error ? { state, error } : { state: save(state) } }
function audit(state, action, target, detail) { state.audit.unshift({ id: id('a'), actor: state.role === 'owner' ? '妈妈' : state.role === 'staff' ? '王老师' : '林妈妈', action, target, detail, at: time() }) }
function changeRole(role) { const s = get(); if (!['guardian', 'staff', 'owner'].includes(role)) return result(s, '角色无效'); s.role = role; if (role === 'guardian') s.selectedStudentId = 's1'; return result(s) }
function selectStudent(studentId) { const s = get(); if (!canAccessStudent(s, studentId)) return result(s, '无权访问该学生'); s.selectedStudentId = studentId; return result(s) }
function updateSession(studentId, status) { const s = get(); const p = student(s, studentId); const chain = { '待到班': '已到班', '已到班': '辅导中', '辅导中': '待接', '待接': '已接走' }; if (!isManager(s)) return result(s, '家长没有状态管理权限'); if (!p || !p.active) return result(s, '学生不可用'); if (chain[p.status] !== status) return result(s, '当前状态不允许这样变更'); p.status = status; audit(s, '更新今日状态', p.name, `更新为 ${status}`); return result(s) }
function sendNotice(studentId, eta) { const s = get(); const p = student(s, studentId); if (!isManager(s)) return result(s, '家长没有发送提醒权限'); if (!p || p.status !== '辅导中') return result(s, '只有辅导中的学生可以发送提醒'); if (!/^\d{1,2}:\d{2}$/.test(eta)) return result(s, '预计时间格式不正确'); if (s.notices.some(n => n.studentId === studentId && n.eta === eta && n.status === '已发送')) return result(s, '该预计时间已经发送过提醒'); p.status = '待接'; s.notices.unshift({ id: id('n'), studentId, eta, status: '已发送', at: time() }); audit(s, '发送接娃提醒', p.name, `预计 ${eta} 可以来接`); return result(s) }
function addHomework(payload) { const s = get(); if (!canAccessStudent(s, payload.studentId)) return result(s, '无权为该学生提交作业'); if (!payload.content && !payload.image) return result(s, '作业内容不能为空'); s.homework.unshift({ id: id('h'), studentId: payload.studentId, subject: payload.subject, content: payload.content, status: '待确认', feedback: payload.note || '', createdAt: time(), image: !!payload.image }); audit(s, '提交作业', student(s, payload.studentId).name, `${payload.subject}：${payload.content}`); return result(s) }
function updateHomework(workId, status, feedback) { const s = get(); const item = s.homework.find(x => x.id === workId); const next = { '待确认': '辅导中', '辅导中': '已完成' }; if (!isManager(s)) return result(s, '家长不能处理作业'); if (!item || (status !== item.status && next[item.status] !== status)) return result(s, '作业状态变更不合法'); item.status = status; if (feedback !== undefined) item.feedback = feedback; audit(s, feedback !== undefined ? '填写作业反馈' : '处理作业', student(s, item.studentId).name, feedback !== undefined ? `${item.subject}：${feedback || '清空反馈'}` : `${item.subject} 标记为 ${status}`); return result(s) }
function addPoints(studentId, delta, type, reason) { const s = get(); const p = student(s, studentId); if (!isManager(s)) return result(s, '家长没有调整积分权限'); if (type === '人工调整' && s.role !== 'owner') return result(s, '人工调整仅负责人可以执行'); if (!p || p.points + delta < 0) return result(s, '积分不能为负数'); if (!reason) return result(s, '积分调整必须填写原因'); p.points += delta; s.ledger.unshift({ id: id('l'), studentId, delta, type, reason, at: time() }); audit(s, '调整积分', p.name, `${delta > 0 ? '+' : ''}${delta}，${reason}`); return result(s) }
function rewardHomework(workId) { const s = get(); const item = s.homework.find(x => x.id === workId); if (!isManager(s)) return result(s, '家长没有奖励积分权限'); if (!item || item.status !== '已完成') return result(s, '仅已完成作业可以奖励'); if (item.rewarded) return result(s, '该作业已经奖励过积分'); const p = student(s, item.studentId); item.rewarded = true; p.points += 5; s.ledger.unshift({ id: id('l'), studentId: p.id, delta: 5, type: '作业奖励', reason: '今日作业完成奖励', at: time(), homeworkId: item.id }); audit(s, '发放积分', p.name, '作业完成奖励 +5'); return result(s) }
function reverseLedger(ledgerId) { const s = get(); const item = s.ledger.find(x => x.id === ledgerId); if (s.role !== 'owner') return result(s, '冲正仅负责人可以执行'); if (!item || item.reversed || item.type === '撤销冲正' || item.type === '兑换扣除') return result(s, '该流水不能冲正'); const p = student(s, item.studentId); if (p.points - item.delta < 0) return result(s, '冲正会导致积分为负数'); p.points -= item.delta; item.reversed = true; s.ledger.unshift({ id: id('l'), studentId: p.id, delta: -item.delta, type: '撤销冲正', reason: `冲正：${item.reason}`, at: time() }); audit(s, '冲正积分流水', p.name, item.reason); return result(s) }
function redeem(studentId, productId) { const s = get(); const p = student(s, studentId); const product = s.products.find(x => x.id === productId); if (!isManager(s)) return result(s, '家长只能浏览商品'); if (!p || !product || !product.onSale || product.stock < 1) return result(s, '商品暂不可兑换'); if (p.points < product.cost) return result(s, '积分不足'); p.points -= product.cost; product.stock -= 1; const redemption = { id: id('r'), studentId, productId, productName: product.name, cost: product.cost, at: time(), status: '已完成' }; s.ledger.unshift({ id: id('l'), studentId, delta: -product.cost, type: '兑换扣除', reason: `兑换${product.name}`, at: time(), redemptionId: redemption.id }); s.redemptions.unshift(redemption); audit(s, '办理兑换', p.name, product.name); return result(s) }
function reverseRedemption(redemptionId) { const s = get(); const redemption = s.redemptions.find(x => x.id === redemptionId); if (s.role !== 'owner') return result(s, '撤销兑换仅负责人可以执行'); if (!redemption || redemption.status !== '已完成') return result(s, '该兑换不能撤销'); const p = student(s, redemption.studentId); const product = s.products.find(x => x.id === redemption.productId); p.points += redemption.cost; if (product) product.stock += 1; redemption.status = '已撤销'; s.ledger.unshift({ id: id('l'), studentId: p.id, delta: redemption.cost, type: '撤销冲正', reason: `撤销兑换：${redemption.productName}`, at: time(), redemptionId }); audit(s, '撤销积分兑换', p.name, redemption.productName); return result(s) }
function addMistake(payload) { const s = get(); if (!canAccessStudent(s, payload.studentId)) return result(s, '无权为该学生新增错题'); if (!payload.knowledge || !payload.note) return result(s, '请填写知识点和错因'); s.mistakes.unshift({ id: id('m'), studentId: payload.studentId, subject: payload.subject, knowledge: payload.knowledge, note: payload.note, status: '待订正', at: time(), image: !!payload.image }); audit(s, '新增错题', student(s, payload.studentId).name, `${payload.subject}·${payload.knowledge}`); return result(s) }
function advanceMistake(idValue) { const s = get(); const item = s.mistakes.find(x => x.id === idValue); if (!isManager(s)) return result(s, '家长不能推进订正状态'); if (!item) return result(s, '错题不存在'); item.status = item.status === '待订正' ? '已订正' : item.status === '已订正' ? '已掌握' : '待订正'; audit(s, '更新错题状态', item.knowledge, item.status); return result(s) }
function reviewBinding(idValue, status) { const s = get(); const b = s.bindings.find(x => x.id === idValue); if (s.role !== 'owner') return result(s, '绑定审核仅负责人可以执行'); if (!b || b.status !== '待审核') return result(s, '该绑定已处理'); b.status = status; audit(s, '审核家长绑定', b.student, `${b.guardian}：${status}`); return result(s) }
function setProduct(idValue, field, value) { const s = get(); const p = s.products.find(x => x.id === idValue); if (s.role !== 'owner') return result(s, '商品管理仅负责人可以执行'); if (!p) return result(s, '商品不存在'); p[field] = value; audit(s, '更新商品', p.name, `${field} 已更新`); return result(s) }
function addProduct(payload) { const s = get(); const cost = Number(payload.cost); const stock = Number(payload.stock); if (s.role !== 'owner') return result(s, '商品上架仅负责人可以执行'); if (!payload.name || !Number.isInteger(cost) || cost < 1 || !Number.isInteger(stock) || stock < 0) return result(s, '请填写有效的商品名称、积分和库存'); const product = { id: id('p'), name: payload.name, cost, stock, onSale: true }; s.products.unshift(product); audit(s, '上架商品', product.name, `${cost} 分，库存 ${stock}`); return result(s) }
function toggleStudent(idValue) { const s = get(); const p = student(s, idValue); if (s.role !== 'owner') return result(s, '学生管理仅负责人可以执行'); if (!p) return result(s, '学生不存在'); p.active = !p.active; audit(s, '更新学生状态', p.name, p.active ? '启用' : '停用'); return result(s) }
function addStudent(payload) { const s = get(); if (s.role !== 'owner') return result(s, '新增学生仅负责人可以执行'); if (!payload.name || !payload.grade) return result(s, '请填写学生姓名和年级'); const p = { id: id('s'), name: payload.name, nickname: payload.name.slice(-2), grade: payload.grade, points: 0, status: '待到班', ranking: false, guardians: [], active: true }; s.students.push(p); audit(s, '新增学生', p.name, p.grade); return result(s) }
function applyBinding(payload) { const s = get(); if (s.role !== 'guardian') return result(s, '仅家长可以申请绑定'); if (!payload.student || !payload.relation) return result(s, '请填写孩子姓名和关系'); if (s.bindings.some(x => x.guardian === '林妈妈' && x.student === payload.student && x.status === '待审核')) return result(s, '该绑定申请正在审核'); const binding = { id: id('b'), guardian: '林妈妈', student: payload.student, relation: payload.relation, status: '待审核' }; s.bindings.unshift(binding); audit(s, '提交绑定申请', binding.student, binding.relation); return result(s) }
function reset() { wx.setStorageSync(KEY, clone(seed)); return get() }
module.exports = { init, get, save, changeRole, selectStudent, updateSession, sendNotice, addHomework, updateHomework, addPoints, rewardHomework, reverseLedger, redeem, reverseRedemption, addMistake, advanceMistake, reviewBinding, setProduct, addProduct, toggleStudent, addStudent, applyBinding, reset, student, visibleStudents }
