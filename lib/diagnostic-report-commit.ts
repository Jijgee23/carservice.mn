/**
 * D-123/D-127 — shared, atomic diagnostic-report commit.
 *
 * Both the mobile API (POST /api/v1/diagnostics/reports) and the dashboard
 * server action (createReportAction) call `commitDiagnosticReportCommand`.
 *
 * - Linked reports (`orderId`, with or without `itemId`) run under ONE
 *   parent-order row lock (`withOrderTransaction`). Everything that decides
 *   whether the report may be written — order existence/tenant, branch scope,
 *   edit permission, order status, item availability, template match — is
 *   re-validated against the fresh locked row, and the report insert plus the
 *   item completion happen in the same transaction. Any pre-lock reads the
 *   adapters do are only cheap preflights (to avoid upload work for obviously
 *   invalid requests) and are never authoritative.
 * - Standalone reports (no order) are a single insert and stay outside the lock.
 *
 * The command returns domain success/failure codes; adapters map them to their
 * own user-facing vocabulary (JSON error vs. form state message).
 *
 * File uploads happen BEFORE this command; adapters wrap the call in
 * `commitWithReportUploadCleanup` so a non-success or a thrown transaction
 * (which has already rolled back) deletes the request-owned uploads.
 */
import type { ReportEntry, ReportSeverity } from "@/lib/diagnostics";
import { canEditOrder, type OrderAccessUser } from "@/lib/auth/order-access";
import { withOrderTransaction } from "@/lib/order-time-booking";
import { canFillDiagnostics, isOrderLocked, type OrderStatus } from "@/lib/orders";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";

export type LockedOrderSnapshot = {
  id: string;
  tenantId: string;
  customerId: string;
  vehicleId: string;
  branchId: string;
  status: string;
  assignedToId: string | null;
};

export type DiagnosticItemSnapshot = {
  id: string;
  diagnosticTemplateId: string | null;
  startedAt: Date | null;
};

/** Shape returned to adapters (the API echoes it as `{ report }`). */
export type DiagnosticReportRecord = {
  id: string;
  orderId: string | null;
  customerId: string;
  vehicleId: string;
  branchId: string;
  createdAt?: Date;
  templateVersion?: number;
};

export type DiagnosticReportWrite = {
  tenantId: string;
  filledById: string;
  orderId: string | null;
  customerId: string;
  vehicleId: string;
  branchId: string;
  templateId: string;
  templateVersion: number;
  data: Record<string, ReportEntry>;
  signatureUrl: string | null;
  mileageAtReport: number | null;
  notes: string | null;
  maxSeverity: ReportSeverity | null;
};

export type DiagnosticItemQuery = {
  where: {
    id: string;
    orderId: string;
    kind: "DIAGNOSTIC";
    status: { not: "CANCELLED" };
    diagnosticReportId: null;
  };
  select: { id: true; diagnosticTemplateId: true; startedAt: true };
};

export type DiagnosticReportTransactionPort = {
  findAvailableItem: (query: DiagnosticItemQuery) => Promise<DiagnosticItemSnapshot | null>;
  createReport: (write: DiagnosticReportWrite) => Promise<DiagnosticReportRecord>;
  completeItem: (input: {
    itemId: string;
    reportId: string;
    completedAt: Date;
    startedAt: Date | null;
  }) => Promise<void>;
};

export type DiagnosticReportCommitFailureCode =
  | "ORDER_NOT_FOUND"
  | "ORDER_SCOPE_FORBIDDEN"
  | "ORDER_EDIT_FORBIDDEN"
  | "ORDER_LOCKED"
  | "ORDER_NOT_IN_PROGRESS"
  | "DIAGNOSTIC_ITEM_UNAVAILABLE"
  | "DIAGNOSTIC_TEMPLATE_MISMATCH";

export type DiagnosticReportCommitResult =
  | { ok: true; report: DiagnosticReportRecord }
  | { ok: false; status: 403 | 404 | 422; code: DiagnosticReportCommitFailureCode };

export const LOCKED_ORDER_SELECT = {
  id: true,
  tenantId: true,
  customerId: true,
  vehicleId: true,
  branchId: true,
  status: true,
  assignedToId: true,
} as const;

export type LockedOrderSelect = typeof LOCKED_ORDER_SELECT;

export type DiagnosticReportCommitInput = {
  tenantId: string;
  actorId: string;
  /**
   * Order-access identity used by the default (Prisma) dependencies'
   * `canEditOrder`. Optional only so injected test dependencies don't need it;
   * production adapters always pass it. Without it, linked commits are denied.
   */
  actor?: OrderAccessUser;
  /** Working-branch scope; null = unrestricted. */
  workingBranchId: string | null;
  orderId: string | null;
  itemId: string | null;
  templateId: string;
  templateVersion: number;
  data: Record<string, ReportEntry>;
  signatureUrl: string | null;
  mileageAtReport: number | null;
  notes: string | null;
  maxSeverity: ReportSeverity | null;
  /** Used only for standalone (orderId = null) reports. */
  standaloneCustomerId: string;
  standaloneVehicleId: string;
  standaloneBranchId: string;
};

export type DiagnosticReportCommitDependencies = {
  withLockedOrder: (
    tenantId: string,
    orderId: string,
    select: LockedOrderSelect,
    work: (
      transaction: DiagnosticReportTransactionPort,
      order: LockedOrderSnapshot | null,
    ) => Promise<DiagnosticReportCommitResult>,
  ) => Promise<DiagnosticReportCommitResult>;
  createStandaloneReport: (write: DiagnosticReportWrite) => Promise<DiagnosticReportRecord>;
  canEditOrder: (order: LockedOrderSnapshot) => boolean;
  now: () => Date;
};

const REPORT_SELECT = {
  id: true,
  createdAt: true,
  templateVersion: true,
  orderId: true,
  customerId: true,
  vehicleId: true,
  branchId: true,
} as const;

function failure(
  status: 403 | 404 | 422,
  code: DiagnosticReportCommitFailureCode,
): DiagnosticReportCommitResult {
  return { ok: false, status, code };
}

function transactionPort(tx: PrismaTransactionClient): DiagnosticReportTransactionPort {
  return {
    async findAvailableItem(query) {
      // The command asks for any non-cancelled, unfilled line; production also
      // keeps the completed-line lock (tests/order-item-completed-lock): a
      // COMPLETED line is never re-opened by attaching a report to it.
      return await tx.serviceItem.findFirst({
        where: { ...query.where, status: { in: ["PENDING", "IN_PROGRESS"] } },
        select: query.select,
      });
    },
    async createReport(write) {
      return await tx.diagnosticReport.create({ data: write, select: REPORT_SELECT });
    },
    async completeItem({ itemId, reportId, completedAt, startedAt }) {
      await tx.serviceItem.update({
        where: { id: itemId },
        data: {
          diagnosticReportId: reportId,
          status: "COMPLETED",
          // Keep the startedAt set when filling began; set it now otherwise.
          startedAt: startedAt ?? completedAt,
          completedAt,
        },
      });
    },
  };
}

/** Production dependencies: Prisma + the parent-order row lock. */
export function prismaDiagnosticReportCommitDependencies(
  actor: OrderAccessUser | undefined,
): DiagnosticReportCommitDependencies {
  return {
    async withLockedOrder(tenantId, orderId, select, work) {
      return await withOrderTransaction(tenantId, orderId, select, async (tx, rawOrder) => {
        return await work(transactionPort(tx), rawOrder as LockedOrderSnapshot | null);
      });
    },
    async createStandaloneReport(write) {
      return await prisma.diagnosticReport.create({ data: write, select: REPORT_SELECT });
    },
    canEditOrder: (order) => (actor ? canEditOrder(actor, order) : false),
    now: () => new Date(),
  };
}

export async function commitDiagnosticReportCommand(
  input: DiagnosticReportCommitInput,
  dependencies: DiagnosticReportCommitDependencies = prismaDiagnosticReportCommitDependencies(
    input.actor,
  ),
): Promise<DiagnosticReportCommitResult> {
  const baseWrite = {
    tenantId: input.tenantId,
    filledById: input.actorId,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    data: input.data,
    signatureUrl: input.signatureUrl,
    mileageAtReport: input.mileageAtReport,
    notes: input.notes,
    maxSeverity: input.maxSeverity,
  };

  const orderId = input.orderId;
  if (!orderId) {
    // An item always belongs to an order; adapters resolve the order first.
    if (input.itemId) return failure(422, "DIAGNOSTIC_ITEM_UNAVAILABLE");
    const report = await dependencies.createStandaloneReport({
      tenantId: baseWrite.tenantId,
      filledById: baseWrite.filledById,
      orderId: null,
      customerId: input.standaloneCustomerId,
      vehicleId: input.standaloneVehicleId,
      branchId: input.standaloneBranchId,
      templateId: baseWrite.templateId,
      templateVersion: baseWrite.templateVersion,
      data: baseWrite.data,
      signatureUrl: baseWrite.signatureUrl,
      mileageAtReport: baseWrite.mileageAtReport,
      notes: baseWrite.notes,
      maxSeverity: baseWrite.maxSeverity,
    });
    return { ok: true, report };
  }

  return await dependencies.withLockedOrder(
    input.tenantId,
    orderId,
    LOCKED_ORDER_SELECT,
    async (tx, order) => {
      if (!order || order.tenantId !== input.tenantId || order.id !== orderId) {
        return failure(404, "ORDER_NOT_FOUND");
      }
      if (input.workingBranchId && order.branchId !== input.workingBranchId) {
        return failure(403, "ORDER_SCOPE_FORBIDDEN");
      }
      if (!dependencies.canEditOrder(order)) {
        return failure(403, "ORDER_EDIT_FORBIDDEN");
      }
      const status = order.status as OrderStatus;
      if (isOrderLocked(status)) return failure(422, "ORDER_LOCKED");
      if (!canFillDiagnostics(status)) return failure(422, "ORDER_NOT_IN_PROGRESS");

      let item: DiagnosticItemSnapshot | null = null;
      if (input.itemId) {
        item = await tx.findAvailableItem({
          where: {
            id: input.itemId,
            orderId: order.id,
            kind: "DIAGNOSTIC",
            status: { not: "CANCELLED" },
            diagnosticReportId: null,
          },
          select: { id: true, diagnosticTemplateId: true, startedAt: true },
        });
        if (!item) return failure(422, "DIAGNOSTIC_ITEM_UNAVAILABLE");
        if (item.diagnosticTemplateId !== input.templateId) {
          return failure(422, "DIAGNOSTIC_TEMPLATE_MISMATCH");
        }
      }

      // Ownership always comes from the locked order, never the request.
      const report = await tx.createReport({
        tenantId: baseWrite.tenantId,
        filledById: baseWrite.filledById,
        orderId: order.id,
        customerId: order.customerId,
        vehicleId: order.vehicleId,
        branchId: order.branchId,
        templateId: baseWrite.templateId,
        templateVersion: baseWrite.templateVersion,
        data: baseWrite.data,
        signatureUrl: baseWrite.signatureUrl,
        mileageAtReport: baseWrite.mileageAtReport,
        notes: baseWrite.notes,
        maxSeverity: baseWrite.maxSeverity,
      });

      if (item) {
        await tx.completeItem({
          itemId: item.id,
          reportId: report.id,
          completedAt: dependencies.now(),
          startedAt: item.startedAt,
        });
      }
      return { ok: true, report };
    },
  );
}
