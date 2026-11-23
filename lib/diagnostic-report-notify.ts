import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

/**
 * Ажилтан оношилгооны тайлан үүсгэмэгц тухайн үйлчлүүлэгчийн (Account) мобайл
 * апп руу push + мэдэгдлийн төвд бичнэ. Best-effort — алдаа гарвал тайлан
 * хадгалах үндсэн урсгалыг таслахгүй. Хүлээн авагч: Customer.accountId (апп-д
 * нэвтэрсэн хэрэглэгч); walk-in (accountId=null) бол илгээхгүй. Тест тенант,
 * дотоод (internal) засварын тайланг үйлчлүүлэгчид мэдэгдэхгүй.
 * dedupeKey = reportId тул давхар дуудсан ч нэг л удаа явна.
 */
export async function notifyDiagnosticReportCreated(reportId: string): Promise<void> {
  try {
    const report = await prisma.diagnosticReport.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        orderId: true,
        tenantId: true,
        tenant: { select: { isTest: true, name: true } },
        order: { select: { isInternal: true } },
        customer: { select: { accountId: true } },
        vehicle: { select: { plate: true } },
        template: { select: { name: true } },
      },
    });
    const accountId = report?.customer?.accountId;
    if (!report || !accountId) return;
    if (report.tenant.isTest || report.order?.isInternal) return;

    const plate = report.vehicle?.plate ?? "";
    const what = report.template?.name ?? "Оношилгоо";
    await createNotification({
      type: "diagnostic_report_created",
      recipient: { accountId },
      input: {
        reportId: report.id,
        orderId: report.orderId ?? "",
        body: `${report.tenant.name}: ${plate ? `${plate} — ` : ""}${what} тайлан бэлэн боллоо.`,
      },
    });
  } catch (error) {
    console.warn("[notify] diagnostic_report_created:", error);
  }
}
