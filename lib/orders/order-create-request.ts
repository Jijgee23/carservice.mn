import { internalPostpaidConflict } from "@/lib/orders/order-internal";
import { parseBusinessLocalDateTime } from "@/lib/booking-time";
import {
  MAX_CATEGORY_DURATION_MINUTES,
  MIN_CATEGORY_DURATION_MINUTES,
} from "@/lib/category-duration";

export type ParsedCreateOrderBody = {
  branchId: string;
  customerId: string;
  vehicleId: string;
  assignedToId: string | null;
  scheduledAt: Date | null;
  notes: string | null;
  appointmentId: string | null;
  estimatedDurationMinutes: number | null;
  // undefined -> derive from TenantVehicle.isPostpaid.
  isPostpaid?: boolean;
  // undefined -> not internal.
  isInternal?: boolean;
};

export type ParseCreateOrderBodyResult =
  | { ok: true; value: ParsedCreateOrderBody }
  | { ok: false; status: 400 | 422; message: string; fieldErrors?: Record<string, string>; code?: string };

const DURATION_BOUNDS_MESSAGE =
  `Хугацаа ${MIN_CATEGORY_DURATION_MINUTES} мин – ${MAX_CATEGORY_DURATION_MINUTES / 60} цагийн хооронд байна.`;

/**
 * Pure request parser for `POST /api/v1/orders`. No Prisma, no env, no auth —
 * see CLUSTER-3-CONTRACT.md ("The seam"). Owns the object-shape guard per
 * amendment 2; the route keeps only the raw `req.json()` parse-failure guard.
 */
export function parseCreateOrderBody(body: unknown): ParseCreateOrderBodyResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, message: "JSON object body шаардлагатай." };
  }
  const b = body as Record<string, unknown>;

  const branchId = typeof b.branchId === "string" ? b.branchId.trim() : "";
  const customerId = typeof b.customerId === "string" ? b.customerId.trim() : "";
  const vehicleId = typeof b.vehicleId === "string" ? b.vehicleId.trim() : "";

  if (b.assignedToId !== undefined && b.assignedToId !== null && typeof b.assignedToId !== "string") {
    return { ok: false, status: 400, message: "assignedToId нь string эсвэл null байна." };
  }
  const assignedToId = typeof b.assignedToId === "string" ? b.assignedToId.trim() || null : null;

  if (b.appointmentId !== undefined && b.appointmentId !== null && typeof b.appointmentId !== "string") {
    return { ok: false, status: 400, message: "appointmentId нь string эсвэл null байна." };
  }
  const appointmentId = typeof b.appointmentId === "string" ? b.appointmentId.trim() || null : null;

  let scheduledAt: Date | null = null;
  if (typeof b.scheduledAt === "string" && b.scheduledAt.trim()) {
    const parsed = parseBusinessLocalDateTime(b.scheduledAt);
    if (!Number.isFinite(parsed.getTime())) {
      // Amendment 1 (manager-confirmed): stays 400, preserved as-is, not
      // harmonized to 422 — see the header comment in
      // tests/order-create-request.test.ts.
      return {
        ok: false,
        status: 400,
        message: "Хүсэлт буруу.",
        fieldErrors: { scheduledAt: "Огноо буруу." },
      };
    }
    scheduledAt = parsed;
  } else if (b.scheduledAt !== undefined && b.scheduledAt !== null && typeof b.scheduledAt !== "string") {
    return { ok: false, status: 400, message: "scheduledAt нь business-local datetime string байна." };
  }

  if (b.isPostpaid !== undefined && typeof b.isPostpaid !== "boolean") {
    return { ok: false, status: 400, message: "isPostpaid нь boolean байна." };
  }
  const isPostpaid = typeof b.isPostpaid === "boolean" ? b.isPostpaid : undefined;

  if (b.isInternal !== undefined && typeof b.isInternal !== "boolean") {
    return { ok: false, status: 400, message: "isInternal нь boolean байна." };
  }
  const isInternal = typeof b.isInternal === "boolean" ? b.isInternal : undefined;
  const conflict = internalPostpaidConflict(isInternal, isPostpaid);
  if (conflict) {
    return {
      ok: false,
      status: 422,
      message: conflict.message,
      fieldErrors: { isInternal: conflict.message, isPostpaid: conflict.message },
      code: conflict.code,
    };
  }

  const notes = typeof b.notes === "string" ? b.notes.trim() || null : null;

  if (b.estimatedDurationMinutes !== undefined && b.estimatedDurationMinutes !== null && typeof b.estimatedDurationMinutes !== "number") {
    return { ok: false, status: 400, message: "estimatedDurationMinutes нь тоо эсвэл null байна." };
  }
  let estimatedDurationMinutes: number | null = null;
  if (typeof b.estimatedDurationMinutes === "number") {
    const value = b.estimatedDurationMinutes;
    if (
      !Number.isInteger(value) ||
      value < MIN_CATEGORY_DURATION_MINUTES ||
      value > MAX_CATEGORY_DURATION_MINUTES
    ) {
      return {
        ok: false,
        status: 422,
        message: "Хүсэлт буруу.",
        fieldErrors: { estimatedDurationMinutes: DURATION_BOUNDS_MESSAGE },
      };
    }
    estimatedDurationMinutes = value;
  }

  if (appointmentId !== null && estimatedDurationMinutes !== null) {
    return {
      ok: false,
      status: 422,
      message: "Хүсэлт буруу.",
      fieldErrors: {
        estimatedDurationMinutes: "Цаг захиалгатай үед хугацааг цаг захиалгаас авна.",
      },
    };
  }

  const fieldErrors: Record<string, string> = {};
  if (!branchId) fieldErrors.branchId = "Салбар сонгоно уу.";
  if (!customerId) fieldErrors.customerId = "Үйлчлүүлэгчээ сонгоно уу.";
  if (!vehicleId) fieldErrors.vehicleId = "Машинаа сонгоно уу.";
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, status: 422, message: "Хүсэлт буруу.", fieldErrors };
  }

  return {
    ok: true,
    value: {
      branchId,
      customerId,
      vehicleId,
      assignedToId,
      scheduledAt,
      notes,
      appointmentId,
      estimatedDurationMinutes,
      ...(isPostpaid !== undefined ? { isPostpaid } : {}),
      ...(isInternal !== undefined ? { isInternal } : {}),
    },
  };
}
