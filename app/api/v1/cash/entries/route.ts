import { jsonError, jsonOk } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { createCashEntry, listCashEntries } from "@/lib/cash/ledger";
import { cashErrorResponse, readJsonObject, requireCashApiUser } from "@/lib/cash/http";
import { buildMeta, getApiPageInfo } from "@/lib/pagination";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

// GET /api/v1/cash/entries?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId&direction=INCOME|EXPENSE&typeId&method&bank&includeVoided=1&outsideSession=1&page&pageSize
// -> { entries: CashEntry[], totals: { income, expense, net, incomeCount, expenseCount }, pagination }
export async function GET(req: Request) {
  const auth = await requireCashApiUser(req);
  if (auth.response) return auth.response;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const params = new URL(req.url).searchParams;
  const page = getApiPageInfo(params);
  const includeVoided = ["1", "true", "yes"].includes((params.get("includeVoided") ?? "").toLowerCase());
  const outsideSession = ["1", "true", "yes"].includes((params.get("outsideSession") ?? "").toLowerCase());
  try {
    const result = await listCashEntries({
      actor: auth.user,
      scope: scopeResult.branchId,
      filters: {
        from: params.get("from"),
        to: params.get("to"),
        branchId: params.get("branchId"),
        direction: params.get("direction"),
        typeId: params.get("typeId"),
        method: params.get("method"),
        bank: params.get("bank"),
        includeVoided,
        outsideSession,
      },
      skip: page.skip,
      take: page.take,
    });
    return jsonOk({ entries: result.entries, totals: result.totals, pagination: buildMeta(result.total, page.page, page.pageSize) });
  } catch (error) {
    return cashErrorResponse("entries.list", error);
  }
}

// POST /api/v1/cash/entries  { direction, typeId, branchId, amount, method, bank?, occurredAt?, note?, attachmentPath?, taxIncluded?, customerId?, counterparty? }
// -> 201 { entry: CashEntry }
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
    const entry = await createCashEntry({
      actor: auth.user,
      scope: scopeResult.branchId,
      direction: body.direction,
      typeId: body.typeId,
      branchId: body.branchId,
      amount: body.amount,
      method: body.method,
      bank: body.bank,
      occurredAt: body.occurredAt,
      note: body.note,
      attachmentPath: body.attachmentPath,
      taxIncluded: body.taxIncluded,
      customerId: body.customerId,
      counterparty: body.counterparty,
    });
    return jsonOk({ entry }, { status: 201 });
  } catch (error) {
    return cashErrorResponse("entries.create", error);
  }
}
