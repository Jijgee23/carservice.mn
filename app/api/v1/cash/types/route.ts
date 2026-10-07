import { jsonError, jsonOk } from "@/lib/api";
import { createCashType, listCashTypes, serializeCashType } from "@/lib/cash/types";
import { cashErrorResponse, readJsonObject, requireCashApiUser } from "@/lib/cash/http";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

// GET /api/v1/cash/types?direction=INCOME|EXPENSE&includeInactive=1 -> { types: CashType[] }
export async function GET(req: Request) {
  const auth = await requireCashApiUser(req);
  if (auth.response) return auth.response;
  const params = new URL(req.url).searchParams;
  try {
    const types = await listCashTypes({
      actor: auth.user,
      direction: params.get("direction"),
      includeInactive: ["1", "true", "yes"].includes((params.get("includeInactive") ?? "").toLowerCase()),
    });
    return jsonOk({ types: types.map(serializeCashType) });
  } catch (error) {
    return cashErrorResponse("types.list", error);
  }
}

// POST /api/v1/cash/types { direction, name } -> 201 { type: CashType }
export async function POST(req: Request) {
  const auth = await requireCashApiUser(req);
  if (auth.response) return auth.response;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const body = await readJsonObject(req);
  if (!body) return jsonError(400, "JSON object шаардлагатай.");
  try {
    const type = await createCashType({ actor: auth.user, direction: body.direction, name: body.name });
    return jsonOk({ type: serializeCashType(type) }, { status: 201 });
  } catch (error) {
    return cashErrorResponse("types.create", error);
  }
}
