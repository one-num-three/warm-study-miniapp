/**
 * 商店域：商品管理、现场兑换、撤销兑换。
 *
 * 兑换是这个系统里最需要事务保证的动作：
 * 检查余额 → 检查库存 → 检查限兑 → 扣积分 → 减库存 → 写兑换记录，
 * 六步在同一个事务里，任何一步失败全部回滚，绝不留下"扣了分没拿到东西"。
 */

import {
  AppError,
  ERROR_CODES,
  PRODUCT_STATUSES,
  isRedeemable,
  newId,
  type Product,
  type ProductStatus,
} from "@warm-study/shared";
import { Db, isUniqueViolation, toJson, type Row } from "../db.js";
import { mapProduct, mapRedemption, mapStudent } from "../mappers.js";
import type { AuthInfo, RequestContext } from "../http.js";
import {
  applyLedger,
  assertCanAccessStudent,
  assertStudentActive,
  boundStudentIds,
  nowIso,
  reverseLedgerEntry,
  writeAudit,
} from "../core.js";
import { actorOf } from "./identity.js";

export function listProducts(db: Db, auth: AuthInfo): Product[] {
  const isManagement = auth.permissions.includes("student.read_all");
  const rows = isManagement
    ? db.all<Row>("SELECT * FROM products ORDER BY created_at DESC")
    : db.all<Row>("SELECT * FROM products WHERE status = '上架' ORDER BY points_cost ASC");
  return rows.map(mapProduct);
}

export interface UpsertProductInput {
  name: string;
  description?: string;
  pointsCost: number;
  stock: number;
  perStudentLimit?: number;
  tone?: Product["tone"];
  status?: ProductStatus;
  image?: string;
}

export function createProduct(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  input: UpsertProductInput,
): Product {
  const id = newId("prd");
  const now = nowIso();
  db.run(
    `INSERT INTO products
      (id, name, description, image, points_cost, stock, status, per_student_limit, tone, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.name.trim(),
    input.description ?? null,
    input.image ?? null,
    input.pointsCost,
    input.stock,
    input.status ?? "上架",
    input.perStudentLimit ?? 0,
    input.tone ?? "leaf",
    now,
    now,
  );
  const product = mapProduct(db.get<Row>("SELECT * FROM products WHERE id = ?", id)!);
  writeAudit(db, ctx, actorOf(auth), {
    action: "product.create",
    target: `product:${id}`,
    after: { name: product.name, pointsCost: product.pointsCost, stock: product.stock },
  });
  return product;
}

export function updateProduct(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  productId: string,
  input: Partial<UpsertProductInput>,
): Product {
  const row = db.get<Row>("SELECT * FROM products WHERE id = ?", productId);
  if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, "商品不存在");
  const before = mapProduct(row);

  if (input.status && !PRODUCT_STATUSES.includes(input.status)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "商品状态不合法");
  }

  const fields: string[] = [];
  const params: unknown[] = [];
  const setField = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    params.push(value);
  };
  if (input.name !== undefined) setField("name", input.name.trim());
  if (input.description !== undefined) setField("description", input.description);
  if (input.image !== undefined) setField("image", input.image);
  if (input.pointsCost !== undefined) setField("points_cost", input.pointsCost);
  if (input.stock !== undefined) setField("stock", input.stock);
  if (input.status !== undefined) setField("status", input.status);
  if (input.perStudentLimit !== undefined) setField("per_student_limit", input.perStudentLimit);
  if (input.tone !== undefined) setField("tone", input.tone);
  if (fields.length === 0) return before;

  setField("updated_at", nowIso());
  params.push(productId);
  db.run(`UPDATE products SET ${fields.join(", ")} WHERE id = ?`, ...params);
  const after = mapProduct(db.get<Row>("SELECT * FROM products WHERE id = ?", productId)!);

  // 库存调整和上下架都属于敏感操作
  if (input.stock !== undefined || input.status !== undefined || input.pointsCost !== undefined) {
    writeAudit(db, ctx, actorOf(auth), {
      action: "product.update",
      target: `product:${productId}`,
      before: { stock: before.stock, status: before.status, pointsCost: before.pointsCost },
      after: { stock: after.stock, status: after.status, pointsCost: after.pointsCost },
    });
  }
  return after;
}

/** 现场兑换。老师核验后一次性完成扣分、减库存、发放。 */
export function redeem(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  input: { studentId: string; productId: string; requestId: string },
) {
  const student = assertStudentActive(db, input.studentId);

  return db.transaction(() => {
    const productRow = db.get<Row>("SELECT * FROM products WHERE id = ?", input.productId);
    if (!productRow) throw new AppError(ERROR_CODES.NOT_FOUND, "商品不存在");
    const product = mapProduct(productRow);

    if (!isRedeemable(product.status, product.stock)) {
      throw new AppError(
        product.stock <= 0 ? ERROR_CODES.OUT_OF_STOCK : ERROR_CODES.INVALID_STATE,
        product.stock <= 0 ? undefined : "该商品未上架",
      );
    }

    if (product.perStudentLimit > 0) {
      const used = Number(
        db.get<Row>(
          `SELECT COUNT(*) AS total FROM redemptions
           WHERE student_id = ? AND product_id = ? AND status = '已完成'`,
          input.studentId,
          input.productId,
        )?.total ?? 0,
      );
      if (used >= product.perStudentLimit) {
        throw new AppError(ERROR_CODES.REDEEM_LIMIT_REACHED, undefined, {
          details: { limit: product.perStudentLimit, used },
        });
      }
    }

    // 扣分。余额不足会在这里抛 INSUFFICIENT_POINTS，整个事务回滚
    const ledger = applyLedger(db, {
      studentId: input.studentId,
      delta: -product.pointsCost,
      type: "兑换扣除",
      reason: `兑换「${product.name}」`,
      operatorId: auth.userId,
      sourceRef: `product:${product.id}`,
      idempotencyKey: `REDEEM:${input.requestId}`,
    });

    // 条件更新，库存被别的请求抢走时 changes 为 0
    const stockUpdate = db.run(
      "UPDATE products SET stock = stock - 1, updated_at = ? WHERE id = ? AND stock > 0",
      nowIso(),
      product.id,
    );
    if (stockUpdate.changes === 0) {
      throw new AppError(ERROR_CODES.OUT_OF_STOCK);
    }

    const redemptionId = newId("rdm");
    try {
      db.run(
        `INSERT INTO redemptions
          (id, student_id, product_id, product_snapshot, points_cost, status, operator_id, request_id, ledger_id, created_at)
         VALUES (?, ?, ?, ?, ?, '已完成', ?, ?, ?, ?)`,
        redemptionId,
        input.studentId,
        product.id,
        toJson({
          id: product.id,
          name: product.name,
          pointsCost: product.pointsCost,
          image: product.image,
        }),
        product.pointsCost,
        auth.userId,
        input.requestId,
        ledger.entryId,
        nowIso(),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(ERROR_CODES.DUPLICATE_REQUEST);
      }
      throw error;
    }

    writeAudit(db, ctx, actorOf(auth), {
      action: "redemption.create",
      target: `redemption:${redemptionId}`,
      after: {
        student: student.name,
        product: product.name,
        pointsCost: product.pointsCost,
        balanceAfter: ledger.balanceAfter,
      },
    });

    return {
      redemption: mapRedemption(
        db.get<Row>("SELECT * FROM redemptions WHERE id = ?", redemptionId)!,
      ),
      balanceAfter: ledger.balanceAfter,
    };
  });
}

/** 撤销兑换：恢复积分 + 恢复库存 + 写冲正流水。仅负责人。 */
export function reverseRedemption(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  redemptionId: string,
  reason: string,
) {
  if (!reason.trim()) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "撤销兑换必须填写原因");
  }
  return db.transaction(() => {
    const row = db.get<Row>("SELECT * FROM redemptions WHERE id = ?", redemptionId);
    if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, "兑换记录不存在");
    const redemption = mapRedemption(row);
    if (redemption.status === "已撤销") {
      throw new AppError(ERROR_CODES.DUPLICATE_REQUEST, "该兑换已经撤销过了");
    }

    const reversal = reverseLedgerEntry(db, {
      ledgerId: redemption.ledgerId,
      operatorId: auth.userId,
      reason: `撤销兑换「${redemption.productSnapshot.name}」：${reason.trim()}`,
    });

    db.run(
      "UPDATE products SET stock = stock + 1, updated_at = ? WHERE id = ?",
      nowIso(),
      row.product_id as string,
    );
    db.run(
      `UPDATE redemptions SET status = '已撤销', reversed_at = ?, reversed_by = ?, reversal_ledger_id = ?
       WHERE id = ?`,
      nowIso(),
      auth.userId,
      reversal.entryId,
      redemptionId,
    );

    writeAudit(db, ctx, actorOf(auth), {
      action: "redemption.reverse",
      target: `redemption:${redemptionId}`,
      before: { status: "已完成", pointsCost: redemption.pointsCost },
      after: { status: "已撤销", balanceAfter: reversal.balanceAfter },
      reason,
    });

    return {
      redemption: mapRedemption(
        db.get<Row>("SELECT * FROM redemptions WHERE id = ?", redemptionId)!,
      ),
      balanceAfter: reversal.balanceAfter,
    };
  });
}

export function listRedemptions(db: Db, auth: AuthInfo, studentId?: string) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (studentId) {
    assertCanAccessStudent(db, auth, studentId);
    clauses.push("r.student_id = ?");
    params.push(studentId);
  } else if (!auth.permissions.includes("student.read_all")) {
    const ids = boundStudentIds(db, auth.userId);
    if (ids.length === 0) return [];
    clauses.push(`r.student_id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .all<Row>(
      `SELECT r.*, s.name AS student_name, s.nickname AS student_nickname
       FROM redemptions r JOIN students s ON s.id = r.student_id
       ${where} ORDER BY r.created_at DESC LIMIT 200`,
      ...params,
    )
    .map((row) => ({
      ...mapRedemption(row),
      studentName: row.student_name as string,
      studentNickname: row.student_nickname as string,
    }));
}

export function studentBalance(db: Db, studentId: string): number {
  const row = db.get<Row>("SELECT * FROM students WHERE id = ?", studentId);
  return row ? mapStudent(row).pointBalance : 0;
}
