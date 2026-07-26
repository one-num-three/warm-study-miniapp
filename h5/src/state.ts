/** 全局状态。登录态、当前身份、当前选中的孩子都放这里。 */

import type { Profile } from "@warm-study/shared";
import { api, deviceId, setToken, getToken } from "./api.js";

export type Shell = "login" | "guardian" | "admin";

export interface AppState {
  profile: Profile | null;
  /** 双身份用户在「我的」里显式切换，不自动混合数据（design §1.1） */
  shell: Shell;
  /** 家长端当前查看的孩子 */
  activeStudentId: string | null;
  ready: boolean;
}

export const state: AppState = {
  profile: null,
  shell: "login",
  activeStudentId: null,
  ready: false,
};

const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify(): void {
  for (const listener of listeners) listener();
}

export function isManagement(profile: Profile | null = state.profile): boolean {
  return Boolean(profile && (profile.roles.includes("owner") || profile.roles.includes("staff")));
}

export function isOwner(profile: Profile | null = state.profile): boolean {
  return Boolean(profile?.roles.includes("owner"));
}

export function can(permission: string): boolean {
  return Boolean(state.profile?.permissions.includes(permission));
}

/** 当前选中的孩子；没显式选过就用第一个。 */
export function activeStudent() {
  const students = state.profile?.students ?? [];
  if (students.length === 0) return null;
  return students.find((item) => item.id === state.activeStudentId) ?? students[0]!;
}

export function selectStudent(studentId: string): void {
  state.activeStudentId = studentId;
  notify();
}

function shellFor(profile: Profile): Shell {
  // 管理端身份优先进管理工作台，家长可以在「我的」里切回去
  return isManagement(profile) ? "admin" : "guardian";
}

export function applyProfile(profile: Profile, shell?: Shell): void {
  state.profile = profile;
  state.shell = shell ?? shellFor(profile);
  if (!state.activeStudentId && profile.students.length > 0) {
    state.activeStudentId = profile.students[0]!.id;
  }
  notify();
}

export function switchShell(shell: Shell): void {
  state.shell = shell;
  notify();
}

/** 启动时静默恢复登录态：有 token 就拉档案，没有就用设备身份自动登一次。 */
export async function bootstrap(): Promise<void> {
  try {
    if (getToken()) {
      const profile = await api.get<Profile>("/auth/profile");
      applyProfile(profile);
      state.ready = true;
      notify();
      return;
    }
  } catch {
    setToken(null);
  }

  try {
    // 没登录过：先用设备身份换一个游客家长身份，
    // 这样"输绑定码"这一步就不用先注册账号 —— 和小程序 wx.login 的体验一致
    const result = await api.post<{ token: string; profile: Profile }>("/auth/login", {
      loginType: "device",
      code: deviceId(),
    });
    setToken(result.token);
    state.profile = result.profile;
    state.shell = result.profile.students.length > 0 ? "guardian" : "login";
    if (result.profile.students.length > 0) {
      state.activeStudentId = result.profile.students[0]!.id;
    }
  } catch {
    state.profile = null;
    state.shell = "login";
  }
  state.ready = true;
  notify();
}

/**
 * 重新拉取档案。
 *
 * `silent` 很重要：页面渲染过程中调用时**必须**传 true。
 * 否则 notify() 会触发订阅者重新渲染当前页 → 页面又调一次 refreshProfile
 * → 再 notify… 变成每秒几十次的请求风暴（手机上就是持续跑流量和耗电）。
 * 只有"用户主动操作后需要让别的页面也看到新数据"时才用 silent = false。
 */
export async function refreshProfile(options: { silent?: boolean } = {}): Promise<void> {
  const profile = await api.get<Profile>("/auth/profile");
  state.profile = profile;
  if (state.activeStudentId && !profile.students.some((s) => s.id === state.activeStudentId)) {
    state.activeStudentId = profile.students[0]?.id ?? null;
  }
  if (!options.silent) notify();
}

export async function logout(): Promise<void> {
  try {
    await api.post("/auth/logout", {});
  } catch {
    /* 服务端可能已经失效了，本地照样清 */
  }
  setToken(null);
  state.profile = null;
  state.activeStudentId = null;
  state.shell = "login";
  notify();
}
