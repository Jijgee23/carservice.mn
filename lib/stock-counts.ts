// Сэлбэг барааны тооллого (StockCount). Start snapshots every in-scope GOODS item's stock into lines; counted
// quantities are saved on the DRAFT; completing applies each counted line's difference (counted − snapshot) to
// Service.stock as an atomic increment, so parts used on repair orders while the count was open are kept. Lines left
// uncounted change nothing. One DRAFT per tenant (partial unique index). See prisma/schema.prisma «StockCount».
import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { canEdit, type RoleCheckUser } from "@/lib/auth/roles";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";

export type StockCountActor = RoleCheckUser & { id: string; tenantId: string };
export type StockCountStatusValue = "DRAFT" | "COMPLETED" | "CANCELLED";

export const STOCK_COUNT_STATUS_LABEL: Record<StockCountStatusValue, string> = {
  DRAFT: "Тоолж байна",
  COMPLETED: "Дууссан",
  CANCELLED: "Цуцалсан",
};

/** Chip tone per status (landing-ops-ui ChipTone values). */
export const STOCK_COUNT_STATUS_TONE: Record<StockCountStatusValue, "warn" | "ok" | "neutral"> = {
  DRAFT: "warn",
  COMPLETED: "ok",
  CANCELLED: "neutral",
};

export type StockCountErrorCode =
  | "STOCK_COUNT_FORBIDDEN"
  | "STOCK_COUNT_DRAFT_EXISTS"
  | "STOCK_COUNT_NOT_FOUND"
  | "STOCK_COUNT_NOT_DRAFT"
  | "STOCK_COUNT_EMPTY"
  | "STOCK_COUNT_NOTHING_COUNTED"
  | "STOCK_COUNT_INVALID";

export class StockCountError extends Error {
  constructor(
    message: string,
    readonly code: StockCountErrorCode,
    readonly status = 422,
    readonly fieldErrors?: Record<string, string>,
    /** STOCK_COUNT_DRAFT_EXISTS: the open count to continue. */
    readonly draftId?: string,
  ) {
    super(message);
    this.name = "StockCountError";
  }
}

/** «ТО-0007». */
export function stockCountLabel(number: number): string {
  return `ТО-${String(number).padStart(4, "0")}`;
}

const QTY_RE = /^\d{1,9}(\.\d{1,3})?$/;

/** Counted quantity from user input: "" / null -> null (not counted); otherwise a non-negative number, ≤ 3 decimals. */
export function parseCountedQty(raw: unknown): { ok: true; value: Prisma.Decimal | null } | { ok: false; message: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const text = (typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : "").trim().replace(/[\s ]/g, "").replace(",", ".");
  if (text === "") return { ok: true, value: null };
  if (!QTY_RE.test(text)) return { ok: false, message: "0-ээс их буюу тэнцүү тоо (3 хүртэлх бутархай)." };
  return { ok: true, value: new Prisma.Decimal(text) };
}

type Qty = string | number | Prisma.Decimal;
type SummaryLine = { systemQty: Qty; countedQty: Qty | null; costPrice: Qty | null };

/** Pure totals of a count: counted lines, lines with a difference, and the shortage / surplus valued at cost. */
export function summarizeStockCount(lines: readonly SummaryLine[]) {
  let countedCount = 0;
  let diffCount = 0;
  let shortage = new Prisma.Decimal(0);
  let surplus = new Prisma.Decimal(0);
  for (const l of lines) {
    if (l.countedQty == null) continue;
    countedCount += 1;
    const diff = new Prisma.Decimal(l.countedQty).minus(l.systemQty);
    if (diff.isZero()) continue;
    diffCount += 1;
    const cost = l.costPrice == null ? new Prisma.Decimal(0) : new Prisma.Decimal(l.costPrice);
    if (diff.isNegative()) shortage = shortage.plus(diff.negated().times(cost));
    else surplus = surplus.plus(diff.times(cost));
  }
  return {
    lineCount: lines.length,
    countedCount,
    diffCount,
    shortageValue: shortage.toDecimalPlaces(2),
    surplusValue: surplus.toDecimalPlaces(2),
  };
}

function assertEdit(actor: StockCountActor) {
  if (!canEdit(actor, "services")) {
    throw new StockCountError("Танд барааны тооллого хийх эрх байхгүй.", "STOCK_COUNT_FORBIDDEN", 403);
  }
}

const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";

// Many line writes in one transaction: allow more than the 5 s default.
const TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

export async function startStockCount(input: { actor: StockCountActor; categoryId?: string | null; note?: string | null }) {
  const { actor } = input;
  assertEdit(actor);
  const tenantId = actor.tenantId;
  const note = input.note?.trim().slice(0, 500) || null;
  const categoryId = input.categoryId?.trim() || null;

  try {
    return await prisma.$transaction(async (tx) => {
      const draft = await tx.stockCount.findFirst({ where: { tenantId, status: "DRAFT" }, select: { id: true, number: true } });
      if (draft) {
        throw new StockCountError(`Нээлттэй тооллого (${stockCountLabel(draft.number)}) байна — эхлээд түүнийг дуусгах эсвэл цуцлана уу.`, "STOCK_COUNT_DRAFT_EXISTS", 409, undefined, draft.id);
      }
      let categoryName: string | null = null;
      if (categoryId) {
        const category = await tx.category.findFirst({ where: { id: categoryId, tenantId }, select: { name: true } });
        if (!category) throw new StockCountError("Ангилал олдсонгүй.", "STOCK_COUNT_INVALID", 422, { categoryId: "Ангилал олдсонгүй." });
        categoryName = category.name;
      }
      const goods = await tx.service.findMany({
        where: { tenantId, type: "GOODS", isActive: true, ...(categoryId ? { categoryId } : {}) },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, code: true, stock: true, costPrice: true, unit: { select: { name: true } } },
      });
      if (goods.length === 0) throw new StockCountError("Тоолох идэвхтэй бараа алга.", "STOCK_COUNT_EMPTY");

      const last = await tx.stockCount.aggregate({ where: { tenantId }, _max: { number: true } });
      const number = (last._max.number ?? 0) + 1;
      const count = await tx.stockCount.create({
        data: { tenantId, number, note, categoryId, categoryName, createdById: actor.id, lineCount: goods.length },
        select: { id: true, number: true },
      });
      await tx.stockCountLine.createMany({
        data: goods.map((g) => ({
          tenantId,
          countId: count.id,
          serviceId: g.id,
          name: g.name,
          code: g.code,
          unit: g.unit?.name ?? null,
          costPrice: g.costPrice,
          systemQty: g.stock ?? new Prisma.Decimal(0),
        })),
      });
      await logAudit({
        tenantId, userId: actor.id, entity: "StockCount", entityId: count.id, action: "CREATE",
        summary: `Тооллого эхлүүлэв: ${stockCountLabel(count.number)} (${goods.length} бараа${categoryName ? `, ${categoryName}` : ""})`,
      }, tx);
      return count;
    }, TX_OPTIONS);
  } catch (error) {
    // Two starts racing: the one-draft index (or the number key) rejects the loser.
    if (isUniqueViolation(error)) throw new StockCountError("Тооллого зэрэг эхлүүлсэн байна — хуудсаа шинэчилнэ үү.", "STOCK_COUNT_DRAFT_EXISTS", 409);
    throw error;
  }
}

async function loadDraft(tx: PrismaTransactionClient, tenantId: string, countId: string) {
  const count = await tx.stockCount.findFirst({ where: { id: countId, tenantId }, select: { id: true, number: true, status: true } });
  if (!count) throw new StockCountError("Тооллого олдсонгүй.", "STOCK_COUNT_NOT_FOUND", 404);
  if (count.status !== "DRAFT") throw new StockCountError("Энэ тооллого аль хэдийн хаагдсан.", "STOCK_COUNT_NOT_DRAFT", 409);
  return count;
}

/** Saves counted quantities (only the lines sent). Errors per line come back keyed by line id. */
export async function saveStockCountLines(input: {
  actor: StockCountActor;
  countId: string;
  entries: ReadonlyArray<{ lineId: string; countedQty: unknown }>;
}) {
  const { actor } = input;
  assertEdit(actor);
  const fieldErrors: Record<string, string> = {};
  const parsed: Array<{ lineId: string; value: Prisma.Decimal | null }> = [];
  for (const e of input.entries) {
    const r = parseCountedQty(e.countedQty);
    if (!r.ok) fieldErrors[e.lineId] = r.message;
    else parsed.push({ lineId: e.lineId, value: r.value });
  }
  if (Object.keys(fieldErrors).length > 0) throw new StockCountError("Зарим тоо буруу байна.", "STOCK_COUNT_INVALID", 422, fieldErrors);

  await prisma.$transaction(async (tx) => {
    await loadDraft(tx, actor.tenantId, input.countId);
    for (const p of parsed) {
      await tx.stockCountLine.updateMany({ where: { id: p.lineId, countId: input.countId, tenantId: actor.tenantId }, data: { countedQty: p.value } });
    }
  }, TX_OPTIONS);
  return { saved: parsed.length };
}

/**
 * Closes the count and applies it: per counted line, difference = counted − snapshot, stock += difference (atomic).
 * The DRAFT -> COMPLETED claim is a conditional update, so a double submit applies the count once.
 */
export async function completeStockCount(input: { actor: StockCountActor; countId: string }) {
  const { actor } = input;
  assertEdit(actor);
  const tenantId = actor.tenantId;
  return prisma.$transaction(async (tx) => {
    const count = await loadDraft(tx, tenantId, input.countId);
    const lines = await tx.stockCountLine.findMany({
      where: { countId: count.id, tenantId },
      select: { id: true, serviceId: true, name: true, unit: true, systemQty: true, countedQty: true, costPrice: true },
    });
    const totals = summarizeStockCount(lines);
    if (totals.countedCount === 0) throw new StockCountError("Нэг ч бараа тоолоогүй байна.", "STOCK_COUNT_NOTHING_COUNTED");

    const now = new Date();
    const claimed = await tx.stockCount.updateMany({
      where: { id: count.id, tenantId, status: "DRAFT" },
      data: { status: "COMPLETED", completedAt: now, completedById: actor.id, ...totals },
    });
    if (claimed.count !== 1) throw new StockCountError("Энэ тооллого аль хэдийн хаагдсан.", "STOCK_COUNT_NOT_DRAFT", 409);

    const label = stockCountLabel(count.number);
    for (const l of lines) {
      if (l.countedQty == null) continue;
      const diff = l.countedQty.minus(l.systemQty);
      await tx.stockCountLine.update({ where: { id: l.id }, data: { difference: diff } });
      if (diff.isZero() || !l.serviceId) continue;
      const applied = await tx.service.updateMany({ where: { id: l.serviceId, tenantId, type: "GOODS" }, data: { stock: { increment: diff } } });
      if (applied.count === 0) continue; // the item was deleted meanwhile; the line keeps the record
      await logAudit({
        tenantId, userId: actor.id, entity: "Service", entityId: l.serviceId, action: "STOCK_CHANGE",
        summary: `${diff.isPositive() ? "+" : "−"}${diff.abs().toString()}${l.unit ? ` ${l.unit}` : ""} (тооллого ${label})`,
        before: { systemQty: l.systemQty.toString() },
        after: { countedQty: l.countedQty.toString(), difference: diff.toString(), reason: "STOCK_COUNT", stockCountId: count.id },
      }, tx);
    }
    await logAudit({
      tenantId, userId: actor.id, entity: "StockCount", entityId: count.id, action: "STATUS_CHANGE",
      summary: `Тооллого дуусгав: ${label} — ${totals.countedCount}/${totals.lineCount} тоолсон, ${totals.diffCount} зөрүүтэй`,
      after: { ...totals, shortageValue: totals.shortageValue.toString(), surplusValue: totals.surplusValue.toString() },
    }, tx);
    return { id: count.id, number: count.number, ...totals };
  }, TX_OPTIONS);
}

export async function cancelStockCount(input: { actor: StockCountActor; countId: string }) {
  const { actor } = input;
  assertEdit(actor);
  return prisma.$transaction(async (tx) => {
    const count = await loadDraft(tx, actor.tenantId, input.countId);
    const done = await tx.stockCount.updateMany({ where: { id: count.id, tenantId: actor.tenantId, status: "DRAFT" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    if (done.count !== 1) throw new StockCountError("Энэ тооллого аль хэдийн хаагдсан.", "STOCK_COUNT_NOT_DRAFT", 409);
    await logAudit({
      tenantId: actor.tenantId, userId: actor.id, entity: "StockCount", entityId: count.id, action: "STATUS_CHANGE",
      summary: `Тооллого цуцлав: ${stockCountLabel(count.number)} (үлдэгдэл өөрчлөгдөөгүй)`,
    }, tx);
    return { id: count.id };
  });
}

const PAGE_SIZE = 30;

export async function listStockCounts(tenantId: string, page = 1) {
  const skip = (Math.max(1, page) - 1) * PAGE_SIZE;
  const [rows, total, draft] = await Promise.all([
    prisma.stockCount.findMany({
      where: { tenantId },
      orderBy: [{ number: "desc" }],
      skip,
      take: PAGE_SIZE,
      select: {
        id: true, number: true, status: true, note: true, categoryName: true, createdAt: true, completedAt: true, cancelledAt: true,
        lineCount: true, countedCount: true, diffCount: true, shortageValue: true, surplusValue: true,
        createdBy: { select: { firstName: true, lastName: true } },
        completedBy: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.stockCount.count({ where: { tenantId } }),
    prisma.stockCount.findFirst({ where: { tenantId, status: "DRAFT" }, select: { id: true, number: true } }),
  ]);
  return { rows, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)), draft };
}

export async function getStockCount(tenantId: string, id: string) {
  return prisma.stockCount.findFirst({
    where: { id, tenantId },
    select: {
      id: true, number: true, status: true, note: true, categoryName: true, createdAt: true, completedAt: true, cancelledAt: true,
      lineCount: true, countedCount: true, diffCount: true, shortageValue: true, surplusValue: true,
      createdBy: { select: { firstName: true, lastName: true } },
      completedBy: { select: { firstName: true, lastName: true } },
      lines: {
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, serviceId: true, name: true, code: true, unit: true, costPrice: true, systemQty: true, countedQty: true, difference: true },
      },
    },
  });
}

export const personName = (u: { firstName: string; lastName: string } | null | undefined) =>
  u ? `${u.lastName ? `${u.lastName.charAt(0)}. ` : ""}${u.firstName}` : "—";
