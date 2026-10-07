// Phase D: one workbook, a sheet per section of the cash summary report. Pure: summary in, Buffer out.
import ExcelJS from "exceljs";
import { bankLabel } from "@/lib/banks";
import { bookingDateKey } from "@/lib/booking-time";
import { ORDER_PAYMENT_METHOD_LABEL } from "@/lib/orders";
import type { CashSummary } from "./report";

const num = (s: string) => Number.parseFloat(s);

export async function buildCashSummaryWorkbook(summary: CashSummary) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "carservice.mn";
  wb.created = new Date();

  const sheet = (name: string, columns: Array<{ header: string; key: string; width: number }>, rows: Array<Record<string, unknown>>) => {
    const ws = wb.addWorksheet(name);
    ws.columns = columns;
    ws.addRows(rows);
  };

  sheet("Хураангуй", [{ header: "Үзүүлэлт", key: "label", width: 34 }, { header: "Дүн", key: "value", width: 20 }], [
    { label: "Хугацаа", value: `${bookingDateKey(new Date(summary.range.from))} – ${bookingDateKey(new Date(summary.range.to))}` },
    { label: "Нийт орлого", value: num(summary.totals.income) },
    { label: "Нийт зарлага", value: num(summary.totals.expense) },
    { label: "Цэвэр дүн", value: num(summary.totals.net) },
    { label: "Бэлэн мөнгөний цэвэр хөдөлгөөн", value: num(summary.netCash) },
    { label: "Дотоод зардал", value: num(summary.internalCost.total) },
  ]);

  const methodRows: Array<Record<string, unknown>> = [];
  for (const m of summary.incomeByMethod) {
    methodRows.push({ method: m.methodLabel, bank: "", total: num(m.total), count: m.count });
    for (const b of m.banks) {
      methodRows.push({ method: m.methodLabel, bank: b.bankLabel, total: num(b.total), count: b.count });
    }
  }
  sheet("Арга-аар орлого", [
    { header: "Төлбөрийн арга", key: "method", width: 18 },
    { header: "Банк", key: "bank", width: 28 },
    { header: "Нийт", key: "total", width: 16 },
    { header: "Тоо", key: "count", width: 8 },
  ], methodRows);

  const typeCols = [{ header: "Төрөл", key: "name", width: 30 }, { header: "Дүн", key: "total", width: 16 }, { header: "Тоо", key: "count", width: 8 }];
  const typeRows = (rows: CashSummary["incomeByType"]) => rows.map((r) => ({ name: r.name, total: num(r.total), count: r.count }));
  sheet("Төрлөөр орлого", typeCols, typeRows(summary.incomeByType));
  sheet("Төрлөөр зарлага", typeCols, typeRows(summary.expenseByType));
  sheet("Арга-аар зарлага", [{ header: "Төлбөрийн арга", key: "method", width: 18 }, { header: "Дүн", key: "total", width: 16 }, { header: "Тоо", key: "count", width: 8 }],
    summary.expenseByMethod.map((r) => ({ method: r.methodLabel, total: num(r.total), count: r.count })));
  sheet("Цэвэр дүн", [
    { header: "Төлбөрийн арга", key: "method", width: 18 },
    { header: "Орлого", key: "income", width: 16 },
    { header: "Зарлага", key: "expense", width: 16 },
    { header: "Цэвэр", key: "net", width: 16 },
  ], summary.netByMethod.map((r) => ({ method: r.methodLabel, income: num(r.income), expense: num(r.expense), net: num(r.net) })));

  const p = summary.postpaid;
  sheet("Дараа тооцоо", [{ header: "Үзүүлэлт", key: "label", width: 44 }, { header: "Дүн", key: "value", width: 18 }, { header: "Тоо", key: "count", width: 8 }], [
    { label: "Дараа төлбөрт хийсэн ажил (хугацаанд)", value: num(p.workDone.total), count: p.workDone.count },
    { label: "Дараа тооцооны цуглуулалт — нийт", value: num(p.collected.total), count: "" },
    { label: "  Тооцоо нийлсэн", value: num(p.collected.settlements.total), count: p.collected.settlements.count },
    { label: "  Захиалга дээр шууд төлсөн", value: num(p.collected.directPayments.total), count: p.collected.directPayments.count },
    { label: "Авлага үлдэгдэл (бүх дууссан захиалга, хугацааны эцсээр)", value: num(p.outstanding.total), count: "" },
    { label: "Дотоод зардал", value: num(summary.internalCost.total), count: summary.internalCost.count },
  ]);

  sheet("Кассын ээлж", [
    { header: "Салбар", key: "branch", width: 22 },
    { header: "Нээсэн", key: "openedAt", width: 20 },
    { header: "Хаасан", key: "closedAt", width: 20 },
    { header: "Төлөв", key: "status", width: 10 },
    { header: "Эхний үлдэгдэл", key: "opening", width: 16 },
    { header: "Бэлэн орлого", key: "cashIn", width: 16 },
    { header: "Бэлэн зарлага", key: "cashOut", width: 16 },
    { header: "Нийт орлого", key: "totalIncome", width: 16 },
    { header: "Нийт зарлага", key: "totalExpense", width: 16 },
    { header: "Байх ёстой", key: "expected", width: 16 },
    { header: "Тоолсон", key: "counted", width: 16 },
    { header: "Зөрүү", key: "difference", width: 14 },
    { header: "Хаасны дараах хүчингүй (цэвэр)", key: "postClose", width: 24 },
  ], [
    ...summary.sessions.items.map((s) => ({
      branch: s.branch.name,
      openedAt: s.openedAt,
      closedAt: s.closedAt ?? "",
      status: s.status === "OPEN" ? "Нээлттэй" : "Хаагдсан",
      opening: num(s.openingCash),
      cashIn: num(s.cashIn),
      cashOut: num(s.cashOut),
      totalIncome: num(s.totalIncome),
      totalExpense: num(s.totalExpense),
      expected: num(s.expectedCash),
      counted: s.countedCash == null ? "" : num(s.countedCash),
      difference: s.difference == null ? "" : num(s.difference),
      postClose: num(s.postCloseVoids.netAmount),
    })),
    {
      branch: "Ээлжээс гадуур",
      openedAt: "",
      closedAt: "",
      status: "",
      opening: "",
      cashIn: num(summary.sessions.outsideSession.income),
      cashOut: num(summary.sessions.outsideSession.expense),
      totalIncome: "",
      totalExpense: "",
      expected: "",
      counted: "",
      difference: "",
      postClose: "",
    },
  ]);

  const optNum = (v: string | null) => (v == null ? "" : num(v));
  sheet("Ээлж — аргаар", [
    { header: "Нээсэн", key: "openedAt", width: 20 },
    { header: "Салбар", key: "branch", width: 22 },
    { header: "Төлөв", key: "status", width: 10 },
    { header: "Арга", key: "method", width: 18 },
    { header: "Банк", key: "bank", width: 24 },
    { header: "Орлого", key: "income", width: 16 },
    { header: "Зарлага", key: "expense", width: 16 },
    { header: "Цэвэр", key: "net", width: 16 },
    { header: "Тооцоолсон", key: "expected", width: 16 },
    { header: "Тоолсон", key: "counted", width: 16 },
    { header: "Зөрүү", key: "difference", width: 14 },
    { header: "Бичлэг", key: "count", width: 8 },
  ], summary.sessions.items.flatMap((s) =>
    s.byMethod.map((m) => ({
      openedAt: s.openedAt,
      branch: s.branch.name,
      status: s.status === "OPEN" ? "Нээлттэй" : "Хаагдсан",
      method: ORDER_PAYMENT_METHOD_LABEL[m.method] ?? m.method,
      bank: m.bank ? bankLabel(m.bank) : "",
      income: num(m.income),
      expense: num(m.expense),
      net: num(m.net),
      expected: optNum(m.expected),
      counted: optNum(m.counted),
      difference: optNum(m.difference),
      count: m.count,
    })),
  ));

  for (const ws of wb.worksheets) ws.getRow(1).font = { bold: true };
  return wb.xlsx.writeBuffer();
}

/** `mungun-guilgee_<from>_<to>.xlsx` (business-day keys). */
export function cashSummaryFilename(from: Date, to: Date): string {
  return `mungun-guilgee_${bookingDateKey(from)}_${bookingDateKey(to)}.xlsx`;
}
