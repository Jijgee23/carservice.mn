import ExcelJS from "exceljs";
import { requireSuperAdmin } from "@/lib/auth/system";
import { prisma } from "@/lib/prisma";
import {
  BILLING_PERIOD_LABEL,
  PLAN_LABEL,
  SUBSCRIPTION_PAYMENT_METHOD_LABEL,
  SUBSCRIPTION_PAYMENT_STATUS_LABEL,
  SUBSCRIPTION_STATUS_LABEL,
} from "@/lib/subscription";
import { parseSubscriptionHistoryFilters, paymentWhere, subscriptionWhere } from "@/lib/subscription-history";

// GET /system/subscriptions/export?tab=subscriptions|payments&q=&plan=&status=&from=&to=
// Хуудасны шүүлтүүртэй ижил (lib/subscription-history.ts) — бүх мөр (хуудаслалтгүй).
const MAX_ROWS = 20_000;

function ub(d: Date | null | undefined): string {
  return d ? d.toLocaleString("mn-MN", { hour12: false, timeZone: "Asia/Ulaanbaatar" }) : "";
}

export async function GET(req: Request) {
  await requireSuperAdmin();
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const f = parseSubscriptionHistoryFilters(sp);

  const wb = new ExcelJS.Workbook();
  wb.creator = "carservice.mn";
  wb.created = new Date();

  if (f.tab === "payments") {
    const rows = await prisma.subscriptionPayment.findMany({
      where: paymentWhere(f),
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      select: {
        plan: true,
        period: true,
        amount: true,
        method: true,
        status: true,
        createdAt: true,
        paidAt: true,
        qpayPaymentId: true,
        tenant: { select: { name: true, registerNumber: true, isTest: true } },
      },
    });
    const ws = wb.addWorksheet("Төлбөр");
    ws.columns = [
      { header: "Огноо", key: "createdAt", width: 20 },
      { header: "Байгууллага", key: "tenant", width: 28 },
      { header: "Регистр", key: "reg", width: 12 },
      { header: "Тест", key: "test", width: 8 },
      { header: "Багц", key: "plan", width: 14 },
      { header: "Хугацаа", key: "period", width: 12 },
      { header: "Дүн", key: "amount", width: 14, style: { numFmt: "#,##0" } },
      { header: "Арга", key: "method", width: 16 },
      { header: "Төлөв", key: "status", width: 16 },
      { header: "Төлсөн", key: "paidAt", width: 20 },
      { header: "QPay гүйлгээ", key: "qpay", width: 22 },
    ];
    ws.addRows(
      rows.map((p) => ({
        createdAt: ub(p.createdAt),
        tenant: p.tenant.name,
        reg: p.tenant.registerNumber,
        test: p.tenant.isTest ? "Тийм" : "",
        plan: PLAN_LABEL[p.plan],
        period: BILLING_PERIOD_LABEL[p.period],
        amount: Number(p.amount.toString()),
        method: SUBSCRIPTION_PAYMENT_METHOD_LABEL[p.method],
        status: SUBSCRIPTION_PAYMENT_STATUS_LABEL[p.status],
        paidAt: ub(p.paidAt),
        qpay: p.qpayPaymentId ?? "",
      })),
    );
    ws.getRow(1).font = { bold: true };
  } else {
    const rows = await prisma.subscription.findMany({
      where: subscriptionWhere(f),
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      select: {
        plan: true,
        status: true,
        startsAt: true,
        endsAt: true,
        amount: true,
        notes: true,
        createdAt: true,
        tenant: { select: { name: true, registerNumber: true, isTest: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });
    const ws = wb.addWorksheet("Эрх");
    ws.columns = [
      { header: "Үүсгэсэн", key: "createdAt", width: 20 },
      { header: "Байгууллага", key: "tenant", width: 28 },
      { header: "Регистр", key: "reg", width: 12 },
      { header: "Тест", key: "test", width: 8 },
      { header: "Багц", key: "plan", width: 14 },
      { header: "Төлөв", key: "status", width: 14 },
      { header: "Эхэлсэн", key: "startsAt", width: 20 },
      { header: "Дуусах", key: "endsAt", width: 20 },
      { header: "Дүн", key: "amount", width: 14, style: { numFmt: "#,##0" } },
      { header: "Тэмдэглэл", key: "notes", width: 36 },
      { header: "Хэн", key: "by", width: 20 },
    ];
    ws.addRows(
      rows.map((s) => ({
        createdAt: ub(s.createdAt),
        tenant: s.tenant.name,
        reg: s.tenant.registerNumber,
        test: s.tenant.isTest ? "Тийм" : "",
        plan: PLAN_LABEL[s.plan],
        status: SUBSCRIPTION_STATUS_LABEL[s.status],
        startsAt: ub(s.startsAt),
        endsAt: ub(s.endsAt),
        amount: s.amount ? Number(s.amount.toString()) : null,
        notes: s.notes ?? "",
        by: s.createdBy ? `${s.createdBy.firstName} ${s.createdBy.lastName}` : "Систем",
      })),
    );
    ws.getRow(1).font = { bold: true };
  }

  const buffer = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="subscription_${f.tab}_${stamp}.xlsx"`,
    },
  });
}
