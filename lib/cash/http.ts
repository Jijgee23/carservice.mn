import { jsonError, requireApiUser } from "@/lib/api";
import { hasPermission } from "@/lib/auth/roles";
import { CashError } from "./rules";

/** Maps a CashError to the staff-API error envelope `{ error, code, fieldErrors? }`. */
export function cashErrorResponse(label: string, error: unknown) {
  if (error instanceof CashError) {
    return jsonError(error.status, error.message, { code: error.code, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}), ...(error.details ?? {}) });
  }
  console.error(`[cash/${label}] failed`, error instanceof Error ? { name: error.name } : { name: "UnknownError" });
  return jsonError(500, "Серверийн алдаа гарлаа. Дахин оролдоно уу.");
}

/** Auth + `cash.manage` gate shared by every cash route (403 CASH_MANAGE_FORBIDDEN). */
export async function requireCashApiUser(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth;
  if (!hasPermission(auth.user, "cash.manage")) {
    return { response: jsonError(403, "Танд кассыг удирдах эрх байхгүй.", { code: "CASH_MANAGE_FORBIDDEN" }) } as const;
  }
  return auth;
}

export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    if (body == null || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}
