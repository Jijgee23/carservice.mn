// Contract — GET/POST /api/v1/branches/[id]/schedules (тусгай өдөр, улирал)
//
// Эрх: `branches.edit` — вэбийн /dashboard/branches/[id]/schedule хуудас ба
// app/_actions/branch-schedules.ts-ийн authorizeBranch()-тэй адил (canEdit
// "branches"). Модулийн хаалтгүй (вэбтэй адил). Бизнес логик:
// lib/branch-schedule-commands.ts (вэбтэй нэг).
//
// GET
//   200: { branch: { id, name },
//          baseDays: { MON..SUN: { isOpen, openTime, closeTime } },  // долоо хоногийн үндсэн цаг
//          exceptions: [{ id, date: "YYYY-MM-DD", isOpen, openTime, closeTime, label }],
//          seasons: [{ id, name, startsOn, endsOn, isActive,
//                      days: { MON..SUN: { isOpen, openTime, closeTime } } }],
//          tenantBranchCount }   // > 1 үед л «бүх салбарт» (POST /branches/schedules/holiday) санал болгоно
//   Алдаа: 401, 403, 404 NOT_FOUND.
//
// POST — шинэ тусгай өдөр эсвэл улирал. Идэвхтэй багц шаардана (403 SUBSCRIPTION_EXPIRED).
//   Body (exception): { kind: "exception", date: "YYYY-MM-DD", isOpen: boolean,
//                       openTime?: "HH:MM", closeTime?: "HH:MM", label?: string, confirm?: boolean }
//   Body (season):    { kind: "season", name, startsOn: "YYYY-MM-DD", endsOn: "YYYY-MM-DD",
//                       days: { MON..SUN: { isOpen, openTime?, closeTime? } }, confirm?: boolean }
//     (season: ирээгүй өдөр хаалттай гэж тооцогдоно — вэб form-той адил)
//   201: { kind, id, created, scheduleClipped: number, message, schedules: <GET хэлбэр> }
//   Хуваарийн нөлөө (ирээдүйн захиалга) — PATCH /branches/[id]-тэй ижил:
//     бүрэн хүчингүй болох захиалга → 409 { code: "SCHEDULE_IMPACT", impact, needsConfirm: false };
//     зөвхөн богиносох бол confirm:true-гүй → 409 { ..., needsConfirm: true }.
//     impact = { erased: [{ id, kind, requestedAt, originalDurationMinutes }],
//                clipped: [{ id, kind, requestedAt, durationMinutes, originalDurationMinutes }] }
//   Алдаа: 400 VALIDATION { fieldErrors: date|label|openTime|closeTime|name|startsOn|endsOn|
//          days.MON.openTime… }, 401, 403, 404 NOT_FOUND, 409 CONFLICT (тухайн өдөр аль
//          хэдийн тусгай хуваарьтай / улирал давхцсан), 409 SCHEDULE_IMPACT, 500.

import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { readJsonObject, scheduleFailureResponse } from "@/lib/branch-schedule-api";
import {
  exceptionBodyToFormData,
  getBranchSchedules,
  seasonBodyToFormData,
  upsertBranchScheduleException,
  upsertBranchScheduleSeason,
} from "@/lib/branch-schedule-commands";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "branches.edit");
  if (denied) return denied;
  const { id } = await ctx.params;

  const schedules = await getBranchSchedules(auth.user.tenantId, id);
  if (!schedules) return jsonError(404, "Салбар олдсонгүй.", { code: "NOT_FOUND" });
  return jsonOk(schedules);
}

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "branches.edit");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const { id } = await ctx.params;

  const body = await readJsonObject(req);
  if (!body) return jsonError(400, "JSON body шаардлагатай.", { code: "VALIDATION" });
  const kind = body.kind;
  if (kind !== "exception" && kind !== "season") {
    return jsonError(400, "kind нь \"exception\" эсвэл \"season\" байна.", {
      code: "VALIDATION",
      fieldErrors: { kind: "exception | season" },
    });
  }
  const confirmed = body.confirm === true;

  const result = kind === "exception"
    ? await upsertBranchScheduleException(auth.user, id, exceptionBodyToFormData(body), confirmed)
    : await upsertBranchScheduleSeason(auth.user, id, seasonBodyToFormData(body), confirmed);
  if (!result.ok) return scheduleFailureResponse(result, "api/v1/branches/schedules POST");

  const schedules = await getBranchSchedules(auth.user.tenantId, id);
  return jsonOk(
    {
      kind,
      id: result.id,
      created: result.created,
      scheduleClipped: result.clipped,
      message: result.message,
      schedules,
    },
    { status: 201 },
  );
}
