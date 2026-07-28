/**
 * 演示数据。首次启动时自动执行，让项目开箱就能点。
 * 生产环境把 WARM_STUDY_SKIP_SEED=1 就不会灌数据。
 */

import { formatBindingCode, newId, toDateKey } from "@warm-study/shared";
import { Db, type Row } from "./db.js";
import { nowIso } from "./core.js";
import { allocateBindingCode, createStaffUser } from "./services/identity.js";

export interface SeedResult {
  created: boolean;
  ownerUsername: string;
  ownerPassword: string;
  staffUsername: string;
  staffPassword: string;
  students: Array<{ name: string; code: string; id: string }>;
}

const OWNER_USERNAME = process.env.WARM_STUDY_OWNER_USER ?? "owner";
const OWNER_PASSWORD = process.env.WARM_STUDY_OWNER_PASS ?? "warm2026";
const STAFF_USERNAME = "teacher";
const STAFF_PASSWORD = "warm2026";

export function ensureSeed(db: Db): SeedResult {
  const existing = db.get<Row>("SELECT COUNT(*) AS total FROM users");
  const empty = Number(existing?.total ?? 0) === 0;

  if (!empty || process.env.WARM_STUDY_SKIP_SEED === "1") {
    return {
      created: false,
      ownerUsername: OWNER_USERNAME,
      ownerPassword: OWNER_PASSWORD,
      staffUsername: STAFF_USERNAME,
      staffPassword: STAFF_PASSWORD,
      students: db
        .all<Row>("SELECT id, name, binding_code FROM students ORDER BY created_at ASC")
        .map((row) => ({
          id: row.id as string,
          name: row.name as string,
          code: formatBindingCode(row.binding_code as string),
        })),
    };
  }

  return db.transaction(() => {
    createStaffUser(db, {
      username: OWNER_USERNAME,
      password: OWNER_PASSWORD,
      displayName: "王负责人",
      roles: ["owner"],
      permissions: null,
    });
    const staffId = createStaffUser(db, {
      username: STAFF_USERNAME,
      password: STAFF_PASSWORD,
      displayName: "李老师",
      roles: ["staff"],
      permissions: null,
    });

    const seedStudents = [
      { name: "张小满", nickname: "小满", grade: "三年级" },
      { name: "陈知夏", nickname: "夏夏", grade: "四年级" },
      { name: "林听白", nickname: "小白", grade: "二年级" },
      { name: "周景行", nickname: "行行", grade: "五年级" },
    ];

    const created: Array<{ name: string; code: string; id: string }> = [];
    const now = nowIso();
    for (const item of seedStudents) {
      const id = newId("stu");
      const code = allocate(db);
      db.run(
        `INSERT INTO students
          (id, name, nickname, grade, status, binding_code, binding_code_enabled,
           binding_code_issued_at, point_balance, public_ranking, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, 1, ?, 0, 1, ?, ?)`,
        id,
        item.name,
        item.nickname,
        item.grade,
        code,
        now,
        now,
        now,
      );
      created.push({ id, name: item.name, code: formatBindingCode(code) });
    }

    const products = [
      { name: "橡皮擦套装", cost: 20, stock: 12, tone: "leaf", desc: "四只装，造型随机" },
      { name: "自动铅笔", cost: 35, stock: 8, tone: "sun", desc: "0.5mm，送两管笔芯" },
      { name: "贴纸大礼包", cost: 15, stock: 20, tone: "clay", desc: "五十张不重样" },
      { name: "课外读物", cost: 80, stock: 3, tone: "leaf", desc: "自选一本，限每人一次" },
    ];
    for (const item of products) {
      db.run(
        `INSERT INTO products
          (id, name, description, points_cost, stock, status, per_student_limit, tone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '上架', ?, ?, ?, ?)`,
        newId("prd"),
        item.name,
        item.desc,
        item.cost,
        item.stock,
        item.name === "课外读物" ? 1 : 0,
        item.tone,
        now,
        now,
      );
    }

    // 给前两个孩子一些初始积分流水，进去就有东西看
    const dateKey = toDateKey();
    const grants = [
      { studentId: created[0]!.id, delta: 30, reason: "上周作业全部按时完成" },
      { studentId: created[0]!.id, delta: 10, reason: "主动帮同学讲题" },
      { studentId: created[1]!.id, delta: 25, reason: "错题全部订正" },
      { studentId: created[2]!.id, delta: 15, reason: "课堂表现积极" },
    ];
    let balances = new Map<string, number>();
    for (const grant of grants) {
      const balance = (balances.get(grant.studentId) ?? 0) + grant.delta;
      balances.set(grant.studentId, balance);
      db.run(
        `INSERT INTO point_ledger
          (id, student_id, delta, type, reason, balance_after, operator_id, reversed, created_at)
         VALUES (?, ?, ?, '表现奖励', ?, ?, ?, 0, ?)`,
        newId("led"),
        grant.studentId,
        grant.delta,
        grant.reason,
        balance,
        staffId,
        now,
      );
    }
    for (const [studentId, balance] of balances) {
      db.run("UPDATE students SET point_balance = ? WHERE id = ?", balance, studentId);
    }

    // 今天的到班记录
    for (const item of created) {
      db.run(
        `INSERT INTO daily_sessions (id, student_id, date_key, status, updated_at)
         VALUES (?, ?, ?, '待到班', ?)`,
        newId("ses"),
        item.id,
        dateKey,
        now,
      );
    }

    return {
      created: true,
      ownerUsername: OWNER_USERNAME,
      ownerPassword: OWNER_PASSWORD,
      staffUsername: STAFF_USERNAME,
      staffPassword: STAFF_PASSWORD,
      students: created,
    };
  });
}

/** 演示数据也走同一套绑定码生成逻辑，保证格式与真实创建完全一致。 */
function allocate(db: Db): string {
  return allocateBindingCode(db);
}
