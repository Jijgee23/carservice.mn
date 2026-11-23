import { enforceRateLimit, jsonOk, PUBLIC_CATALOG_RATE_LIMIT } from "@/lib/api";
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
  // Web /book-тэй (app/(app)/book/page.tsx) ЯГ ижил жагсаалт: системийн бүх
  // идэвхтэй ажлын төрөл. Апп ч мөн бүх нийтийн газрыг харуулж, онлайн захиалга
  // авдаггүйг «Дэлгэрэнгүй»-тэй гаргадаг (/api/v1/app/orgs, includeNonBookable).
  const serviceKeys = await prisma.systemServiceKey.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return jsonOk({ serviceKeys });
}
