import { jsonError, jsonOk } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { cashErrorResponse, readJsonObject, requireCashApiUser } from "@/lib/cash/http";
import { listSessions, openCashSession } from "@/lib/cash/session";
import { buildMeta, getApiPageInfo } from "@/lib/pagination";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

// GET /api/v1/cash/sessions?from=YYYY-MM-DD&to=YYYY-MM-DD (openedAt)&branchId&status=OPEN|CLOSED&page&pageSize
// -> { sessions: CashSession[], pagination }
export async function GET(req: Request) {
  const auth = await requireCashApiUser(req);
  if (auth.response) return auth.response;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const params = new URL(req.url).searchParams;
  const page = getApiPageInfo(params);
  try {
    const result = await listSessions({
      actor: auth.user,
      scope: scopeResult.branchId,
      filters: { from: params.get("from"), to: params.get("to"), branchId: params.get("branchId"), status: params.get("status") },
      skip: page.skip,
      take: page.take,
    });
    return jsonOk({ sessions: result.sessions, pagination: buildMeta(result.total, page.page, page.pageSize) });
  } catch (error) {
    return cashErrorResponse("sessions.list", error);
  }
}

// POST /api/v1/cash/sessions  { branchId, openingCash, note? } -> 201 { session: CashSession }
export async function POST(req: Request) {
  const auth = await requireCashApiUser(req);
  if (auth.response) return auth.response;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const body = await readJsonObject(req);
  if (!body) return jsonError(400, "JSON object шаардлагатай.");
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  try {
    const session = await openCashSession({
      actor: auth.user,
      scope: scopeResult.branchId,
      branchId: body.branchId,
      openingCash: body.openingCash,
      note: body.note,
    });
    return jsonOk({ session }, { status: 201 });
  } catch (error) {
    return cashErrorResponse("sessions.open", error);
  }
}
