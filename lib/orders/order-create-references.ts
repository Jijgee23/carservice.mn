// Pure reference-validation seam for `createOrderCommand`. No I/O, no Date
// construction, no randomness, and no imports from anything that reads the
// environment or touches Prisma — this must be importable by a plain unit
// test with zero setup. The caller (order-create-command.ts) does all the
// fetching and passes in the already-resolved row snapshots.

export type BranchReferenceSnapshot = {
  id: string;
  slotMinutes: number | null;
  isActive: boolean;
};

export type CustomerReferenceSnapshot = {
  id: string;
};

export type VehicleReferenceSnapshot = {
  vehicleId: string;
  customerId: string | null;
  isPostpaid: boolean;
};

export type AppointmentReferenceSnapshot = {
  id: string;
  customerId: string | null;
  accountId: string | null;
  vehicleId: string | null;
  serviceOrderId: string | null;
  branchId: string;
  estimatedDurationMinutes: number | null;
  arrivedAt: Date | null;
  categoryId: string | null;
  category: { name: string } | null;
  categories: Array<{ categoryId: string; category: { name: string } }>;
};

export type ValidateOrderReferencesInput = {
  branchId: string;
  customerId: string;
  vehicleId: string;
  appointmentId: string | null | undefined;
  branch: BranchReferenceSnapshot | null;
  customer: CustomerReferenceSnapshot | null;
  vehicle: VehicleReferenceSnapshot | null;
  appointment: AppointmentReferenceSnapshot | null;
  accountVehicleToLink: boolean;
};

export function validateOrderReferences(
  input: ValidateOrderReferencesInput,
): Record<string, string> {
  const { branchId, customerId, vehicleId, appointmentId, branch, customer, vehicle, appointment, accountVehicleToLink } = input;

  const fieldErrors: Record<string, string> = {};
  if (!branch || !branch.isActive) fieldErrors.branchId = "Салбар олдсонгүй.";
  if (!customer) fieldErrors.customerId = "Үйлчлүүлэгч олдсонгүй.";
  if (appointmentId && !appointment) {
    fieldErrors.appointmentId = "Цаг захиалга олдсонгүй.";
  } else if (appointmentId && appointment?.serviceOrderId) {
    fieldErrors.appointmentId = "Энэ цаг захиалгад засварын хуудас аль хэдийн үүссэн байна.";
  } else if (appointmentId && appointment?.branchId !== branchId) {
    fieldErrors.appointmentId = "Цаг захиалга өөр салбарынх байна.";
  } else if (appointmentId && appointment?.customerId !== customerId) {
    fieldErrors.customerId = "Цаг захиалгын үйлчлүүлэгчтэй таарахгүй байна.";
  }
  if (appointmentId && appointment?.vehicleId && appointment.vehicleId !== vehicleId) {
    fieldErrors.vehicleId = "Энэ цаг захиалгад өөр машин холбогдсон байна.";
  }
  if (vehicle && vehicle.customerId !== customerId) {
    fieldErrors.vehicleId = "Энэ машин сонгосон үйлчлүүлэгчийнх биш.";
  }
  if (!vehicle && !accountVehicleToLink) {
    fieldErrors.vehicleId = "Машин олдсонгүй.";
  }
  return fieldErrors;
}

/** Explicit isPostpaid wins; otherwise the vehicle's default (false when unknown). */
export function resolveOrderIsPostpaid(
  explicit: boolean | undefined | null,
  vehicleDefault: boolean | undefined | null,
): boolean {
  return explicit ?? vehicleDefault ?? false;
}
