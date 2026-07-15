import "./styles.css";

type Role = "owner" | "staff" | "guardian";
type SessionStatus = "待到班" | "已到班" | "辅导中" | "待接" | "已接走";
type HomeworkStatus = "待确认" | "辅导中" | "已完成" | "需要补充" | "未完成";
type MistakeStatus = "待订正" | "已订正" | "已掌握";
type ProductStatus = "上架" | "下架";

interface Student {
  id: string;
  name: string;
  nickname: string;
  grade: string;
  points: number;
  sessionStatus: SessionStatus;
  publicRanking: boolean;
  guardianNames: string[];
}

interface Homework {
  id: string;
  studentId: string;
  subject: string;
  content: string;
  status: HomeworkStatus;
  feedback: string;
  createdAt: string;
  completedAt?: string;
  imageData?: string;
}

interface Ledger {
  id: string;
  studentId: string;
  delta: number;
  type: "作业奖励" | "表现奖励" | "错题订正" | "兑换扣除" | "人工调整" | "撤销冲正";
  reason: string;
  createdAt: string;
  reversed?: boolean;
  sourceRedemptionId?: string;
  reversalOfLedgerId?: string;
}

interface Product {
  id: string;
  name: string;
  pointsCost: number;
  stock: number;
  status: ProductStatus;
  limit: number;
  tone: "sun" | "leaf" | "clay";
}

interface Redemption {
  id: string;
  studentId: string;
  productId: string;
  productName: string;
  pointsCost: number;
  status: "已完成" | "已撤销";
  createdAt: string;
  reversedAt?: string;
  reversalLedgerId?: string;
}

interface WrongQuestion {
  id: string;
  studentId: string;
  subject: string;
  knowledge: string;
  note: string;
  status: MistakeStatus;
  createdAt: string;
  imageData?: string;
}

interface Binding {
  id: string;
  guardianName: string;
  studentName: string;
  relation: string;
  status: "待审核" | "已通过" | "已拒绝";
}

interface Notice {
  id: string;
  studentId: string;
  eta: string;
  status: "已发送" | "待授权";
  createdAt: string;
}

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
  createdAt: string;
}

interface AppState {
  activeRole: Role;
  page: string;
  guideSeen?: boolean;
  selectedStudentId: string;
  students: Student[];
  homework: Homework[];
  ledgers: Ledger[];
  products: Product[];
  redemptions: Redemption[];
  mistakes: WrongQuestion[];
  bindings: Binding[];
  notices: Notice[];
  audit: AuditEntry[];
  dashboardFilter?: SessionStatus;
  homeworkFilter?: HomeworkStatus;
}

const STORE_KEY = "warm-study-h5-v1";
const today = "2026年7月15日";
const roleLabel: Record<Role, string> = { owner: "妈妈·负责人", staff: "老师·日常管理", guardian: "家长·林妈妈" };

const seedState: AppState = {
  activeRole: "owner",
  page: "dashboard",
  selectedStudentId: "s1",
  students: [
    { id: "s1", name: "林小满", nickname: "小满", grade: "三年级", points: 86, sessionStatus: "辅导中", publicRanking: true, guardianNames: ["林妈妈", "林爸爸"] },
    { id: "s2", name: "陈一诺", nickname: "一诺", grade: "四年级", points: 72, sessionStatus: "待接", publicRanking: true, guardianNames: ["陈妈妈"] },
    { id: "s3", name: "周子安", nickname: "子安", grade: "二年级", points: 61, sessionStatus: "已到班", publicRanking: true, guardianNames: ["周妈妈"] },
    { id: "s4", name: "沈嘉禾", nickname: "嘉禾", grade: "五年级", points: 48, sessionStatus: "待到班", publicRanking: false, guardianNames: ["沈妈妈"] }
  ],
  homework: [
    { id: "h1", studentId: "s1", subject: "数学", content: "练习册第32页第1—6题", status: "辅导中", feedback: "正在订正应用题。", createdAt: "16:05" },
    { id: "h2", studentId: "s1", subject: "语文", content: "完成《荷花》生字词与阅读题", status: "待确认", feedback: "", createdAt: "16:05" },
    { id: "h3", studentId: "s2", subject: "英语", content: "Unit 4 单词抄写与听力", status: "已完成", feedback: "书写认真，听力全对。", createdAt: "15:40", completedAt: "17:00" },
    { id: "h4", studentId: "s3", subject: "数学", content: "口算卡第18页", status: "待确认", feedback: "", createdAt: "16:12" }
  ],
  ledgers: [
    { id: "l1", studentId: "s1", delta: 10, type: "作业奖励", reason: "昨日全部作业完成", createdAt: "07-14 18:08" },
    { id: "l2", studentId: "s1", delta: 6, type: "错题订正", reason: "分数应用题订正完成", createdAt: "07-13 17:40" },
    { id: "l3", studentId: "s2", delta: 8, type: "表现奖励", reason: "主动完成复习", createdAt: "07-14 17:30" },
    { id: "l4", studentId: "s3", delta: 5, type: "作业奖励", reason: "按时完成作业", createdAt: "07-12 18:20" },
    { id: "l5", studentId: "s1", delta: -20, type: "兑换扣除", reason: "兑换绘画本", createdAt: "07-11 16:50" }
  ],
  products: [
    { id: "p1", name: "植萃绘画本", pointsCost: 20, stock: 8, status: "上架", limit: 1, tone: "sun" },
    { id: "p2", name: "小鹿书签", pointsCost: 35, stock: 3, status: "上架", limit: 1, tone: "leaf" },
    { id: "p3", name: "周末电影券", pointsCost: 60, stock: 2, status: "上架", limit: 1, tone: "clay" },
    { id: "p4", name: "彩色便签套装", pointsCost: 15, stock: 0, status: "下架", limit: 1, tone: "sun" }
  ],
  redemptions: [
    { id: "r1", studentId: "s1", productId: "p1", productName: "植萃绘画本", pointsCost: 20, status: "已完成", createdAt: "07-11 16:50" }
  ],
  mistakes: [
    { id: "m1", studentId: "s1", subject: "数学", knowledge: "分数应用题", note: "单位“1”找错，已经订正一次。", status: "已订正", createdAt: "07-14" },
    { id: "m2", studentId: "s1", subject: "语文", knowledge: "比喻句辨析", note: "需要复习本体、喻体和比喻词。", status: "待订正", createdAt: "07-13" },
    { id: "m3", studentId: "s2", subject: "英语", knowledge: "一般过去时", note: "不规则动词变化需要再记一遍。", status: "已掌握", createdAt: "07-12" }
  ],
  bindings: [
    { id: "b1", guardianName: "李妈妈", studentName: "李昀泽", relation: "母亲", status: "待审核" },
    { id: "b2", guardianName: "周爸爸", studentName: "周子安", relation: "父亲", status: "待审核" }
  ],
  notices: [
    { id: "n1", studentId: "s2", eta: "17:30", status: "已发送", createdAt: "17:00" }
  ],
  audit: [
    { id: "a1", actor: "妈妈", action: "发放积分", target: "林小满", detail: "+10，昨日全部作业完成", createdAt: "07-14 18:08" },
    { id: "a2", actor: "王老师", action: "发送接娃提醒", target: "陈一诺", detail: "预计 17:30 可接", createdAt: "07-15 17:00" }
  ]
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isState(value: unknown): value is AppState {
  return isRecord(value)
    && (value.activeRole === "owner" || value.activeRole === "staff" || value.activeRole === "guardian")
    && typeof value.page === "string"
    && typeof value.selectedStudentId === "string"
    && Array.isArray(value.students)
    && Array.isArray(value.homework)
    && Array.isArray(value.ledgers)
    && Array.isArray(value.products)
    && Array.isArray(value.redemptions)
    && Array.isArray(value.mistakes)
    && Array.isArray(value.bindings)
    && Array.isArray(value.notices)
    && Array.isArray(value.audit);
}

function readState(): AppState {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return structuredClone(seedState);
    const parsed: unknown = JSON.parse(raw);
    return isState(parsed) ? parsed : structuredClone(seedState);
  } catch {
    return structuredClone(seedState);
  }
}

let state = readState();
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("应用容器不存在");
const appRoot = app;

function persist(): void {
  window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function commit(mutator: () => void): void {
  mutator();
  persist();
  render();
}

function stamp(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function studentById(id: string): Student {
  const student = state.students.find((item) => item.id === id);
  if (!student) throw new Error("未找到学生");
  return student;
}

function selectedStudent(): Student {
  return studentById(state.selectedStudentId);
}

function visibleStudents(): Student[] {
  return state.activeRole === "guardian" ? state.students.filter((student) => student.id === "s1" || student.id === "s2") : state.students;
}

function addAudit(action: string, target: string, detail: string): void {
  state.audit.unshift({ id: uid("a"), actor: state.activeRole === "guardian" ? "林妈妈" : state.activeRole === "owner" ? "妈妈" : "王老师", action, target, detail, createdAt: `07-15 ${stamp()}` });
}

function addPoints(studentId: string, delta: number, type: Ledger["type"], reason: string, sourceRedemptionId?: string, reversalOfLedgerId?: string): Ledger | undefined {
  const student = studentById(studentId);
  if (student.points + delta < 0) return undefined;
  student.points += delta;
  const ledger: Ledger = { id: uid("l"), studentId, delta, type, reason, createdAt: `07-15 ${stamp()}`, sourceRedemptionId, reversalOfLedgerId };
  state.ledgers.unshift(ledger);
  return ledger;
}

function weeklyGrowth(studentId: string): number {
  return state.ledgers
    .filter((item) => item.studentId === studentId && item.delta > 0 && !item.reversed && item.type !== "撤销冲正")
    .reduce((sum, item) => sum + item.delta, 0);
}

function isManager(): boolean {
  return state.activeRole === "owner" || state.activeRole === "staff";
}

function isOwner(): boolean {
  return state.activeRole === "owner";
}

function etaFromMinutes(minutes: number): string {
  const baselineMinutes = 17 * 60;
  const total = baselineMinutes + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function redeemProduct(studentId: string, productId: string): string | undefined {
  const student = studentById(studentId);
  const product = state.products.find((item) => item.id === productId);
  if (!product || product.status !== "上架") return "商品当前不可兑换";
  if (product.stock < 1) return "商品库存不足";
  if (student.points < product.pointsCost) return "学生积分不足";
  const completedCount = state.redemptions.filter((item) => item.studentId === studentId && item.productId === productId && item.status === "已完成").length;
  if (completedCount >= product.limit) return "该商品已达到每人兑换上限";
  const redemption: Redemption = { id: uid("r"), studentId, productId, productName: product.name, pointsCost: product.pointsCost, status: "已完成", createdAt: `07-15 ${stamp()}` };
  const ledger = addPoints(studentId, -product.pointsCost, "兑换扣除", `兑换${product.name}`, redemption.id);
  if (!ledger) return "积分扣除失败";
  product.stock -= 1;
  state.redemptions.unshift(redemption);
  addAudit("办理积分兑换", student.name, `${product.name}，扣除 ${product.pointsCost} 分`);
  return undefined;
}

function reverseRedemption(redemptionId: string): string | undefined {
  const redemption = state.redemptions.find((item) => item.id === redemptionId);
  if (!redemption || redemption.status !== "已完成") return "该兑换记录不能重复撤销";
  const product = state.products.find((item) => item.id === redemption.productId);
  if (!product) return "找不到原商品，无法撤销";
  const originalLedger = state.ledgers.find((item) => item.sourceRedemptionId === redemption.id && item.type === "兑换扣除");
  if (!originalLedger || originalLedger.reversed) return "原积分流水已经被撤销";
  const reversal = addPoints(redemption.studentId, redemption.pointsCost, "撤销冲正", `撤销兑换：${redemption.productName}`, undefined, originalLedger.id);
  if (!reversal) return "积分冲正失败";
  originalLedger.reversed = true;
  product.stock += 1;
  redemption.status = "已撤销";
  redemption.reversedAt = `07-15 ${stamp()}`;
  redemption.reversalLedgerId = reversal.id;
  addAudit("撤销积分兑换", studentById(redemption.studentId).name, `${redemption.productName}，恢复 ${redemption.pointsCost} 分和 1 件库存`);
  return undefined;
}

function statusClass(status: string): string {
  return `status status-${status.replace(/待/g, "wait").replace(/已/g, "done").replace(/辅导中/g, "active").replace(/未完成/g, "late").replace(/需要补充/g, "late").replace(/上架/g, "active").replace(/下架/g, "late")}`;
}

function esc(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character);
}

function navItems(): Array<{ id: string; label: string }> {
  if (state.activeRole === "guardian") {
    return [{ id: "today", label: "今日" }, { id: "homework", label: "作业" }, { id: "growth", label: "成长" }, { id: "mistakes", label: "错题" }, { id: "profile", label: "我的" }];
  }
  const base = [{ id: "dashboard", label: "看板" }, { id: "homework", label: "作业" }, { id: "students", label: "学员" }, { id: "points", label: "积分" }, { id: "shop", label: "商店" }, { id: "mistakes", label: "错题" }];
  return state.activeRole === "owner" ? [...base, { id: "team", label: "权限" }, { id: "audit", label: "审计" }] : base;
}

function renderHeader(): string {
  return `<header class="topbar">
    <div class="brand"><span class="brand-mark">暖</span><div><strong>暖芽辅导班</strong><small>${today}</small></div></div>
    <div class="header-actions">
      <button class="guide-entry" data-action="open-guide">功能导览</button>
      <div class="role-switch" aria-label="体验角色切换">
        ${(["guardian", "staff", "owner"] as Role[]).map((role) => `<button class="role-button ${state.activeRole === role ? "is-active" : ""}" data-action="role" data-role="${role}">${roleLabel[role]}</button>`).join("")}
      </div>
    </div>
  </header>`;
}

function renderNavigation(): string {
  return `<nav class="nav-strip">${navItems().map((item) => `<button class="nav-item ${state.page === item.id ? "is-active" : ""}" data-action="page" data-page="${item.id}">${item.label}</button>`).join("")}</nav>`;
}

function renderStudentPicker(): string {
  return `<div class="student-picker">${visibleStudents().map((student) => `<button type="button" class="student-chip ${state.selectedStudentId === student.id ? "is-active" : ""}" data-action="select-student" data-student="${student.id}"><span>${esc(student.nickname.slice(0, 1))}</span>${esc(student.nickname)}</button>`).join("")}</div>`;
}

function pageTitle(eyebrow: string, title: string, subtitle: string): string {
  return `<section class="page-title"><p>${eyebrow}</p><h1>${title}</h1><span>${subtitle}</span></section>`;
}

function renderDashboard(): string {
  const statuses: SessionStatus[] = ["待到班", "已到班", "辅导中", "待接", "已接走"];
  const completedButUnrewarded = state.homework.filter((homework) => homework.status === "已完成" && !state.ledgers.some((ledger) => ledger.studentId === homework.studentId && ledger.reason.includes("今日作业"))).length;
  const workspaceLabel = isOwner() ? "妈妈工作台" : "老师工作台";
  return `${pageTitle(workspaceLabel, "今天要把每个孩子都安稳送回家", "先看异常，再处理日常。")}
    <section class="stat-ribbon">
      ${statuses.map((status) => `<button class="metric" data-action="filter-status" data-status="${status}"><strong>${state.students.filter((student) => student.sessionStatus === status).length}</strong><span>${status}</span></button>`).join("")}
    </section>
    <section class="alert-band"><div><p>需要你处理</p><strong>${state.bindings.filter((binding) => binding.status === "待审核").length} 个绑定申请 · ${completedButUnrewarded} 份已完成作业待奖励</strong></div><button class="text-button" data-action="page" data-page="students">去处理</button></section>
    <section class="section-heading"><div><p>今日状态轨道</p><h2>孩子们现在在哪里</h2></div><button class="soft-button" data-action="page" data-page="homework">作业工作台</button></section>
    ${state.dashboardFilter ? `<div class="active-filter">正在查看：${state.dashboardFilter}<button data-action="clear-dashboard-filter">清除</button></div>` : ""}
    <section class="student-rail">${state.students.filter((student) => !state.dashboardFilter || student.sessionStatus === state.dashboardFilter).map((student) => {
      const work = state.homework.filter((homework) => homework.studentId === student.id);
      const done = work.filter((homework) => homework.status === "已完成").length;
      const latestNotice = state.notices.find((notice) => notice.studentId === student.id);
      return `<article class="student-row">
        <div class="student-avatar">${esc(student.nickname.slice(0, 1))}</div>
        <div class="student-copy"><strong>${esc(student.name)}</strong><span>${esc(student.grade)} · ${done}/${work.length || 0} 项作业完成${latestNotice ? ` · ${latestNotice.eta} 可接` : ""}</span></div>
        <span class="${statusClass(student.sessionStatus)}">${student.sessionStatus}</span>
        <div class="row-actions">
          ${student.sessionStatus === "待到班" ? `<button data-action="session" data-id="${student.id}" data-status="已到班">到班</button>` : ""}
          ${student.sessionStatus === "已到班" ? `<button data-action="session" data-id="${student.id}" data-status="辅导中">开始</button>` : ""}
          ${student.sessionStatus === "辅导中" ? `<button data-action="remind" data-id="${student.id}" data-minutes="15">15分钟</button><button data-action="remind" data-id="${student.id}" data-minutes="30">30分钟</button><button data-action="remind" data-id="${student.id}" data-minutes="60">60分钟</button><button data-action="remind" data-id="${student.id}" data-minutes="custom">自定义</button>` : ""}
          ${student.sessionStatus === "待接" ? `<button data-action="session" data-id="${student.id}" data-status="已接走">已接走</button>` : ""}
          ${student.sessionStatus === "已接走" ? `<button disabled>今日完成</button>` : ""}
        </div>
      </article>`;
    }).join("")}</section>`;
}

function renderToday(): string {
  const student = selectedStudent();
  const items = state.homework.filter((item) => item.studentId === student.id);
  const notice = state.notices.find((item) => item.studentId === student.id);
  return `${pageTitle(`${esc(student.nickname)}的今日`, `${student.sessionStatus === "待接" ? "可以准备来接啦" : "作业正在稳稳推进"}`, notice ? `老师已通知：预计 ${notice.eta} 可以来接。` : "老师会在预计完成前主动通知你。")}
    ${renderStudentPicker()}
    <section class="hero-note"><div class="scribble">${student.sessionStatus}</div><div><p>今天的学习进度</p><strong>${items.filter((item) => item.status === "已完成").length} / ${items.length || 0} 项已经完成</strong><span>${items.find((item) => item.feedback)?.feedback || "老师正在整理今天的反馈。"}</span></div></section>
    <section class="section-heading"><div><p>今日作业</p><h2>每一项都清清楚楚</h2></div><button class="soft-button" data-action="page" data-page="homework">补充作业</button></section>
    <section class="homework-list">${items.length ? items.map(renderHomeworkCard).join("") : `<div class="empty-state">今天还没有提交作业，先把老师需要辅导的内容发过来吧。</div>`}</section>
    <section class="growth-strip"><div><p>可用积分</p><strong>${student.points}</strong><span>本周认真学习的每一步都会被记住。</span></div><button data-action="page" data-page="growth">去看成长记录</button></section>`;
}

function renderHomeworkCard(item: Homework): string {
  return `<article class="homework-card">${item.imageData ? `<img class="record-image" src="${item.imageData}" alt="${esc(item.subject)}作业图片" />` : ""}<div><p>${esc(item.subject)} · ${item.createdAt}</p><strong>${esc(item.content || "已上传作业图片")}</strong><span>${item.feedback ? esc(item.feedback) : "老师还没有填写反馈"}</span></div><span class="${statusClass(item.status)}">${item.status}</span></article>`;
}

function renderHomework(): string {
  if (state.activeRole === "guardian") {
    const student = selectedStudent();
    const history = state.homework.filter((item) => item.studentId === student.id);
    return `${pageTitle("提交作业", "把今天需要辅导的内容交给老师", "文字作业、科目与说明会马上进入老师的工作台。")}
      ${renderStudentPicker()}
      <form class="paper-form" id="homework-form">
        <input type="hidden" name="studentId" value="${student.id}" />
        <label>科目<select name="subject"><option>数学</option><option>语文</option><option>英语</option><option>其他</option></select></label>
        <label>作业内容<textarea name="content" placeholder="例如：练习册第32页第1—6题；读课文两遍"></textarea></label>
        <label>补充说明<input name="note" placeholder="例如：这题昨天没听懂，请老师多讲一遍" /></label>
        <label>作业图片（可选）<input name="image" type="file" accept="image/*" /></label>
        <div class="upload-placeholder"><strong>图片会保存在当前浏览器，用于H5体验验证</strong><span>单张图片请控制在 800KB 内；正式版会迁移到云存储。</span></div>
        <button class="primary-button" type="submit">提交给老师</button>
      </form>
      <section class="section-heading"><div><p>提交记录</p><h2>今天与历史作业</h2></div></section>
      <section class="homework-list">${history.map(renderHomeworkCard).join("")}</section>`;
  }
  const filters: HomeworkStatus[] = ["待确认", "辅导中", "已完成", "需要补充", "未完成"];
  return `${pageTitle("作业工作台", "今天的作业，今天闭环", "确认、辅导、反馈和奖励在同一条线上完成。")}
    <div class="filter-line">${filters.map((filter) => `<button class="filter-button" data-action="homework-filter" data-status="${filter}">${filter} ${state.homework.filter((item) => item.status === filter).length}</button>`).join("")}</div>
    ${state.homeworkFilter ? `<div class="active-filter">正在查看：${state.homeworkFilter}<button data-action="clear-homework-filter">清除</button></div>` : ""}
    <section class="work-grid">${state.homework.filter((item) => !state.homeworkFilter || item.status === state.homeworkFilter).map((item) => {
      const student = studentById(item.studentId);
      const nextAction = item.status === "待确认" ? "开始辅导" : item.status === "辅导中" ? "完成此项" : "查看记录";
      const nextStatus = item.status === "待确认" ? "辅导中" : item.status === "辅导中" ? "已完成" : item.status;
      return `<article class="work-card"><div class="work-card-top"><span>${esc(student.nickname)} · ${esc(student.grade)}</span><span class="${statusClass(item.status)}">${item.status}</span></div><h3>${esc(item.subject)}</h3><p>${esc(item.content)}</p><small>${item.feedback || "暂未填写辅导反馈"}</small>${isManager() ? `<form class="feedback-form"><input type="hidden" name="homeworkId" value="${item.id}" /><input name="feedback" value="${esc(item.feedback)}" placeholder="填写给家长的辅导反馈" /><button type="submit">保存反馈</button></form>` : ""}<div class="card-actions">${item.status === "已完成" ? `<button data-action="reward" data-id="${item.studentId}">奖励 +5</button>` : `<button data-action="homework-status" data-id="${item.id}" data-status="${nextStatus}">${nextAction}</button>`}<button class="text-button" data-action="select-student" data-student="${item.studentId}">学生详情</button></div></article>`;
    }).join("")}</section>`;
}

function leaderboard(): Student[] {
  return [...state.students].filter((student) => student.publicRanking).sort((left, right) => weeklyGrowth(right.id) - weeklyGrowth(left.id) || right.points - left.points);
}

function renderLeaderboard(): string {
  return `<ol class="leaderboard">${leaderboard().map((student, index) => `<li><span class="rank">${index + 1}</span><div class="leader-name"><strong>${esc(student.nickname)}</strong><small>${esc(student.grade)}</small></div><strong>${weeklyGrowth(student.id)}<small>本周成长</small></strong></li>`).join("")}</ol>`;
}

function renderGrowth(): string {
  const student = selectedStudent();
  const ledger = state.ledgers.filter((item) => item.studentId === student.id).slice(0, 6);
  return `${pageTitle("成长花园", `${student.nickname} 已经积累 ${student.points} 分`, "兑换不会影响本周榜单，努力一直会被看见。")}
    ${renderStudentPicker()}
    <section class="growth-layout"><article class="score-poster"><p>本周成长积分</p><strong>${weeklyGrowth(student.id)}</strong><span>可用积分 ${student.points}</span></article><article class="rank-panel"><p>本周排行榜</p>${renderLeaderboard()}</article></section>
    <section class="section-heading"><div><p>成长明细</p><h2>每一笔都有原因</h2></div><button class="soft-button" data-action="page" data-page="shop">看看积分商店</button></section>
    <section class="ledger-list">${ledger.map((item) => `<article><div><strong>${esc(item.type)}</strong><span>${esc(item.reason)} · ${item.createdAt}</span></div><b class="${item.delta > 0 ? "plus" : "minus"}">${item.delta > 0 ? "+" : ""}${item.delta}</b></article>`).join("")}</section>`;
}

function renderPoints(): string {
  const student = selectedStudent();
  const ledger = state.ledgers.slice(0, 12);
  const adjustmentForm = state.activeRole === "owner" ? `<form class="paper-form compact-form" id="points-form"><h3>为 ${esc(student.nickname)} 调整积分</h3>${renderStudentPicker()}<label>积分变化<input type="number" name="delta" required min="-100" max="100" value="5" /></label><label>调整原因<input name="reason" required placeholder="例如：今天认真完成复习" /></label><button class="primary-button" type="submit">确认写入流水</button></form>` : `<article class="security-note"><strong>老师可发放作业奖励</strong><span>人工加减分、冲正和规则设置由妈妈统一处理，日常奖励请从作业工作台操作。</span></article>`;
  return `${pageTitle("积分与排行榜", "让鼓励有据可查", "所有增减分都保留流水；需要撤回时用冲正，不直接删除。")}
    <section class="points-admin-grid"><article class="rank-panel"><p>本周成长榜</p>${renderLeaderboard()}</article>${adjustmentForm}</section>
    <section class="section-heading"><div><p>最新流水</p><h2>所有积分都能核对</h2></div></section><section class="ledger-list">${ledger.map((item) => `<article><div><strong>${esc(studentById(item.studentId).nickname)} · ${esc(item.type)}${item.reversed ? " · 已冲正" : ""}</strong><span>${esc(item.reason)} · ${item.createdAt}</span></div><div class="ledger-actions"><b class="${item.delta > 0 ? "plus" : "minus"}">${item.delta > 0 ? "+" : ""}${item.delta}</b>${isOwner() && !item.reversed && item.type !== "兑换扣除" && item.type !== "撤销冲正" ? `<button class="text-button" data-action="reverse-ledger" data-id="${item.id}">冲正</button>` : ""}</div></article>`).join("")}</section>`;
}

function productCard(product: Product, admin: boolean): string {
  const guardianView = state.activeRole === "guardian";
  return `<article class="product-card ${product.tone}"><div class="product-art"><span>${product.name.slice(0, 1)}</span></div><div class="product-copy"><p>${product.stock > 0 ? `剩余 ${product.stock} 件` : "暂时售罄"}</p><h3>${esc(product.name)}</h3><strong>${product.pointsCost} <small>积分</small></strong><span>${product.status} · 每人限 ${product.limit} 件</span></div><div class="product-action">${admin ? `<form class="inventory-form"><input type="hidden" name="productId" value="${product.id}" /><input name="stock" type="number" min="0" value="${product.stock}" aria-label="${esc(product.name)}库存" /><button type="submit">更新库存</button></form><button class="soft-button" data-action="toggle-product" data-id="${product.id}">${product.status === "上架" ? "下架" : "上架"}</button>` : guardianView ? `<button disabled>${product.status === "上架" && product.stock > 0 ? "到辅导班兑换" : "暂不可兑"}</button>` : `<span class="staff-exchange-hint">在下方办理兑换</span>`}</div></article>`;
}

function renderShop(): string {
  const admin = state.activeRole === "owner";
  const staffMode = state.activeRole === "staff";
  const activeProducts = state.products.filter((product) => product.status === "上架" && product.stock > 0);
  const redemptionForm = isManager() ? `<form class="redeem-form" id="redemption-form"><div><p>现场兑换</p><strong>一次完成扣积分、减库存与记录</strong></div><label>学生<select name="studentId">${state.students.map((student) => `<option value="${student.id}" ${student.id === state.selectedStudentId ? "selected" : ""}>${esc(student.name)} · 当前 ${student.points} 分</option>`).join("")}</select></label><label>商品<select name="productId">${activeProducts.map((product) => `<option value="${product.id}">${esc(product.name)} · ${product.pointsCost} 分 · 库存 ${product.stock}</option>`).join("")}</select></label><button class="primary-button" type="submit" ${activeProducts.length ? "" : "disabled"}>确认现场兑换</button></form>` : "";
  return `${pageTitle("积分商店", admin ? "用小小的奖励，守住大大的动力" : staffMode ? "把孩子的努力兑换成一份实在的鼓励" : "喜欢的奖励，靠努力慢慢兑换", admin ? "商品、库存和兑换记录都在这里管理。" : staffMode ? "老师可以在现场为孩子办理兑换，商品配置由妈妈管理。" : "到辅导班后请老师帮忙办理兑换。")}
    ${admin ? `<form class="inline-form" id="product-form"><input name="name" required placeholder="新商品名称" /><input name="points" required type="number" min="1" placeholder="所需积分" /><input name="stock" required type="number" min="0" placeholder="库存" /><button type="submit">上架商品</button></form>` : state.activeRole === "guardian" ? renderStudentPicker() : ""}
    ${redemptionForm}
    <section class="product-grid">${state.products.map((product) => productCard(product, admin)).join("")}</section>
    <section class="section-heading"><div><p>${admin ? "兑换记录" : "我的兑换"}</p><h2>${admin ? "每一件礼物都有清楚记录" : "已经带回家的小奖励"}</h2></div></section>
    <section class="ledger-list">${state.redemptions.filter((redemption) => isManager() || redemption.studentId === selectedStudent().id).map((redemption) => `<article><div><strong>${esc(studentById(redemption.studentId).nickname)} · ${esc(redemption.productName)}</strong><span>${redemption.createdAt} · ${redemption.status}${redemption.reversedAt ? ` · ${redemption.reversedAt} 已撤销` : ""}</span></div><div class="ledger-actions"><b class="minus">-${redemption.pointsCost}</b>${isOwner() && redemption.status === "已完成" ? `<button class="text-button" data-action="reverse-redemption" data-id="${redemption.id}">撤销兑换</button>` : ""}</div></article>`).join("") || `<div class="empty-state">还没有兑换记录。</div>`}</section>`;
}

function renderMistakes(): string {
  const student = selectedStudent();
  const admin = state.activeRole !== "guardian";
  const list = state.mistakes.filter((item) => admin || item.studentId === student.id);
  return `${pageTitle("错题集", "错过一次，也可以学会一次", "把错因记下来，下一次就有更清晰的方向。")}
    ${state.activeRole === "guardian" ? renderStudentPicker() : `<div class="student-picker">${state.students.map((item) => `<button class="student-chip ${state.selectedStudentId === item.id ? "is-active" : ""}" data-action="select-student" data-student="${item.id}">${esc(item.nickname)}</button>`).join("")}</div>`}
    <form class="paper-form compact-form" id="mistake-form"><h3>上传一条错题</h3><input type="hidden" name="studentId" value="${student.id}" /><label>科目<select name="subject"><option>数学</option><option>语文</option><option>英语</option></select></label><label>知识点<input name="knowledge" required placeholder="例如：分数应用题" /></label><label>错因与订正提示<textarea name="note" required placeholder="写下为什么会错，以及下次如何避免"></textarea></label><label>错题图片（可选）<input name="image" type="file" accept="image/*" /></label><button class="primary-button" type="submit">保存到错题集</button></form>
    <section class="mistake-grid">${list.map((item) => `<article class="mistake-card">${item.imageData ? `<img class="mistake-image" src="${item.imageData}" alt="${esc(item.knowledge)}错题图片" />` : `<div class="mistake-symbol">错</div>`}<div><p>${esc(studentById(item.studentId).nickname)} · ${esc(item.subject)} · ${item.createdAt}</p><h3>${esc(item.knowledge)}</h3><span>${esc(item.note)}</span></div><div class="mistake-actions"><span class="${statusClass(item.status)}">${item.status}</span>${admin ? `<button data-action="next-mistake" data-id="${item.id}">推进状态</button>` : ""}</div></article>`).join("")}</section>`;
}

function renderStudents(): string {
  const bindingBoard = state.activeRole === "owner" ? `<section class="binding-board"><div><p>待审核绑定</p><h2>${state.bindings.filter((binding) => binding.status === "待审核").length} 条申请</h2></div>${state.bindings.filter((binding) => binding.status === "待审核").map((binding) => `<article><strong>${esc(binding.guardianName)}</strong><span>申请绑定 ${esc(binding.studentName)} · ${esc(binding.relation)}</span><button data-action="approve-binding" data-id="${binding.id}">通过</button><button class="text-button" data-action="reject-binding" data-id="${binding.id}">拒绝</button></article>`).join("")}</section>` : `<section class="security-note"><strong>家长绑定由负责人审核</strong><span>老师可查看已绑定家长信息，不能新增、解除或审核绑定关系。</span></section>`;
  return `${pageTitle("学员与家长", "每个孩子都有自己的学习轨迹", "先完成家长绑定审核，再维护学生档案。")}
    ${bindingBoard}
    <section class="student-directory">${state.students.map((student) => `<article><div class="student-avatar">${esc(student.nickname.slice(0, 1))}</div><div><strong>${esc(student.name)} · ${esc(student.grade)}</strong><span>家长：${esc(student.guardianNames.join("、"))}</span><small>积分 ${student.points} · ${student.sessionStatus}</small></div><button class="soft-button" data-action="select-student" data-student="${student.id}">查看</button></article>`).join("")}</section>`;
}

function renderTeam(): string {
  return `${pageTitle("老师与权限", "把能做什么说清楚", "V1 中，所有后台动作都会在浏览器体验版留下审计记录。")}
    <section class="permission-table"><article><div><strong>妈妈 · 超级管理员</strong><span>学生、积分、商品、兑换撤销、权限、审计</span></div><b>全部权限</b></article><article><div><strong>王老师 · 日常管理</strong><span>作业、到班、接娃提醒、积分奖励、错题、现场兑换</span></div><b>8 项权限</b></article><article><div><strong>林妈妈 · 家长</strong><span>提交作业、查看孩子、错题上传、积分与商店浏览</span></div><b>仅本人孩子</b></article></section>
    <section class="security-note"><strong>安全规则提示</strong><span>当前 H5 用角色切换模拟权限，正式接入云端后还需要在服务端再次校验，不能只靠隐藏按钮。</span></section>`;
}

function renderAudit(): string {
  return `${pageTitle("操作审计", "每次关键变动都留痕", "用于核对积分、兑换、提醒、绑定和状态修正。")}
    <section class="audit-list">${state.audit.map((entry) => `<article><time>${entry.createdAt}</time><div><strong>${esc(entry.actor)} · ${esc(entry.action)}</strong><span>${esc(entry.target)}：${esc(entry.detail)}</span></div></article>`).join("")}</section>`;
}

function renderProfile(): string {
  const notices = state.notices.filter((item) => item.studentId === selectedStudent().id);
  return `${pageTitle("我的家庭", "让老师更了解每个孩子", "当前为 H5 体验账号，绑定、提醒和隐私设置均可在此查看。")}
    ${renderStudentPicker()}
    <section class="profile-paper"><div><p>已绑定孩子</p><h2>${selectedStudent().name}</h2><span>${selectedStudent().grade} · ${selectedStudent().guardianNames.join("、")}</span></div><div><p>排行榜公开</p><h2>${selectedStudent().publicRanking ? "已开启" : "未开启"}</h2><button data-action="toggle-ranking" data-id="${selectedStudent().id}">切换设置</button></div></section>
    <section class="section-heading"><div><p>接娃提醒</p><h2>最近通知</h2></div><button class="soft-button" data-action="browser-notify">开启网页通知</button></section>
    <section class="ledger-list">${notices.map((notice) => `<article><div><strong>预计 ${notice.eta} 可以来接</strong><span>${notice.createdAt} · ${notice.status}</span></div><b class="plus">已通知</b></article>`).join("") || `<div class="empty-state">最近还没有接娃提醒。</div>`}</section>`;
}

function guideCard(title: string, description: string, role: Role, page: string, roleName: string, actionLabel: string): string {
  return `<article class="guide-card">
    <div class="guide-card-copy"><p>${roleName}</p><h2>${title}</h2><span>${description}</span></div>
    <button class="soft-button" data-action="guide-jump" data-role="${role}" data-page="${page}">${actionLabel}</button>
  </article>`;
}

function renderGuide(): string {
  return `${pageTitle("功能导览", "三分钟看懂暖芽怎么用", "这是一套围绕孩子到班、作业、接娃与成长奖励展开的日常协作工具。")}
    <section class="guide-route" aria-label="日常使用主线">
      <article><b>01</b><div><strong>家长先提交</strong><span>把当天作业和补充说明交给老师。</span></div></article>
      <article><b>02</b><div><strong>老师辅导并提醒</strong><span>跟进作业、填写反馈，预计完成时通知接娃。</span></div></article>
      <article><b>03</b><div><strong>负责人统一管理</strong><span>维护学员、积分、商品、权限与关键记录。</span></div></article>
    </section>
    <section class="section-heading"><div><p>全部功能</p><h2>每一项都有清晰的负责人</h2></div></section>
    <section class="guide-grid">
      ${guideCard("每日状态与作业", "家长提交文字或图片作业；老师确认、辅导、填写反馈并发放作业奖励。", "guardian", "homework", "家长 / 老师", "去提交作业")}
      ${guideCard("接娃提醒", "老师可设置 15、30、60 分钟或自定义时间；家长在“今日”和“我的家庭”查看提醒。", "staff", "dashboard", "老师", "去发接娃提醒")}
      ${guideCard("积分与排行榜", "完成作业、表现进步和错题订正均可积累积分；家长可查看成长流水和本周排行。", "guardian", "growth", "家长", "去看成长")}
      ${guideCard("积分商店与兑换", "负责人可上架、下架与调整库存；老师和负责人可现场兑换，负责人可撤销并自动恢复积分和库存。", "owner", "shop", "负责人 / 老师", "去管理商店")}
      ${guideCard("错题集", "家长或老师上传错题与图片；老师持续推进待订正、已订正和已掌握三个阶段。", "guardian", "mistakes", "家长 / 老师", "去记录错题")}
      ${guideCard("学员与家长绑定", "负责人审核家长绑定申请并维护学员档案；老师只能查看绑定信息。", "owner", "students", "负责人", "去管理学员")}
      ${guideCard("角色权限", "家长只看自己的孩子；老师处理日常；负责人拥有积分、商品、绑定、权限与撤销权限。", "owner", "team", "负责人", "去看权限")}
      ${guideCard("操作审计与隐私", "关键的积分、兑换、提醒、绑定和状态变动会留痕；家长还能控制孩子是否参与排行榜。", "owner", "audit", "负责人 / 家长", "去看审计")}
    </section>
    <section class="security-note guide-note"><strong>体验版说明</strong><span>当前是浏览器本地数据演示。正式上线到小程序后，登录、角色权限、图片和提醒都需要由服务端与微信能力共同校验。</span></section>`;
}

function renderGuideOverlay(): string {
  return `<div class="guide-overlay" role="dialog" aria-modal="true" aria-labelledby="guide-overlay-title">
    <section class="guide-dialog">
      <p>欢迎体验暖芽</p><h2 id="guide-overlay-title">先用三步，照看好每一天</h2>
      <span>提交作业、老师辅导、接娃提醒、积分成长和后台管理，都已经放进这版 H5 体验中。</span>
      <div class="guide-preview"><strong>家长提交</strong><strong>老师跟进</strong><strong>负责人管理</strong></div>
      <button class="primary-button" data-action="start-guide">查看全部功能</button>
      <button class="text-button guide-skip" data-action="dismiss-guide">直接进入体验</button>
    </section>
  </div>`;
}

function renderPage(): string {
  const normalizedPage = state.activeRole === "guardian" && state.page === "dashboard" ? "today" : state.page;
  if (normalizedPage === "guide") return renderGuide();
  if (normalizedPage === "dashboard") return renderDashboard();
  if (normalizedPage === "today") return renderToday();
  if (normalizedPage === "homework") return renderHomework();
  if (normalizedPage === "growth") return renderGrowth();
  if (normalizedPage === "points") return renderPoints();
  if (normalizedPage === "shop") return renderShop();
  if (normalizedPage === "mistakes") return renderMistakes();
  if (normalizedPage === "students") return renderStudents();
  if (normalizedPage === "team") return renderTeam();
  if (normalizedPage === "audit") return renderAudit();
  return renderProfile();
}

function render(): void {
  appRoot.innerHTML = `<div class="app-shell">${renderHeader()}${renderNavigation()}<main>${renderPage()}</main><footer><span>H5 体验版 · 数据保存在当前浏览器</span><button class="text-button" data-action="reset">恢复示例数据</button></footer></div>${state.guideSeen ? "" : renderGuideOverlay()}`;
}

function showToast(message: string): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 2400);
}

function cycleMistake(status: MistakeStatus): MistakeStatus {
  if (status === "待订正") return "已订正";
  if (status === "已订正") return "已掌握";
  return "待订正";
}

function readLocalImage(entry: FormDataEntryValue | null): Promise<string | undefined> {
  if (!(entry instanceof File) || entry.size === 0) return Promise.resolve(undefined);
  if (!entry.type.startsWith("image/")) return Promise.reject(new Error("请选择图片文件"));
  if (entry.size > 800 * 1024) return Promise.reject(new Error("图片请控制在 800KB 以内"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("图片读取失败"));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(entry);
  });
}

function handleAction(action: string, element: HTMLElement): void {
  const ownerOnly = new Set(["toggle-product", "approve-binding", "reject-binding", "reverse-ledger", "reverse-redemption"]);
  const managerOnly = new Set(["session", "remind", "homework-status", "reward", "redeem"]);
  if (ownerOnly.has(action) && !isOwner()) { showToast("这项操作仅负责人可以执行"); return; }
  if (managerOnly.has(action) && !isManager()) { showToast("家长没有这项管理权限"); return; }
  if (action === "role") {
    const role = element.dataset.role as Role | undefined;
    if (!role) return;
    commit(() => { state.activeRole = role; state.page = role === "guardian" ? "today" : "dashboard"; });
    return;
  }
  if (action === "page") {
    const page = element.dataset.page;
    if (!page) return;
    commit(() => { state.page = page; });
    return;
  }
  if (action === "open-guide" || action === "start-guide") {
    commit(() => { state.guideSeen = true; state.page = "guide"; });
    return;
  }
  if (action === "dismiss-guide") {
    commit(() => { state.guideSeen = true; state.page = state.activeRole === "guardian" ? "today" : "dashboard"; });
    return;
  }
  if (action === "guide-jump") {
    const role = element.dataset.role as Role | undefined;
    const page = element.dataset.page;
    if (!role || !page) return;
    commit(() => { state.guideSeen = true; state.activeRole = role; state.page = page; });
    return;
  }
  if (action === "filter-status") {
    const status = element.dataset.status as SessionStatus | undefined;
    if (!status) return;
    commit(() => { state.dashboardFilter = status; });
    return;
  }
  if (action === "clear-dashboard-filter") {
    commit(() => { state.dashboardFilter = undefined; });
    return;
  }
  if (action === "homework-filter") {
    const status = element.dataset.status as HomeworkStatus | undefined;
    if (!status) return;
    commit(() => { state.homeworkFilter = status; });
    return;
  }
  if (action === "clear-homework-filter") {
    commit(() => { state.homeworkFilter = undefined; });
    return;
  }
  if (action === "select-student") {
    const studentId = element.dataset.student;
    if (!studentId) return;
    commit(() => { state.selectedStudentId = studentId; });
    return;
  }
  if (action === "session") {
    const studentId = element.dataset.id;
    const status = element.dataset.status as SessionStatus | undefined;
    if (!studentId || !status) return;
    commit(() => { const student = studentById(studentId); student.sessionStatus = status; addAudit("更新今日状态", student.name, `更新为 ${status}`); });
    showToast("今日状态已更新");
    return;
  }
  if (action === "remind") {
    const studentId = element.dataset.id;
    if (!studentId) return;
    const minutes = element.dataset.minutes;
    const customEta = minutes === "custom" ? window.prompt("输入预计可以接的时间，例如 17:45", "17:30") : null;
    if (minutes === "custom" && !customEta) return;
    const eta = customEta ?? etaFromMinutes(Number(minutes));
    if (!/^\d{1,2}:\d{2}$/.test(eta)) { showToast("请输入类似 17:45 的时间"); return; }
    if (state.notices.some((notice) => notice.studentId === studentId && notice.eta === eta && notice.status === "已发送")) { showToast("该预计时间已经发送过提醒"); return; }
    commit(() => {
      const student = studentById(studentId);
      student.sessionStatus = "待接";
      state.notices.unshift({ id: uid("n"), studentId, eta, status: "已发送", createdAt: stamp() });
      addAudit("发送接娃提醒", student.name, `预计 ${eta} 可以来接`);
    });
    if ("Notification" in window && Notification.permission === "granted") new Notification("暖芽辅导班接娃提醒", { body: `${studentById(studentId).nickname} 预计 ${eta} 可以来接` });
    showToast(`已发送预计 ${eta} 的接娃提醒`);
    return;
  }
  if (action === "homework-status") {
    const homeworkId = element.dataset.id;
    const status = element.dataset.status as HomeworkStatus | undefined;
    if (!homeworkId || !status) return;
    commit(() => {
      const work = state.homework.find((item) => item.id === homeworkId);
      if (!work) return;
      work.status = status;
      if (status === "已完成") { work.completedAt = stamp(); work.feedback = work.feedback || "已完成今天的辅导，做得很认真。"; }
      addAudit("处理作业", studentById(work.studentId).name, `${work.subject} 标记为 ${status}`);
    });
    showToast("作业进度已保存");
    return;
  }
  if (action === "reward") {
    const studentId = element.dataset.id;
    if (!studentId) return;
    commit(() => { const student = studentById(studentId); addPoints(studentId, 5, "作业奖励", "今日作业完成奖励"); addAudit("发放积分", student.name, "+5，今日作业完成奖励"); });
    showToast("已发放 5 积分");
    return;
  }
  if (action === "redeem") {
    const productId = element.dataset.id;
    if (!productId) return;
    const student = selectedStudent();
    let error: string | undefined;
    commit(() => { error = redeemProduct(student.id, productId); });
    if (error) { showToast(error); return; }
    showToast("兑换完成，积分与库存已同步更新");
    return;
  }
  if (action === "toggle-product") {
    const productId = element.dataset.id;
    if (!productId) return;
    commit(() => { const product = state.products.find((item) => item.id === productId); if (!product) return; product.status = product.status === "上架" ? "下架" : "上架"; addAudit("更新商品状态", product.name, product.status); });
    return;
  }
  if (action === "reverse-ledger") {
    const ledgerId = element.dataset.id;
    if (!ledgerId) return;
    const original = state.ledgers.find((item) => item.id === ledgerId);
    if (!original || original.reversed || original.type === "兑换扣除" || original.type === "撤销冲正") { showToast("该积分流水不能冲正"); return; }
    const reversal = addPoints(original.studentId, -original.delta, "撤销冲正", `冲正：${original.reason}`, undefined, original.id);
    if (!reversal) { showToast("冲正会使积分为负，已拒绝操作"); return; }
    commit(() => { original.reversed = true; addAudit("冲正积分流水", studentById(original.studentId).name, `${original.delta > 0 ? "撤回" : "恢复"} ${Math.abs(original.delta)} 分`); });
    showToast("已生成一笔冲正流水");
    return;
  }
  if (action === "reverse-redemption") {
    const redemptionId = element.dataset.id;
    if (!redemptionId) return;
    const error = reverseRedemption(redemptionId);
    if (error) { showToast(error); return; }
    commit(() => {});
    showToast("兑换已撤销，积分和库存已恢复");
    return;
  }
  if (action === "next-mistake") {
    const mistakeId = element.dataset.id;
    if (!mistakeId) return;
    commit(() => { const mistake = state.mistakes.find((item) => item.id === mistakeId); if (!mistake) return; mistake.status = cycleMistake(mistake.status); addAudit("更新错题状态", mistake.knowledge, `更新为 ${mistake.status}`); });
    return;
  }
  if (action === "approve-binding" || action === "reject-binding") {
    const bindingId = element.dataset.id;
    if (!bindingId) return;
    commit(() => { const binding = state.bindings.find((item) => item.id === bindingId); if (!binding) return; binding.status = action === "approve-binding" ? "已通过" : "已拒绝"; addAudit("审核家长绑定", binding.studentName, `${binding.guardianName}：${binding.status}`); });
    showToast(action === "approve-binding" ? "绑定申请已通过" : "绑定申请已拒绝");
    return;
  }
  if (action === "toggle-ranking") {
    const studentId = element.dataset.id;
    if (!studentId) return;
    commit(() => { const student = studentById(studentId); student.publicRanking = !student.publicRanking; addAudit("更新排行榜隐私", student.name, student.publicRanking ? "开启公开排行" : "关闭公开排行"); });
    return;
  }
  if (action === "browser-notify") {
    if (!("Notification" in window)) { showToast("当前浏览器不支持网页通知"); return; }
    if (Notification.permission === "granted") { showToast("网页通知已经开启"); return; }
    void Notification.requestPermission().then((permission) => showToast(permission === "granted" ? "网页通知已开启" : "未授权网页通知，可继续在页面内查看提醒"));
    return;
  }
  if (action === "reset") {
    state = structuredClone(seedState);
    persist();
    render();
    showToast("示例数据已恢复");
  }
}

appRoot.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLElement>("[data-action]");
  if (!button) return;
  handleAction(button.dataset.action ?? "", button);
});

appRoot.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const values = new FormData(form);
  if (form.classList.contains("feedback-form")) {
    if (!isManager()) { showToast("家长不能修改老师反馈"); return; }
    const homeworkId = String(values.get("homeworkId") ?? "");
    const feedback = String(values.get("feedback") ?? "").trim();
    const homework = state.homework.find((item) => item.id === homeworkId);
    if (!homework) return;
    commit(() => { homework.feedback = feedback; addAudit("填写作业反馈", studentById(homework.studentId).name, `${homework.subject}：${feedback || "清空反馈"}`); });
    showToast("辅导反馈已保存，家长可立即查看");
    return;
  }
  if (form.classList.contains("inventory-form")) {
    if (!isOwner()) { showToast("只有负责人可以调整库存"); return; }
    const productId = String(values.get("productId") ?? "");
    const stock = Number(values.get("stock"));
    const product = state.products.find((item) => item.id === productId);
    if (!product || !Number.isInteger(stock) || stock < 0) { showToast("库存必须是 0 或正整数"); return; }
    commit(() => { const previous = product.stock; product.stock = stock; addAudit("调整商品库存", product.name, `${previous} → ${stock}`); });
    showToast("商品库存已更新");
    return;
  }
  if (form.id === "redemption-form") {
    if (!isManager()) { showToast("家长不能办理现场兑换"); return; }
    const studentId = String(values.get("studentId") ?? "");
    const productId = String(values.get("productId") ?? "");
    let error: string | undefined;
    commit(() => { error = redeemProduct(studentId, productId); });
    if (error) { showToast(error); return; }
    showToast("现场兑换完成，积分、库存和记录已同步更新");
    return;
  }
  if (form.id === "homework-form") {
    const studentId = String(values.get("studentId") ?? "");
    const subject = String(values.get("subject") ?? "");
    const content = String(values.get("content") ?? "").trim();
    const note = String(values.get("note") ?? "").trim();
    let imageData: string | undefined;
    try { imageData = await readLocalImage(values.get("image")); } catch (error: unknown) { showToast(error instanceof Error ? error.message : "图片读取失败"); return; }
    if (!studentId || (!content && !imageData)) { showToast("请填写作业内容或上传一张图片"); return; }
    commit(() => { state.homework.unshift({ id: uid("h"), studentId, subject, content, status: "待确认", feedback: note, createdAt: stamp(), imageData }); addAudit("提交作业", studentById(studentId).name, `${subject}：${content || "上传作业图片"}`); });
    showToast("作业已进入老师工作台");
    return;
  }
  if (form.id === "points-form") {
    if (!isOwner()) { showToast("人工调整积分仅负责人可以执行"); return; }
    const delta = Number(values.get("delta"));
    const reason = String(values.get("reason") ?? "").trim();
    if (!Number.isFinite(delta) || delta === 0 || !reason) return;
    const student = selectedStudent();
    if (student.points + delta < 0) { showToast("积分不能扣成负数"); return; }
    commit(() => { addPoints(student.id, delta, "人工调整", reason); addAudit("人工调整积分", student.name, `${delta > 0 ? "+" : ""}${delta}，${reason}`); });
    showToast("积分流水已写入");
    return;
  }
  if (form.id === "product-form") {
    if (!isOwner()) { showToast("商品上架仅负责人可以执行"); return; }
    const name = String(values.get("name") ?? "").trim();
    const points = Number(values.get("points"));
    const stock = Number(values.get("stock"));
    if (!name || !Number.isFinite(points) || !Number.isFinite(stock)) return;
    commit(() => { state.products.unshift({ id: uid("p"), name, pointsCost: points, stock, status: "上架", limit: 1, tone: "leaf" }); addAudit("上架商品", name, `${points} 积分，库存 ${stock}`); });
    showToast("新商品已上架");
    return;
  }
  if (form.id === "mistake-form") {
    const studentId = String(values.get("studentId") ?? "");
    const subject = String(values.get("subject") ?? "");
    const knowledge = String(values.get("knowledge") ?? "").trim();
    const note = String(values.get("note") ?? "").trim();
    let imageData: string | undefined;
    try { imageData = await readLocalImage(values.get("image")); } catch (error: unknown) { showToast(error instanceof Error ? error.message : "图片读取失败"); return; }
    if (!studentId || !knowledge || !note) return;
    commit(() => { state.mistakes.unshift({ id: uid("m"), studentId, subject, knowledge, note, status: "待订正", createdAt: "07-15", imageData }); addAudit("新增错题", studentById(studentId).name, `${subject} · ${knowledge}`); });
    showToast("错题已经保存");
  }
});

render();
