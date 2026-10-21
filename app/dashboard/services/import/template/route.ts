import { requireUser } from "@/lib/auth";
import { canCreate } from "@/lib/auth/roles";
import { categoriesForKindWhere } from "@/lib/categories";
import { prisma } from "@/lib/prisma";
import { parseImportKind } from "@/lib/services/import";
import { buildServiceWorkbook, XLSX_CONTENT_TYPE } from "@/lib/services/service-export";

// GET /dashboard/services/import/template?type=labor|goods — хоосон загвар +
// «Ангилал, нэгж» хуудас (тенантын идэвхтэй нэрс).
export async function GET(req: Request) {
  const user = await requireUser();
  if (!canCreate(user, "services")) return new Response("Forbidden", { status: 403 });
  const type = parseImportKind(new URL(req.url).searchParams.get("type")) ?? "GOODS";
  const [categories, units] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true, ...categoriesForKindWhere(user.tenantId, type) }, orderBy: { name: "asc" }, select: { name: true } }),
    prisma.unit.findMany({ where: { tenantId: user.tenantId, isActive: true }, orderBy: { name: "asc" }, select: { name: true } }),
  ]);
  const buffer = await buildServiceWorkbook({
    type,
    rows: [],
    withStatus: false,
    reference: { categories: categories.map((c) => c.name), units: units.map((u) => u.name) },
  });
  return new Response(buffer, {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${type === "LABOR" ? "ajil" : "selbeg"}_import_zagvar.xlsx"`,
    },
  });
}
