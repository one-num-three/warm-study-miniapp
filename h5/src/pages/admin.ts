/** 管理端四个 Tab 及其子页面（老师 + 负责人共用，按权限显隐）。 */

import {
  PERMISSIONS,
  SESSION_STATUSES,
  SETTING_KEYS,
  compactStamp,
  formatBindingCode,
  nextTransitions,
  newRequestId,
  toDateKey,
  SESSION_TRANSITIONS,
  type AuditLog,
  type DashboardSummary,
  type PointLedgerEntry,
  type Product,
  type Redemption,
  type SessionStatus,
  type Student,
} from "@warm-study/shared";
import { api, ApiError } from "../api.js";
import { button, card, div, el, mount, p, span, strong } from "../dom.js";
import { definePage, navigateTo, reload } from "../router.js";
import { can, isOwner, logout, state, switchShell } from "../state.js";
import { actionSheet, confirmDialog, emptyState, formSheet, toast, toastError } from "../ui.js";

interface TodayRow {
  studentId: string;
  name: string;
  nickname: string;
  grade: string;
  session: { id: string; status: SessionStatus };
  sheet: { id: string; status: string; rewarded: boolean } | null;
  pointBalance: number;
  lastReminderAt: string | null;
}

interface StudentDetail extends Student {
  bindingCodeDisplay: string;
  computedBalance: number;
  guardians: Array<{
    bindingId: string;
    userId: string;
    displayName: string;
    relation: string;
    status: string;
    createdAt: string;
  }>;
}

const STATUS_TONE: Record<string, string> = {
  待到班: "tag tag--muted",
  已到班: "tag",
  辅导中: "tag tag--gold",
  待接: "tag tag--accent",
  已接走: "tag",
};

/* ---------------------------------- 看板 ---------------------------------- */

definePage("admin.board", {
  title: "今日看板",
  tab: true,
  extra: () => state.profile?.displayName ?? null,
  async render(container) {
    const [summary, rows] = await Promise.all([
      api.get<DashboardSummary>("/dashboard"),
      api.get<TodayRow[]>("/sessions/today"),
    ]);

    const alerts: HTMLElement[] = [];
    if (summary.pendingBindings > 0 && can(PERMISSIONS.BINDING_REVIEW)) {
      alerts.push(
        alertRow(`${summary.pendingBindings} 条家长绑定申请待审核`, () => navigateTo("admin.bindings")),
      );
    }
    if (summary.homework.finishedButUnrewarded > 0) {
      alerts.push(alertRow(`${summary.homework.finishedButUnrewarded} 份作业已完成但还没发积分`, () =>
        navigateTo("admin.homework"),
      ));
    }
    if (summary.lowStockProducts > 0 && can(PERMISSIONS.PRODUCT_MANAGE)) {
      alerts.push(alertRow(`${summary.lowStockProducts} 个商品库存不足`, () => navigateTo("admin.products")));
    }
    if (summary.remindedNotPickedUp > 0) {
      alerts.push(alertRow(`${summary.remindedNotPickedUp} 个孩子已提醒但还没接走`, null));
    }

    mount(
      container,
      div(
        { class: "grid grid--3", style: "margin-bottom:10px" },
        ...SESSION_STATUSES.map((status) =>
          div(
            { class: status === "待接" ? "metric is-alert" : "metric" },
            strong({}, String(summary.sessionCounts[status] ?? 0)),
            span({}, status),
          ),
        ),
        div(
          { class: "metric" },
          strong({}, String(summary.homework.notSubmitted)),
          span({}, "今日未交作业"),
        ),
      ),
      alerts.length > 0 ? card("要处理的事", ...alerts) : null,
      div({ class: "section-title" }, div({}, `今日学员 · ${summary.dateKey}`)),
      rows.length === 0
        ? emptyState("还没有在读学员")
        : div({}, ...rows.map((row) => todayCard(row))),
    );
  },
});

function alertRow(text: string, onClick: (() => void) | null): HTMLElement {
  return div(
    { class: "row" },
    div({ class: "row__main" }, div({ class: "row__title" }, text)),
    onClick ? button({ class: "btn btn--sm", onClick }, "去处理") : null,
  );
}

function todayCard(row: TodayRow): HTMLElement {
  const transitions = nextTransitions(SESSION_TRANSITIONS, row.session.status);
  return card(
    div(
      { class: "spread", style: "width:100%" },
      div({}, `${row.name}（${row.nickname || row.grade}）`),
      span({ class: STATUS_TONE[row.session.status] ?? "tag" }, row.session.status),
    ),
    div(
      { class: "row__sub" },
      `${row.grade} · ${row.pointBalance} 分 · 作业${row.sheet ? row.sheet.status : "未提交"}`,
      row.lastReminderAt ? ` · 已提醒 ${compactStamp(row.lastReminderAt)}` : "",
    ),
    div(
      { class: "btn-row", style: "margin-top:10px" },
      ...(can(PERMISSIONS.SESSION_MANAGE)
        ? transitions.map((rule) =>
            button(
              {
                class: "btn btn--sm",
                dataset: { action: `session-${rule.to}`, student: row.studentId },
                onClick: async () => {
                  try {
                    await api.post("/sessions/transition", { studentId: row.studentId, to: rule.to });
                    toast(`已标记「${rule.to}」`);
                    reload();
                  } catch (error) {
                    toastError(error);
                  }
                },
              },
              rule.label,
            ),
          )
        : []),
      can(PERMISSIONS.NOTIFICATION_SEND)
        ? button(
            {
              class: "btn btn--sm btn--accent",
              dataset: { action: "notify", student: row.studentId },
              onClick: () => void sendReminder(row),
            },
            "发接娃提醒",
          )
        : null,
      isOwner() && row.session.status === "已接走"
        ? button(
            {
              class: "btn btn--sm btn--ghost",
              onClick: async () => {
                const form = await formSheet({
                  title: "撤回「已接走」",
                  hint: "状态回退属于纠错操作，会记入审计日志。",
                  fields: [{ name: "reason", label: "原因", required: true, type: "textarea" }],
                });
                if (!form) return;
                try {
                  await api.post("/sessions/transition", {
                    studentId: row.studentId,
                    to: "待接",
                    reason: form.reason,
                  });
                  toast("已回退");
                  reload();
                } catch (error) {
                  toastError(error);
                }
              },
            },
            "撤回接走",
          )
        : null,
    ),
  );
}

async function sendReminder(row: TodayRow): Promise<void> {
  const choice = await actionSheet({
    title: `提醒 ${row.name} 的家长`,
    actions: [
      { label: "15 分钟后可接", value: "15" },
      { label: "30 分钟后可接", value: "30" },
      { label: "60 分钟后可接", value: "60" },
      { label: "自定义时间…", value: "custom" },
    ],
  });
  if (!choice) return;

  let body: Record<string, unknown> = { studentId: row.studentId, requestId: newRequestId() };
  if (choice === "custom") {
    const form = await formSheet({
      title: "自定义可接时间",
      fields: [{ name: "etaAt", label: "预计可接时刻", required: true, placeholder: "18:30", maxlength: 5 }],
    });
    if (!form) return;
    body.etaAt = form.etaAt;
  } else {
    body.minutes = Number(choice);
  }

  try {
    const result = await api.post<{ delivered: boolean; reminder: { etaAt: string } }>("/reminders", body);
    toast(
      result.delivered
        ? `已通知家长：预计 ${result.reminder.etaAt} 可接`
        : "家长还没绑定，提醒已记录但没发出去，请电话联系",
      result.delivered ? "info" : "error",
      3000,
    );
    reload();
  } catch (error) {
    if (error instanceof ApiError && error.code === "DUPLICATE_REQUEST") {
      const again = await confirmDialog({ title: "重复提醒", body: error.message, confirmText: "再发一次" });
      if (!again) return;
      try {
        await api.post("/reminders", { ...body, confirmDuplicate: true, requestId: newRequestId() });
        toast("已再次发送");
        reload();
      } catch (retryError) {
        toastError(retryError);
      }
      return;
    }
    toastError(error);
  }
}

/* -------------------------------- 作业池 -------------------------------- */

definePage("admin.homework", {
  title: "今日作业",
  tab: true,
  async render(container) {
    const sheets = await api.get<Array<Record<string, unknown>>>("/homework/sheets", {
      // 用共享的 toDateKey，保证和服务端按同一个时区划分"今天"
      dateKey: toDateKey(),
    });

    mount(
      container,
      sheets.length === 0
        ? emptyState("今天还没有家长提交作业")
        : div({}, ...sheets.map((sheet) => sheetCard(sheet))),
    );
  },
});

function sheetCard(sheet: Record<string, unknown>): HTMLElement {
  const items = sheet.items as Array<Record<string, unknown>>;
  const status = String(sheet.status);
  const settled = items.every((item) => item.status === "已完成" || item.status === "未完成");

  return card(
    div(
      { class: "spread", style: "width:100%" },
      div({}, `${sheet.studentName}`),
      span({ class: STATUS_TONE[status] ?? "tag" }, status),
    ),
    ...items.map((item) =>
      div(
        { class: "row" },
        item.image ? el("img", { class: "thumb thumb--sm", src: String(item.image) }) : null,
        div(
          { class: "row__main" },
          div({ class: "row__title" }, String(item.subject)),
          div({ class: "row__sub" }, String(item.content || "（没有补充说明）")),
        ),
        can(PERMISSIONS.HOMEWORK_MANAGE)
          ? itemActions(String(item.id), String(item.status))
          : span({ class: "tag tag--muted" }, String(item.status)),
      ),
    ),
    sheet.feedback ? p({ class: "card__hint", style: "margin-top:8px" }, `反馈：${sheet.feedback}`) : null,
    can(PERMISSIONS.HOMEWORK_MANAGE) && status === "辅导中"
      ? div(
          { class: "btn-row", style: "margin-top:10px" },
          button(
            {
              class: settled ? "btn btn--sm btn--primary" : "btn btn--sm",
              dataset: { action: "finish-sheet" },
              onClick: () => void finishSheet(String(sheet.id), settled),
            },
            "结束今天的作业",
          ),
        )
      : null,
    can(PERMISSIONS.HOMEWORK_MANAGE) && (status === "待确认" || status === "需要补充")
      ? div(
          { class: "btn-row", style: "margin-top:10px" },
          button(
            {
              class: "btn btn--sm btn--ghost",
              onClick: async () => {
                try {
                  await api.post(`/homework/sheets/${sheet.id}/transition`, { to: "需要补充" });
                  toast("已要求家长补充");
                  reload();
                } catch (error) {
                  toastError(error);
                }
              },
            },
            "要求补充",
          ),
          p({ class: "card__hint" }, "把任意一项标记为「开始」，整张单会自动进入辅导中。"),
        )
      : null,
  );
}

function itemActions(itemId: string, status: string): HTMLElement {
  const next: Record<string, Array<{ to: string; label: string }>> = {
    待开始: [
      { to: "进行中", label: "开始" },
      { to: "未完成", label: "未完成" },
    ],
    进行中: [
      { to: "已完成", label: "完成" },
      { to: "未完成", label: "未完成" },
    ],
    已完成: [],
    未完成: [],
  };
  const actions = next[status] ?? [];
  if (actions.length === 0) {
    return span({ class: status === "已完成" ? "tag" : "tag tag--muted" }, status);
  }
  return div(
    { class: "btn-row" },
    ...actions.map((action) =>
      button(
        {
          class: "btn btn--sm",
          dataset: { action: `item-${action.to}`, item: itemId },
          onClick: async () => {
            try {
              await api.post(`/homework/items/${itemId}/status`, { status: action.to });
              reload();
            } catch (error) {
              toastError(error);
            }
          },
        },
        action.label,
      ),
    ),
  );
}

async function finishSheet(sheetId: string, settled: boolean): Promise<void> {
  if (!settled) {
    toast("还有作业项没有标记完成或未完成", "error");
    return;
  }
  const form = await formSheet({
    title: "结束今天的作业",
    hint: "反馈会直接展示给家长。",
    fields: [
      {
        name: "status",
        label: "结果",
        type: "select",
        options: [
          { label: "已完成", value: "已完成" },
          { label: "未完成", value: "未完成" },
        ],
      },
      { name: "feedback", label: "辅导反馈", required: true, type: "textarea", maxlength: 300 },
      { name: "unfinishedReason", label: "未完成原因（选未完成时必填）", type: "textarea" },
      { name: "rewardPoints", label: "奖励积分", type: "number", value: "10" },
    ],
    submitText: "确认结束",
  });
  if (!form) return;

  try {
    const result = await api.post<{ reward: { applied: number; skipped: string | null } }>(
      `/homework/sheets/${sheetId}/finish`,
      {
        status: form.status,
        feedback: form.feedback,
        unfinishedReason: form.unfinishedReason || undefined,
        rewardPoints: form.rewardPoints ? Number(form.rewardPoints) : undefined,
        requestId: newRequestId(),
      },
    );
    // 如实转述服务端的发放结果，不把"没发成"说成"成功"
    if (result.reward.applied > 0) toast(`已结束，发放 ${result.reward.applied} 分`);
    else if (result.reward.skipped === "no_permission") {
      toast("作业已结束，但你没有发放积分的权限，分已挂起等负责人补发", "error", 3200);
    } else if (result.reward.skipped === "already_rewarded") {
      toast("作业已结束。这张单之前发过分了，没有重复发放", "info", 3000);
    } else toast("作业已结束");
    reload();
  } catch (error) {
    toastError(error);
  }
}

/* --------------------------------- 学员 --------------------------------- */

definePage("admin.students", {
  title: "学员",
  tab: true,
  async render(container) {
    const students = await api.get<Student[]>("/students", { includeDisabled: "true" });

    mount(
      container,
      can(PERMISSIONS.STUDENT_MANAGE)
        ? button(
            {
              class: "btn btn--primary btn--block",
              style: "margin-bottom:12px",
              dataset: { action: "new-student" },
              onClick: () => void createStudent(),
            },
            "新增学员（自动生成绑定码）",
          )
        : null,
      students.length === 0
        ? emptyState("还没有学员")
        : div(
            {},
            ...students.map((student) =>
              card(
                div(
                  { class: "spread", style: "width:100%" },
                  div({}, `${student.name}${student.nickname ? `（${student.nickname}）` : ""}`),
                  student.status === "active"
                    ? span({ class: "tag" }, student.grade)
                    : span({ class: "tag tag--muted" }, "已停用"),
                ),
                div(
                  {
                    class: student.bindingCodeEnabled ? "code-plate" : "code-plate is-disabled",
                    style: "margin-top:10px",
                    dataset: { role: "binding-code-plate", student: student.id },
                  },
                  div(
                    {},
                    div({ class: "code-plate__label" }, student.bindingCodeEnabled ? "绑定码" : "绑定码已停用"),
                    div({ class: "code-plate__code" }, formatBindingCode(student.bindingCode)),
                  ),
                  button(
                    {
                      class: "btn btn--sm",
                      onClick: () => void copyCode(formatBindingCode(student.bindingCode)),
                    },
                    "复制",
                  ),
                ),
                div(
                  { class: "spread", style: "margin-top:10px" },
                  span({ class: "text-small text-muted" }, `${student.pointBalance} 分`),
                  button(
                    {
                      class: "btn btn--sm",
                      onClick: () => navigateTo("admin.student", { id: student.id }),
                    },
                    "详情",
                  ),
                ),
              ),
            ),
          ),
    );
  },
});

async function copyCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code);
    toast(`已复制 ${code}`);
  } catch {
    toast(`绑定码：${code}`);
  }
}

async function createStudent(): Promise<void> {
  const form = await formSheet({
    title: "新增学员",
    hint: "保存后系统会生成一个唯一固定的绑定码，把它给家长即可完成绑定。",
    fields: [
      { name: "name", label: "姓名", required: true, maxlength: 20 },
      { name: "nickname", label: "昵称（排行榜上显示）", maxlength: 20 },
      {
        name: "grade",
        label: "年级",
        required: true,
        type: "select",
        options: ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级"].map((value) => ({
          label: value,
          value,
        })),
      },
      { name: "note", label: "备注", type: "textarea" },
    ],
    submitText: "建立档案",
  });
  if (!form) return;

  try {
    const result = await api.post<{ student: Student; bindingCodeDisplay: string }>("/students", form);
    // 生成的码要在这里显眼地展示一次 —— 这是老师抄给家长的那张纸条
    const confirmed = await confirmDialog({
      title: `${result.student.name} 的绑定码`,
      code: result.bindingCodeDisplay,
      body: "把这串码给家长，他们在小程序里输入即可绑定。这个码固定不变，爸爸妈妈可以用同一个码分别绑定。",
      confirmText: "知道了",
      cancelText: "复制",
    });
    if (!confirmed) await copyCode(result.bindingCodeDisplay);
    reload();
  } catch (error) {
    toastError(error);
  }
}

definePage("admin.student", {
  title: "学员详情",
  async render(container, params) {
    const [detail, ledger] = await Promise.all([
      api.get<StudentDetail>(`/students/${params.id}`),
      api.get<{ entries: PointLedgerEntry[] }>("/points/ledger", { studentId: params.id, limit: 30 }),
    ]);

    mount(
      container,
      card(
        div(
          { class: "spread", style: "width:100%" },
          div({}, detail.name),
          span({ class: detail.status === "active" ? "tag" : "tag tag--muted" }, detail.status === "active" ? "在读" : "已停用"),
        ),
        div({ class: "row__sub" }, `${detail.grade} · 昵称 ${detail.nickname || "未设置"}`),
        div(
          {
            class: detail.bindingCodeEnabled ? "code-plate" : "code-plate is-disabled",
            style: "margin-top:10px",
          },
          div(
            {},
            div({ class: "code-plate__label" }, detail.bindingCodeEnabled ? "绑定码（固定不变）" : "绑定码已停用"),
            div({ class: "code-plate__code" }, detail.bindingCodeDisplay),
          ),
          button({ class: "btn btn--sm", onClick: () => void copyCode(detail.bindingCodeDisplay) }, "复制"),
        ),
        can(PERMISSIONS.BINDING_CODE_MANAGE)
          ? div(
              { class: "btn-row", style: "margin-top:10px" },
              button(
                {
                  class: "btn btn--sm btn--ghost",
                  onClick: async () => {
                    const yes = await confirmDialog({
                      title: detail.bindingCodeEnabled ? "停用绑定码？" : "启用绑定码？",
                      body: detail.bindingCodeEnabled
                        ? "停用后新家长无法用这个码绑定，已绑定的家长不受影响。"
                        : "启用后家长可以重新用这个码绑定。",
                    });
                    if (!yes) return;
                    try {
                      await api.post(`/students/${params.id}/binding-code/toggle`, {
                        enabled: !detail.bindingCodeEnabled,
                      });
                      toast("已更新");
                      reload();
                    } catch (error) {
                      toastError(error);
                    }
                  },
                },
                detail.bindingCodeEnabled ? "停用绑定码" : "启用绑定码",
              ),
              button(
                {
                  class: "btn btn--sm btn--ghost",
                  onClick: async () => {
                    const form = await formSheet({
                      title: "重置绑定码",
                      hint: "只有码外泄时才需要重置。重置后旧码立即失效，已绑定的家长不受影响。",
                      fields: [{ name: "reason", label: "重置原因", required: true, type: "textarea" }],
                      submitText: "确认重置",
                    });
                    if (!form) return;
                    try {
                      const result = await api.post<{ bindingCodeDisplay: string }>(
                        `/students/${params.id}/binding-code/reset`,
                        { reason: form.reason },
                      );
                      const done = await confirmDialog({
                        title: "新的绑定码",
                        code: result.bindingCodeDisplay,
                        body: "旧码已立即失效，请把新码交给还没绑定的家长。",
                        confirmText: "知道了",
                        cancelText: "复制",
                      });
                      if (!done) await copyCode(result.bindingCodeDisplay);
                      reload();
                    } catch (error) {
                      toastError(error);
                    }
                  },
                },
                "重置绑定码",
              ),
            )
          : null,
      ),
      card(
        "已绑定的家长",
        detail.guardians.length === 0
          ? emptyState("还没有家长绑定")
          : div(
              {},
              ...detail.guardians.map((guardian) =>
                div(
                  { class: "row" },
                  div({ class: "row__main" },
                    div({ class: "row__title" }, `${guardian.displayName}（${guardian.relation}）`),
                    div({ class: "row__sub" }, compactStamp(guardian.createdAt)),
                  ),
                  span(
                    {
                      class:
                        guardian.status === "已通过"
                          ? "tag"
                          : guardian.status === "待审核"
                            ? "tag tag--gold"
                            : "tag tag--muted",
                    },
                    guardian.status,
                  ),
                  guardian.status === "已通过" && can(PERMISSIONS.BINDING_REVIEW)
                    ? button(
                        {
                          class: "btn btn--sm btn--ghost",
                          onClick: async () => {
                            const yes = await confirmDialog({
                              title: "解除绑定？",
                              body: `${guardian.displayName} 将无法再看到 ${detail.name} 的数据。`,
                              danger: true,
                            });
                            if (!yes) return;
                            try {
                              await api.post(`/bindings/${guardian.bindingId}/release`, {});
                              toast("已解除");
                              reload();
                            } catch (error) {
                              toastError(error);
                            }
                          },
                        },
                        "解除",
                      )
                    : null,
                ),
              ),
            ),
      ),
      card(
        div(
          { class: "spread", style: "width:100%" },
          div({}, `积分 ${detail.pointBalance}`),
          detail.pointBalance === detail.computedBalance
            ? span({ class: "tag" }, "账目一致")
            : span({ class: "tag tag--danger" }, `与流水差 ${detail.pointBalance - detail.computedBalance}`),
        ),
        div(
          { class: "btn-row", style: "margin-bottom:8px" },
          can(PERMISSIONS.POINTS_GRANT)
            ? button({ class: "btn btn--sm btn--primary", onClick: () => void grantPoints(detail) }, "发放积分")
            : null,
          can(PERMISSIONS.REDEMPTION_CREATE)
            ? button(
                { class: "btn btn--sm", onClick: () => navigateTo("admin.redeem", { id: detail.id }) },
                "现场兑换",
              )
            : null,
        ),
        ledger.entries.length === 0
          ? emptyState("还没有积分记录")
          : div(
              {},
              ...ledger.entries.map((entry) =>
                div(
                  { class: "row" },
                  div(
                    { class: "row__main" },
                    div({ class: entry.reversed ? "row__title is-reversed" : "row__title" }, entry.reason),
                    div({ class: "row__sub" }, `${entry.type} · ${compactStamp(entry.createdAt)}`),
                  ),
                  div(
                    { class: `ledger__delta ${entry.delta > 0 ? "is-plus" : "is-minus"}` },
                    `${entry.delta > 0 ? "+" : ""}${entry.delta}`,
                  ),
                  isOwner() && !entry.reversed && entry.type !== "撤销冲正"
                    ? button(
                        {
                          class: "btn btn--sm btn--ghost",
                          onClick: () => void reverseLedger(entry),
                        },
                        "冲正",
                      )
                    : null,
                ),
              ),
            ),
      ),
      can(PERMISSIONS.STUDENT_MANAGE)
        ? card(
            "档案管理",
            div(
              { class: "btn-row" },
              button(
                {
                  class: "btn btn--sm",
                  onClick: async () => {
                    const form = await formSheet({
                      title: "编辑档案",
                      fields: [
                        { name: "name", label: "姓名", value: detail.name, required: true },
                        { name: "nickname", label: "昵称", value: detail.nickname },
                        { name: "grade", label: "年级", value: detail.grade, required: true },
                        { name: "note", label: "备注", type: "textarea", value: detail.note ?? "" },
                      ],
                    });
                    if (!form) return;
                    try {
                      await api.patch(`/students/${detail.id}`, form);
                      toast("已保存");
                      reload();
                    } catch (error) {
                      toastError(error);
                    }
                  },
                },
                "编辑",
              ),
              button(
                {
                  class: "btn btn--sm",
                  onClick: async () => {
                    try {
                      await api.patch(`/students/${detail.id}`, { publicRanking: !detail.publicRanking });
                      toast(detail.publicRanking ? "已设为不公开参与排行" : "已加入公开排行");
                      reload();
                    } catch (error) {
                      toastError(error);
                    }
                  },
                },
                detail.publicRanking ? "退出公开排行" : "加入公开排行",
              ),
              button(
                {
                  class: detail.status === "active" ? "btn btn--sm btn--danger" : "btn btn--sm",
                  onClick: async () => {
                    const yes = await confirmDialog({
                      title: detail.status === "active" ? "停用这名学员？" : "恢复在读？",
                      body:
                        detail.status === "active"
                          ? "停用后不再产生新记录，历史数据全部保留。"
                          : "恢复后可以继续记录作业和积分。",
                      danger: detail.status === "active",
                    });
                    if (!yes) return;
                    try {
                      await api.patch(`/students/${detail.id}`, {
                        status: detail.status === "active" ? "disabled" : "active",
                      });
                      toast("已更新");
                      reload();
                    } catch (error) {
                      toastError(error);
                    }
                  },
                },
                detail.status === "active" ? "停用学员" : "恢复在读",
              ),
            ),
          )
        : null,
    );
  },
});

async function grantPoints(student: StudentDetail): Promise<void> {
  const owner = isOwner();
  const form = await formSheet({
    title: `给 ${student.name} 发积分`,
    fields: [
      { name: "delta", label: "分数", required: true, type: "number", value: "10" },
      {
        name: "type",
        label: "类型",
        type: "select",
        options: (owner
          ? ["表现奖励", "作业奖励", "错题订正", "人工调整"]
          : ["表现奖励", "作业奖励", "错题订正"]
        ).map((value) => ({ label: value, value })),
      },
      { name: "reason", label: "原因", required: true, placeholder: "写清楚，家长看得到", maxlength: 100 },
    ],
    submitText: "发放",
  });
  if (!form) return;

  const payload = {
    studentId: student.id,
    delta: Number(form.delta),
    type: form.type,
    reason: form.reason,
    requestId: newRequestId(),
  };
  try {
    await api.post("/points/grant", payload);
    toast("已发放");
    reload();
  } catch (error) {
    if (error instanceof ApiError && error.details?.requiresConfirm) {
      const yes = await confirmDialog({ title: "大额调整确认", body: error.message });
      if (!yes) return;
      try {
        await api.post("/points/grant", { ...payload, confirmed: true, requestId: newRequestId() });
        toast("已发放");
        reload();
      } catch (retryError) {
        toastError(retryError);
      }
      return;
    }
    toastError(error);
  }
}

async function reverseLedger(entry: PointLedgerEntry): Promise<void> {
  const form = await formSheet({
    title: "冲正这笔流水",
    hint: "原流水永久保留，系统会另外生成一条反向流水。",
    fields: [{ name: "reason", label: "冲正原因", required: true, type: "textarea" }],
    submitText: "确认冲正",
  });
  if (!form) return;
  try {
    await api.post("/points/reverse", { ledgerId: entry.id, reason: form.reason });
    toast("已冲正");
    reload();
  } catch (error) {
    toastError(error);
  }
}

definePage("admin.redeem", {
  title: "现场兑换",
  async render(container, params) {
    const [detail, products, redemptions] = await Promise.all([
      api.get<StudentDetail>(`/students/${params.id}`),
      api.get<Product[]>("/products"),
      api.get<Array<Redemption & { studentName: string }>>("/redemptions", { studentId: params.id! }),
    ]);
    const onSale = products.filter((product) => product.status === "上架");
    // 已经兑换过几次，用来判断限兑商品还能不能点 —— 否则超限的商品看起来能点，
    // 点下去才报错，老师当着孩子的面很尴尬
    const usedCount = new Map<string, number>();
    for (const item of redemptions) {
      if (item.status !== "已完成") continue;
      const key = item.productSnapshot.id;
      usedCount.set(key, (usedCount.get(key) ?? 0) + 1);
    }

    mount(
      container,
      card(
        div({ class: "spread", style: "width:100%" }, div({}, detail.name), span({ class: "tag" }, `${detail.pointBalance} 分`)),
        p({ class: "card__hint" }, "核对孩子本人后再兑换。扣分、减库存、发放在同一步完成。"),
      ),
      onSale.length === 0
        ? emptyState("没有上架的商品")
        : div(
            {},
            ...onSale.map((product) => {
              const used = usedCount.get(product.id) ?? 0;
              const limitReached = product.perStudentLimit > 0 && used >= product.perStudentLimit;
              const affordable =
                detail.pointBalance >= product.pointsCost && product.stock > 0 && !limitReached;
              return card(
                div(
                  { class: "spread", style: "width:100%" },
                  div({}, product.name),
                  span({ class: product.stock > 0 ? "tag" : "tag tag--muted" }, `库存 ${product.stock}`),
                ),
                p({ class: "card__hint" }, product.description ?? ""),
                div(
                  { class: "spread", style: "margin-top:8px" },
                  strong({ style: "color:var(--c-accent)" }, `${product.pointsCost} 分`),
                  button(
                    {
                      class: affordable ? "btn btn--sm btn--primary" : "btn btn--sm",
                      disabled: !affordable,
                      dataset: { action: "redeem", product: product.id },
                      onClick: async () => {
                        const yes = await confirmDialog({
                          title: `兑换「${product.name}」？`,
                          body: `将扣除 ${detail.name} 的 ${product.pointsCost} 分。`,
                        });
                        if (!yes) return;
                        try {
                          const result = await api.post<{ balanceAfter: number }>("/redemptions", {
                            studentId: detail.id,
                            productId: product.id,
                            requestId: newRequestId(),
                          });
                          toast(`兑换成功，余额 ${result.balanceAfter} 分`);
                          reload();
                        } catch (error) {
                          toastError(error);
                        }
                      },
                    },
                    product.stock <= 0
                      ? "已兑完"
                      : limitReached
                        ? "已达限兑"
                        : affordable
                          ? "兑换"
                          : "积分不够",
                  ),
                ),
              );
            }),
          ),
    );
  },
});

/* --------------------------------- 管理 --------------------------------- */

definePage("admin.manage", {
  title: "管理",
  tab: true,
  async render(container) {
    const entries: Array<{ label: string; hint: string; page: string; show: boolean }> = [
      {
        label: "家长绑定审核",
        hint: "审核、解除家长与孩子的绑定关系",
        page: "admin.bindings",
        show: can(PERMISSIONS.BINDING_REVIEW),
      },
      {
        label: "商品与库存",
        hint: "上下架、改价、补库存",
        page: "admin.products",
        show: can(PERMISSIONS.PRODUCT_MANAGE),
      },
      { label: "兑换记录", hint: "查看与撤销兑换", page: "admin.redemptions", show: true },
      {
        label: "老师账号",
        hint: "新增老师、分配权限、停用账号",
        page: "admin.staff",
        show: can(PERMISSIONS.STAFF_MANAGE),
      },
      {
        label: "审计日志",
        hint: "敏感操作全记录，只增不删",
        page: "admin.audit",
        show: can(PERMISSIONS.AUDIT_READ),
      },
      {
        label: "系统设置",
        hint: "绑定审核开关、积分规则、排行隐私",
        page: "admin.settings",
        show: can(PERMISSIONS.SETTINGS_MANAGE),
      },
      { label: "积分对账", hint: "流水重算余额，只读核对", page: "admin.reconcile", show: isOwner() },
    ];

    mount(
      container,
      card(
        null,
        div(
          { class: "row" },
          div({ class: "avatar" }, (state.profile?.displayName ?? "?").slice(0, 1)),
          div(
            { class: "row__main" },
            div({ class: "row__title" }, state.profile?.displayName ?? ""),
            div({ class: "row__sub" }, isOwner() ? "负责人" : "老师"),
          ),
        ),
      ),
      card(
        null,
        ...entries
          .filter((entry) => entry.show)
          .map((entry) =>
            div(
              { class: "row", onClick: () => navigateTo(entry.page), style: "cursor:pointer" },
              div(
                { class: "row__main" },
                div({ class: "row__title" }, entry.label),
                div({ class: "row__sub" }, entry.hint),
              ),
              span({ class: "text-muted" }, "›"),
            ),
          ),
      ),
      (state.profile?.students.length ?? 0) > 0
        ? card(
            "身份",
            p({ class: "card__hint" }, "你也绑定了孩子，可以切换到家长端查看。"),
            button(
              {
                class: "btn btn--block",
                style: "margin-top:10px",
                onClick: () => switchShell("guardian"),
              },
              "切换到家长端",
            ),
          )
        : null,
      button(
        {
          class: "btn btn--ghost btn--block",
          onClick: async () => {
            const yes = await confirmDialog({ title: "退出登录？", danger: true });
            if (yes) await logout();
          },
        },
        "退出登录",
      ),
    );
  },
});

definePage("admin.bindings", {
  title: "绑定审核",
  async render(container) {
    const bindings = await api.get<
      Array<{ id: string; studentName: string; guardianName: string; relation: string; status: string; createdAt: string }>
    >("/bindings");
    const pending = bindings.filter((item) => item.status === "待审核");
    const others = bindings.filter((item) => item.status !== "待审核");

    async function review(id: string, decision: "approve" | "reject"): Promise<void> {
      let reason: string | undefined;
      if (decision === "reject") {
        const form = await formSheet({
          title: "拒绝绑定申请",
          fields: [{ name: "reason", label: "拒绝原因", type: "textarea", placeholder: "会记入审计日志" }],
          submitText: "确认拒绝",
        });
        if (!form) return;
        reason = form.reason;
      }
      try {
        await api.post(`/bindings/${id}/review`, { decision, reason });
        toast(decision === "approve" ? "已通过" : "已拒绝");
        reload();
      } catch (error) {
        toastError(error);
      }
    }

    mount(
      container,
      card(
        "待审核",
        pending.length === 0
          ? emptyState("没有待审核的申请")
          : div(
              {},
              ...pending.map((item) =>
                div(
                  { class: "row" },
                  div(
                    { class: "row__main" },
                    div({ class: "row__title" }, `${item.guardianName} → ${item.studentName}`),
                    div({ class: "row__sub" }, `关系：${item.relation} · ${compactStamp(item.createdAt)}`),
                  ),
                  div(
                    { class: "btn-row" },
                    button({ class: "btn btn--sm btn--primary", onClick: () => void review(item.id, "approve") }, "通过"),
                    button({ class: "btn btn--sm btn--ghost", onClick: () => void review(item.id, "reject") }, "拒绝"),
                  ),
                ),
              ),
            ),
      ),
      card(
        "全部绑定关系",
        others.length === 0
          ? emptyState("暂无记录")
          : div(
              {},
              ...others.map((item) =>
                div(
                  { class: "row" },
                  div(
                    { class: "row__main" },
                    div({ class: "row__title" }, `${item.guardianName} → ${item.studentName}`),
                    div({ class: "row__sub" }, `${item.relation} · ${compactStamp(item.createdAt)}`),
                  ),
                  span(
                    { class: item.status === "已通过" ? "tag" : "tag tag--muted" },
                    item.status,
                  ),
                ),
              ),
            ),
      ),
    );
  },
});

definePage("admin.products", {
  title: "商品与库存",
  async render(container) {
    const products = await api.get<Product[]>("/products");

    async function upsert(product?: Product): Promise<void> {
      const form = await formSheet({
        title: product ? `编辑「${product.name}」` : "新增商品",
        fields: [
          { name: "name", label: "商品名", required: true, value: product?.name ?? "" },
          { name: "description", label: "说明", value: product?.description ?? "" },
          { name: "pointsCost", label: "积分价格", required: true, type: "number", value: String(product?.pointsCost ?? 20) },
          { name: "stock", label: "库存", required: true, type: "number", value: String(product?.stock ?? 10) },
          {
            name: "perStudentLimit",
            label: "每人限兑次数（0 = 不限）",
            type: "number",
            value: String(product?.perStudentLimit ?? 0),
          },
          {
            name: "status",
            label: "状态",
            type: "select",
            value: product?.status ?? "上架",
            options: ["上架", "下架", "草稿"].map((value) => ({ label: value, value })),
          },
        ],
      });
      if (!form) return;
      const payload = {
        name: form.name,
        description: form.description,
        pointsCost: Number(form.pointsCost),
        stock: Number(form.stock),
        perStudentLimit: Number(form.perStudentLimit || 0),
        status: form.status,
      };
      try {
        if (product) await api.patch(`/products/${product.id}`, payload);
        else await api.post("/products", payload);
        toast("已保存");
        reload();
      } catch (error) {
        toastError(error);
      }
    }

    mount(
      container,
      button(
        { class: "btn btn--primary btn--block", style: "margin-bottom:12px", onClick: () => void upsert() },
        "新增商品",
      ),
      ...products.map((product) =>
        card(
          div(
            { class: "spread", style: "width:100%" },
            div({}, product.name),
            span(
              { class: product.status === "上架" ? "tag" : "tag tag--muted" },
              product.status,
            ),
          ),
          div({ class: "row__sub" }, `${product.pointsCost} 分 · 库存 ${product.stock}${product.perStudentLimit ? ` · 限 ${product.perStudentLimit} 次` : ""}`),
          div(
            { class: "btn-row", style: "margin-top:10px" },
            button({ class: "btn btn--sm", onClick: () => void upsert(product) }, "编辑"),
            button(
              {
                class: "btn btn--sm",
                onClick: async () => {
                  const form = await formSheet({
                    title: `补库存 · ${product.name}`,
                    fields: [{ name: "stock", label: "调整为", type: "number", required: true, value: String(product.stock) }],
                  });
                  if (!form) return;
                  try {
                    await api.patch(`/products/${product.id}`, { stock: Number(form.stock) });
                    toast("已更新库存");
                    reload();
                  } catch (error) {
                    toastError(error);
                  }
                },
              },
              "改库存",
            ),
            button(
              {
                class: "btn btn--sm btn--ghost",
                onClick: async () => {
                  try {
                    await api.patch(`/products/${product.id}`, {
                      status: product.status === "上架" ? "下架" : "上架",
                    });
                    reload();
                  } catch (error) {
                    toastError(error);
                  }
                },
              },
              product.status === "上架" ? "下架" : "上架",
            ),
          ),
        ),
      ),
    );
  },
});

definePage("admin.redemptions", {
  title: "兑换记录",
  async render(container) {
    const redemptions = await api.get<Array<Redemption & { studentName: string }>>("/redemptions");
    mount(
      container,
      redemptions.length === 0
        ? emptyState("还没有兑换记录")
        : card(
            null,
            ...redemptions.map((item) =>
              div(
                { class: "row" },
                div(
                  { class: "row__main" },
                  div(
                    { class: item.status === "已撤销" ? "row__title is-reversed" : "row__title" },
                    `${item.studentName} · ${item.productSnapshot.name}`,
                  ),
                  div({ class: "row__sub" }, `${item.pointsCost} 分 · ${compactStamp(item.createdAt)}`),
                ),
                item.status === "已撤销"
                  ? span({ class: "tag tag--muted" }, "已撤销")
                  : can(PERMISSIONS.REDEMPTION_REVERSE)
                    ? button(
                        {
                          class: "btn btn--sm btn--ghost",
                          onClick: async () => {
                            const form = await formSheet({
                              title: "撤销兑换",
                              hint: "积分和库存都会退回，并留下冲正流水。",
                              fields: [{ name: "reason", label: "撤销原因", required: true, type: "textarea" }],
                              submitText: "确认撤销",
                            });
                            if (!form) return;
                            try {
                              await api.post(`/redemptions/${item.id}/reverse`, { reason: form.reason });
                              toast("已撤销");
                              reload();
                            } catch (error) {
                              toastError(error);
                            }
                          },
                        },
                        "撤销",
                      )
                    : span({ class: "tag" }, "已完成"),
              ),
            ),
          ),
    );
  },
});

definePage("admin.staff", {
  title: "老师账号",
  async render(container) {
    const staff = await api.get<
      Array<{ id: string; displayName: string; username: string | null; roles: string[]; status: string; permissions: string[] }>
    >("/staff");

    mount(
      container,
      button(
        {
          class: "btn btn--primary btn--block",
          style: "margin-bottom:12px",
          onClick: async () => {
            const form = await formSheet({
              title: "新增老师",
              fields: [
                { name: "displayName", label: "姓名", required: true },
                { name: "username", label: "登录名", required: true, hint: "至少 3 个字符" },
                { name: "password", label: "初始密码", required: true, type: "password", hint: "至少 6 位" },
              ],
            });
            if (!form) return;
            try {
              await api.post("/staff", form);
              toast("已创建");
              reload();
            } catch (error) {
              toastError(error);
            }
          },
        },
        "新增老师",
      ),
      ...staff.map((member) =>
        card(
          div(
            { class: "spread", style: "width:100%" },
            div({}, `${member.displayName}${member.username ? `（${member.username}）` : ""}`),
            span(
              { class: member.status === "active" ? "tag" : "tag tag--muted" },
              member.roles.includes("owner") ? "负责人" : "老师",
            ),
          ),
          div({ class: "row__sub" }, `${member.permissions.length} 项权限 · ${member.status === "active" ? "正常" : "已停用"}`),
          !member.roles.includes("owner")
            ? div(
                { class: "btn-row", style: "margin-top:10px" },
                button(
                  {
                    class: member.status === "active" ? "btn btn--sm btn--danger" : "btn btn--sm",
                    onClick: async () => {
                      const yes = await confirmDialog({
                        title: member.status === "active" ? "停用这个账号？" : "恢复这个账号？",
                        body:
                          member.status === "active"
                            ? "停用后该老师立刻失去所有管理权限，历史操作记录保留。"
                            : "恢复后可以重新登录。",
                        danger: member.status === "active",
                      });
                      if (!yes) return;
                      try {
                        await api.patch(`/staff/${member.id}`, {
                          status: member.status === "active" ? "disabled" : "active",
                        });
                        toast("已更新");
                        reload();
                      } catch (error) {
                        toastError(error);
                      }
                    },
                  },
                  member.status === "active" ? "停用" : "恢复",
                ),
                button(
                  {
                    class: "btn btn--sm",
                    onClick: async () => {
                      const form = await formSheet({
                        title: `重设 ${member.displayName} 的密码`,
                        fields: [{ name: "password", label: "新密码", required: true, type: "password" }],
                      });
                      if (!form) return;
                      try {
                        await api.patch(`/staff/${member.id}`, { password: form.password });
                        toast("已重设");
                      } catch (error) {
                        toastError(error);
                      }
                    },
                  },
                  "重设密码",
                ),
              )
            : p({ class: "card__hint", style: "margin-top:8px" }, "系统始终保留至少一名负责人，不能停用最后一名。"),
        ),
      ),
    );
  },
});

definePage("admin.audit", {
  title: "审计日志",
  async render(container) {
    const logs = await api.get<AuditLog[]>("/audit", { limit: "100" });
    mount(
      container,
      card(null, p({ class: "card__hint" }, "所有敏感操作都会留痕。日志只增不删，任何角色都没有删除入口。")),
      logs.length === 0
        ? emptyState("还没有记录")
        : card(
            null,
            ...logs.map((log) =>
              div(
                { class: "row" },
                div(
                  { class: "row__main" },
                  div({ class: "row__title" }, `${log.actorName} · ${log.action}`),
                  div({ class: "row__sub" }, `${log.target}${log.reason ? ` · ${log.reason}` : ""}`),
                ),
                span({ class: "text-small text-muted" }, compactStamp(log.createdAt)),
              ),
            ),
          ),
    );
  },
});

definePage("admin.settings", {
  title: "系统设置",
  async render(container) {
    const settings = await api.get<Record<string, unknown>>("/settings");

    function toggleRow(key: string, label: string, hint: string): HTMLElement {
      const on = Boolean(settings[key]);
      return div(
        { class: "row" },
        div({ class: "row__main" }, div({ class: "row__title" }, label), div({ class: "row__sub" }, hint)),
        div({
          class: on ? "switch is-on" : "switch",
          dataset: { setting: key },
          onClick: async () => {
            try {
              await api.patch("/settings", { [key]: !on });
              toast("已保存");
              reload();
            } catch (error) {
              toastError(error);
            }
          },
        }),
      );
    }

    function numberRow(key: string, label: string, hint: string): HTMLElement {
      return div(
        { class: "row" },
        div({ class: "row__main" }, div({ class: "row__title" }, label), div({ class: "row__sub" }, hint)),
        button(
          {
            class: "btn btn--sm",
            onClick: async () => {
              const form = await formSheet({
                title: label,
                fields: [{ name: "value", label, type: "number", required: true, value: String(settings[key] ?? 0) }],
              });
              if (!form) return;
              try {
                await api.patch("/settings", { [key]: Number(form.value) });
                toast("已保存");
                reload();
              } catch (error) {
                toastError(error);
              }
            },
          },
          String(settings[key] ?? "-"),
        ),
      );
    }

    mount(
      container,
      card(
        "绑定",
        toggleRow(
          SETTING_KEYS.BINDING_REQUIRES_REVIEW,
          "绑定码需要人工审核",
          "关闭时家长输码即绑定；开启后要负责人在「绑定审核」里通过",
        ),
      ),
      card(
        "积分",
        numberRow(SETTING_KEYS.HOMEWORK_DEFAULT_REWARD, "作业完成默认奖励", "结束作业时的默认发放分数"),
        numberRow(SETTING_KEYS.POINTS_ADJUST_THRESHOLD, "大额调整阈值", "超过这个分数的人工调整需要二次确认"),
      ),
      card(
        "商店与排行",
        numberRow(SETTING_KEYS.LOW_STOCK_THRESHOLD, "库存告警线", "库存低于这个数会在看板提示"),
        toggleRow(
          SETTING_KEYS.LEADERBOARD_SHOW_REAL_NAME,
          "家长端排行显示真实姓名",
          "默认关闭，家长端只看到昵称或脱敏姓名",
        ),
      ),
    );
  },
});

definePage("admin.reconcile", {
  title: "积分对账",
  async render(container) {
    const result = await api.get<{
      checked: number;
      mismatches: Array<{ studentId: string; name: string; cached: number; computed: number; diff: number }>;
      items: Array<{ studentId: string; name: string; cached: number; computed: number; diff: number }>;
    }>("/points/reconcile");

    mount(
      container,
      card(
        div(
          { class: "spread", style: "width:100%" },
          div({}, `已核对 ${result.checked} 名学员`),
          result.mismatches.length === 0
            ? span({ class: "tag" }, "全部一致")
            : span({ class: "tag tag--danger" }, `${result.mismatches.length} 处不一致`),
        ),
        p({ class: "card__hint" }, "只读核对：把缓存余额和流水重算结果逐个比对，发现差异只告警，不自动覆盖。"),
      ),
      result.mismatches.length > 0
        ? card(
            "差异明细",
            ...result.mismatches.map((item) =>
              div(
                { class: "row" },
                div(
                  { class: "row__main" },
                  div({ class: "row__title" }, item.name),
                  div({ class: "row__sub" }, `缓存 ${item.cached} · 流水 ${item.computed}`),
                ),
                div({ class: "row__value" }, `${item.diff > 0 ? "+" : ""}${item.diff}`),
              ),
            ),
          )
        : null,
      card(
        "全部学员",
        ...result.items.map((item) =>
          div(
            { class: "row" },
            div({ class: "row__main" }, div({ class: "row__title" }, item.name)),
            div({ class: "row__value" }, String(item.computed)),
          ),
        ),
      ),
    );
  },
});
