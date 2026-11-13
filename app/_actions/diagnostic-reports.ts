"use server";


import { moduleDisabledMessage } from "@/lib/plan-modules";
import { assertModuleEnabled, isModuleEnabled } from "@/lib/plan-modules-server";
import type { ConfirmActionResult } from "@/lib/confirm-action";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { workingBranchScopeId } from "@/lib/auth/roles";
import { canCreate as canCreatePerm, canDelete as canDeletePerm } from "@/lib/auth/roles";
import {
  computeReportSeverity,
  type ReportEntry,
  type TemplateSchema,
  tenantVisibleTemplateWhere,
  validateReportData,
} from "@/lib/diagnostics";
import {
  collectValidatedReportData,
  commitWithReportUploadCleanup,
  ReportDataValidationError,
} from "@/lib/diagnostics-server";
import {
  commitDiagnosticReportCommand,
  type DiagnosticReportCommitFailureCode,
} from "@/lib/diagnostic-report-commit";
import {
  ACTION_GENERIC_ERROR_MESSAGE,
  knownAuthorizationMessage,
  logUnexpectedActionError,
} from "@/lib/action-errors";
import { UploadValidationError } from "@/lib/storage";
import { assertActiveSubscription } from "@/lib/subscription-server";
import { canFillDiagnostics, isOrderLocked, type OrderStatus } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { canEditOrder } from "@/lib/auth/order-access";

export type ReportActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  redirectTo?: string;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * formData дотор:
 *   templateId, orderId? — байх ёстой
 *   itemId? — захиалгын аль ServiceItem(kind=DIAGNOSTIC) мөрийг энэ тайлан
 *     гүйцээж байгааг заана (өгвөл: тухайн мөрийг тайлантай холбож, статусыг
 *     дууссан болгоно)
 *   customerId, vehicleId, branchId — orderId байхгүй бол заавал
 *   mileageAtReport?, notes?
 *   data[*][value|note], photos[*][], signatures[*], signature
 */
export async function createReportAction(
  _prev: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const user = await requireUser();
  if (!(await isModuleEnabled(user.tenantId, "enable_diagnostics"))) {
    return { ok: false, message: moduleDisabledMessage("enable_diagnostics") };
  }
  const inactive = await subscriptionFailure(user.tenantId);
  if (inactive) return { ok: false, message: inactive };

  const templateId = s(formData, "templateId");
  const orderId = s(formData, "orderId");
  const itemId = s(formData, "itemId");
  // Захиалгагүй (standalone) тайланд canEditOrder хамаарахгүй тул эрхийг
  // шууд шалгана — mobile POST /diagnostics/reports-тэй ижил.
  if (!orderId && !canCreatePerm(user, "diagnostics")) {
    return { ok: false, message: "Танд оношилгооны тайлан үүсгэх эрх байхгүй." };
  }
  let customerId = s(formData, "customerId");
  let vehicleId = s(formData, "vehicleId");
  let branchId = s(formData, "branchId");
  const mileageStr = s(formData, "mileageAtReport");
  const notes = s(formData, "notes");

  if (!templateId) return { ok: false, message: "Загвар сонгоогүй байна." };

  const template = await prisma.diagnosticTemplate.findFirst({
    // Систем admin-ийн хуваалцсан (tenantId=NULL + grant) загварыг ч оруулна.
    where: {
      AND: [
        { id: templateId, isActive: true },
        tenantVisibleTemplateWhere(user.tenantId),
      ],
    },
    select: { id: true, name: true, version: true, schema: true },
  });
  if (!template) return { ok: false, message: "Загвар олдсонгүй." };

  // Салбараар хязгаарлагдсан ажилтан зөвхөн өөрийн салбарт оношилгоо хийнэ.
  const scope = workingBranchScopeId(user);

  // orderId өгөгдсөн бол захиалгаас customer/vehicle/branch-г өвлөнө.
  // Энэ нь зөвхөн урьдчилсан шалгалт (файл хадгалахаас өмнө илт буруу хүсэлтийг
  // буцаана) — бүх шалгалт захиалгын түгжээн дор commit команд дотор дахин хийгдэнэ.
  if (orderId) {
    const order = await prisma.serviceOrder.findFirst({
      where: {
        id: orderId,
        tenantId: user.tenantId,
        ...(scope ? { branchId: scope } : {}),
      },
      select: {
        id: true,
        status: true,
        customerId: true,
        vehicleId: true,
        branchId: true,
        assignedToId: true,
      },
    });
    if (!order) return { ok: false, message: "Засварын хуудас олдсонгүй." };
    if (!canEditOrder(user, order)) return { ok: false, message: "Танд энэ засварын хуудсанд оношилгоо бөглөх эрх байхгүй." };

    // Засварын хуудас эхэлсний дараа л оношилгоо бөглөнө.
    const status = order.status as OrderStatus;
    if (isOrderLocked(status)) {
      return {
        ok: false,
        message: "Дууссан / цуцлагдсан засварын хуудсанд оношилгоо бөглөх боломжгүй.",
      };
    }
    if (!canFillDiagnostics(status)) {
      return {
        ok: false,
        message: "Засварын хуудас эхлээгүй байна. Эхлүүлсний дараа оношилгоо бөглөнө.",
      };
    }

    customerId = order.customerId;
    vehicleId = order.vehicleId;
    branchId = order.branchId;

    if (itemId) {
      const item = await prisma.serviceItem.findFirst({
        where: {
          id: itemId,
          orderId: order.id,
          kind: "DIAGNOSTIC",
          status: { in: ["PENDING", "IN_PROGRESS"] }, // COMPLETED мөр түгжигдсэн
          diagnosticReportId: null,
        },
        select: { id: true, diagnosticTemplateId: true },
      });
      if (!item) {
        return {
          ok: false,
          message: "Оношилгооны мөр олдсонгүй эсвэл аль хэдийн бөглөгдсөн байна.",
        };
      }
      if (item.diagnosticTemplateId !== template.id) {
        return { ok: false, message: TEMPLATE_MISMATCH_MESSAGE };
      }
    }
  }

  if (!customerId || !vehicleId || !branchId) {
    return {
      ok: false,
      message: "Үйлчлүүлэгч, машин, салбар заавал шаардлагатай.",
    };
  }

  if (scope && branchId !== scope) {
    return {
      ok: false,
      message: "Зөвхөн өөрийн салбарт оношилгоо бүртгэх боломжтой.",
    };
  }

  // Тенант харьяалал шалгана
  const [cust, veh, br] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: customerId, tenantId: user.tenantId },
      select: { id: true },
    }),
    prisma.tenantVehicle.findUnique({
      where: {
        tenantId_vehicleId: { tenantId: user.tenantId, vehicleId },
      },
      select: { id: true, customerId: true },
    }),
    prisma.branch.findFirst({
      where: { id: branchId, tenantId: user.tenantId },
      select: { id: true },
    }),
  ]);
  if (!cust || !veh || !br) {
    return { ok: false, message: "Сонгосон мэдээлэл буруу." };
  }
  // Машин өөр үйлчлүүлэгчийнх бол тайлан тэр эзний түүхэнд орох тул хориглоно
  // (захиалга үүсгэхтэй ижил шалгуур — order-create-references.ts).
  if (veh.customerId !== customerId) {
    return { ok: false, message: "Сонгосон мэдээлэл буруу." };
  }

  const schema = template.schema as unknown as TemplateSchema;

  let collected: Awaited<ReturnType<typeof collectValidatedReportData>>;
  try {
    collected = await collectValidatedReportData(formData, schema);
  } catch (e) {
    if (e instanceof ReportDataValidationError || e instanceof UploadValidationError) {
      return { ok: false, message: e.message };
    }
    // Файлын системийн алдаа серверийн зам агуулж болох тул харуулахгүй.
    logUnexpectedActionError("diagnostic-report-upload", e);
    return { ok: false, message: "Файл хадгалахад алдаа гарлаа." };
  }

  let validated: Record<string, ReportEntry>;
  try {
    validated = validateReportData(schema, collected.data);
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Бөглөлт буруу.",
    };
  }

  const mileage = mileageStr ? Number(mileageStr) : null;
  const mileageVal =
    mileage !== null && Number.isFinite(mileage) && mileage >= 0
      ? Math.floor(mileage)
      : null;

  const maxSeverity = computeReportSeverity(schema, validated);

  let committed: Awaited<ReturnType<typeof commitDiagnosticReportCommand>>;
  try {
    committed = await commitWithReportUploadCleanup(
      collected.uploadedPaths,
      () =>
        commitDiagnosticReportCommand({
          tenantId: user.tenantId,
          actorId: user.id,
          actor: user,
          workingBranchId: scope,
          orderId: orderId || null,
          itemId: itemId || null,
          templateId: template.id,
          templateVersion: template.version,
          data: validated,
          signatureUrl: collected.signatureUrl,
          mileageAtReport: mileageVal,
          notes: notes || null,
          maxSeverity,
          standaloneCustomerId: customerId,
          standaloneVehicleId: vehicleId,
          standaloneBranchId: branchId,
        }),
      (result) => result.ok,
    );
  } catch (e) {
    logUnexpectedActionError("diagnostic-report-create", e);
    return { ok: false, message: "Хадгалахад алдаа гарлаа." };
  }
  if (!committed.ok) {
    return { ok: false, message: commitFailureMessage(committed.code) };
  }
  const reportId = committed.report.id;
  // Түгжээн дор уншсан захиалгын утга (preflight-аас өөрчлөгдсөн байж болно).
  customerId = committed.report.customerId;
  vehicleId = committed.report.vehicleId;
  branchId = committed.report.branchId;

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "DiagnosticReport",
    entityId: reportId,
    action: "CREATE",
    summary: `${template.name}${orderId ? ` · засварын хуудас #${orderId}` : ""}`,
    after: { templateId: template.id, orderId, customerId, vehicleId, branchId },
  });

  revalidatePath("/dashboard/diagnostics/reports");
  if (orderId) {
    revalidatePath(`/dashboard/orders/${orderId}`);
    redirect(`/dashboard/orders/${orderId}`);
  }
  redirect(`/dashboard/diagnostics/reports/${reportId}`);
}

/**
 * Оношилгооны формд анхны хариулт өгөх үед дуудагдана — тухайн
 * (хараахан бөглөгдөөгүй, "Хүлээгдэж буй") DIAGNOSTIC мөрийг автоматаар
 * "Эхэлсэн" болгож startedAt тавина. Тайлан хадгалах эрхтэй (canEditOrder)
 * хэн ч өдөөж болно — `orders.itemStatus` гараар солих эрх шаардахгүй.
 * Нөхцөл таарахгүй бол (аль хэдийн эхэлсэн г.м.) чимээгүй алгасна.
 */
export async function startDiagnosticItemAction(
  orderId: string,
  itemId: string,
): Promise<void> {
  const user = await requireUser();
  await assertModuleEnabled(user.tenantId, "enable_diagnostics");
  if (!orderId || !itemId) return;
  const scope = workingBranchScopeId(user);

  const order = await prisma.serviceOrder.findFirst({
    where: {
      id: orderId,
      tenantId: user.tenantId,
      ...(scope ? { branchId: scope } : {}),
    },
    select: { id: true, status: true, branchId: true, assignedToId: true },
  });
  if (!order || !canEditOrder(user, order)) return;
  const status = order.status as OrderStatus;
  if (isOrderLocked(status) || !canFillDiagnostics(status)) return;

  const { count } = await prisma.serviceItem.updateMany({
    where: {
      id: itemId,
      orderId: order.id,
      kind: "DIAGNOSTIC",
      status: "PENDING",
      diagnosticReportId: null,
    },
    data: { status: "IN_PROGRESS", startedAt: new Date(), completedAt: null },
  });
  if (count === 0) return;

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "ServiceOrder",
    entityId: order.id,
    action: "ITEM_STATUS_CHANGE",
    summary: `PENDING → IN_PROGRESS (мөр ${itemId}, оношилгоо бөглөж эхэлсэн)`,
    before: { status: "PENDING" },
    after: { status: "IN_PROGRESS" },
  });
  revalidatePath(`/dashboard/orders/${order.id}`);
}

export async function deleteReportAction(formData: FormData): Promise<ConfirmActionResult> {
  const user = await requireUser();
  if (!(await isModuleEnabled(user.tenantId, "enable_diagnostics"))) {
    return { error: moduleDisabledMessage("enable_diagnostics") };
  }
  const inactive = await subscriptionFailure(user.tenantId);
  if (inactive) return { error: inactive };
  const id = s(formData, "id");
  if (!id) return;

  const report = await prisma.diagnosticReport.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { id: true, orderId: true, filledById: true, order: { select: { assignedToId: true, branchId: true } } },
  });
  if (!report) return;

  const allowed =
    (canDeletePerm(user, "diagnostics") || report.filledById === user.id) &&
    (!report.order || canEditOrder(user, report.order));
  if (!allowed) {
    return { error: "Танд устгах эрх байхгүй." };
  }

  // Энэ тайланг гүйцээж байсан ServiceItem-ийг олж, тайлан устгагдсаны дараа
  // (FK-ийн SET NULL-аар diagnosticReportId нь автоматаар хоослогдоно) статусыг
  // нь бөглөх хүлээгдэж буй болгож буцаана.
  const linkedItem = await prisma.serviceItem.findUnique({
    where: { diagnosticReportId: report.id },
    select: { id: true, status: true },
  });
  // Дууссан оношилгооны мөр түгжигдсэн — тайланг устгаж мөрийг буцаах боломжгүй.
  if (linkedItem?.status === "COMPLETED") {
    return { error: "Дууссан ажлыг засах боломжгүй." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.diagnosticReport.delete({ where: { id: report.id } });
    if (linkedItem) {
      await tx.serviceItem.updateMany({
        where: { id: linkedItem.id },
        data: { status: "PENDING", startedAt: null, completedAt: null },
      });
    }
  });

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "DiagnosticReport",
    entityId: report.id,
    action: "DELETE",
    summary: report.orderId ? `засварын хуудас #${report.orderId}` : null,
  });

  revalidatePath("/dashboard/diagnostics/reports");
  if (report.orderId) revalidatePath(`/dashboard/orders/${report.orderId}`);
}

const TEMPLATE_MISMATCH_MESSAGE = "Оношилгооны мөрийн загвартай тохирох загвар сонгоно уу.";

/** Багц дууссан бол хэрэглэгчид харуулах мессеж, идэвхтэй бол null. */
async function subscriptionFailure(tenantId: string): Promise<string | null> {
  try {
    await assertActiveSubscription(tenantId);
    return null;
  } catch (error) {
    const known = knownAuthorizationMessage(error);
    if (known) return known;
    logUnexpectedActionError("diagnostic-report-subscription", error);
    return ACTION_GENERIC_ERROR_MESSAGE;
  }
}

function commitFailureMessage(code: DiagnosticReportCommitFailureCode): string {
  switch (code) {
    case "ORDER_NOT_FOUND":
      return "Засварын хуудас олдсонгүй.";
    case "ORDER_SCOPE_FORBIDDEN":
      return "Зөвхөн өөрийн салбарт оношилгоо бүртгэх боломжтой.";
    case "ORDER_EDIT_FORBIDDEN":
      return "Танд энэ засварын хуудсанд оношилгоо бөглөх эрх байхгүй.";
    case "ORDER_LOCKED":
      return "Дууссан / цуцлагдсан засварын хуудсанд оношилгоо бөглөх боломжгүй.";
    case "ORDER_NOT_IN_PROGRESS":
      return "Засварын хуудас эхлээгүй байна. Эхлүүлсний дараа оношилгоо бөглөнө.";
    case "DIAGNOSTIC_ITEM_UNAVAILABLE":
      return "Оношилгооны мөр олдсонгүй эсвэл аль хэдийн бөглөгдсөн байна.";
    case "DIAGNOSTIC_TEMPLATE_MISMATCH":
      return TEMPLATE_MISMATCH_MESSAGE;
  }
}
