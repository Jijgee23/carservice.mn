// /api/v1/branches/**/schedules route-уудын дундын JSON хариу (алдааны хэлбэр
// app/api/v1/branches/[id]/route.ts-тэй ижил: `{ error, code?, fieldErrors?,
// impact?, needsConfirm? }`).

import type { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import {
  type BranchScheduleCommandResult,
  scheduleFieldErrorsToJson,
} from "@/lib/branch-schedule-commands";

type Failure = Exclude<BranchScheduleCommandResult, { ok: true }>;

export function scheduleFailureResponse(result: Failure, label: string): NextResponse {
  switch (result.code) {
    case "VALIDATION": {
      const fieldErrors = scheduleFieldErrorsToJson(result.fieldErrors);
      const first = Object.values(fieldErrors)[0] ?? "Өгөгдөл буруу.";
      return jsonError(400, first, { code: "VALIDATION", fieldErrors });
    }
    case "SCHEDULE_IMPACT":
      return jsonError(409, result.message, {
        code: "SCHEDULE_IMPACT",
        impact: result.impact,
        needsConfirm: result.needsConfirm,
      });
    case "NOT_FOUND":
      return jsonError(404, result.message, { code: "NOT_FOUND" });
    case "CONFLICT":
      return jsonError(409, result.message, { code: "CONFLICT" });
    default:
      console.error(`[${label}]`, result.message);
      return jsonError(500, "Хуваарь хадгалахад алдаа гарлаа.");
  }
}

/** JSON body-г object болгож уншина; биш бол null. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}
