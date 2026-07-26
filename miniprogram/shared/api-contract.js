/**
 * 接口契约。H5 和小程序照着这里的路径与出入参调用，服务端照着实现，
 * 改动这里会同时让三边编译报错 —— 这就是把契约放在 shared 里的目的。
 */
export const API_PREFIX = "/api";
/* --------------------------- 各接口的路径与方法 --------------------------- */
export const ENDPOINTS = {
    health: { method: "GET", path: "/health" },
    login: { method: "POST", path: "/auth/login" },
    staffLogin: { method: "POST", path: "/auth/staff-login" },
    logout: { method: "POST", path: "/auth/logout" },
    profile: { method: "GET", path: "/auth/profile" },
    bindByCode: { method: "POST", path: "/bindings/by-code" },
    previewBindingCode: { method: "GET", path: "/bindings/preview" },
    listBindings: { method: "GET", path: "/bindings" },
    reviewBinding: { method: "POST", path: "/bindings/:id/review" },
    releaseBinding: { method: "POST", path: "/bindings/:id/release" },
    listStudents: { method: "GET", path: "/students" },
    createStudent: { method: "POST", path: "/students" },
    getStudent: { method: "GET", path: "/students/:id" },
    updateStudent: { method: "PATCH", path: "/students/:id" },
    resetBindingCode: { method: "POST", path: "/students/:id/binding-code/reset" },
    toggleBindingCode: { method: "POST", path: "/students/:id/binding-code/toggle" },
    dashboard: { method: "GET", path: "/dashboard" },
    todayStudents: { method: "GET", path: "/sessions/today" },
    transitionSession: { method: "POST", path: "/sessions/transition" },
    listSheets: { method: "GET", path: "/homework/sheets" },
    createSheet: { method: "POST", path: "/homework/sheets" },
    getSheet: { method: "GET", path: "/homework/sheets/:id" },
    transitionSheet: { method: "POST", path: "/homework/sheets/:id/transition" },
    updateItemStatus: { method: "POST", path: "/homework/items/:id/status" },
    finishSheet: { method: "POST", path: "/homework/sheets/:id/finish" },
    sendPickupNotice: { method: "POST", path: "/reminders" },
    listReminders: { method: "GET", path: "/reminders" },
    listLedger: { method: "GET", path: "/points/ledger" },
    grantPoints: { method: "POST", path: "/points/grant" },
    reverseLedger: { method: "POST", path: "/points/reverse" },
    reconcile: { method: "GET", path: "/points/reconcile" },
    leaderboard: { method: "GET", path: "/leaderboard" },
    listProducts: { method: "GET", path: "/products" },
    createProduct: { method: "POST", path: "/products" },
    updateProduct: { method: "PATCH", path: "/products/:id" },
    redeem: { method: "POST", path: "/redemptions" },
    listRedemptions: { method: "GET", path: "/redemptions" },
    reverseRedemption: { method: "POST", path: "/redemptions/:id/reverse" },
    listWrongQuestions: { method: "GET", path: "/wrong-questions" },
    createWrongQuestion: { method: "POST", path: "/wrong-questions" },
    updateWrongQuestion: { method: "PATCH", path: "/wrong-questions/:id" },
    transitionWrongQuestion: { method: "POST", path: "/wrong-questions/:id/transition" },
    listStaff: { method: "GET", path: "/staff" },
    createStaff: { method: "POST", path: "/staff" },
    updateStaff: { method: "PATCH", path: "/staff/:id" },
    listAudit: { method: "GET", path: "/audit" },
    getSettings: { method: "GET", path: "/settings" },
    updateSettings: { method: "PATCH", path: "/settings" },
};
/** 前端调用时用它把 :id 填进路径。 */
export function buildPath(template, params = {}) {
    return template.replace(/:([A-Za-z0-9_]+)/g, (_match, key) => {
        const value = params[key];
        if (value === undefined)
            throw new Error(`路径参数缺失: ${key}`);
        return encodeURIComponent(String(value));
    });
}
/** 系统设置项的键名与默认值。 */
export const SETTING_KEYS = {
    /** 用绑定码绑定后是否还要负责人审核。默认 false —— 输码即绑定。 */
    BINDING_REQUIRES_REVIEW: "binding.requiresReview",
    /** 人工调整积分的大额阈值，超过要二次确认 */
    POINTS_ADJUST_THRESHOLD: "points.adjustThreshold",
    /** 作业完成默认奖励分 */
    HOMEWORK_DEFAULT_REWARD: "points.homeworkDefaultReward",
    /** 商品库存低于此值在看板告警 */
    LOW_STOCK_THRESHOLD: "store.lowStockThreshold",
    /** 家长端排行榜是否显示真实姓名（默认脱敏） */
    LEADERBOARD_SHOW_REAL_NAME: "leaderboard.showRealName",
};
export const DEFAULT_SETTINGS = {
    [SETTING_KEYS.BINDING_REQUIRES_REVIEW]: false,
    [SETTING_KEYS.POINTS_ADJUST_THRESHOLD]: 50,
    [SETTING_KEYS.HOMEWORK_DEFAULT_REWARD]: 10,
    [SETTING_KEYS.LOW_STOCK_THRESHOLD]: 3,
    [SETTING_KEYS.LEADERBOARD_SHOW_REAL_NAME]: false,
};
//# sourceMappingURL=api-contract.js.map