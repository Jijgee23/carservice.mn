import { requireUser } from "@/lib/auth";
import { canView } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { parseImportKind } from "@/lib/services/import";
import { buildServiceWorkbook, XLSX_CONTENT_TYPE } from "@/lib/services/service-export";

// GET /dashboard/services/export?type=labor|goods — тухайн төрлийн бүх мөр
// (идэвхгүй нь ч «Төлөв» баганатай). Гарчиг импортынхтой ижил.
export async function GET(req: Request) {
  const user = await requireUser();
  if (!canView(user, "services")) return new Response("Forbidden", { status: 403 });
  const type = parseImportKind(new URL(req.url).searchParams.get("type")) ?? "GOODS";
  const services = await prisma.service.findMany({
    where: { tenantId: user.tenantId, type },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      code: true,
      name: true,
      price: true,
      costPrice: true,
      stock: true,
      durationValue: true,
      reminderIntervalMonths: true,
      description: true,
      isActive: true,
      category: { select: { name: true } },
      unit: { select: { name: true } },
      durationUnit: { select: { name: true } },
    },
  });
  const buffer = await buildServiceWorkbook({
    type,
    withStatus: true,
    rows: services.map((s) => ({
      code: s.code,
      name: s.name,
      category: s.category?.name ?? null,
      unit: s.unit?.name ?? null,
      price: s.price.toString(),
      costPrice: s.costPrice?.toString() ?? null,
      stock: s.stock?.toString() ?? null,
      durationValue: s.durationValue?.toString() ?? null,
      durationUnit: s.durationUnit?.name ?? null,
      reminderIntervalMonths: s.reminderIntervalMonths,
      description: s.description,
      isActive: s.isActive,
    })),
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(buffer, {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${type === "LABOR" ? "ajil" : "selbeg"}_${stamp}.xlsx"`,
    },
  });
}
