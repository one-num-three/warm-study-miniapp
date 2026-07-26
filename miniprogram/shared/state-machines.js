/**
 * 状态机（design.md §5）。前后端共用同一张转移表，
 * 界面上不该出现的按钮直接不渲染，服务端再校验一次。
 */
/** 每日辅导状态：正向推进 + 一条旁路 + 一条仅负责人可用的逆向纠错。 */
export const SESSION_TRANSITIONS = [
    { from: "待到班", to: "已到班", label: "标记到班" },
    { from: "已到班", to: "辅导中", label: "开始辅导" },
    { from: "辅导中", to: "待接", label: "可以接走" },
    { from: "待接", to: "已接走", label: "确认接走" },
    // 旁路：孩子来了但今天不辅导，直接等家长接
    { from: "已到班", to: "待接", label: "直接待接" },
    // 逆向纠错：接走标错了
    { from: "已接走", to: "待接", correction: true, label: "撤回接走（纠错）" },
];
export const HOMEWORK_TRANSITIONS = [
    { from: "待确认", to: "需要补充", label: "要求补充" },
    { from: "需要补充", to: "待确认", label: "重新提交" },
    { from: "待确认", to: "辅导中", label: "开始辅导" },
    { from: "辅导中", to: "已完成", label: "全部完成" },
    { from: "辅导中", to: "未完成", label: "标记未完成" },
    { from: "待确认", to: "已撤回", label: "家长撤回" },
    { from: "需要补充", to: "已撤回", label: "家长撤回" },
    { from: "已完成", to: "辅导中", correction: true, label: "退回辅导中（纠错）" },
    { from: "未完成", to: "辅导中", correction: true, label: "退回辅导中（纠错）" },
];
export const HOMEWORK_ITEM_TRANSITIONS = [
    { from: "待开始", to: "进行中", label: "开始" },
    { from: "进行中", to: "已完成", label: "完成" },
    { from: "进行中", to: "未完成", label: "未完成" },
    { from: "待开始", to: "未完成", label: "未完成" },
    { from: "已完成", to: "进行中", correction: true, label: "退回（纠错）" },
    { from: "未完成", to: "进行中", correction: true, label: "退回（纠错）" },
];
export const MISTAKE_TRANSITIONS = [
    { from: "待订正", to: "已订正", label: "已订正" },
    { from: "已订正", to: "已掌握", label: "已掌握" },
    // 复测又错了，允许打回
    { from: "已掌握", to: "待订正", label: "复测再错" },
    { from: "已订正", to: "待订正", label: "订正不合格" },
];
export const PRODUCT_TRANSITIONS = [
    { from: "草稿", to: "上架", label: "上架" },
    { from: "上架", to: "下架", label: "下架" },
    { from: "下架", to: "上架", label: "重新上架" },
];
function findRule(rules, from, to) {
    return rules.find((rule) => rule.from === from && rule.to === to);
}
export function checkTransition(rules, from, to) {
    if (from === to) {
        return { allowed: false, requiresCorrectionRight: false };
    }
    const rule = findRule(rules, from, to);
    if (!rule)
        return { allowed: false, requiresCorrectionRight: false };
    return { allowed: true, requiresCorrectionRight: Boolean(rule.correction), rule };
}
/** 从当前状态出发，界面上该显示哪些按钮。 */
export function nextTransitions(rules, from, options = {}) {
    return rules.filter((rule) => rule.from === from && (options.includeCorrections ? true : !rule.correction));
}
/** 作业单里所有项都终结了吗（用于判断能不能结束当天作业）。 */
export function allItemsSettled(statuses) {
    return statuses.length > 0 && statuses.every((s) => s === "已完成" || s === "未完成");
}
/** 商品是否对家长可见可兑（库存 0 时派生为售罄，不改状态字段）。 */
export function isRedeemable(status, stock) {
    return status === "上架" && stock > 0;
}
//# sourceMappingURL=state-machines.js.map