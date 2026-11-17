import { enforceRateLimit, jsonOk, PUBLIC_CATALOG_RATE_LIMIT } from "@/lib/api";
import { bookableServiceKeyWhere } from "@/lib/bookable-service-keys";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";

/**
 * GET /api/v1/app/service-keys — идэвхтэй SystemServiceKey-үүдийн жагсаалт
 * (нийтэд нээлттэй, org сонголтоос өмнөх "ямар ажил хийлгэх гэж байна?"
 * сонголтод зориулав — харах: /api/v1/app/orgs-ийн branch.serviceKeyIds).
 */
export async function GET(req: Request) {
  const limited = enforceRateLimit(req, "public-catalog", PUBLIC_CATALOG_RATE_LIMIT);
  if (limited) return limited;
  setBypassContext();
  // Онлайн захиалга авдаг газарт байхгүй түлхүүрийг ШҮҮНЭ ГАРГАНА — сонговол
  // баталгаатай хоосон салбарын жагсаалт буцаах сонголтыг харуулахгүй (харах:
  // web-ийн app/(app)/discover/page.tsx-ийн ижил шийдвэр).
  const serviceKeys = await prisma.systemServiceKey.findMany({
    where: await bookableServiceKeyWhere(),
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return jsonOk({ serviceKeys });
}
