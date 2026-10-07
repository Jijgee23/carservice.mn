import { parseBusinessLocalDateTime } from "@/lib/booking-time";

export type ParsedCreateAppointmentBody = {
  branchId: string;
  customerId: string;
  /** Optional global Vehicle id; must be this customer's tenant vehicle. */
  vehicleId: string | null;
  requestedAt: Date;
  note: string | null;
  categoryIds: string[];
  confirmed: boolean;
  /** Optional responsible master; null/absent = none. */
  assignedToId: string | null;
};

export type ParseCreateAppointmentBodyResult =
  | { ok: true; value: ParsedCreateAppointmentBody }
  | { ok: false; status: 400 | 422; message: string; fieldErrors?: Record<string, string> };

/**
 * Pure request parser for `POST /api/v1/appointments` (staff phone-in
 * registration). No Prisma, no env, no auth — modeled on
 * `lib/orders/order-create-request.ts`. Only shape/field validation and the
 * "past time" rejection live here; capacity, working-hours and branch/
 * customer existence stay server-side inside
 * `registerAppointmentByStaffCommand` (single source of truth, re-checked
 * under the row lock — see `reserveAppointmentInTransaction`).
 */
export function parseCreateAppointmentBody(
  body: unknown,
  now: Date = new Date(),
): ParseCreateAppointmentBodyResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, message: "JSON object body шаардлагатай." };
  }
  const b = body as Record<string, unknown>;

  const branchId = typeof b.branchId === "string" ? b.branchId.trim() : "";
  const customerId = typeof b.customerId === "string" ? b.customerId.trim() : "";

  if (b.vehicleId !== undefined && b.vehicleId !== null && typeof b.vehicleId !== "string") {
    return { ok: false, status: 400, message: "vehicleId нь string эсвэл null байна." };
  }
  const vehicleId = typeof b.vehicleId === "string" ? b.vehicleId.trim() || null : null;

  if (b.assignedToId !== undefined && b.assignedToId !== null && typeof b.assignedToId !== "string") {
    return { ok: false, status: 400, message: "assignedToId нь string эсвэл null байна." };
  }
  const assignedToId = typeof b.assignedToId === "string" ? b.assignedToId.trim() || null : null;

  if (b.note !== undefined && b.note !== null && typeof b.note !== "string") {
    return { ok: false, status: 400, message: "note нь string эсвэл null байна." };
  }
  const note = typeof b.note === "string" ? b.note.trim() || null : null;

  if (b.confirmed !== undefined && typeof b.confirmed !== "boolean") {
    return { ok: false, status: 400, message: "confirmed нь boolean байна." };
  }
  const confirmed = b.confirmed === true;

  let categoryIds: string[] = [];
  if (b.categoryIds !== undefined) {
    if (
      !Array.isArray(b.categoryIds) ||
      b.categoryIds.some((id) => typeof id !== "string" || !id.trim())
    ) {
      return { ok: false, status: 400, message: "categoryIds нь string[] байна." };
    }
    categoryIds = [...new Set(b.categoryIds.map((id) => (id as string).trim()))];
  }

  const requestedRaw = typeof b.requestedAt === "string" ? b.requestedAt : "";

  const fieldErrors: Record<string, string> = {};
  if (!branchId) fieldErrors.branchId = "Салбараа сонгоно уу.";
  if (!customerId) fieldErrors.customerId = "Үйлчлүүлэгчээ сонгоно уу.";

  let requestedAt: Date | null = null;
  if (!requestedRaw.trim()) {
    fieldErrors.requestedAt = "Цагаа сонгоно уу.";
  } else {
    const parsed = parseBusinessLocalDateTime(requestedRaw);
    if (!Number.isFinite(parsed.getTime())) {
      fieldErrors.requestedAt = "Огноо буруу.";
    } else if (parsed.getTime() <= now.getTime()) {
      // Past time can never create a booking — empty future capacity can
      // (the slots endpoint reflects that; this is the mirrored create-side
      // rejection, independent of capacity).
      fieldErrors.requestedAt = "Өнгөрсөн цаг сонгох боломжгүй.";
    } else {
      requestedAt = parsed;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, status: 422, message: "Хүсэлт буруу.", fieldErrors };
  }

  return {
    ok: true,
    value: {
      branchId,
      customerId,
      vehicleId,
      requestedAt: requestedAt!,
      note,
      categoryIds,
      confirmed,
      assignedToId,
    },
  };
}
