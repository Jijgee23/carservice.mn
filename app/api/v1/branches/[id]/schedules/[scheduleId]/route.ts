// Contract — PATCH/DELETE /api/v1/branches/[id]/schedules/[scheduleId]
//
// `scheduleId` нь тухайн салбарын тусгай өдөр (exception) эсвэл улирлын
// (season) id — төрлийг сервер өөрөө тодорхойлно (хариунд `kind`).
// Эрх: `branches.edit`; идэвхтэй багц шаардана (403 SUBSCRIPTION_EXPIRED).
// Логик: lib/branch-schedule-commands.ts (вэбийн app/_actions/branch-schedules.ts-тэй нэг).
//
// PATCH — хэсэгчилсэн засвар: ирээгүй талбар одоогийн утгаараа үлдэнэ.
//   exception: { date?, isOpen?, openTime?, closeTime?, label?, confirm? }
//     (огноог өөрчилбөл хуучин өдрийн мөр устаж шинэ өдөрт шилжинэ — вэбтэй адил)
//   season:    { name?, startsOn?, endsOn?, days?: { MON..SUN: {...} }, confirm? }
//     (days-д ирээгүй өдөр одоогийн утгаараа үлдэнэ)
//   200: { kind, id, scheduleClipped, message, schedules: <GET /branches/[id]/schedules хэлбэр> }
//   Алдаа: 400 VALIDATION, 401, 403, 404 NOT_FOUND, 409 CONFLICT, 409 SCHEDULE_IMPACT
//     { impact, needsConfirm } (POST /schedules-тэй ижил дүрэм), 500.
//
// DELETE
//   Устгахад нөлөөлөх захиалга бүрэн хүчингүй болох бол 409 SCHEDULE_IMPACT
//   (needsConfirm: false — хатуу хориг); зөвхөн богиносох бол вэбтэй адил
//   баталгаажуулалтгүйгээр устгаж, захиалгын хугацааг таарууллна.
//   200: { ok: true, kind, id }. Алдаа: 401, 403, 404 NOT_FOUND, 409 SCHEDULE_IMPACT.

import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { readJsonObject, scheduleFailureResponse } from "@/lib/branch-schedule-api";
import {
  deleteBranchScheduleException,
  deleteBranchScheduleSeason,
  exceptionBodyToFormData,
  findBranchScheduleKind,
  getBranchSchedules,
  seasonBodyToFormData,
  upsertBranchScheduleException,
  upsertBranchScheduleSeason,
} from "@/lib/branch-schedule-commands";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

type Ctx = { params: Promise<{ id: string; scheduleId: string }> };

const NOT_FOUND_MESSAGE = "Хуваарь олдсонгүй.";

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "branches.edit");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const { id, scheduleId } = await ctx.params;

  const body = await readJsonObject(req);
  if (!body) return jsonError(400, "JSON body шаардлагатай.", { code: "VALIDATION" });

  const current = await getBranchSchedules(auth.user.tenantId, id);
  if (!current) return jsonError(404, "Салбар олдсонгүй.", { code: "NOT_FOUND" });
  const confirmed = body.confirm === true;

  const exception = current.exceptions.find((e) => e.id === scheduleId);
  const season = exception ? undefined : current.seasons.find((s) => s.id === scheduleId);
  if (!exception && !season) return jsonError(404, NOT_FOUND_MESSAGE, { code: "NOT_FOUND" });

  const kind = exception ? "exception" : "season";
  const result = exception
    ? await upsertBranchScheduleException(
        auth.user,
        id,
        exceptionBodyToFormData(body, { exceptionId: scheduleId, base: exception }),
        confirmed,
      )
    : await upsertBranchScheduleSeason(
        auth.user,
        id,
        seasonBodyToFormData(body, { seasonId: scheduleId, base: season }),
        confirmed,
      );
  if (!result.ok) return scheduleFailureResponse(result, "api/v1/branches/schedules PATCH");

  const schedules = await getBranchSchedules(auth.user.tenantId, id);
  return jsonOk({
    kind,
    id: result.id,
    scheduleClipped: result.clipped,
    message: result.message,
    schedules,
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "branches.edit");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const { id, scheduleId } = await ctx.params;

  const kind = await findBranchScheduleKind(auth.user.tenantId, id, scheduleId);
  if (!kind) return jsonError(404, NOT_FOUND_MESSAGE, { code: "NOT_FOUND" });

  const result = kind === "exception"
    ? await deleteBranchScheduleException(auth.user, id, scheduleId)
    : await deleteBranchScheduleSeason(auth.user, id, scheduleId);
  if (!result.ok) {
    return jsonError(409, result.message, {
      code: "SCHEDULE_IMPACT",
      impact: result.impact,
      needsConfirm: false,
    });
  }
  if (!result.deleted) return jsonError(404, NOT_FOUND_MESSAGE, { code: "NOT_FOUND" });
  return jsonOk({ ok: true, kind, id: scheduleId });
}
