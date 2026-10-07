import { Prisma } from "@/app/generated/prisma/client";
import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
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
import { buildMeta, getApiPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { canEditOrder, orderReadWhere } from "@/lib/auth/order-access";
import { withOrderTransaction } from "@/lib/order-time-booking";
import { canFillDiagnostics, isOrderLocked, serviceItemTimingPatch, type OrderStatus } from "@/lib/orders";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "diagnostics.view");
  if (denied) return denied;

  const url = new URL(req.url);
  const vehicleId = url.searchParams.get("vehicleId")?.trim();
  const customerId = url.searchParams.get("customerId")?.trim();
  const orderId = url.searchParams.get("orderId")?.trim();
  const filledByMe = url.searchParams.get("filledByMe") === "true";
  const { page, pageSize, skip, take } = getApiPageInfo(url.searchParams);

  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const scope = scopeResult.branchId;
  const orderAccess = orderReadWhere(auth.user);
  const where: Prisma.DiagnosticReportWhereInput = {
    tenantId: auth.user.tenantId,
    ...(scope ? { branchId: scope } : {}),
    ...(Object.keys(orderAccess).length
      ? { OR: [{ orderId: null }, { order: { is: orderAccess } }] }
      : {}),
  };
  if (vehicleId) where.vehicleId = vehicleId;
  if (customerId) where.customerId = customerId;
  if (orderId) where.orderId = orderId;
  if (filledByMe) where.filledById = auth.user.id;

  const [reports, total] = await Promise.all([
    prisma.diagnosticReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        createdAt: true,
        templateVersion: true,
        mileageAtReport: true,
        orderId: true,
        template: { select: { id: true, name: true, type: true } },
        customer: { select: { id: true, fullName: true, phone: true } },
        vehicle: {
          select: { id: true, plate: true, make: true, model: true },
        },
        branch: { select: { id: true, name: true } },
        filledBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    }),
    prisma.diagnosticReport.count({ where }),
  ]);

  return jsonOk({ reports, pagination: buildMeta(total, page, pageSize) });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "diagnostics.create");
  if (denied) return denied;

  // Multipart form-data — зураг хавсаргахын тулд
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonError(
      400,
      "Multipart form-data илгээнэ үү (зураг хавсаргах боломжтой).",
    );
  }

  const templateId = str(formData, "templateId");
  const customerId = str(formData, "customerId");
  const vehicleId = str(formData, "vehicleId");
  const branchId = str(formData, "branchId");
  const orderId = str(formData, "orderId");
  const itemId = str(formData, "itemId");
  const mileageStr = str(formData, "mileageAtReport");
  const notes = str(formData, "notes");

  if (!templateId) return jsonError(422, "templateId шаардлагатай.");

  const template = await prisma.diagnosticTemplate.findFirst({
    where: {
      AND: [
        { id: templateId, isActive: true },
        tenantVisibleTemplateWhere(auth.user.tenantId),
      ],
    },
    select: { id: true, version: true, schema: true },
  });
  if (!template) return jsonError(404, "Загвар олдсонгүй.");

  // Салбараар хязгаарлагдсан ажилтан зөвхөн өөрийн салбарт оношилгоо хийнэ.
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const scope = scopeResult.branchId;

  let finalCustomerId = customerId;
  let finalVehicleId = vehicleId;
  let finalBranchId = branchId;
  let linkedOrderId = orderId || null;

  if (itemId) {
    // This preflight read only infers the parent order and avoids doing
    // upload work for an obviously invalid request. The authoritative item
    // and order checks happen again under the parent order lock below.
    const item = await prisma.serviceItem.findFirst({
      where: {
        id: itemId,
        ...(orderId ? { orderId } : {}),
        kind: "DIAGNOSTIC",
        order: {
          tenantId: auth.user.tenantId,
          ...(scope ? { branchId: scope } : {}),
        },
      },
      select: {
        diagnosticTemplateId: true,
        order: {
          select: {
            id: true,
            status: true,
            customerId: true,
            vehicleId: true,
            branchId: true,
            assignedToId: true,
          },
        },
      },
    });
    if (!item) {
      return jsonError(422, "Оношилгооны мөр олдсонгүй эсвэл аль хэдийн бөглөгдсөн байна.");
    }
    if (item.diagnosticTemplateId !== template.id) {
      return jsonError(422, "Оношилгооны мөрийн загвартай тохирох загвар сонгоно уу.", {
        code: "DIAGNOSTIC_TEMPLATE_MISMATCH",
      });
    }
    if (!canEditOrder(auth.user, item.order)) {
      return jsonError(403, "Танд энэ засварын хуудсанд оношилгоо бөглөх эрх байхгүй.");
    }
    const itemOrderStatus = item.order.status as OrderStatus;
    if (isOrderLocked(itemOrderStatus)) {
      return jsonError(422, "Дууссан / цуцлагдсан захиалгад оношилгоо бөглөх боломжгүй.", {
        code: "ORDER_LOCKED",
      });
    }
    if (!canFillDiagnostics(itemOrderStatus)) {
      return jsonError(422, "Оношилгооны тайланг зөвхөн ажиллаж буй захиалгад бүртгэнэ үү.", {
        code: "ORDER_STATUS_INVALID",
      });
    }
    linkedOrderId = item.order.id;
    finalCustomerId = item.order.customerId;
    finalVehicleId = item.order.vehicleId;
    finalBranchId = item.order.branchId;
  } else if (orderId) {
    const order = await prisma.serviceOrder.findFirst({
      where: {
        id: orderId,
        tenantId: auth.user.tenantId,
        ...(scope ? { branchId: scope } : {}),
      },
      select: {
        customerId: true,
        vehicleId: true,
        branchId: true,
        status: true,
        assignedToId: true,
      },
    });
    if (!order) return jsonError(404, "Засварын хуудас олдсонгүй.");
    if (!canEditOrder(auth.user, order)) return jsonError(403, "Танд энэ засварын хуудсанд оношилгоо бөглөх эрх байхгүй.");
    const orderStatus = order.status as OrderStatus;
    if (isOrderLocked(orderStatus)) {
      return jsonError(422, "Дууссан / цуцлагдсан захиалгад оношилгоо бөглөх боломжгүй.", {
        code: "ORDER_LOCKED",
      });
    }
    if (!canFillDiagnostics(orderStatus)) {
      return jsonError(422, "Оношилгооны тайланг зөвхөн ажиллаж буй захиалгад бүртгэнэ үү.", {
        code: "ORDER_STATUS_INVALID",
      });
    }
    finalCustomerId = order.customerId;
    finalVehicleId = order.vehicleId;
    finalBranchId = order.branchId;

  }

  if (!finalCustomerId || !finalVehicleId || !finalBranchId) {
    return jsonError(
      422,
      "customerId, vehicleId, branchId шаардлагатай (эсвэл orderId илгээнэ үү).",
    );
  }

  if (scope && finalBranchId !== scope) {
    return jsonError(403, "Зөвхөн өөрийн салбарт оношилгоо бүртгэх боломжтой.");
  }

  const [cust, veh, br] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: finalCustomerId, tenantId: auth.user.tenantId },
      select: { id: true },
    }),
    prisma.tenantVehicle.findUnique({
      where: {
        tenantId_vehicleId: {
          tenantId: auth.user.tenantId,
          vehicleId: finalVehicleId,
        },
      },
      select: { id: true },
    }),
    prisma.branch.findFirst({
      where: { id: finalBranchId, tenantId: auth.user.tenantId },
      select: { id: true },
    }),
  ]);
  if (!cust || !veh || !br) return jsonError(422, "Сонгосон ID-нууд буруу.");

  const schema = template.schema as unknown as TemplateSchema;

  let collected: Awaited<ReturnType<typeof collectValidatedReportData>>;
  try {
    collected = await collectValidatedReportData(formData, schema);
  } catch (e) {
    if (e instanceof ReportDataValidationError) {
      return jsonError(422, e.message);
    }
    return jsonError(
      400,
      e instanceof Error ? e.message : "Файл хадгалахад алдаа.",
    );
  }

  let validated: Record<string, ReportEntry>;
  try {
    validated = validateReportData(schema, collected.data);
  } catch (e) {
    return jsonError(422, e instanceof Error ? e.message : "Бөглөлт буруу.");
  }

  const mileage = mileageStr ? Number(mileageStr) : null;
  const mileageVal =
    mileage !== null && Number.isFinite(mileage) && mileage >= 0
      ? Math.floor(mileage)
      : null;

  if (itemId) {
    // The upload deliberately happened before this transaction. Everything
    // that decides whether an item can be completed, and both writes that
    // complete it, must be serialized by the parent order lock.
    return commitWithReportUploadCleanup(
      collected.uploadedPaths,
      () =>
        withOrderTransaction(
          auth.user.tenantId,
          linkedOrderId!,
          {
            id: true,
            customerId: true,
            vehicleId: true,
            branchId: true,
            status: true,
            assignedToId: true,
          },
          async (tx, rawOrder) => {
        const order = rawOrder as {
          id: string;
          customerId: string;
          vehicleId: string;
          branchId: string;
          status: string;
          assignedToId: string | null;
        } | null;
        if (!order) return jsonError(404, "Засварын хуудас олдсонгүй.");
        if (scope && order.branchId !== scope) {
          return jsonError(403, "Зөвхөн өөрийн салбарт оношилгоо бүртгэх боломжтой.");
        }
        if (!canEditOrder(auth.user, order)) {
          return jsonError(403, "Танд энэ засварын хуудсанд оношилгоо бөглөх эрх байхгүй.");
        }
        const txOrderStatus = order.status as OrderStatus;
        if (isOrderLocked(txOrderStatus)) {
          return jsonError(422, "Дууссан / цуцлагдсан захиалгад оношилгоо бөглөх боломжгүй.", {
            code: "ORDER_LOCKED",
          });
        }
        if (!canFillDiagnostics(txOrderStatus)) {
          return jsonError(422, "Оношилгооны тайланг зөвхөн ажиллаж буй захиалгад бүртгэнэ үү.", {
            code: "ORDER_STATUS_INVALID",
          });
        }

        const item = await tx.serviceItem.findFirst({
          where: {
            id: itemId,
            orderId: order.id,
            kind: "DIAGNOSTIC",
            status: { in: ["PENDING", "IN_PROGRESS"] }, // COMPLETED мөр түгжигдсэн
            diagnosticReportId: null,
          },
          select: { id: true, diagnosticTemplateId: true, startedAt: true },
        });
        if (!item) {
          return jsonError(422, "Оношилгооны мөр олдсонгүй эсвэл аль хэдийн бөглөгдсөн байна.");
        }
        if (item.diagnosticTemplateId !== template.id) {
          return jsonError(422, "Оношилгооны мөрийн загвартай тохирох загвар сонгоно уу.", {
            code: "DIAGNOSTIC_TEMPLATE_MISMATCH",
          });
        }

        const report = await tx.diagnosticReport.create({
          data: {
            templateVersion: template.version,
            data: validated,
            maxSeverity: computeReportSeverity(schema, validated),
            signatureUrl: collected.signatureUrl,
            mileageAtReport: mileageVal,
            notes: notes || null,
            tenantId: auth.user.tenantId,
            templateId: template.id,
            orderId: order.id,
            customerId: order.customerId,
            vehicleId: order.vehicleId,
            branchId: order.branchId,
            filledById: auth.user.id,
          },
          select: {
            id: true,
            createdAt: true,
            templateVersion: true,
            orderId: true,
            customerId: true,
            vehicleId: true,
            branchId: true,
          },
        });
        await tx.serviceItem.update({
          where: { id: item.id },
          data: {
            diagnosticReportId: report.id,
            status: "COMPLETED",
            ...serviceItemTimingPatch("COMPLETED", item.startedAt),
          },
        });
        return jsonOk({ report }, { status: 201 });
          },
        ),
      (result) => result instanceof Response ? result.ok : true,
    );
  }

  const report = await commitWithReportUploadCleanup(
    collected.uploadedPaths,
    () =>
      prisma.diagnosticReport.create({
        data: {
          templateVersion: template.version,
          data: validated,
          maxSeverity: computeReportSeverity(schema, validated),
          signatureUrl: collected.signatureUrl,
          mileageAtReport: mileageVal,
          notes: notes || null,
          tenantId: auth.user.tenantId,
          templateId: template.id,
          orderId: linkedOrderId,
          customerId: finalCustomerId,
          vehicleId: finalVehicleId,
          branchId: finalBranchId,
          filledById: auth.user.id,
        },
        select: {
          id: true,
          createdAt: true,
          templateVersion: true,
          orderId: true,
          customerId: true,
          vehicleId: true,
          branchId: true,
        },
      }),
  );

  return jsonOk({ report }, { status: 201 });
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
