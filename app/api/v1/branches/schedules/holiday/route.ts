// Contract — POST /api/v1/branches/schedules/holiday (баярын өдрийг БҮХ салбарт)
//
// Вэбийн applyHolidayToAllBranchesAction-тэй нэг логик
// (lib/branch-schedule-commands.ts applyHolidayToAllBranches): тенантын салбар
// бүрд ижил тусгай өдрийг upsert хийнэ. All-or-nothing БИШ — нэг салбарт
// захиалга хүчингүй болох (erased) эсвэл confirm-гүй богиносолт гарвал зөвхөн
// тэр салбар алгасагдаж `errors`/`results`-д орно.
// Эрх: `branches.edit`; идэвхтэй багц шаардана (403 SUBSCRIPTION_EXPIRED).
// (Path-ийн `schedules` нь [id]-ээс өмнө тааруулагддаг static сегмент.)
//
// Body: { date: "YYYY-MM-DD", isOpen: boolean, openTime?: "HH:MM",
//         closeTime?: "HH:MM", label?: string, confirm?: boolean }
// 200: { ok, message, succeeded, failed, errors: string[],
//        results: [{ branchId, branchName, ok, id?, code?, message?, fieldErrors?,
//                    impact?, needsConfirm? }] }
//   ok=false (бүх салбар амжилтгүй) үед ч 200 — салбар тус бүрийн шалтгаан results-д.
// Алдаа: 400 VALIDATION, 401, 403, 404 NOT_FOUND (салбаргүй).

import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { readJsonObject } from "@/lib/branch-schedule-api";
import {
  applyHolidayToAllBranches,
  type BranchScheduleCommandResult,
  exceptionBodyToFormData,
  scheduleFieldErrorsToJson,
} from "@/lib/branch-schedule-commands";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

type Failure = Exclude<BranchScheduleCommandResult, { ok: true }>;

/** Клиентэд харуулах мессеж — ERROR-ийн түүхий (DB) текстийг гаргахгүй. */
function publicMessage(r: Failure): string {
  if (r.code === "VALIDATION") return "алдаа";
  if (r.code === "ERROR") return "Хуваарь хадгалахад алдаа гарлаа.";
  return r.message;
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "branches.edit");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const body = await readJsonObject(req);
  if (!body) return jsonError(400, "JSON body шаардлагатай.", { code: "VALIDATION" });

  const result = await applyHolidayToAllBranches(
    auth.user,
    exceptionBodyToFormData(body),
    body.confirm === true,
  );
  if (!result) return jsonError(404, "Салбар олдсонгүй.", { code: "NOT_FOUND" });

  return jsonOk({
    ok: result.ok,
    message: result.message,
    succeeded: result.succeeded,
    failed: result.failed,
    // lib-ийн errors нь ERROR-ийн түүхий текстийг агуулж болзошгүй тул дахин бүтээнэ.
    errors: result.results.flatMap(({ branchName, result: r }) =>
      r.ok ? [] : [`${branchName}: ${publicMessage(r)}`],
    ),
    results: result.results.map(({ branchId, branchName, result: r }) => {
      if (r.ok) return { branchId, branchName, ok: true, id: r.id, message: r.message };
      if (r.code === "VALIDATION") {
        return { branchId, branchName, ok: false, code: r.code, fieldErrors: scheduleFieldErrorsToJson(r.fieldErrors) };
      }
      if (r.code === "SCHEDULE_IMPACT") {
        return { branchId, branchName, ok: false, code: r.code, message: r.message, impact: r.impact, needsConfirm: r.needsConfirm };
      }
      return { branchId, branchName, ok: false, code: r.code, message: publicMessage(r) };
    }),
  });
}
