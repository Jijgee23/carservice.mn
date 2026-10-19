import ExcelJS from "exceljs";
import { requireUser } from "@/lib/auth";
import { canCreate } from "@/lib/auth/roles";
import { IMPORT_FIELDS } from "@/lib/employees/import";
import { prisma } from "@/lib/prisma";

// GET /dashboard/employees/import/template — «Excel-ээс оруулах» загвар:
// 1-р хуудас гарчигтай хоосон хүснэгт, 2-р хуудсанд тенантын идэвхтэй
// үүрэг/салбарын нэрс (Excel-д яг ийм нэрээр бичвэл автоматаар таарна).
export async function GET() {
  const user = await requireUser();
  if (!canCreate(user, "employees")) return new Response("Forbidden", { status: 403 });

  const [roles, branches] = await Promise.all([
    prisma.role.findMany({
      where: { tenantId: user.tenantId, isActive: true },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
    prisma.branch.findMany({
      where: { tenantId: user.tenantId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { name: true },
    }),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "carservice.mn";
  wb.created = new Date();

  const sheet = wb.addWorksheet("Ажилтнууд");
  sheet.columns = IMPORT_FIELDS.map((f) => ({
    header: f.label,
    key: f.key,
    width: f.key === "email" ? 28 : 18,
  }));
  sheet.getRow(1).font = { bold: true };
  // Утсыг текстээр — эс бөгөөс Excel урд талын тэг/зураасыг идэж болно.
  sheet.getColumn("phone").numFmt = "@";
  sheet.getColumn("activeUntil").numFmt = "yyyy-mm-dd";

  const ref = wb.addWorksheet("Үүрэг, салбар");
  ref.columns = [
    { header: "Үүрэг", key: "role", width: 24 },
    { header: "Салбар", key: "branch", width: 28 },
  ];
  ref.getRow(1).font = { bold: true };
  for (let i = 0; i < Math.max(roles.length, branches.length); i++) {
    ref.addRow({ role: roles[i]?.name ?? "", branch: branches[i]?.name ?? "" });
  }
  ref.addRow({});
  ref.addRow({ role: "Заавар: Овог, Нэр, Утас, Имэйл заавал. Огноог 2026-12-31 хэлбэрээр." });

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="ajiltan_import_zagvar.xlsx"',
    },
  });
}
