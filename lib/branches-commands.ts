// Салбарын CRUD-ийн дундын бизнес логик — вэбийн server action
// (app/_actions/branches.ts) болон мобайл staff API (app/api/v1/branches/**)
// хоёулаа ЭНД дуудна. Validation нь вэб form-ийн `FormData` хэлбэр дээр
// ажилладаг тул API JSON body-г `branchBodyToFormData`-аар ижил хэлбэрт
// хөрвүүлнэ — дүрэм, мессеж давхардахгүй.
//
// Эрх (canCreate/canEdit/canDelete "branches") болон багцын идэвхтэй эсэхийг
// (subscription) дуудагч өөрөө шалгана: вэб — `authorize()`, API —
// `requirePermission` + `requireActiveSubscriptionApi`.
//
// RLS: async helper дотор үргэлж `return await prisma…` (bare `return
// prisma…` биш) — AsyncLocalStorage context алдагдахаас сэргийлнэ.

import { isForeignKeyViolation } from "@/lib/prisma-errors";
import { logAudit } from "@/lib/audit";
import {
  ALL_WEEKDAYS,
  DEFAULT_OPEN_DAYS,
  type Weekday,
  isValidTime,
  isWeekday,
} from "@/lib/branches";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { moduleDisabledMessage } from "@/lib/plan-modules";
import { isModuleEnabled } from "@/lib/plan-modules-server";
import { prisma } from "@/lib/prisma";
import { resolveEffectiveSchedule } from "@/lib/branch-effective-schedule";
import { applyScheduleClips, inspectScheduleImpact, type ScheduleImpact } from "@/lib/branch-schedule-impact";
import { MAX_ADVANCE_BOOKING_DAYS } from "@/lib/booking-time";

/** Салбарын үйлдэл хийж буй ажилтан (вэбийн SessionUser / API-ийн ApiUser аль аль нь таарна). */
export type BranchActor = { id: string; tenantId: string };

export const PRIMARY_BRANCH_LOCKED_MESSAGE =
  "Үндсэн салбарыг идэвхгүй болгохын тулд эхлээд өөр салбарыг үндсэн болгоно уу.";

export type DaySchedule = { isOpen: boolean; openTime: string | null; closeTime: string | null };

type Parsed = {
  name: string;
  phone: string | null;
  city: string | null;
  district: string | null;
  khoroo: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  openTime: string | null;
  closeTime: string | null;
  slotMinutes: number | null;
  slotCapacity: number | null;
  openDays: Weekday[];
  daySchedules: Record<Weekday, DaySchedule>;
  isPrimary: boolean;
  tagIds: string[];
  errors: Record<string, string>;
};

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// Илгээсэн tagIds-с зөвхөн бодитоор идэвхтэй BranchTag-т харгалзахыг нь
// шүүнэ — устсан/идэвхгүй болсон шошгыг чимээгүй орхино (харах:
// app/_actions/categories.ts-ийн validBranchIds-тэй адил зарчим).
async function validTagIds(tagIds: string[]): Promise<string[]> {
  if (tagIds.length === 0) return [];
  const rows = await prisma.branchTag.findMany({
    where: { id: { in: tagIds }, isActive: true },
    select: { id: true },
  });
  return rows.map((t) => t.id);
}

function parseFloatOrNull(v: string): number | null {
  if (!v) return null;
  const n = Number.parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : Number.NaN;
}

function validate(fd: FormData, opts: { requireTag?: boolean } = {}): Parsed {
  const name = s(fd, "name");
  const phone = s(fd, "phone");
  const city = s(fd, "city");
  const district = s(fd, "district");
  const khoroo = s(fd, "khoroo");
  const address = s(fd, "address");
  const latRaw = s(fd, "latitude");
  const lngRaw = s(fd, "longitude");
  const openTimeRaw = s(fd, "openTime");
  const closeTimeRaw = s(fd, "closeTime");

  const errors: Record<string, string> = {};

  if (!name) errors.name = "Салбарын нэрээ оруулна уу.";
  // Утас заавал биш — оруулсан бол 8 оронтой зөв байх ёстой.
  if (phone && !isValidPhone(phone))
    errors.phone = "Утасны дугаар 8 оронтой тоо байх ёстой.";

  // Координат
  let latitude: number | null = null;
  if (latRaw) {
    const n = parseFloatOrNull(latRaw);
    if (n === null || Number.isNaN(n) || n < -90 || n > 90) {
      errors.latitude = "Latitude -90 ба 90-ийн хооронд байна.";
    } else {
      latitude = n;
    }
  }
  let longitude: number | null = null;
  if (lngRaw) {
    const n = parseFloatOrNull(lngRaw);
    if (n === null || Number.isNaN(n) || n < -180 || n > 180) {
      errors.longitude = "Longitude -180 ба 180-ийн хооронд байна.";
    } else {
      longitude = n;
    }
  }

  // Салбарын fallback цаг. Өдөр тус бүрийн мөрүүд доор өөрийн цагтай байж болно.
  const openTime = openTimeRaw || null;
  const closeTime = closeTimeRaw || null;
  if (openTime && !isValidTime(openTime))
    errors.openTime = "Цагийн форматыг HH:MM (24 цаг) хэлбэрээр оруулна уу.";
  if (closeTime && !isValidTime(closeTime))
    errors.closeTime = "Цагийн форматыг HH:MM (24 цаг) хэлбэрээр оруулна уу.";
  if (openTime && closeTime && closeTime <= openTime)
    errors.closeTime = "Дуусах цаг эхлэх цагаас хойш байна.";

  // Онлайн цаг захиалгын slot тохиргоо (заавал биш)
  const slotMinutesRaw = s(fd, "slotMinutes");
  const slotCapacityRaw = s(fd, "slotCapacity");
  let slotMinutes: number | null = null;
  if (slotMinutesRaw) {
    const n = Number.parseInt(slotMinutesRaw, 10);
    if (!Number.isFinite(n) || n < 5 || n > 480)
      errors.slotMinutes = "5-480 минут хооронд байна.";
    else slotMinutes = n;
  }
  let slotCapacity: number | null = null;
  if (slotCapacityRaw) {
    const n = Number.parseInt(slotCapacityRaw, 10);
    if (!Number.isFinite(n) || n < 1 || n > 100)
      errors.slotCapacity = "1-100 хооронд байна.";
    else slotCapacity = n;
  }

  // Өдөр тус бүрийн хуваарь. Хуучин form/post-оос ирсэн workDays-ийг fallback
  // болгон дэмжинэ — шинэ form бүх долоо хоногийн мөрийг илгээнэ.
  const rawDays = fd.getAll("workDays");
  const openDaysSet = new Set<Weekday>();
  for (const d of rawDays) {
    if (isWeekday(d)) openDaysSet.add(d);
  }
  const openDays =
    openDaysSet.size > 0 ? Array.from(openDaysSet) : DEFAULT_OPEN_DAYS.slice();
  const daySchedules = {} as Parsed["daySchedules"];
  for (const wd of ALL_WEEKDAYS) {
    const hasNewField = fd.has(`schedule_${wd}_isOpen`);
    const isOpen = hasNewField
      ? fd.get(`schedule_${wd}_isOpen`) === "on"
      : openDaysSet.size > 0
        ? openDaysSet.has(wd)
        : DEFAULT_OPEN_DAYS.includes(wd);
    const dayOpen = s(fd, `schedule_${wd}_openTime`) || openTime;
    const dayClose = s(fd, `schedule_${wd}_closeTime`) || closeTime;
    daySchedules[wd] = {
      isOpen,
      openTime: dayOpen || null,
      closeTime: dayClose || null,
    };
    if (isOpen) {
      if (!dayOpen || !isValidTime(dayOpen)) {
        errors[`schedule_${wd}_openTime`] = "Нээлттэй өдөр эхлэх цаг шаардлагатай.";
      }
      if (!dayClose || !isValidTime(dayClose)) {
        errors[`schedule_${wd}_closeTime`] = "Нээлттэй өдөр дуусах цаг шаардлагатай.";
      }
      if (dayOpen && dayClose && isValidTime(dayOpen) && isValidTime(dayClose) && dayClose <= dayOpen) {
        errors[`schedule_${wd}_closeTime`] = "Дуусах цаг эхлэх цагаас хойш байна.";
      }
    }
  }

  const rawTagIds = fd.getAll("tagIds").filter((v): v is string => typeof v === "string");
  // Шинэ салбарт ядаж нэг шошго ЗААВАЛ — discovery-г бизнесийн төрлөөр шүүхэд
  // хэрэгжихийн тулд. Хуучин, шошгогүй салбаруудыг буцаагаад заавал шошготой
  // болгохоор шаардахгүй (тэдгээрийг зөвхөн edit хуудсан дээрх сануулга
  // banner-аар анхааруулна) — харах: app/dashboard/branches/[id]/page.tsx.
  if (opts.requireTag && rawTagIds.length === 0) {
    errors.tagIds = "Ядаж нэг шошго сонгоно уу.";
  }

  return {
    name,
    phone: phone ? (normalizePhone(phone) ?? phone) : null,
    city: city || null,
    district: district || null,
    khoroo: khoroo || null,
    address: address || null,
    latitude,
    longitude,
    openTime,
    closeTime,
    slotMinutes,
    slotCapacity,
    openDays,
    daySchedules,
    isPrimary: fd.get("isPrimary") === "on",
    tagIds: rawTagIds,
    errors,
  };
}

function toBranchData(p: Parsed) {
  return {
    name: p.name,
    phone: p.phone,
    city: p.city,
    district: p.district,
    khoroo: p.khoroo,
    address: p.address,
    latitude: p.latitude,
    longitude: p.longitude,
    openTime: p.openTime,
    closeTime: p.closeTime,
    slotMinutes: p.slotMinutes,
    slotCapacity: p.slotCapacity,
    isPrimary: p.isPrimary,
  };
}

function scheduleCreateMany(
  branchId: string,
  daySchedules: Parsed["daySchedules"],
) {
  return ALL_WEEKDAYS.map((wd) => ({
    branchId,
    weekday: wd,
    ...daySchedules[wd],
  }));
}

/** Transaction дотроос шидэж, гадна талд нь кодтой үр дүн болгох бизнес дүрмийн алдаа. */
class BranchRuleError extends Error {}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateBranchResult =
  | { ok: true; id: string }
  | { ok: false; code: "VALIDATION"; fieldErrors: Record<string, string> }
  | { ok: false; code: "MODULE_DISABLED" | "UNKNOWN"; message: string };

/**
 * Шинэ салбар үүсгэнэ (шошго заавал). «Олон салбар» модуль хаалттай бол
 * тенантэд аль хэдийн салбар байвал татгалзана. Анхны салбар автоматаар
 * үндсэн болно. Амжилттай бол audit (CREATE) бичнэ.
 */
export async function createBranch(actor: BranchActor, formData: FormData): Promise<CreateBranchResult> {
  const p = validate(formData, { requireTag: true });
  if (Object.keys(p.errors).length > 0) {
    return { ok: false, code: "VALIDATION", fieldErrors: p.errors };
  }

  // Багцын модуль: «Олон салбар» хаалттай бол зөвхөн нэг салбартай байна.
  if (!(await isModuleEnabled(actor.tenantId, "enable_multi_branch"))) {
    const existing = await prisma.branch.count({ where: { tenantId: actor.tenantId } });
    if (existing >= 1) {
      return { ok: false, code: "MODULE_DISABLED", message: moduleDisabledMessage("enable_multi_branch") };
    }
  }

  const tagIds = await validTagIds(p.tagIds);

  let createdId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      // Хэрэв isPrimary=true бол бусад салбаруудыг false болгоно
      if (p.isPrimary) {
        await tx.branch.updateMany({
          where: { tenantId: actor.tenantId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      // Тенант дотор анхных нь автоматаар үндсэн салбар болно
      const existing = await tx.branch.count({
        where: { tenantId: actor.tenantId },
      });
      const isPrimary = p.isPrimary || existing === 0;
      const branch = await tx.branch.create({
        data: {
          ...toBranchData(p),
          isPrimary,
          tenantId: actor.tenantId,
          tags: { connect: tagIds.map((tagId) => ({ id: tagId })) },
        },
        select: { id: true },
      });
      createdId = branch.id;
      await tx.branchSchedule.createMany({
        data: scheduleCreateMany(branch.id, p.daySchedules),
      });
    });
  } catch (e) {
    console.error("[createBranch]", e);
    return { ok: false, code: "UNKNOWN", message: "Үүсгэх явцад алдаа гарлаа." };
  }
  if (!createdId) {
    return { ok: false, code: "UNKNOWN", message: "Үүсгэх явцад алдаа гарлаа." };
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Branch",
    entityId: createdId,
    action: "CREATE",
    summary: p.name,
    after: toBranchData(p),
  });

  return { ok: true, id: createdId };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export type UpdateBranchResult =
  | { ok: true; clipped: number }
  | { ok: false; code: "VALIDATION"; fieldErrors: Record<string, string> }
  | {
      ok: false;
      code: "SCHEDULE_IMPACT";
      message: string;
      impact: ScheduleImpact;
      // true: зөвхөн clipped (богиносох) — confirmed=true-гээр дахин илгээж
      // үргэлжлүүлж болно. false: erased байгаа тул хатуу хориглоно.
      needsConfirm: boolean;
    }
  | { ok: false; code: "NOT_FOUND" | "PRIMARY_LOCKED" | "UNKNOWN"; message: string };

/**
 * Салбарыг бүхэлд нь шинэчилнэ (талбар + 7 хоногийн хуваарь + шошго).
 * Хуваарь өөрчлөгдөхөд ирээдүйн захиалгуудад үзүүлэх нөлөөг шалгана:
 * бүрэн хүчингүй болох (erased) захиалга байвал хатуу хориглоно, зөвхөн
 * богиносох (clipped) бол `confirmed=true` үед л хадгалж, богиносгоно.
 * Амжилттай бол audit (UPDATE) бичнэ.
 */
export async function updateBranch(
  actor: BranchActor,
  id: string,
  formData: FormData,
  confirmed: boolean,
): Promise<UpdateBranchResult> {
  const p = validate(formData);
  if (Object.keys(p.errors).length > 0) {
    return { ok: false, code: "VALIDATION", fieldErrors: p.errors };
  }

  let updateResult: {
    count: number;
    clipped: number;
    impact: ScheduleImpact | null;
    blocked: boolean;
    needsConfirm: boolean;
  };
  try {
    updateResult = await prisma.$transaction(async (tx) => {
      // S13: serialize hours/schedule changes against concurrent bookings
      // created via lib/appointment-reservations.ts's own branch lock — same
      // pattern, same row.
      await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${id} AND "tenantId" = ${actor.tenantId} FOR UPDATE`;
      const current = await tx.branch.findFirst({
        where: { id, tenantId: actor.tenantId },
        select: {
          isPrimary: true,
          openTime: true,
          closeTime: true,
          schedules: true,
          scheduleExceptions: true,
          scheduleSeasons: { include: { days: true } },
        },
      });
      if (!current) return { count: 0, clipped: 0, impact: null, blocked: false, needsConfirm: false };

      // Үндсэнийг нь өөр болгох гэж байвал зөвшөөрөхгүй
      // (үндсэн салбарыг хасах нь тенантэд нэгээс ч бага үлдээх эрсдэлтэй)
      if (current.isPrimary && !p.isPrimary) {
        throw new BranchRuleError(PRIMARY_BRANCH_LOCKED_MESSAGE);
      }

      if (p.isPrimary && !current.isPrimary) {
        await tx.branch.updateMany({
          where: { tenantId: actor.tenantId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      const proposedBranch = {
        openTime: p.openTime,
        closeTime: p.closeTime,
        schedules: ALL_WEEKDAYS.map((weekday) => ({
          weekday,
          ...p.daySchedules[weekday],
        })),
        scheduleExceptions: current.scheduleExceptions,
        scheduleSeasons: current.scheduleSeasons,
      };
      const now = new Date();
      const impact = await inspectScheduleImpact(tx, {
        tenantId: actor.tenantId,
        branchId: id,
        from: now,
        to: new Date(now.getTime() + MAX_ADVANCE_BOOKING_DAYS * 86400000),
        resolve: (dateStr) => resolveEffectiveSchedule({ dateStr, branch: proposedBranch }),
        fallbackDurationMinutes: p.slotMinutes ?? 30,
      });
      // S13 Phase 4: erased items hard-block the save — an erased reservation
      // no longer fits the new hours at all, so silently proceeding would
      // leave an invalid reservation on the books; staff must resolve it
      // first. Clipped-only impact is non-destructive (just shortened), so it
      // follows the same confirmed=true convention as
      // app/_actions/orders.ts's reschedule flows — the caller resubmits
      // with confirmed=true once the preview is shown.
      if (impact.erased.length > 0) {
        return { count: 0, clipped: 0, impact, blocked: true, needsConfirm: false };
      }
      if (impact.clipped.length > 0 && !confirmed) {
        return { count: 0, clipped: 0, impact, blocked: true, needsConfirm: true };
      }

      const r = await tx.branch.updateMany({
        where: { id, tenantId: actor.tenantId },
        data: toBranchData(p),
      });
      if (r.count > 0) {
        const tagIds = await validTagIds(p.tagIds);
        await tx.branch.update({
          where: { id },
          data: { tags: { set: tagIds.map((tagId) => ({ id: tagId })) } },
        });
        for (const wd of ALL_WEEKDAYS) {
          await tx.branchSchedule.upsert({
            where: { branchId_weekday: { branchId: id, weekday: wd } },
            create: { branchId: id, weekday: wd, ...p.daySchedules[wd] },
            update: p.daySchedules[wd],
          });
        }
      }
      if (r.count > 0) await applyScheduleClips(tx, impact);
      return { count: r.count, clipped: impact.clipped.length, impact: null, blocked: false, needsConfirm: false };
    });
  } catch (e) {
    if (e instanceof BranchRuleError) {
      return { ok: false, code: "PRIMARY_LOCKED", message: e.message };
    }
    console.error("[updateBranch]", e);
    return { ok: false, code: "UNKNOWN", message: "Шинэчлэх явцад алдаа гарлаа." };
  }

  if (updateResult.blocked) {
    return {
      ok: false,
      code: "SCHEDULE_IMPACT",
      message: updateResult.needsConfirm
        ? `Хуваарь хадгалбал ${updateResult.impact!.clipped.length} захиалгын үргэлжлэх хугацаа богиносно. Доор жагсаалтыг харж, үргэлжлүүлэхийг баталгаажуулна уу.`
        : `Хуваарь хадгалахад ${updateResult.impact!.erased.length} захиалга бүрэн хүчингүй болно. Ажилтан эхлээд эдгээрийг шийдвэрлэнэ үү.`,
      impact: updateResult.impact!,
      needsConfirm: updateResult.needsConfirm,
    };
  }
  if (updateResult.count === 0) {
    return { ok: false, code: "NOT_FOUND", message: "Салбар олдсонгүй." };
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Branch",
    entityId: id,
    action: "UPDATE",
    summary: p.name,
    after: toBranchData(p),
  });

  return { ok: true, clipped: updateResult.clipped };
}

// ---------------------------------------------------------------------------
// Toggle active
// ---------------------------------------------------------------------------

export type ToggleBranchActiveResult =
  | { ok: true; isActive: boolean }
  | { ok: false; code: "NOT_FOUND" }
  | { ok: false; code: "PRIMARY_LOCKED"; message: string };

/**
 * Салбарын идэвхтэй/идэвхгүй төлөвийг сэлгэнэ. Идэвхтэй үндсэн салбарыг
 * идэвхгүй болгохыг хориглоно. Амжилттай бол audit (STATUS_CHANGE) бичнэ.
 */
export async function toggleBranchActive(actor: BranchActor, id: string): Promise<ToggleBranchActiveResult> {
  const target = await prisma.branch.findFirst({
    where: { id, tenantId: actor.tenantId },
    select: { isPrimary: true, isActive: true, name: true },
  });
  if (!target) return { ok: false, code: "NOT_FOUND" };
  if (target.isPrimary && target.isActive) {
    return { ok: false, code: "PRIMARY_LOCKED", message: PRIMARY_BRANCH_LOCKED_MESSAGE };
  }

  const nextActive = !target.isActive;
  await prisma.branch.update({
    where: { id },
    data: { isActive: nextActive },
  });

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Branch",
    entityId: id,
    action: "STATUS_CHANGE",
    summary: `${target.name} · ${nextActive ? "идэвхжүүлсэн" : "идэвхгүй болгосон"}`,
    before: { isActive: target.isActive },
    after: { isActive: nextActive },
  });

  return { ok: true, isActive: nextActive };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export type DeleteBranchResult =
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" }
  | { ok: false; code: "PRIMARY_LOCKED" | "HAS_EMPLOYEES" | "FK_CONFLICT"; message: string };

/**
 * Салбарыг устгана. Үндсэн салбар, ажилтантай салбар, засварын хуудас/цаг
 * захиалгатай (FK) салбарыг устгахгүй. Бусад гэнэтийн алдааг дээш шиднэ.
 * Амжилттай бол audit (DELETE) бичнэ.
 */
export async function deleteBranch(actor: BranchActor, id: string): Promise<DeleteBranchResult> {
  const target = await prisma.branch.findFirst({
    where: { id, tenantId: actor.tenantId },
    select: { isPrimary: true, name: true },
  });
  if (!target) return { ok: false, code: "NOT_FOUND" };
  if (target.isPrimary) {
    return {
      ok: false,
      code: "PRIMARY_LOCKED",
      message: "Үндсэн салбарыг устгах боломжгүй. Эхлээд өөр салбарыг үндсэн болгоно уу.",
    };
  }

  // User.branchId нь onDelete: SetNull тул DB зогсоохгүй — ажилтнууд салбаргүй
  // болж, ээлжийн хуваарь нь cascade-аар устна. Тиймээс апп түвшинд хориглоно.
  // Тоолох болон устгахыг нэг transaction-д хийж, хооронд нь ажилтан
  // оноогдохоос сэргийлнэ.
  let employeeCount = 0;
  try {
    employeeCount = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${id} AND "tenantId" = ${actor.tenantId} FOR UPDATE`;
      // Tombstone (устгагдсан) ажилтан салбарыг түгжихгүй — захиалгын FK-д л үлддэг.
      const count = await tx.user.count({ where: { branchId: id, tenantId: actor.tenantId, deletedAt: null } });
      if (count > 0) return count;
      await tx.branch.delete({ where: { id, tenantId: actor.tenantId } });
      return 0;
    });
  } catch (e) {
    if (isForeignKeyViolation(e)) {
      return {
        ok: false,
        code: "FK_CONFLICT",
        message: "Энэ салбарт засварын хуудас/цаг захиалга бүртгэлтэй тул устгах боломжгүй.",
      };
    }
    throw e;
  }
  if (employeeCount > 0) {
    return {
      ok: false,
      code: "HAS_EMPLOYEES",
      message: `Энэ салбарт ${employeeCount} ажилтан бүртгэлтэй. Эхлээд тэднийг өөр салбар руу шилжүүлнэ үү.`,
    };
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Branch",
    entityId: id,
    action: "DELETE",
    summary: target.name,
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Detail read (мобайл API) + JSON body → FormData
// ---------------------------------------------------------------------------

/**
 * Салбарын дэлгэрэнгүй — app/dashboard/branches/[id] хуудсан дээрх засах
 * form-ийн талбарууд + 7 хоногийн хуваарь (ALL_WEEKDAYS дарааллаар, мөргүй
 * өдөр хаалттай гэж бөглөнө) + шошго + ажилтны тоо. Тенантаар л хязгаарлана
 * (вэб хуудастай адил). Олдохгүй бол null.
 */
export async function getBranchDetail(tenantId: string, id: string) {
  const branch = await prisma.branch.findFirst({
    where: { id, tenantId },
    include: {
      schedules: { select: { weekday: true, isOpen: true, openTime: true, closeTime: true } },
      tags: { select: { id: true, name: true } },
      _count: { select: { users: true } },
    },
  });
  if (!branch) return null;

  const byDay = new Map(branch.schedules.map((r) => [r.weekday as Weekday, r]));
  const schedules = ALL_WEEKDAYS.map((weekday) => {
    const r = byDay.get(weekday);
    return {
      weekday,
      isOpen: r?.isOpen ?? false,
      openTime: r?.openTime ?? null,
      closeTime: r?.closeTime ?? null,
    };
  });

  return {
    id: branch.id,
    name: branch.name,
    phone: branch.phone,
    city: branch.city,
    district: branch.district,
    khoroo: branch.khoroo,
    address: branch.address,
    latitude: branch.latitude,
    longitude: branch.longitude,
    openTime: branch.openTime,
    closeTime: branch.closeTime,
    slotMinutes: branch.slotMinutes,
    slotCapacity: branch.slotCapacity,
    isPrimary: branch.isPrimary,
    isActive: branch.isActive,
    tags: branch.tags,
    tagIds: branch.tags.map((t) => t.id),
    employeeCount: branch._count.users,
    schedules,
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
  };
}

export type BranchDetail = NonNullable<Awaited<ReturnType<typeof getBranchDetail>>>;

/** Мобайл API-ийн JSON body (бүх талбар заавал биш). */
export type BranchJsonBody = {
  name?: unknown;
  phone?: unknown;
  city?: unknown;
  district?: unknown;
  khoroo?: unknown;
  address?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  openTime?: unknown;
  closeTime?: unknown;
  slotMinutes?: unknown;
  slotCapacity?: unknown;
  isPrimary?: unknown;
  tagIds?: unknown;
  /** [{ weekday: "MON", isOpen, openTime, closeTime }] — өдөр тус бүрийн хуваарь. */
  schedules?: unknown;
  /** Хуваарийн нөлөөг (clipped) баталгаажуулсан эсэх. */
  confirm?: unknown;
};

const BODY_FIELDS = [
  "name", "phone", "city", "district", "khoroo", "address",
  "latitude", "longitude", "openTime", "closeTime", "slotMinutes", "slotCapacity",
] as const;

/**
 * JSON body-г вэбийн `<BranchForm>`-ийн илгээдэг `FormData` хэлбэрт
 * хөрвүүлнэ — validation-г `validate()` яг вэбтэй адилаар хийнэ.
 *
 * `base` өгвөл (PATCH) одоогийн салбарын утгуудаас эхэлж, body-д ирсэн
 * талбаруудаар л дарна — ирээгүй талбар, шошго, өдрүүд хэвээр үлдэнэ.
 * `null` утга нь тухайн талбарыг хоосолно.
 */
export function branchBodyToFormData(body: BranchJsonBody, base?: BranchDetail): FormData {
  const fd = new FormData();
  const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
  const rec = body as Record<string, unknown>;

  for (const key of BODY_FIELDS) {
    if (key in rec) fd.set(key, str(rec[key]));
    else if (base) fd.set(key, str(base[key]));
  }

  const isPrimary = "isPrimary" in rec ? rec.isPrimary === true : base?.isPrimary === true;
  if (isPrimary) fd.set("isPrimary", "on");

  const tagIds = Array.isArray(body.tagIds) ? body.tagIds : (base?.tagIds ?? []);
  for (const t of tagIds) if (typeof t === "string") fd.append("tagIds", t);

  const days = new Map<Weekday, DaySchedule>();
  if (base) for (const d of base.schedules) days.set(d.weekday, d);
  if (Array.isArray(body.schedules)) {
    for (const raw of body.schedules) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      if (!isWeekday(r.weekday)) continue;
      days.set(r.weekday, {
        isOpen: r.isOpen === true,
        openTime: typeof r.openTime === "string" ? r.openTime : null,
        closeTime: typeof r.closeTime === "string" ? r.closeTime : null,
      });
    }
  }
  // Нээлттэй өдөр цаггүй ирвэл салбарын ерөнхий цагийг (эсвэл бүртгэлийн
  // анхдагч 09:00–18:00) өвлөнө. Шинэ салбарт (base-гүй) ирээгүй өдрүүд
  // анхдагч Даваа–Баасан нээлттэй — вэб form-ын анхдагчтай ижил.
  const defaultOpen = str(fd.get("openTime")) || "09:00";
  const defaultClose = str(fd.get("closeTime")) || "18:00";
  if (!base) {
    for (const wd of ALL_WEEKDAYS) {
      if (!days.has(wd)) {
        days.set(wd, { isOpen: DEFAULT_OPEN_DAYS.includes(wd), openTime: null, closeTime: null });
      }
    }
  }
  for (const [wd, d] of days) {
    fd.set(`schedule_${wd}_isOpen`, d.isOpen ? "on" : "off");
    fd.set(`schedule_${wd}_openTime`, d.openTime ?? (d.isOpen ? defaultOpen : ""));
    fd.set(`schedule_${wd}_closeTime`, d.closeTime ?? (d.isOpen ? defaultClose : ""));
  }
  return fd;
}
