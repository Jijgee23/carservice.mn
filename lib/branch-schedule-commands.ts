// Салбарын тусгай өдөр (BranchScheduleException), улирлын хуваарь
// (BranchScheduleSeason), бүх салбарт баярын өдөр тохируулах — дундын бизнес
// логик. Вэбийн server action (app/_actions/branch-schedules.ts) болон мобайл
// staff API (app/api/v1/branches/[id]/schedules/**, .../branches/schedules/holiday)
// хоёулаа ЭНД дуудна. Validation нь вэб form-ийн `FormData` хэлбэр дээр
// ажилладаг тул API JSON body-г `exceptionBodyToFormData` /
// `seasonBodyToFormData`-аар ижил хэлбэрт хөрвүүлнэ — дүрэм, мессеж давхардахгүй.
//
// Эрх (canEdit "branches") болон багцын идэвхтэй эсэхийг (subscription)
// дуудагч өөрөө шалгана: вэб — `authorizeBranch()`, API — `requirePermission`
// + `requireActiveSubscriptionApi`. revalidatePath-ийг вэб action хийнэ.
//
// RLS: async helper дотор үргэлж `return await prisma…`.

import { logAudit } from "@/lib/audit";
import { ALL_WEEKDAYS, isValidTime, WEEK_DAYS, type Weekday } from "@/lib/branches";
import { bookingDayBounds } from "@/lib/booking-time";
import { prisma } from "@/lib/prisma";
import { resolveEffectiveSchedule } from "@/lib/branch-effective-schedule";
import { applyScheduleClips, inspectScheduleImpact, type ScheduleImpact } from "@/lib/branch-schedule-impact";

/** Хуваарь засаж буй ажилтан (вэбийн SessionUser / API-ийн ApiUser аль аль нь таарна). */
export type BranchScheduleActor = { id: string; tenantId: string };

export type BranchScheduleCommandResult =
  | { ok: true; id: string; created: boolean; clipped: number; message: string }
  | { ok: false; code: "VALIDATION"; fieldErrors: Record<string, string> }
  | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "ERROR"; message: string }
  | { ok: false; code: "SCHEDULE_IMPACT"; message: string; impact: ScheduleImpact; needsConfirm: boolean };

export type BranchScheduleDeleteResult =
  | { ok: true; deleted: boolean }
  | { ok: false; code: "SCHEDULE_IMPACT"; message: string; impact: ScheduleImpact; needsConfirm: false };

/** Transaction дотроос шидэгдэж, кодтой үр дүн болж хувирах хүлээгдэж буй алдаа. */
class ScheduleCommandError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CONFLICT", message: string) {
    super(message);
    this.name = "ScheduleCommandError";
  }
}

function s(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  try {
    bookingDayBounds(value);
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

function parseOpenTimes(
  fd: FormData,
  prefix: string,
  errors: Record<string, string>,
) {
  const isOpen = fd.get(`${prefix}_isOpen`) === "on";
  const openTime = s(fd, `${prefix}_openTime`) || null;
  const closeTime = s(fd, `${prefix}_closeTime`) || null;
  if (isOpen) {
    if (!openTime || !isValidTime(openTime)) errors[`${prefix}_openTime`] = "Нээх цаг шаардлагатай.";
    if (!closeTime || !isValidTime(closeTime)) errors[`${prefix}_closeTime`] = "Хаах цаг шаардлагатай.";
    if (openTime && closeTime && isValidTime(openTime) && isValidTime(closeTime) && closeTime <= openTime) {
      errors[`${prefix}_closeTime`] = "Хаах цаг нээх цагаас хойш байна.";
    }
  }
  return { isOpen, openTime, closeTime };
}

async function branchExists(actor: BranchScheduleActor, branchId: string) {
  return await prisma.branch.findFirst({
    where: { id: branchId, tenantId: actor.tenantId },
    select: { id: true, name: true },
  });
}

// --- EXCEPTION (нэг удаагийн тусгай өдөр) ------------------------------------

/**
 * Тусгай өдөр нэмэх/засах. FormData талбарууд: date (YYYY-MM-DD), exceptionId?
 * (засах үед), label?, exception_isOpen ("on"), exception_openTime,
 * exception_closeTime. Ирээдүйн захиалгыг бүрэн хүчингүй болгох бол хатуу
 * хориг; зөвхөн богиносгох бол `confirmed`-гүйгээр SCHEDULE_IMPACT.
 */
export async function upsertBranchScheduleException(
  actor: BranchScheduleActor,
  branchId: string,
  formData: FormData,
  confirmed: boolean,
): Promise<BranchScheduleCommandResult> {
  if (!(await branchExists(actor, branchId))) {
    return { ok: false, code: "NOT_FOUND", message: "Салбар олдсонгүй." };
  }

  const dateStr = s(formData, "date");
  const exceptionId = s(formData, "exceptionId") || null;
  const label = s(formData, "label");
  const date = parseDate(dateStr);
  const errors: Record<string, string> = {};
  if (!date) errors.date = "Огноог YYYY-MM-DD хэлбэрээр оруулна уу.";
  if (label.length > 120) errors.label = "Тайлбар 120 тэмдэгтээс урт байж болохгүй.";
  const times = parseOpenTimes(formData, "exception", errors);
  if (Object.keys(errors).length > 0) return { ok: false, code: "VALIDATION", fieldErrors: errors };

  try {
    const result = await prisma.$transaction(async (tx) => {
      // S13: same branch-row lock as lib/appointment-reservations.ts, so the
      // overlap check + impact inspection + save serialize against concurrent
      // bookings on this branch.
      await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${branchId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`;
      const current = await tx.branch.findFirst({
        where: { id: branchId, tenantId: actor.tenantId },
        include: { schedules: true, scheduleExceptions: true, scheduleSeasons: { include: { days: true } } },
      });
      if (!current) throw new ScheduleCommandError("NOT_FOUND", "Салбар олдсонгүй.");
      const previous = exceptionId
        ? current.scheduleExceptions.find((item) => item.id === exceptionId)
        : null;
      if (exceptionId && !previous) throw new ScheduleCommandError("NOT_FOUND", "Тусгай өдрийн хуваарь олдсонгүй.");
      const conflictingDate = current.scheduleExceptions.find(
        (item) => item.date.getTime() === date!.getTime() && item.id !== exceptionId,
      );
      if (conflictingDate) throw new ScheduleCommandError("CONFLICT", "Энэ өдөр аль хэдийн тусгай хуваарьтай байна.");
      const proposedException = {
        date: date!,
        isOpen: times.isOpen,
        openTime: times.isOpen ? times.openTime : null,
        closeTime: times.isOpen ? times.closeTime : null,
        label: label || null,
      };
      const branch = {
        openTime: current.openTime,
        closeTime: current.closeTime,
        schedules: current.schedules,
        scheduleExceptions: [
          ...current.scheduleExceptions.filter(
            (item) => item.id !== exceptionId && item.date.getTime() !== date!.getTime(),
          ),
          proposedException,
        ],
        scheduleSeasons: current.scheduleSeasons,
      };
      const affectedDates = [dateStr];
      if (previous) affectedDates.push(previous.date.toISOString().slice(0, 10));
      const affectedDateValues = affectedDates.sort();
      const impact = await inspectScheduleImpact(tx, {
        tenantId: actor.tenantId,
        branchId,
        from: bookingDayBounds(affectedDateValues[0]!).start,
        to: bookingDayBounds(affectedDateValues.at(-1)!).end,
        resolve: (key) => resolveEffectiveSchedule({ dateStr: key, branch }),
        fallbackDurationMinutes: current.slotMinutes ?? 30,
      });
      if (impact.erased.length > 0) {
        return {
          blocked: true as const,
          needsConfirm: false,
          impact,
          message: `Энэ өөрчлөлт ${impact.erased.length} захиалгыг бүрэн хүчингүй болгоно. Ажилтан эхлээд шийднэ үү.`,
        };
      }
      if (impact.clipped.length > 0 && !confirmed) {
        return {
          blocked: true as const,
          needsConfirm: true,
          impact,
          message: `Энэ өөрчлөлт ${impact.clipped.length} захиалгын үргэлжлэх хугацааг богиносгоно. Доор жагсаалтыг харж баталгаажуулна уу.`,
        };
      }
      const existing = await tx.branchScheduleException.findUnique({
        where: { branchId_date: { branchId, date: date! } },
        select: { id: true, isOpen: true, openTime: true, closeTime: true, label: true },
      });
      const saved = await tx.branchScheduleException.upsert({
        where: { branchId_date: { branchId, date: date! } },
        create: { branchId, date: date!, isOpen: times.isOpen, openTime: times.isOpen ? times.openTime : null, closeTime: times.isOpen ? times.closeTime : null, label: label || null },
        update: { isOpen: times.isOpen, openTime: times.isOpen ? times.openTime : null, closeTime: times.isOpen ? times.closeTime : null, label: label || null },
        select: { id: true },
      });
      if (previous && previous.date.getTime() !== date!.getTime()) {
        await tx.branchScheduleException.delete({ where: { id: previous.id } });
      }
      await applyScheduleClips(tx, impact);
      return {
        blocked: false as const,
        existing: existing ?? previous,
        saved,
        clipped: impact.clipped.length,
      };
    });
    if (result.blocked) {
      return { ok: false, code: "SCHEDULE_IMPACT", message: result.message, impact: result.impact, needsConfirm: result.needsConfirm };
    }
    await logAudit({
      tenantId: actor.tenantId,
      userId: actor.id,
      branchId,
      entity: "Branch",
      entityId: branchId,
      action: result.existing ? "UPDATE" : "CREATE",
      summary: `Тусгай өдөр · ${dateStr}`,
      before: result.existing ?? undefined,
      after: { id: result.saved.id, date: dateStr, isOpen: times.isOpen, openTime: times.openTime, closeTime: times.closeTime, label: label || null },
    });
    return {
      ok: true,
      id: result.saved.id,
      created: !result.existing,
      clipped: result.clipped,
      message: result.clipped ? `Хадгаллаа. ${result.clipped} захиалгын үргэлжлэх хугацааг хаах цагт таарууллаа.` : "Тусгай өдрийн хуваарь хадгалагдлаа.",
    };
  } catch (error) {
    if (error instanceof ScheduleCommandError) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: "ERROR", message: error instanceof Error ? error.message : "Тусгай өдөр хадгалахад алдаа гарлаа." };
  }
}

/** Тусгай өдрийг устгана. Олдохгүй бол `deleted: false`. */
export async function deleteBranchScheduleException(
  actor: BranchScheduleActor,
  branchId: string,
  id: string,
): Promise<BranchScheduleDeleteResult> {
  const deleted = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${branchId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`;
    const current = await tx.branch.findFirst({
      where: { id: branchId, tenantId: actor.tenantId },
      include: { schedules: true, scheduleExceptions: true, scheduleSeasons: { include: { days: true } } },
    });
    const target = current?.scheduleExceptions.find((item) => item.id === id);
    if (!current || !target) return { count: 0 };
    const targetDate = target.date.toISOString().slice(0, 10);
    const branch = {
      openTime: current.openTime,
      closeTime: current.closeTime,
      schedules: current.schedules,
      scheduleExceptions: current.scheduleExceptions.filter((item) => item.id !== id),
      scheduleSeasons: current.scheduleSeasons,
    };
    const impact = await inspectScheduleImpact(tx, {
      tenantId: actor.tenantId,
      branchId,
      from: bookingDayBounds(targetDate).start,
      to: bookingDayBounds(targetDate).end,
      resolve: (dateStr) => resolveEffectiveSchedule({ dateStr, branch }),
      fallbackDurationMinutes: current.slotMinutes ?? 30,
    });
    if (impact.erased.length > 0) {
      return { impact, error: `Энэ өөрчлөлт ${impact.erased.length} захиалгыг бүрэн хүчингүй болгоно. Ажилтан эхлээд шийднэ үү.` };
    }
    const result = await tx.branchScheduleException.deleteMany({ where: { id, branchId } });
    await applyScheduleClips(tx, impact);
    return result;
  });
  if ("error" in deleted) {
    return { ok: false, code: "SCHEDULE_IMPACT", message: deleted.error, impact: deleted.impact, needsConfirm: false };
  }
  if (deleted.count > 0) {
    await logAudit({ tenantId: actor.tenantId, userId: actor.id, branchId, entity: "Branch", entityId: branchId, action: "DELETE", summary: "Тусгай өдрийн хуваарь устгав" });
  }
  return { ok: true, deleted: deleted.count > 0 };
}

// --- SEASON (улирлын хуваарь) ----------------------------------------------

/**
 * Улирал нэмэх/засах. FormData талбарууд: seasonId? (засах үед), name,
 * startsOn, endsOn (YYYY-MM-DD), өдөр бүрд season_{WD}_isOpen ("on"),
 * season_{WD}_openTime, season_{WD}_closeTime.
 */
export async function upsertBranchScheduleSeason(
  actor: BranchScheduleActor,
  branchId: string,
  formData: FormData,
  confirmed: boolean,
): Promise<BranchScheduleCommandResult> {
  if (!(await branchExists(actor, branchId))) {
    return { ok: false, code: "NOT_FOUND", message: "Салбар олдсонгүй." };
  }

  const id = s(formData, "seasonId") || null;
  const name = s(formData, "name");
  const startsOn = s(formData, "startsOn");
  const endsOn = s(formData, "endsOn");
  const starts = parseDate(startsOn);
  const ends = parseDate(endsOn);
  const errors: Record<string, string> = {};
  if (!name) errors.name = "Улирлын нэр шаардлагатай.";
  if (name.length > 120) errors.name = "Улирлын нэр 120 тэмдэгтээс урт байж болохгүй.";
  if (!starts) errors.startsOn = "Эхлэх огноо буруу.";
  if (!ends) errors.endsOn = "Дуусах огноо буруу.";
  if (starts && ends && ends <= starts) errors.endsOn = "Дуусах огноо эхлэх огнооноос хойш байна.";
  const days = {} as Record<Weekday, ReturnType<typeof parseOpenTimes>>;
  for (const wd of ALL_WEEKDAYS) days[wd] = parseOpenTimes(formData, `season_${wd}`, errors);
  if (Object.keys(errors).length > 0) return { ok: false, code: "VALIDATION", fieldErrors: errors };

  try {
    const txResult = await prisma.$transaction(async (tx) => {
      // S13: previously this whole action (overlap check through save) ran as
      // bare `prisma.*` calls with no transaction and no lock at all — the
      // overlap check could pass against a stale snapshot that a concurrent
      // write already invalidated. Now matches the branch-row lock pattern
      // used by lib/appointment-reservations.ts and the other mutations here
      // and in lib/branches-commands.ts.
      await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${branchId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`;

      const overlap = await tx.branchScheduleSeason.findFirst({
        where: {
          branchId,
          isActive: true,
          ...(id ? { id: { not: id } } : {}),
          startsOn: { lt: ends! },
          endsOn: { gt: starts! },
        },
        select: { id: true, name: true },
      });
      if (overlap) return { ok: false as const, code: "CONFLICT" as const, message: `Энэ хугацаа "${overlap.name}" улиралтай давхцаж байна.` };

      const existing = id
        ? await tx.branchScheduleSeason.findFirst({ where: { id, branchId }, include: { days: true } })
        : null;
      if (id && !existing) return { ok: false as const, code: "NOT_FOUND" as const, message: "Улирал олдсонгүй." };
      const currentBranch = await tx.branch.findFirst({
        where: { id: branchId, tenantId: actor.tenantId },
        include: { schedules: true, scheduleExceptions: true, scheduleSeasons: { include: { days: true } } },
      });
      if (!currentBranch) return { ok: false as const, code: "NOT_FOUND" as const, message: "Салбар олдсонгүй." };
      const proposedSeason = {
        name,
        startsOn: starts!,
        endsOn: ends!,
        isActive: true,
        days: ALL_WEEKDAYS.map((weekday) => ({ weekday, ...days[weekday] })),
      };
      const now = new Date();
      const seasonImpactStart = bookingDayBounds(startsOn).start;
      const seasonImpactEnd = bookingDayBounds(endsOn).start;
      const impactFrom = seasonImpactStart.getTime() > now.getTime() ? seasonImpactStart : now;
      const impact = impactFrom < seasonImpactEnd
        ? await inspectScheduleImpact(tx, {
            tenantId: actor.tenantId,
            branchId,
            from: impactFrom,
            to: seasonImpactEnd,
            resolve: (dateStr) => resolveEffectiveSchedule({
              dateStr,
              branch: {
                openTime: currentBranch.openTime,
                closeTime: currentBranch.closeTime,
                schedules: currentBranch.schedules,
                scheduleExceptions: currentBranch.scheduleExceptions,
                scheduleSeasons: [
                  ...currentBranch.scheduleSeasons.filter((item) => item.id !== id),
                  proposedSeason,
                ],
              },
            }),
            fallbackDurationMinutes: currentBranch.slotMinutes ?? 30,
          })
        : { erased: [], clipped: [] };
      if (impact.erased.length > 0) {
        return {
          ok: false as const,
          code: "SCHEDULE_IMPACT" as const,
          message: `Энэ улирал ${impact.erased.length} захиалгыг бүрэн хүчингүй болгоно. Ажилтан эхлээд шийднэ үү.`,
          impact,
          needsConfirm: false,
        };
      }
      if (impact.clipped.length > 0 && !confirmed) {
        return {
          ok: false as const,
          code: "SCHEDULE_IMPACT" as const,
          message: `Энэ улирал ${impact.clipped.length} захиалгын үргэлжлэх хугацааг богиносгоно. Доор жагсаалтыг харж баталгаажуулна уу.`,
          impact,
          needsConfirm: true,
        };
      }
      const saved = existing
        ? await tx.branchScheduleSeason.update({
            where: { id: id! },
            data: { name, startsOn: starts!, endsOn: ends!, isActive: true, days: { deleteMany: {}, create: ALL_WEEKDAYS.map((weekday) => ({ weekday, isOpen: days[weekday].isOpen, openTime: days[weekday].isOpen ? days[weekday].openTime : undefined, closeTime: days[weekday].isOpen ? days[weekday].closeTime : undefined })) } },
            select: { id: true },
          })
        : await tx.branchScheduleSeason.create({
            data: { branchId, name, startsOn: starts!, endsOn: ends!, isActive: true, days: { create: ALL_WEEKDAYS.map((weekday) => ({ weekday, isOpen: days[weekday].isOpen, openTime: days[weekday].openTime || undefined, closeTime: days[weekday].closeTime || undefined })) } },
            select: { id: true },
          });
      await applyScheduleClips(tx, impact);
      return { ok: true as const, existing, saved, clipped: impact.clipped.length };
    });
    if (!txResult.ok) {
      if (txResult.code === "SCHEDULE_IMPACT") {
        return { ok: false, code: "SCHEDULE_IMPACT", message: txResult.message, impact: txResult.impact, needsConfirm: txResult.needsConfirm };
      }
      return { ok: false, code: txResult.code, message: txResult.message };
    }
    const { existing, saved, clipped } = txResult;
    await logAudit({
      tenantId: actor.tenantId,
      userId: actor.id,
      branchId,
      entity: "Branch",
      entityId: branchId,
      action: existing ? "UPDATE" : "CREATE",
      summary: `Улирлын хуваарь · ${name}`,
      before: existing ? { id: existing.id, name: existing.name, startsOn: existing.startsOn.toISOString(), endsOn: existing.endsOn.toISOString(), days: existing.days } : undefined,
      after: { id: saved.id, name, startsOn, endsOn, days },
    });
    return {
      ok: true,
      id: saved.id,
      created: !existing,
      clipped,
      message: clipped ? `Хадгаллаа. ${clipped} захиалгын үргэлжлэх хугацааг хаах цагт таарууллаа.` : "Улирлын хуваарь хадгалагдлаа.",
    };
  } catch (error) {
    return { ok: false, code: "ERROR", message: error instanceof Error ? error.message : "Улирлын хуваарь хадгалахад алдаа гарлаа." };
  }
}

/** Улирлыг устгана. Олдохгүй бол `deleted: false`. */
export async function deleteBranchScheduleSeason(
  actor: BranchScheduleActor,
  branchId: string,
  id: string,
): Promise<BranchScheduleDeleteResult> {
  const deleted = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${branchId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`;
    const current = await tx.branch.findFirst({
      where: { id: branchId, tenantId: actor.tenantId },
      include: { schedules: true, scheduleExceptions: true, scheduleSeasons: { include: { days: true } } },
    });
    const target = current?.scheduleSeasons.find((item) => item.id === id);
    if (!current || !target) return { count: 0 };
    const branch = {
      openTime: current.openTime,
      closeTime: current.closeTime,
      schedules: current.schedules,
      scheduleExceptions: current.scheduleExceptions,
      scheduleSeasons: current.scheduleSeasons.filter((item) => item.id !== id),
    };
    const seasonEnd = target.endsOn.toISOString().slice(0, 10);
    const impactFrom = bookingDayBounds(target.startsOn.toISOString().slice(0, 10)).start;
    const now = new Date();
    const from = impactFrom.getTime() > now.getTime() ? impactFrom : now;
    const to = bookingDayBounds(seasonEnd).start;
    const impact = from < to
      ? await inspectScheduleImpact(tx, {
          tenantId: actor.tenantId,
          branchId,
          from,
          to,
          resolve: (dateStr) => resolveEffectiveSchedule({ dateStr, branch }),
          fallbackDurationMinutes: current.slotMinutes ?? 30,
        })
      : { erased: [], clipped: [] };
    if (impact.erased.length > 0) {
      return { impact, error: `Энэ өөрчлөлт ${impact.erased.length} захиалгыг бүрэн хүчингүй болгоно. Ажилтан эхлээд шийднэ үү.` };
    }
    const result = await tx.branchScheduleSeason.deleteMany({ where: { id, branchId } });
    await applyScheduleClips(tx, impact);
    return result;
  });
  if ("error" in deleted) {
    return { ok: false, code: "SCHEDULE_IMPACT", message: deleted.error, impact: deleted.impact, needsConfirm: false };
  }
  if (deleted.count > 0) {
    await logAudit({ tenantId: actor.tenantId, userId: actor.id, branchId, entity: "Branch", entityId: branchId, action: "DELETE", summary: "Улирлын хуваарь устгав" });
  }
  return { ok: true, deleted: deleted.count > 0 };
}

// --- ALL-BRANCH HOLIDAY (fan-out) ------------------------------------------

export type HolidayFanOutResult = {
  ok: boolean;
  message: string;
  succeeded: number;
  failed: number;
  errors: string[];
  /** Салбар тус бүрийн үр дүн (мобайл клиентэд impact-ийг харуулахад). */
  results: Array<{ branchId: string; branchName: string; result: BranchScheduleCommandResult }>;
};

/**
 * Нэг л удаа (жишээ нь Шинэ жил) огноо оруулбал, тенантын БҮХ салбарт нэг
 * зэрэг "тусгай өдөр" тохируулна. Салбар бүрд ЯГ адилхан
 * `upsertBranchScheduleException`-г дуудна (impact-шалгалт, audit) — нэг
 * салбарт захиалга цуцлагдах эрсдэлтэй (`erased`) эсвэл баталгаажуулаагүй
 * (`needsConfirm`) тохиолдол гарвал ЗӨВХӨН тэр салбар алгасагдаж, errors
 * жагсаалтад орно (харах: lib/bulk-action.ts-ийн "all-or-nothing БИШ" загвар).
 * Салбаргүй бол `null`.
 */
export async function applyHolidayToAllBranches(
  actor: BranchScheduleActor,
  formData: FormData,
  confirmed: boolean,
): Promise<HolidayFanOutResult | null> {
  const branches = await prisma.branch.findMany({
    where: { tenantId: actor.tenantId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  if (branches.length === 0) return null;

  let succeeded = 0;
  const errors: string[] = [];
  const results: HolidayFanOutResult["results"] = [];
  for (const branch of branches) {
    // `formData` дахин ашиглана — функц зөвхөн УНШИНА (мутэйт хийхгүй) тул
    // нэг FormData-г олон удаа дамжуулах аюулгүй.
    const result = await upsertBranchScheduleException(actor, branch.id, formData, confirmed);
    results.push({ branchId: branch.id, branchName: branch.name, result });
    if (result.ok) {
      succeeded++;
    } else {
      errors.push(`${branch.name}: ${"message" in result ? result.message : "алдаа"}`);
    }
  }

  if (succeeded === 0) {
    return {
      ok: false,
      message: errors[0] ?? "Хадгалахад алдаа гарлаа.",
      succeeded,
      failed: errors.length,
      errors,
      results,
    };
  }
  return {
    ok: true,
    message: `${succeeded}/${branches.length} салбарт хадгалагдлаа.${errors.length ? ` (${errors.length} амжилтгүй)` : ""}`,
    succeeded,
    failed: errors.length,
    errors,
    results,
  };
}

// --- READ (мобайл жагсаалт; вэбийн /dashboard/branches/[id]/schedule хуудастай ижил өгөгдөл)

type DayHours = { isOpen: boolean; openTime: string | null; closeTime: string | null };

export async function getBranchSchedules(tenantId: string, branchId: string) {
  const [branch, tenantBranchCount] = await Promise.all([
    prisma.branch.findFirst({
      where: { id: branchId, tenantId },
      include: {
        schedules: true,
        scheduleExceptions: { orderBy: { date: "asc" } },
        scheduleSeasons: { orderBy: { startsOn: "asc" }, include: { days: true } },
      },
    }),
    prisma.branch.count({ where: { tenantId } }),
  ]);
  if (!branch) return null;

  const baseDays = Object.fromEntries(WEEK_DAYS.map((day) => {
    const saved = branch.schedules.find((item) => item.weekday === day.value);
    return [day.value, {
      isOpen: saved?.isOpen ?? Boolean(branch.openTime && branch.closeTime),
      openTime: saved?.openTime ?? branch.openTime ?? null,
      closeTime: saved?.closeTime ?? branch.closeTime ?? null,
    }];
  })) as Record<Weekday, DayHours>;

  return {
    branch: { id: branch.id, name: branch.name },
    baseDays,
    exceptions: branch.scheduleExceptions.map((item) => ({
      id: item.id,
      date: item.date.toISOString().slice(0, 10),
      isOpen: item.isOpen,
      openTime: item.openTime,
      closeTime: item.closeTime,
      label: item.label,
    })),
    seasons: branch.scheduleSeasons.map((item) => ({
      id: item.id,
      name: item.name,
      startsOn: item.startsOn.toISOString().slice(0, 10),
      endsOn: item.endsOn.toISOString().slice(0, 10),
      isActive: item.isActive,
      days: Object.fromEntries(WEEK_DAYS.map((day) => {
        const saved = item.days.find((entry) => entry.weekday === day.value);
        return [day.value, {
          isOpen: saved?.isOpen ?? false,
          openTime: saved?.openTime ?? null,
          closeTime: saved?.closeTime ?? null,
        }];
      })) as Record<Weekday, DayHours>,
    })),
    tenantBranchCount,
  };
}

/** Тухайн id аль төрлийн мөр болохыг (тухайн салбарын хүрээнд) тодорхойлно. */
export async function findBranchScheduleKind(
  tenantId: string,
  branchId: string,
  scheduleId: string,
): Promise<"exception" | "season" | null> {
  const [exception, season] = await Promise.all([
    prisma.branchScheduleException.findFirst({
      where: { id: scheduleId, branchId, branch: { tenantId } },
      select: { id: true },
    }),
    prisma.branchScheduleSeason.findFirst({
      where: { id: scheduleId, branchId, branch: { tenantId } },
      select: { id: true },
    }),
  ]);
  if (exception) return "exception";
  if (season) return "season";
  return null;
}

// --- JSON (мобайл API) → вэб form-ийн FormData хэлбэр -----------------------

type HoursJson = { isOpen?: unknown; openTime?: unknown; closeTime?: unknown };

export type ExceptionJsonBody = HoursJson & { date?: unknown; label?: unknown };

export type SeasonJsonBody = {
  name?: unknown;
  startsOn?: unknown;
  endsOn?: unknown;
  days?: unknown;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function putHours(fd: FormData, prefix: string, h: HoursJson | undefined) {
  if (h?.isOpen === true) fd.set(`${prefix}_isOpen`, "on");
  fd.set(`${prefix}_openTime`, str(h?.openTime));
  fd.set(`${prefix}_closeTime`, str(h?.closeTime));
}

/** `base` (засах үед одоогийн мөр) дээр body-г давхарлаж FormData болгоно. */
export function exceptionBodyToFormData(
  body: ExceptionJsonBody,
  opts: { exceptionId?: string; base?: { date: string; isOpen: boolean; openTime: string | null; closeTime: string | null; label: string | null } } = {},
): FormData {
  const base = opts.base;
  const pick = <K extends keyof ExceptionJsonBody>(key: K, fallback: unknown) =>
    key in body ? body[key] : fallback;
  const fd = new FormData();
  if (opts.exceptionId) fd.set("exceptionId", opts.exceptionId);
  fd.set("date", str(pick("date", base?.date)));
  fd.set("label", str(pick("label", base?.label)));
  putHours(fd, "exception", {
    isOpen: pick("isOpen", base?.isOpen),
    openTime: pick("openTime", base?.openTime),
    closeTime: pick("closeTime", base?.closeTime),
  });
  return fd;
}

export function seasonBodyToFormData(
  body: SeasonJsonBody,
  opts: { seasonId?: string; base?: { name: string; startsOn: string; endsOn: string; days: Record<Weekday, DayHours> } } = {},
): FormData {
  const base = opts.base;
  const fd = new FormData();
  if (opts.seasonId) fd.set("seasonId", opts.seasonId);
  fd.set("name", str("name" in body ? body.name : base?.name));
  fd.set("startsOn", str("startsOn" in body ? body.startsOn : base?.startsOn));
  fd.set("endsOn", str("endsOn" in body ? body.endsOn : base?.endsOn));
  const days = (body.days && typeof body.days === "object" && !Array.isArray(body.days)
    ? body.days
    : {}) as Partial<Record<Weekday, HoursJson>>;
  for (const wd of ALL_WEEKDAYS) {
    const given = days[wd];
    putHours(fd, `season_${wd}`, given && typeof given === "object" ? given : base?.days[wd]);
  }
  return fd;
}

/**
 * Вэб form-ийн fieldErrors түлхүүрийг JSON талбарын нэр рүү буулгана:
 * `exception_openTime` → `openTime`, `season_MON_closeTime` → `days.MON.closeTime`.
 */
export function scheduleFieldErrorsToJson(fieldErrors: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, msg] of Object.entries(fieldErrors)) {
    const season = /^season_([A-Z]{3})_(openTime|closeTime)$/.exec(key);
    if (season) out[`days.${season[1]}.${season[2]}`] = msg;
    else out[key.replace(/^exception_/, "")] = msg;
  }
  return out;
}
