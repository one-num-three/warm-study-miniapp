/**
 * 登录页 —— 整个产品的入口。
 *
 * 家长：输入辅导班给的绑定码，输完即和孩子绑定，不需要注册、不需要密码。
 * 管理端：老师/负责人用账号密码登录。
 *
 * 绑定码输入做了三层体验：
 *  1. 边输边归一化（自动大写、自动补短横、自动纠正 O→0 / I、L→1）；
 *  2. 输满 8 位本地先校验校验位，错了当场提示，不浪费一次网络请求；
 *  3. 校验位过了再向服务端要一次"脱敏姓名预览"，让家长确认绑的是自家娃。
 */

import {
  formatBindingCode,
  normalizeBindingCode,
  validateBindingCode,
  type Profile,
} from "@warm-study/shared";
import { api, ApiError, deviceId, getToken, setToken } from "../api.js";
import { button, div, el, mount, p, span } from "../dom.js";
import { applyProfile, state } from "../state.js";
import { toast, toastError } from "../ui.js";

type Mode = "guardian" | "staff";

let mode: Mode = "guardian";

export function renderLogin(): HTMLElement {
  const container = div({ class: "login" });
  paint(container);
  return container;
}

function paint(container: HTMLElement): void {
  mount(
    container,
    div(
      { class: "login__brand" },
      div({ class: "login__mark" }, "芽"),
      el("h1", {}, "暖芽辅导班"),
      p({}, mode === "guardian" ? "输入辅导班给的绑定码，就能看到孩子的每一天" : "老师与负责人入口"),
    ),
    mode === "guardian" ? guardianCard(container) : staffCard(container),
    div(
      { class: "login__switch" },
      button(
        {
          class: mode === "guardian" ? "is-active" : "",
          dataset: { role: "tab-guardian" },
          onClick: () => {
            mode = "guardian";
            paint(container);
          },
        },
        "我是家长",
      ),
      button(
        {
          class: mode === "staff" ? "is-active" : "",
          dataset: { role: "tab-staff" },
          onClick: () => {
            mode = "staff";
            paint(container);
          },
        },
        "老师 / 负责人",
      ),
    ),
    p(
      { class: "card__hint", style: "margin-top:18px;text-align:center" },
      "绑定码由辅导班在建立学员档案时生成，一人一码、固定不变。",
    ),
  );
}

/* ------------------------------ 家长：绑定码 ------------------------------ */

function guardianCard(container: HTMLElement): HTMLElement {
  const card = div({ class: "login__card" });

  const input = el("input", {
    class: "code-input",
    placeholder: "····-····",
    maxlength: 9, // 8 位 + 一个短横
    autocomplete: "off",
    dataset: { role: "binding-code" },
  });

  const feedback = div({ style: "min-height:22px" });
  const previewBox = div({});
  const submit = button(
    { class: "btn btn--primary btn--block", style: "margin-top:14px", dataset: { role: "bind-submit" } },
    "绑定孩子",
  );
  submit.disabled = true;

  let previewTimer: number | undefined;

  const relationSelect = el("select", { dataset: { role: "relation" } });
  for (const relation of ["妈妈", "爸爸", "爷爷", "奶奶", "外公", "外婆", "其他家长"]) {
    relationSelect.appendChild(el("option", { value: relation }, relation));
  }

  const nameInput = el("input", {
    placeholder: "老师这样称呼你，例如「小满妈妈」",
    maxlength: 20,
    dataset: { role: "guardian-name" },
  });

  function setFeedback(text: string, tone: "ok" | "error" | "muted"): void {
    mount(
      feedback,
      p(
        {
          class: tone === "error" ? "field__error" : "field__hint",
          style: tone === "ok" ? "color:var(--c-success);font-weight:600" : "",
        },
        text,
      ),
    );
  }

  input.addEventListener("input", () => {
    const raw = normalizeBindingCode(input.value);
    const capped = raw.slice(0, 8);
    // 输到第 5 位自动补短横，视觉上分成两组
    input.value = capped.length > 4 ? `${capped.slice(0, 4)}-${capped.slice(4)}` : capped;
    input.classList.remove("is-valid", "is-invalid");
    mount(previewBox);
    submit.disabled = true;
    window.clearTimeout(previewTimer);

    if (capped.length === 0) {
      mount(feedback);
      return;
    }
    if (capped.length < 8) {
      setFeedback(`还差 ${8 - capped.length} 位`, "muted");
      return;
    }

    const check = validateBindingCode(capped);
    if (!check.ok) {
      input.classList.add("is-invalid");
      setFeedback(
        check.reason === "charset"
          ? "绑定码里不会出现 I、L、O、U，请再核对一下"
          : "绑定码不正确，请检查是否输错",
        "error",
      );
      return;
    }

    input.classList.add("is-valid");
    setFeedback("格式正确，正在核对…", "muted");
    previewTimer = window.setTimeout(() => void loadPreview(capped), 180);
  });

  async function loadPreview(code: string, retried = false): Promise<void> {
    try {
      const preview = await api.get<{ valid: boolean; studentHint?: string; grade?: string }>(
        "/bindings/preview",
        { code },
      );
      if (normalizeBindingCode(input.value) !== code) return; // 输入已经变了
      if (!preview.valid) {
        input.classList.remove("is-valid");
        input.classList.add("is-invalid");
        setFeedback("这个绑定码不存在，请向辅导班老师确认", "error");
        return;
      }
      mount(feedback);
      mount(
        previewBox,
        div(
          { class: "code-preview", dataset: { role: "bind-preview" } },
          span({ class: "tag" }, "已找到"),
          div({}, `${preview.studentHint ?? ""} · ${preview.grade ?? ""}`),
        ),
      );
      submit.disabled = false;
    } catch (error) {
      if (error instanceof ApiError && error.code === "UNAUTHENTICATED" && !retried) {
        // 游客身份还没建好：重建一次再试。retried 标志保证最多重试一次，
        // 不会因为服务端持续 401 而无限打请求。
        await ensureGuestIdentity();
        void loadPreview(code, true);
        return;
      }
      // 预览失败不阻断绑定，让用户直接提交，由服务端给准确结论
      mount(feedback);
      submit.disabled = false;
    }
  }

  submit.addEventListener("click", () => {
    void doBind();
  });
  input.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter" && !submit.disabled) void doBind();
  });

  async function doBind(): Promise<void> {
    const code = normalizeBindingCode(input.value);
    submit.disabled = true;
    submit.textContent = "绑定中…";
    try {
      await ensureGuestIdentity();
      const result = await api.post<{
        status: "已通过" | "待审核";
        student: { name: string };
        profile: Profile;
      }>("/bindings/by-code", {
        bindingCode: code,
        relation: relationSelect.value,
        guardianName: nameInput.value.trim() || undefined,
      });
      if (result.status === "待审核") {
        applyProfile(result.profile, "guardian");
        toast("绑定申请已提交，等负责人通过后就能看到孩子的数据", "info", 3000);
      } else {
        applyProfile(result.profile, "guardian");
        toast(`已绑定 ${result.student.name}`);
      }
    } catch (error) {
      submit.disabled = false;
      submit.textContent = "绑定孩子";
      if (error instanceof ApiError && error.code === "BINDING_ALREADY_EXISTS") {
        // 已经绑过了，直接进去
        try {
          const profile = await api.get<Profile>("/auth/profile");
          applyProfile(profile, "guardian");
          toast("你已经绑定过这个孩子了");
          return;
        } catch {
          /* 落到下面的统一提示 */
        }
      }
      toastError(error);
    }
  }

  mount(
    card,
    div(
      { class: "field" },
      el("label", { class: "field__label" }, "孩子的绑定码"),
      input,
      feedback,
      previewBox,
    ),
    div(
      { class: "field" },
      el("label", { class: "field__label" }, "你和孩子的关系"),
      relationSelect,
    ),
    div(
      { class: "field" },
      el("label", { class: "field__label" }, "你的称呼（选填）"),
      nameInput,
    ),
    submit,
    alreadyBoundHint(container),
  );

  return card;
}

/** 已经绑过孩子却又回到登录页时，给一个直接进入的入口。 */
function alreadyBoundHint(container: HTMLElement): HTMLElement | null {
  const students = state.profile?.students ?? [];
  if (students.length === 0) return null;
  return div(
    { style: "margin-top:14px" },
    div({ class: "divider" }),
    p({ class: "card__hint" }, `你已绑定：${students.map((s) => s.name).join("、")}`),
    button(
      {
        class: "btn btn--block",
        style: "margin-top:8px",
        onClick: () => {
          if (state.profile) applyProfile(state.profile, "guardian");
          mount(container);
        },
      },
      "直接进入家长端",
    ),
  );
}

/**
 * 保证当前有一个可用的（游客）家长身份，绑定码接口需要登录态。
 *
 * 判断依据必须是 **token** 而不是 state.profile：
 * 接口收到 401 时只会清掉 token，state.profile 还留着，
 * 用 profile 判断的话这里会直接 return，调用方拿到的仍是没有登录态的状态，
 * 于是"401 → 重建身份 → 再 401"永远循环下去。
 */
async function ensureGuestIdentity(): Promise<void> {
  if (getToken()) return;
  const result = await api.post<{ token: string; profile: Profile }>("/auth/login", {
    loginType: "device",
    code: deviceId(),
  });
  setToken(result.token);
  state.profile = result.profile;
}

/* ------------------------------ 管理端：账密 ------------------------------ */

function staffCard(container: HTMLElement): HTMLElement {
  const username = el("input", {
    placeholder: "登录名",
    autocomplete: "username",
    dataset: { role: "staff-username" },
  });
  const password = el("input", {
    type: "password",
    placeholder: "密码",
    autocomplete: "current-password",
    dataset: { role: "staff-password" },
  });
  const submit = button(
    { class: "btn btn--primary btn--block", dataset: { role: "staff-submit" } },
    "登录管理端",
  );

  async function doLogin(): Promise<void> {
    if (!username.value.trim() || !password.value) {
      toast("请填写登录名和密码", "error");
      return;
    }
    submit.disabled = true;
    submit.textContent = "登录中…";
    try {
      const result = await api.post<{ token: string; profile: Profile }>("/auth/staff-login", {
        username: username.value.trim(),
        password: password.value,
      });
      setToken(result.token);
      applyProfile(result.profile, "admin");
      toast(`欢迎回来，${result.profile.displayName}`);
    } catch (error) {
      submit.disabled = false;
      submit.textContent = "登录管理端";
      toastError(error);
    }
  }

  submit.addEventListener("click", () => void doLogin());
  password.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") void doLogin();
  });

  const card = div({ class: "login__card" });
  mount(
    card,
    div({ class: "field" }, el("label", { class: "field__label" }, "登录名"), username),
    div({ class: "field" }, el("label", { class: "field__label" }, "密码"), password),
    submit,
    div({ class: "divider" }),
    p(
      { class: "card__hint" },
      "演示账号：负责人 owner / warm2026，老师 teacher / warm2026",
    ),
    button(
      {
        class: "btn btn--sm",
        style: "margin-top:8px",
        onClick: () => {
          username.value = "owner";
          password.value = "warm2026";
          void doLogin();
        },
      },
      "用负责人账号快速登录",
    ),
  );
  void container;
  return card;
}

export { formatBindingCode };
