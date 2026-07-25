const assert = require('node:assert/strict')
const fs = require('node:fs')
const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) }
}
const moduleBox = { exports: {} }
new Function('require', 'module', 'exports', 'wx', fs.readFileSync(require.resolve('../miniprogram/utils/store.js'), 'utf8'))(require, moduleBox, moduleBox.exports, global.wx)
const store = moduleBox.exports

store.init()
let state = store.get()
assert.equal(state.students.length, 4, '应初始化示例学生')
assert.equal(state.role, 'guardian', '首次应为家长体验角色')

assert.equal(store.selectStudent('s2').error, '无权访问该学生', '家长不可切换到其他家庭学生')
assert.equal(store.updateSession('s1', '待接').error, '家长没有状态管理权限', '家长不可直接改变今日状态')
assert.equal(store.redeem('s1', 'p1').error, '家长只能浏览商品', '家长不可直接兑换')

state = store.changeRole('staff').state
assert.equal(store.updateSession('s3', '待接').error, '当前状态不允许这样变更', '非法状态跳转应被拒绝')
state = store.updateSession('s3', '辅导中').state
assert.equal(store.student(state, 's3').status, '辅导中', '老师可推进今日状态')
state = store.sendNotice('s3', '17:40').state
assert.equal(store.student(state, 's3').status, '待接', '发送提醒后学生应进入待接')
assert.equal(state.notices[0].eta, '17:40', '提醒应保存预计时间')
assert.equal(store.sendNotice('s3', '17:40').error, '只有辅导中的学生可以发送提醒', '待接后不可重复发送提醒')

const beforeHomework = state.homework.length
state = store.addHomework({ studentId: 's1', subject: '数学', content: '口算卡第18页', note: '请讲解第3题' }).state
assert.equal(state.homework.length, beforeHomework + 1, '家长作业提交应新增记录')
assert.equal(state.homework[0].status, '待确认', '新作业应等待老师确认')
state = store.updateHomework(state.homework[0].id, '辅导中').state
state = store.updateHomework(state.homework[0].id, '已完成', '已完成今天的辅导').state
state = store.rewardHomework(state.homework[0].id).state
assert.equal(store.rewardHomework(state.homework[0].id).error, '该作业已经奖励过积分', '同一作业不可重复奖励')

const beforePoints = store.student(state, 's1').points
let points = store.addPoints('s1', 5, '作业奖励', '测试奖励')
assert.ok(!points.error, '奖励积分应成功')
assert.equal(store.student(points.state, 's1').points, beforePoints + 5, '积分余额应由流水更新')
points = store.addPoints('s1', -999, '表现奖励', '负余额校验')
assert.equal(points.error, '积分不能为负数', '不允许扣成负积分')
assert.equal(store.addPoints('s1', 1, '人工调整', '仅负责人').error, '人工调整仅负责人可以执行', '老师不可人工调整积分')

state = points.state
const stockBefore = state.products[0].stock
const balanceBefore = store.student(state, 's1').points
const redemption = store.redeem('s1', 'p1')
assert.ok(!redemption.error, '积分足够时应完成兑换')
assert.equal(store.student(redemption.state, 's1').points, balanceBefore - 20, '兑换应扣除积分')
assert.equal(redemption.state.products[0].stock, stockBefore - 1, '兑换应扣减库存')
assert.equal(store.reverseRedemption(redemption.state.redemptions[0].id).error, '撤销兑换仅负责人可以执行', '老师不可撤销兑换')

state = store.changeRole('owner').state
const reversed = store.reverseRedemption(state.redemptions[0].id)
assert.ok(!reversed.error, '负责人可撤销兑换')
assert.equal(reversed.state.redemptions[0].status, '已撤销', '撤销后需保留兑换记录')
assert.equal(reversed.state.products[0].stock, stockBefore, '撤销兑换应恢复库存')
const productCount = reversed.state.products.length
state = store.addProduct({ name: '奖励贴纸', cost: 12, stock: 6 }).state
assert.equal(state.products.length, productCount + 1, '负责人可上架商品')
const studentCount = state.students.length
state = store.addStudent({ name: '许星澜', grade: '一年级' }).state
assert.equal(state.students.length, studentCount + 1, '负责人可新增学生档案')

state = store.addMistake({ studentId: 's1', subject: '数学', knowledge: '小数除法', note: '商的小数点位置错误' }).state
const mistake = state.mistakes[0]
state = store.advanceMistake(mistake.id).state
assert.equal(state.mistakes[0].status, '已订正', '错题状态可推进')
state = store.changeRole('guardian').state
const bindingCount = state.bindings.length
state = store.applyBinding({ student: '许星澜', relation: '母亲' }).state
assert.equal(state.bindings.length, bindingCount + 1, '家长可提交绑定申请')
console.log('miniapp local business checks passed')
