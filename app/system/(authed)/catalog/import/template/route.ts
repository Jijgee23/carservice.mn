import ExcelJS from "exceljs";
import { requireSuperAdmin } from "@/lib/auth/system";
import { loadSystemCategories } from "@/lib/catalog/catalog-admin";
import { CATALOG_IMPORT_FIELDS, parseCatalogType } from "@/lib/catalog/catalog-input";

// GET /system/catalog/import/template?type=LABOR|GOODS — нэгдсэн сангийн импортын
// хоосон загвар (+ сэлбэгт «Ангилал» хуудас: системийн идэвхтэй ангиллын нэрс).
export async function GET(req: Request) {
  await requireSuperAdmin();
  const type = parseCatalogType(new URL(req.url).searchParams.get("type")) ?? "GOODS";
  const fields = CATALOG_IMPORT_FIELDS[type];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(type === "LABOR" ? "Ажил" : "Сэлбэг");
  ws.columns = fields.map((f) => ({ header: f.required ? `${f.label} *` : f.label, width: f.key === "name" ? 40 : 18 }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  if (type === "GOODS") {
    const ref = wb.addWorksheet("Ангилал");
    ref.columns = [{ header: "Системийн ангилал", width: 40 }];
    ref.getRow(1).font = { bold: true };
    for (const c of await loadSystemCategories(type)) ref.addRow([c.name]);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="negdsen_san_${type === "LABOR" ? "ajil" : "selbeg"}_zagvar.xlsx"`,
    },
  });
}
