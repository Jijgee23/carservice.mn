// P6-B3 — bulk (userId × date|weekday) schedule write, mirroring
// `bulkUpsertEmployeeShiftAction` in `app/_actions/employee-schedule.ts`:
// same permission gate (no per-target `authorizeScheduleTarget` call — the
// core itself tenant-filters every target against `tenantId`, exactly as the
// action relies on it to), same audit summary shape.
//
// Contract:
//   POST /api/v1/employee-schedules/bulk
//     Permission: employees.schedule
//     Body: { scope: "date"|"weekday", isWorking: boolean,
//             segments: [{branchId, startTime, endTime}],
//             targets: [{userId, date?, weekday?}] }
//     200 → { message, applied }
//     Errors:
//       401 (no code)
//       403 {error, code:"FORBIDDEN"} / {code:"SUBSCRIPTION_EXPIRED"}
//       400 {error, code:"VALIDATION", fieldErrors?} — bad scope/targets/segments
import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { bulkUpsertEmployeeShiftCommand } from "@/lib/employee-schedule-commands";
import { prisma } from "@/lib/prisma";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

type RawTarget = { userId?: unknown; date?: unknown; weekday?: unknown };

// The core takes `targetsJson`/`segmentsJson` as JSON strings (unchanged, per
// task instructions) — adapt the JSON body's arrays at the edge, and fill in
// the field the body omits (`date` for weekday scope, `weekday` for date
// scope) the same way the web action's hidden bulk-editor inputs always send
// both.
// Returns null when any element is not an object (e.g. `targets: [null]`) —
// the caller answers 400 VALIDATION instead of crashing on `t.userId`.
function normalizeTargets(value: unknown): string | null {
  const raw: unknown[] = Array.isArray(value) ? value : [];
  if (raw.some((t) => !t || typeof t !== "object" || Array.isArray(t))) return null;
  const list = raw as RawTarget[];
  return JSON.stringify(
    list.map((t) => ({
      userId: typeof t.userId === "string" ? t.userId : "",
      date: typeof t.date === "string" ? t.date : "",
      weekday: typeof t.weekday === "string" ? t.weekday : "",
    })),
  );
}

function segmentsToJson(value: unknown): string {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "employees.schedule");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.", { code: "VALIDATION" });
  }
  if (!body || typeof body !== "object") {
    return jsonError(400, "Body буруу.", { code: "VALIDATION" });
  }
  const { scope, isWorking, segments, targets } = body as Record<string, unknown>;
  const scopeStr = typeof scope === "string" ? scope : "";
  const targetsJson = normalizeTargets(targets);
  if (targetsJson === null) {
    return jsonError(400, "Сонголт буруу байна.", {
      code: "VALIDATION",
      fieldErrors: { targets: "Сонголт буруу байна." },
    });
  }

  const result = await bulkUpsertEmployeeShiftCommand(prisma, {
    tenantId: auth.user.tenantId,
    scope: scopeStr,
    isWorking: isWorking === true,
    segmentsJson: segmentsToJson(segments),
    targetsJson,
  });

  if (!result.ok) {
    return jsonError(400, "message" in result && result.message ? result.message : "Алдаа гарлаа.", {
      code: result.code,
      ...("fieldErrors" in result && result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
    });
  }

  if (result.applied > 0) {
    await logAudit({
      tenantId: auth.user.tenantId,
      userId: auth.user.id,
      entity: "User",
      entityId: auth.user.id,
      action: "UPDATE",
      summary: `Ажлын хувиар багцаар тохируулав (${result.applied} ${scopeStr === "date" ? "өдөр/ажилтан" : "гараг/ажилтан"})`,
    });
  }

  return jsonOk({ message: `${result.applied} байршил шинэчлэгдлээ.`, applied: result.applied });
}
