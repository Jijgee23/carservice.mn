// Contract — GET /api/v1/system/me → { admin: { id, email, firstName, lastName, kind, permissions } }
// Апп эрхээр цэс харуулахад ашиглана; сервер хүсэлт бүрд эрхийг DB-ээс дахин шалгана. 401 token хүчингүй/идэвхгүй админ.

import { jsonOk } from "@/lib/api";
import { requireSystemApiUser } from "@/lib/auth/system-api";

export async function GET(req: Request) {
  const auth = await requireSystemApiUser(req);
  if (auth.response) return auth.response;
  return jsonOk({ admin: auth.admin });
}
