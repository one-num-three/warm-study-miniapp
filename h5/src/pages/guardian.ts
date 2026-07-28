/** 家长端四个 Tab 及其子页面。 */

import {
  compactStamp,
  newRequestId,
  normalizeBindingCode,
  toDateKey,
  validateBindingCode,
  type LeaderboardResponse,
  type PointLedgerEntry,
  type Product,
  type Profile,
  type Redemption,
  type WrongQuestion,
} from "@warm-study/shared";
import { api } from "../api.js";
import { button, card, div, el, icon, mount, p, span, strong } from "../dom.js";
import { ICONS } from "../icons.js";
import { definePage, navigateTo, reload } from "../router.js";
import {
  activeStudent,
  applyProfile,
  logout,
  refreshProfile,
  selectStudent,
  state,
  switchShell,
  isManagement,
} from "../state.js";
import { confirmDialog, emptyState, formSheet, toast, toastError } from "../ui.js";

/* ------------------------------- 公共小组件 ------------------------------- */

/** 孩子切换条。绑了多个孩子时才显示。 */
function studentPicker(): HTMLElement | null {
  const students = state.profile?.students ?? [];
  if (students.length <= 1) return null;
  const activeId = activeStudent()?.id;
  return div(
    { class: "picker" },
    ...students.map((student) =>
      button(
        {
          class: student.id === activeId ? "is-active" : "",
          onClick: () => {
            selectStudent(student.id);
            reload();
          },
        },
        student.nickname || student.name,
      ),
    ),
  );
}

/** 还没绑孩子时的引导。 */
function needBinding(): HTMLElement {
  return div(
    {},
    card(
      "还没有绑定孩子",
      p({ class: "card__hint" }, "向辅导班老师要一张写着绑定码的小卡片，输入后就能看到孩子在班里的情况。"),
      button(
        {
          class: "btn btn--primary btn--block",
          style: "margin-top:12px",
          onClick: () => navigateTo("guardian.bind"),
        },
        "去输绑定码",
      ),
    ),
    pendingBindingCard(),
  );
}

function pendingBindingCard(): HTMLElement | null {
  const pending = state.profile?.pendingBindings ?? [];
  if (pending.length === 0) return null;
  return card(
    "等待审核",
    ...pending.map((item) =>
      div(
        { class: "row" },
        div(
          { class: "row__main" },
          div({ class: "row__title" }, item.studentName),
          div({ class: "row__sub" }, `关系：${item.relation} · 提交于 ${compactStamp(item.createdAt)}`),
        ),
        span({ class: "tag tag--gold" }, "待审核"),
      ),
    ),
  );
}

const SESSION_TONE: Record<string, string> = {
  待到班: "tag--muted",
  已到班: "tag",
  辅导中: "tag tag--gold",
  待接: "tag tag--accent",
  已接走: "tag",
};

function statusTag(status: string): HTMLElement {
  return span({ class: SESSION_TONE[status] ?? "tag" }, status);
}

/* ---------------------------------- 今日 ---------------------------------- */

definePage("guardian.today", {
  title: "今日",
  tab: true,
  async render(container) {
    if ((state.profile?.students ?? []).length === 0) {
      mount(container, studentPicker(), needBinding());
      return;
    }
    const student = activeStudent()!;
    const [sheets, reminders, ledger] = await Promise.all([
      api.get<Array<Record<string, unknown>>>("/homework/sheets", { studentId: student.id }),
      api.get<Array<Record<string, unknown>>>("/reminders", { studentId: student.id }),
      api.get<{ entries: PointLedgerEntry[]; balance: number }>("/points/ledger", {
        studentId: student.id,
        limit: 5,
      }),
    ]);

    // 必须用 shared 的 toDateKey：直接 toISOString().slice(0,10) 拿的是 UTC 日期，
    // 北京时间 0-8 点会比服务端的 dateKey 少一天，家长早上交完作业首页仍显示"还没交"
    const today = toDateKey();
    const todaySheet = sheets.find((sheet) => sheet.dateKey === today);
    const latestReminder = reminders[0];

    mount(
      container,
      studentPicker(),
      div(
        { class: "hero" },
        p({ class: "hero__label" }, `${student.name}的积分余额`),
        strong({ class: "hero__value" }, String(ledger.balance)),
        div(
          { class: "hero__foot" },
          div({}, `年级 ${student.grade}`),
          div({}, `我是${student.relation}`),
        ),
      ),
      card(
        div({}, "今天在班里"),
        todaySheet
          ? div(
              { class: "row" },
              div(
                { class: "row__main" },
                div({ class: "row__title" }, "今日作业"),
                div({ class: "row__sub" }, `${(todaySheet.items as unknown[]).length} 项 · ${todaySheet.status}`),
              ),
              button(
                {
                  class: "btn btn--sm",
                  onClick: () => navigateTo("guardian.sheet", { id: String(todaySheet.id) }),
                },
                "查看",
              ),
            )
          : div(
              { class: "row" },
              div(
                { class: "row__main" },
                div({ class: "row__title" }, "今天还没交作业"),
                div({ class: "row__sub" }, "把今天要写的作业拍照或打字告诉老师"),
              ),
              button(
                { class: "btn btn--sm btn--primary", onClick: () => navigateTo("guardian.submit") },
                "去提交",
              ),
            ),
        latestReminder
          ? div(
              { class: "row" },
              div(
                { class: "row__main" },
                div({ class: "row__title" }, `预计 ${latestReminder.etaAt} 可以接走`),
                div({ class: "row__sub" }, `老师发送于 ${compactStamp(String(latestReminder.createdAt))}`),
              ),
              statusTag(String(latestReminder.status)),
            )
          : div(
              { class: "row" },
              div(
                { class: "row__main" },
                div({ class: "row__title" }, "还没有接娃提醒"),
                div({ class: "row__sub" }, "老师安排好时间会主动通知你，不用反复问"),
              ),
              icon(ICONS.bell, "tabbar__icon"),
            ),
      ),
      card(
        div(
          { class: "spread", style: "width:100%" },
          div({}, "最近积分"),
          button({ class: "btn btn--sm", onClick: () => navigateTo("guardian.ledger") }, "全部"),
        ),
        ledger.entries.length === 0
          ? emptyState("还没有积分记录")
          : div(
              {},
              ...ledger.entries.slice(0, 5).map(ledgerRow),
            ),
      ),
    );
  },
});

function ledgerRow(entry: PointLedgerEntry): HTMLElement {
  return div(
    { class: "row" },
    div(
      { class: "row__main" },
      div({ class: entry.reversed ? "row__title is-reversed" : "row__title" }, entry.reason),
      div({ class: "row__sub" }, `${entry.type} · ${compactStamp(entry.createdAt)}`),
    ),
    div(
      {
        class: `ledger__delta ${entry.delta > 0 ? "is-plus" : "is-minus"}${entry.reversed ? " is-reversed" : ""}`,
      },
      `${entry.delta > 0 ? "+" : ""}${entry.delta}`,
    ),
  );
}

/* ------------------------------- 绑定码页面 ------------------------------- */

definePage("guardian.bind", {
  title: "绑定孩子",
  async render(container) {
    const input = el("input", {
      class: "code-input",
      placeholder: "····-····",
      maxlength: 9,
      dataset: { role: "binding-code" },
    });
    const feedback = div({ style: "min-height:20px" });
    const relation = el("select", {});
    for (const item of ["妈妈", "爸爸", "爷爷", "奶奶", "外公", "外婆", "其他家长"]) {
      relation.appendChild(el("option", { value: item }, item));
    }
    const submit = button(
      { class: "btn btn--primary btn--block", dataset: { role: "bind-submit" } },
      "绑定",
    );

    input.addEventListener("input", () => {
      const raw = normalizeBindingCode(input.value).slice(0, 8);
      input.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
      input.classList.remove("is-valid", "is-invalid");
      if (raw.length < 8) {
        mount(feedback, raw.length ? p({ class: "field__hint" }, `还差 ${8 - raw.length} 位`) : null);
        return;
      }
      const check = validateBindingCode(raw);
      input.classList.add(check.ok ? "is-valid" : "is-invalid");
      mount(
        feedback,
        check.ok
          ? p({ class: "field__hint", style: "color:var(--c-success)" }, "格式正确")
          : p({ class: "field__error" }, "绑定码不正确，请核对"),
      );
    });

    submit.addEventListener("click", async () => {
      submit.disabled = true;
      try {
        const result = await api.post<{ status: string; student: { name: string }; profile: Profile }>(
          "/bindings/by-code",
          { bindingCode: normalizeBindingCode(input.value), relation: relation.value },
        );
        applyProfile(result.profile, "guardian");
        toast(result.status === "待审核" ? "已提交，等待负责人审核" : `已绑定 ${result.student.name}`);
      } catch (error) {
        submit.disabled = false;
        toastError(error);
      }
    });

    mount(
      container,
      card(
        "输入绑定码",
        p({ class: "card__hint" }, "绑定码由辅导班建立学员档案时生成，一人一码、固定不变。同一个码爸爸妈妈都能用。"),
        div({ style: "margin-top:12px" }, input),
        feedback,
        div({ class: "field", style: "margin-top:10px" }, el("label", { class: "field__label" }, "关系"), relation),
        submit,
      ),
    );
  },
});

/* ---------------------------------- 作业 ---------------------------------- */

definePage("guardian.homework", {
  title: "作业",
  tab: true,
  async render(container) {
    if ((state.profile?.students ?? []).length === 0) {
      mount(container, needBinding());
      return;
    }
    const student = activeStudent()!;
    const sheets = await api.get<Array<Record<string, unknown>>>("/homework/sheets", {
      studentId: student.id,
    });

    mount(
      container,
      studentPicker(),
      button(
        {
          class: "btn btn--primary btn--block",
          style: "margin-bottom:12px",
          onClick: () => navigateTo("guardian.submit"),
        },
        "提交今天的作业",
      ),
      sheets.length === 0
        ? emptyState("还没有作业记录")
        : div(
            {},
            ...sheets.map((sheet) =>
              card(
                div(
                  { class: "spread", style: "width:100%" },
                  div({}, String(sheet.dateKey)),
                  span({ class: "tag" }, String(sheet.status)),
                ),
                div(
                  { class: "row__sub" },
                  (sheet.items as Array<{ subject: string; status: string }>)
                    .map((item) => `${item.subject}（${item.status}）`)
                    .join("，"),
                ),
                sheet.feedback ? p({ class: "card__hint", style: "margin-top:8px" }, `老师反馈：${sheet.feedback}`) : null,
                button(
                  {
                    class: "btn btn--sm",
                    style: "margin-top:10px",
                    onClick: () => navigateTo("guardian.sheet", { id: String(sheet.id) }),
                  },
                  "查看详情",
                ),
              ),
            ),
          ),
    );
  },
});

definePage("guardian.submit", {
  title: "提交作业",
  async render(container) {
    const student = activeStudent();
    if (!student) {
      mount(container, needBinding());
      return;
    }

    const items: Array<{ subject: string; content: string; image?: string }> = [];
    const list = div({});

    function paintList(): void {
      mount(
        list,
        items.length === 0
          ? emptyState("还没有添加科目")
          : div(
              {},
              ...items.map((item, index) =>
                div(
                  { class: "row" },
                  item.image ? el("img", { class: "thumb thumb--sm", src: item.image }) : null,
                  div(
                    { class: "row__main" },
                    div({ class: "row__title" }, item.subject),
                    div({ class: "row__sub" }, item.content || "（没有补充说明）"),
                  ),
                  button(
                    {
                      class: "btn btn--sm btn--ghost",
                      onClick: () => {
                        items.splice(index, 1);
                        paintList();
                      },
                    },
                    "删除",
                  ),
                ),
              ),
            ),
      );
    }

    async function addItem(): Promise<void> {
      const result = await formSheet({
        title: "添加一项作业",
        fields: [
          {
            name: "subject",
            label: "科目",
            required: true,
            type: "select",
            options: ["语文", "数学", "英语", "科学", "其他"].map((value) => ({ label: value, value })),
          },
          { name: "content", label: "作业内容", type: "textarea", placeholder: "例如：抄写生字两遍、口算 30 题" },
          { name: "image", label: "作业照片（选填）", type: "image", hint: "拍一张作业本，老师看得更清楚" },
        ],
        submitText: "添加",
      });
      if (!result) return;
      items.push({
        subject: result.subject!,
        content: result.content ?? "",
        ...(result.image ? { image: result.image } : {}),
      });
      paintList();
    }

    const submit = button({ class: "btn btn--primary btn--block", dataset: { role: "submit-sheet" } }, "提交给老师");
    submit.addEventListener("click", async () => {
      if (items.length === 0) {
        toast("至少添加一项作业", "error");
        return;
      }
      submit.disabled = true;
      try {
        await api.post("/homework/sheets", { studentId: student.id, items });
        toast("已提交，老师会在班上处理");
        navigateTo("guardian.homework");
      } catch (error) {
        submit.disabled = false;
        toastError(error);
      }
    });

    paintList();
    mount(
      container,
      card(
        `${student.name} · ${toDateKey()}`,
        p({ class: "card__hint" }, "按科目一项一项加，老师会逐项标记进度。作业开始辅导后就不能再改了。"),
      ),
      card("今天的作业", list),
      button(
        { class: "btn btn--block", style: "margin-bottom:10px", onClick: () => void addItem() },
        "添加一项",
      ),
      submit,
    );
  },
});

definePage("guardian.sheet", {
  title: "作业详情",
  async render(container, params) {
    const sheet = await api.get<Record<string, unknown>>(`/homework/sheets/${params.id}`);
    const items = sheet.items as Array<Record<string, unknown>>;
    const canWithdraw = sheet.status === "待确认" || sheet.status === "需要补充";

    mount(
      container,
      card(
        div(
          { class: "spread", style: "width:100%" },
          div({}, `${sheet.dateKey} · ${sheet.studentName}`),
          span({ class: "tag" }, String(sheet.status)),
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
            span({ class: "tag tag--muted" }, String(item.status)),
          ),
        ),
      ),
      sheet.feedback
        ? card("老师反馈", p({ class: "card__hint" }, String(sheet.feedback)))
        : null,
      sheet.unfinishedReason
        ? card("未完成原因", p({ class: "card__hint" }, String(sheet.unfinishedReason)))
        : null,
      canWithdraw
        ? button(
            {
              class: "btn btn--ghost btn--block",
              onClick: async () => {
                const yes = await confirmDialog({
                  title: "撤回这份作业？",
                  body: "撤回后可以重新提交今天的作业。",
                });
                if (!yes) return;
                try {
                  await api.post(`/homework/sheets/${params.id}/transition`, { to: "已撤回" });
                  toast("已撤回");
                  navigateTo("guardian.homework");
                } catch (error) {
                  toastError(error);
                }
              },
            },
            "撤回作业",
          )
        : null,
    );
  },
});

/* ---------------------------------- 成长 ---------------------------------- */

definePage("guardian.growth", {
  title: "成长",
  tab: true,
  async render(container) {
    if ((state.profile?.students ?? []).length === 0) {
      mount(container, needBinding());
      return;
    }
    const student = activeStudent()!;
    const [board, ledger] = await Promise.all([
      api.get<LeaderboardResponse>("/leaderboard", { period: "week", limit: 10 }),
      api.get<{ entries: PointLedgerEntry[]; balance: number }>("/points/ledger", {
        studentId: student.id,
        limit: 8,
      }),
    ]);

    mount(
      container,
      studentPicker(),
      div(
        { class: "hero" },
        p({ class: "hero__label" }, "当前积分"),
        strong({ class: "hero__value" }, String(ledger.balance)),
        div(
          { class: "hero__foot" },
          div({}, `本周排名 ${board.rows.find((row) => row.isSelf)?.rank ?? "—"}`),
          div({}, "花积分不会掉排名"),
        ),
      ),
      div(
        { class: "grid grid--3", style: "margin-bottom:12px" },
        button({ class: "metric", onClick: () => navigateTo("guardian.ledger") }, strong({}, "流水"), span({}, "积分明细")),
        button({ class: "metric", onClick: () => navigateTo("guardian.store") }, strong({}, "商城"), span({}, "看看能换啥")),
        button({ class: "metric", onClick: () => navigateTo("guardian.mistakes") }, strong({}, "错题"), span({}, "错题本")),
      ),
      card(
        div(
          { class: "spread", style: "width:100%" },
          div({}, "本周排行榜"),
          span({ class: "text-small text-muted" }, board.range ? `${board.range.start} 起` : ""),
        ),
        board.rows.length === 0
          ? emptyState("本周还没有人上榜")
          : div(
              {},
              ...board.rows.map((row) =>
                div(
                  {
                    class: `rank rank--top${row.rank <= 3 ? row.rank : ""}${row.isSelf ? " is-self" : ""}`,
                  },
                  div({ class: "rank__no" }, String(row.rank)),
                  div({ class: "row__main" }, div({ class: "row__title" }, row.displayName)),
                  div({ class: "row__value" }, String(row.score)),
                ),
              ),
            ),
      ),
      card(
        div({}, "最近变动"),
        ledger.entries.length === 0 ? emptyState("还没有积分记录") : div({}, ...ledger.entries.map(ledgerRow)),
      ),
    );
  },
});

definePage("guardian.ledger", {
  title: "积分流水",
  async render(container) {
    const student = activeStudent()!;
    const ledger = await api.get<{ entries: PointLedgerEntry[]; balance: number; computedBalance: number }>(
      "/points/ledger",
      { studentId: student.id, limit: 200 },
    );
    mount(
      container,
      card(
        div(
          { class: "spread", style: "width:100%" },
          div({}, `${student.name} 当前 ${ledger.balance} 分`),
          ledger.balance === ledger.computedBalance
            ? span({ class: "tag" }, "账目一致")
            : span({ class: "tag tag--danger" }, "账目异常"),
        ),
        p({ class: "card__hint" }, "余额由每一笔流水累加得到，任何人都不能直接改余额。"),
      ),
      ledger.entries.length === 0
        ? emptyState("还没有积分记录")
        : card(null, ...ledger.entries.map(ledgerRow)),
    );
  },
});

definePage("guardian.store", {
  title: "积分商城",
  async render(container) {
    const student = activeStudent()!;
    const [products, redemptions, ledger] = await Promise.all([
      api.get<Product[]>("/products"),
      api.get<Array<Redemption & { studentName: string }>>("/redemptions", { studentId: student.id }),
      api.get<{ balance: number }>("/points/ledger", { studentId: student.id, limit: 1 }),
    ]);

    mount(
      container,
      card(
        div(
          { class: "spread", style: "width:100%" },
          div({}, `${student.name} 现有 ${ledger.balance} 分`),
        ),
        p({ class: "card__hint" }, "兑换要到辅导班现场找老师办理，家长端不能自助扣分 —— 避免误操作。"),
      ),
      div(
        { class: "section-title" },
        div({}, "可兑换商品"),
      ),
      products.length === 0
        ? emptyState("暂时没有上架商品")
        : div(
            {},
            ...products.map((product) =>
              card(
                div(
                  { class: "spread", style: "width:100%" },
                  div({}, product.name),
                  span(
                    { class: product.stock > 0 ? "tag" : "tag tag--muted" },
                    product.stock > 0 ? `库存 ${product.stock}` : "已兑完",
                  ),
                ),
                p({ class: "card__hint" }, product.description ?? ""),
                div(
                  { class: "spread", style: "margin-top:8px" },
                  strong({ style: "color:var(--c-accent);font-size:18px" }, `${product.pointsCost} 分`),
                  product.perStudentLimit > 0
                    ? span({ class: "tag tag--gold" }, `每人限 ${product.perStudentLimit} 次`)
                    : null,
                ),
              ),
            ),
          ),
      div({ class: "section-title" }, div({}, "兑换记录")),
      redemptions.length === 0
        ? emptyState("还没有兑换过")
        : card(
            null,
            ...redemptions.map((item) =>
              div(
                { class: "row" },
                div(
                  { class: "row__main" },
                  div(
                    { class: item.status === "已撤销" ? "row__title is-reversed" : "row__title" },
                    item.productSnapshot.name,
                  ),
                  div({ class: "row__sub" }, compactStamp(item.createdAt)),
                ),
                span(
                  { class: item.status === "已撤销" ? "tag tag--muted" : "tag tag--accent" },
                  item.status === "已撤销" ? "已撤销" : `-${item.pointsCost}`,
                ),
              ),
            ),
          ),
    );
  },
});

definePage("guardian.mistakes", {
  title: "错题本",
  async render(container) {
    const student = activeStudent()!;
    const questions = await api.get<Array<WrongQuestion & { studentName: string }>>("/wrong-questions", {
      studentId: student.id,
    });

    async function addQuestion(): Promise<void> {
      const result = await formSheet({
        title: "记一道错题",
        fields: [
          {
            name: "subject",
            label: "科目",
            required: true,
            type: "select",
            options: ["语文", "数学", "英语", "科学", "其他"].map((value) => ({ label: value, value })),
          },
          { name: "knowledge", label: "知识点", required: true, placeholder: "例如：两位数进位加法" },
          { name: "reason", label: "错因", type: "textarea", placeholder: "为什么错了" },
          { name: "answer", label: "正确答案", type: "textarea" },
          { name: "image", label: "题目照片", type: "image" },
        ],
        submitText: "保存",
      });
      if (!result) return;
      try {
        await api.post("/wrong-questions", { studentId: student.id, ...result });
        toast("已记录");
        reload();
      } catch (error) {
        toastError(error);
      }
    }

    mount(
      container,
      button(
        { class: "btn btn--primary btn--block", style: "margin-bottom:12px", onClick: () => void addQuestion() },
        "记一道错题",
      ),
      questions.length === 0
        ? emptyState("还没有错题记录")
        : div(
            {},
            ...questions.map((question) =>
              card(
                div(
                  { class: "spread", style: "width:100%" },
                  div({}, `${question.subject} · ${question.knowledge}`),
                  span(
                    {
                      class:
                        question.status === "已掌握"
                          ? "tag"
                          : question.status === "已订正"
                            ? "tag tag--gold"
                            : "tag tag--accent",
                    },
                    question.status,
                  ),
                ),
                question.reason ? p({ class: "card__hint" }, `错因：${question.reason}`) : null,
                question.answer ? p({ class: "card__hint" }, `正确答案：${question.answer}`) : null,
                question.image ? el("img", { class: "thumb", src: question.image }) : null,
                div(
                  { class: "btn-row", style: "margin-top:10px" },
                  ...nextMistakeActions(question),
                ),
              ),
            ),
          ),
    );
  },
});

function nextMistakeActions(question: WrongQuestion): HTMLElement[] {
  const transitions: Record<string, Array<{ to: string; label: string }>> = {
    待订正: [{ to: "已订正", label: "标记已订正" }],
    已订正: [
      { to: "已掌握", label: "已经掌握了" },
      { to: "待订正", label: "订正得不对" },
    ],
    已掌握: [{ to: "待订正", label: "复测又错了" }],
  };
  return (transitions[question.status] ?? []).map((action) =>
    button(
      {
        class: "btn btn--sm",
        onClick: async () => {
          try {
            await api.post(`/wrong-questions/${question.id}/transition`, { to: action.to });
            toast("已更新");
            reload();
          } catch (error) {
            toastError(error);
          }
        },
      },
      action.label,
    ),
  );
}

/* ---------------------------------- 我的 ---------------------------------- */

definePage("guardian.me", {
  title: "我的",
  tab: true,
  async render(container) {
    // silent：渲染过程中不能广播状态变化，否则会把自己再触发一遍，无限循环
    await refreshProfile({ silent: true });
    const profile = state.profile!;

    mount(
      container,
      card(
        null,
        div(
          { class: "row" },
          div({ class: "avatar" }, profile.displayName.slice(0, 1)),
          div(
            { class: "row__main" },
            div({ class: "row__title" }, profile.displayName),
            div({ class: "row__sub" }, `已绑定 ${profile.students.length} 个孩子`),
          ),
        ),
      ),
      card(
        div(
          { class: "spread", style: "width:100%" },
          div({}, "我的孩子"),
          button({ class: "btn btn--sm", onClick: () => navigateTo("guardian.bind") }, "再绑一个"),
        ),
        profile.students.length === 0
          ? emptyState("还没有绑定孩子")
          : div(
              {},
              ...profile.students.map((student) =>
                div(
                  { class: "row" },
                  div({ class: "avatar avatar--accent" }, student.name.slice(0, 1)),
                  div(
                    { class: "row__main" },
                    div({ class: "row__title" }, `${student.name}（${student.nickname || "无昵称"}）`),
                    div({ class: "row__sub" }, `${student.grade} · 我是${student.relation}`),
                  ),
                  div({ class: "row__value" }, `${student.pointBalance} 分`),
                ),
              ),
            ),
      ),
      pendingBindingCard(),
      isManagement(profile)
        ? card(
            "身份",
            p({ class: "card__hint" }, "你同时拥有管理端身份。两边数据不混在一起，需要时显式切换。"),
            button(
              {
                class: "btn btn--primary btn--block",
                style: "margin-top:10px",
                onClick: () => switchShell("admin"),
              },
              "切换到管理工作台",
            ),
          )
        : null,
      card(
        "关于",
        p({ class: "card__hint" }, "暖芽辅导班 · 家长端。绑定码由辅导班生成，一人一码、固定不变。"),
        button(
          {
            class: "btn btn--ghost btn--block",
            style: "margin-top:10px",
            onClick: async () => {
              const yes = await confirmDialog({ title: "退出登录？", body: "退出后需要重新输入绑定码。", danger: true });
              if (yes) await logout();
            },
          },
          "退出登录",
        ),
      ),
    );
  },
});

export { newRequestId };
