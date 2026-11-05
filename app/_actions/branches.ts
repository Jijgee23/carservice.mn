"use server";


import { isForeignKeyViolation } from "@/lib/prisma-errors";
import type { ConfirmActionResult } from "@/lib/confirm-action";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { canCreate, canDelete, canEdit } from "@/lib/auth/roles";
import { assertActiveSubscription } from "@/lib/subscription-server";
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

export type BranchActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  // S13 Phase 4: detailed affected-bookings preview (see
  // app/dashboard/branches/_components/schedule-impact-preview.tsx). Present
  // whenever a save was blocked or is pending confirmation because of
  // erased/clipped reservations.
  impact?: ScheduleImpact;
  // true when `impact.clipped` is non-empty and non-destructive (no erased
  // items) — the caller should resubmit with confirmed=true to proceed.
  needsConfirm?: boolean;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function authorize(action: "create" | "edit" | "delete") {
  const user = await requireUser();
  const ok =
    action === "create"
      ? canCreate(user, "branches")
      : action === "edit"
        ? canEdit(user, "branches")
        : canDelete(user, "branches");
  if (!ok) {
    throw new Error("Танд салбарт энэ үйлдэл хийх эрх байхгүй.");
  }
  await assertActiveSubscription(user.tenantId);
  return user;
}

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
  daySchedules: Record<Weekday, { isOpen: boolean; openTime: string | null; closeTime: string | null }>;
  isPrimary: boolean;
  tagIds: string[];
  errors: Record<string, string>;
};

// Илгээсэн tagIds-с зөвхөн бодитоор идэвхтэй BranchTag-т харгалзахыг нь
// шүүнэ — устсан/идэвхгүй болсон шошгыг чимээгүй орхино (harах:
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

export async function createBranchAction(
  _prev: BranchActionState,
  formData: FormData,
): Promise<BranchActionState> {
  let user;
  try {
    user = await authorize("create");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const p = validate(formData, { requireTag: true });
  if (Object.keys(p.errors).length > 0) {
    return { ok: false, fieldErrors: p.errors };
  }

  // Багцын модуль: «Олон салбар» хаалттай бол зөвхөн нэг салбартай байна.
  if (!(await isModuleEnabled(user.tenantId, "enable_multi_branch"))) {
    const existing = await prisma.branch.count({ where: { tenantId: user.tenantId } });
    if (existing >= 1) {
      return { ok: false, message: moduleDisabledMessage("enable_multi_branch") };
    }
  }

  const tagIds = await validTagIds(p.tagIds);

  let createdId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      // Хэрэв isPrimary=true бол бусад салбаруудыг false болгоно
      if (p.isPrimary) {
        await tx.branch.updateMany({
          where: { tenantId: user.tenantId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      // Тенант дотор анхных нь автоматаар үндсэн салбар болно
      const existing = await tx.branch.count({
        where: { tenantId: user.tenantId },
      });
      const isPrimary = p.isPrimary || existing === 0;
      const branch = await tx.branch.create({
        data: {
          ...toBranchData(p),
          isPrimary,
          tenantId: user.tenantId,
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
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Үүсгэх явцад алдаа гарлаа.",
    };
  }

  if (createdId) {
    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      entity: "Branch",
      entityId: createdId,
      action: "CREATE",
      summary: p.name,
      after: toBranchData(p),
    });
  }

  revalidatePath("/dashboard/branches");
  revalidatePath("/dashboard");
  redirect("/dashboard/branches");
}

export async function updateBranchAction(
  id: string,
  _prev: BranchActionState,
  formData: FormData,
): Promise<BranchActionState> {
  let user;
  try {
    user = await authorize("edit");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const p = validate(formData);
  if (Object.keys(p.errors).length > 0) {
    return { ok: false, fieldErrors: p.errors };
  }

  const confirmed = s(formData, "confirmed") === "true";
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
      await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${id} AND "tenantId" = ${user.tenantId} FOR UPDATE`;
      const current = await tx.branch.findFirst({
        where: { id, tenantId: user.tenantId },
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
        throw new Error(
          "Үндсэн салбарыг идэвхгүй болгохын тулд эхлээд өөр салбарыг үндсэн болгоно уу.",
        );
      }

      if (p.isPrimary && !current.isPrimary) {
        await tx.branch.updateMany({
          where: { tenantId: user.tenantId, isPrimary: true },
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
        tenantId: user.tenantId,
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
        where: { id, tenantId: user.tenantId },
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

    if (updateResult.blocked) {
      return {
        ok: false,
        message: updateResult.needsConfirm
          ? `Хуваарь хадгалбал ${updateResult.impact!.clipped.length} захиалгын үргэлжлэх хугацаа богиносно. Доор жагсаалтыг харж, үргэлжлүүлэхийг баталгаажуулна уу.`
          : `Хуваарь хадгалахад ${updateResult.impact!.erased.length} захиалга бүрэн хүчингүй болно. Ажилтан эхлээд эдгээрийг шийдвэрлэнэ үү.`,
        impact: updateResult.impact!,
        needsConfirm: updateResult.needsConfirm,
      };
    }
    if (updateResult.count === 0) {
      return { ok: false, message: "Салбар олдсонгүй." };
    }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Шинэчлэх явцад алдаа гарлаа.",
    };
  }

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "Branch",
    entityId: id,
    action: "UPDATE",
    summary: p.name,
    after: toBranchData(p),
  });

  revalidatePath("/dashboard/branches");
  revalidatePath(`/dashboard/branches/${id}`);
  redirect(`/dashboard/branches${updateResult.clipped ? `?scheduleWarning=${updateResult.clipped}` : ""}`);
}

export async function toggleBranchActiveAction(formData: FormData): Promise<void> {
  const user = await authorize("edit");
  const id = s(formData, "id");
  if (!id) return;

  const target = await prisma.branch.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { isPrimary: true, isActive: true, name: true },
  });
  if (!target) return;
  if (target.isPrimary && target.isActive) {
    throw new Error(
      "Үндсэн салбарыг идэвхгүй болгохын тулд эхлээд өөр салбарыг үндсэн болгоно уу.",
    );
  }

  const nextActive = !target.isActive;
  await prisma.branch.update({
    where: { id },
    data: { isActive: nextActive },
  });

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "Branch",
    entityId: id,
    action: "STATUS_CHANGE",
    summary: `${target.name} · ${nextActive ? "идэвхжүүлсэн" : "идэвхгүй болгосон"}`,
    before: { isActive: target.isActive },
    after: { isActive: nextActive },
  });

  revalidatePath("/dashboard/branches");
  revalidatePath("/dashboard");
}

export async function deleteBranchAction(formData: FormData): Promise<ConfirmActionResult> {
  const user = await authorize("delete");
  const id = s(formData, "id");
  if (!id) return;

  const target = await prisma.branch.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { isPrimary: true, name: true },
  });
  if (!target) return;
  if (target.isPrimary) {
    return { error: "Үндсэн салбарыг устгах боломжгүй. Эхлээд өөр салбарыг үндсэн болгоно уу." };
  }

  // User.branchId нь onDelete: SetNull тул DB зогсоохгүй — ажилтнууд салбаргүй
  // болж, ээлжийн хуваарь нь cascade-аар устна. Тиймээс апп түвшинд хориглоно.
  // Тоолох болон устгахыг нэг transaction-д хийж, хооронд нь ажилтан
  // оноогдохоос сэргийлнэ.
  let employeeCount = 0;
  try {
    employeeCount = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${id} AND "tenantId" = ${user.tenantId} FOR UPDATE`;
      // Tombstone (устгагдсан) ажилтан салбарыг түгжихгүй — захиалгын FK-д л үлддэг.
      const count = await tx.user.count({ where: { branchId: id, tenantId: user.tenantId, deletedAt: null } });
      if (count > 0) return count;
      await tx.branch.delete({ where: { id, tenantId: user.tenantId } });
      return 0;
    });
  } catch (e) {
    if (isForeignKeyViolation(e)) {
      return { error: "Энэ салбарт засварын хуудас/цаг захиалга бүртгэлтэй тул устгах боломжгүй." };
    }
    throw e;
  }
  if (employeeCount > 0) {
    return {
      error: `Энэ салбарт ${employeeCount} ажилтан бүртгэлтэй. Эхлээд тэднийг өөр салбар руу шилжүүлнэ үү.`,
    };
  }

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "Branch",
    entityId: id,
    action: "DELETE",
    summary: target.name,
  });

  revalidatePath("/dashboard/branches");
  revalidatePath("/dashboard");
}
