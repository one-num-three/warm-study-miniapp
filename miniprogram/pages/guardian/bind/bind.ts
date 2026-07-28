/**
 * 绑定孩子 —— 已经登录的家长再绑一个孩子（入口在「我的」→「再绑一个」）。
 *
 * 和登录页共用同一套绑定码三层体验，一层都不能省：
 *  1. 边输边归一化 —— 自动大写、第 5 位补短横，把手抄最容易错的 O→0 / I、L→1 纠回来；
 *  2. 输满 8 位先在本地验校验位 —— 抄错一位当场红框，不浪费一次网络往返；
 *  3. 校验位过了再去服务端要一次脱敏姓名 —— 让家长确认绑的是自家娃再提交。
 *     二胎家庭两张纸条长得一模一样，这一层省不得。
 */

import { api, toast, toastError, ApiError } from "../../../utils/api";
import { normalizeBindingCode, validateBindingCode } from "../../../shared/binding-code.js";

const RELATIONS = ["妈妈", "爸爸", "爷爷", "奶奶", "外公", "外婆", "其他家长"];

/** 预览请求的防抖计时器。它和页面数据无关，没必要进 setData。 */
let previewTimer = 0;

Page({
  data: {
    loading: true,
    error: "",

    /* -------- 绑定码 -------- */
    /** 带短横的展示值：XXXX-XXXX */
    codeDisplay: "",
    /** 归一化后的 8 位规范码，提交时用它 */
    codeNormalized: "",
    codeClass: "code-input",
    /** 灰字：还差几位 */
    codeHint: "",
    /** 绿字：格式正确 */
    codeOk: "",
    /** 红字：校验位不对 / 码不存在 */
    codeError: "",
    /** 服务端回的脱敏预览："小*  ·  三年级" */
    preview: null as { studentHint: string; grade: string } | null,

    /* -------- 关系 -------- */
    relations: RELATIONS,
    relation: RELATIONS[0],

    /* -------- 提交按钮 -------- */
    canBind: false,
    binding: false,
    /** 按钮的样式和文案在 WXML 里算不了，统一在 syncButton 里合成 */
    bindClass: "btn btn--primary btn--block is-disabled",
    bindText: "绑定",
  },

  async onLoad() {
    await getApp<any>().ready();
    await this.load();
  },

  /**
   * 这一页没有列表要拉，load 只确认「身份已经建好」——
   * /bindings/preview 和 /bindings/by-code 都要登录态，没身份的话输得再对也提交不了。
   */
  async load() {
    const app = getApp<any>();
    this.setData({ loading: true, error: "" });
    try {
      if (!app.globalData.profile) {
        // 静默登录当时失败了（后端没起 / 没配合法域名），这里重跑一次
        app.readyPromise = null;
        await app.ready();
      }
      if (!app.globalData.profile) {
        throw new ApiError("UNAUTHENTICATED", app.globalData.bootError || "还没有登录，请退出小程序重新进入", 0);
      }
      this.setData({ loading: false });
    } catch (error: any) {
      this.setData({
        loading: false,
        error: error && error.message ? error.message : "加载失败，请稍后重试",
      });
      toastError(error);
    }
  },

  /* -------------------------------- 绑定码输入 -------------------------------- */

  onCodeInput(event: any) {
    const raw = normalizeBindingCode(event.detail.value).slice(0, 8);
    // 第 5 位起补短横，视觉上分成两组，和纸条上的印刷形式一致
    const display = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;

    if (previewTimer) clearTimeout(previewTimer);

    const base = {
      codeDisplay: display,
      codeNormalized: raw,
      preview: null,
      codeOk: "",
      codeError: "",
      canBind: false,
    };

    if (raw.length === 0) {
      this.syncButton({ ...base, codeClass: "code-input", codeHint: "" });
      return;
    }
    if (raw.length < 8) {
      this.syncButton({ ...base, codeClass: "code-input", codeHint: `还差 ${8 - raw.length} 位` });
      return;
    }

    // 第二层：本地校验位。错了当场说，不发请求
    const check = validateBindingCode(raw);
    if (!check.ok) {
      this.syncButton({
        ...base,
        codeClass: "code-input is-invalid",
        codeHint: "",
        codeError: "绑定码不正确，请核对",
      });
      return;
    }

    // 第三层：格式过了，去服务端要脱敏预览。防抖 180ms —— 家长手输最后一位常有回删
    this.syncButton({
      ...base,
      codeClass: "code-input is-valid",
      codeHint: "",
      codeOk: "格式正确",
      canBind: true,
    });
    previewTimer = setTimeout(() => {
      void this.loadPreview(raw);
    }, 180);
  },

  async loadPreview(code: string) {
    try {
      const preview = await api.get<any>("/bindings/preview", { code });
      // 用户可能已经改了输入，过期的响应直接丢掉
      if (this.data.codeNormalized !== code) return;

      if (!preview.valid) {
        this.syncButton({
          codeClass: "code-input is-invalid",
          codeOk: "",
          codeError: "这个绑定码不存在，请向辅导班老师确认",
          preview: null,
          canBind: false,
        });
        return;
      }
      // 找到了就用预览卡片替掉「格式正确」，一行只说一件事
      this.syncButton({
        codeOk: "",
        codeError: "",
        preview: { studentHint: preview.studentHint ?? "", grade: preview.grade ?? "" },
        canBind: true,
      });
    } catch (error) {
      // 预览只是锦上添花：它挂了也让家长照常提交，由服务端给准确结论
      if (this.data.codeNormalized === code) this.syncButton({ canBind: true });
    }
  },

  onRelationChange(event: any) {
    this.setData({ relation: RELATIONS[Number(event.detail.value)] });
  },

  /* --------------------------------- 提交绑定 --------------------------------- */

  async onBind() {
    if (!this.data.canBind || this.data.binding) return;
    const app = getApp<any>();
    this.syncButton({ binding: true });
    try {
      const result = await api.post<any>("/bindings/by-code", {
        bindingCode: this.data.codeNormalized,
        relation: this.data.relation,
      });
      // 绑定会改变「我的孩子」，档案要立刻换掉，否则退回上一页还是旧的
      app.applyProfile(result.profile, "guardian");
      toast(result.status === "待审核" ? "已提交，等待负责人审核" : `已绑定 ${result.student.name}`);
      // 等 toast 露个脸再退，否则用户看不到反馈
      setTimeout(() => {
        if (getCurrentPages().length > 1) wx.navigateBack();
        else app.enterShell();
      }, 900);
    } catch (error) {
      // 失败要让按钮重新可点：绑定码没错的话再点一次就成了
      this.syncButton({ binding: false });
      toastError(error);
    }
  },

  /** 按钮的禁用态和文案都由 canBind / binding 推出来，WXML 里算不了，只能在这里合成。 */
  syncButton(this: any, patch: any) {
    const next = { ...this.data, ...patch };
    this.setData({
      ...patch,
      bindClass: next.canBind && !next.binding
        ? "btn btn--primary btn--block"
        : "btn btn--primary btn--block is-disabled",
      bindText: next.binding ? "绑定中…" : "绑定",
    });
  },
});
