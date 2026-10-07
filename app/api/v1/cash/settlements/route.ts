import { jsonError, jsonOk } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { cashErrorResponse, readJsonObject, requireCashApiUser } from "@/lib/cash/http";
import { createPostpaidSettlement, listSettlements } from "@/lib/cash/settlement";
import { buildMeta, getApiPageInfo } from "@/lib/pagination";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

// GET /api/v1/cash/settlements?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId&customerId&includeVoided=1&page&pageSize
// -> { settlements: SettlementSummary[], pagination }   (date range filters the ledger entry's occurredAt)
export async function GET(req: Request) {
  const auth = await requireCashApiUser(req);
  if (auth.response) return auth.response;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const params = new URL(req.url).searchParams;
  const page = getApiPageInfo(params);
  const includeVoided = ["1", "true", "yes"].includes((params.get("includeVoided") ?? "").toLowerCase());
  try {
    const result = await listSettlements({
      actor: auth.user,
      scope: scopeResult.branchId,
      filters: { from: params.get("from"), to: params.get("to"), branchId: params.get("branchId"), customerId: params.get("customerId"), includeVoided },
      skip: page.skip,
      take: page.take,
    });
    return jsonOk({ settlements: result.settlements, pagination: buildMeta(result.total, page.page, page.pageSize) });
  } catch (error) {
    return cashErrorResponse("settlements.list", error);
  }
}

// POST /api/v1/cash/settlements  { branchId, customerId, orderIds: string[], method, bank?, occurredAt?, note?, expectedAmount? }
// Permission: cash.manage AND orders.closeUnpaidPostpaid. -> 201 { settlement: SettlementDetail }
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
    const settlement = await createPostpaidSettlement({
      actor: auth.user,
      scope: scopeResult.branchId,
      branchId: body.branchId,
      customerId: body.customerId,
      orderIds: body.orderIds,
      method: body.method,
      bank: body.bank,
      occurredAt: body.occurredAt,
      note: body.note,
      expectedAmount: body.expectedAmount,
    });
    return jsonOk({ settlement }, { status: 201 });
  } catch (error) {
    return cashErrorResponse("settlements.create", error);
  }
}
