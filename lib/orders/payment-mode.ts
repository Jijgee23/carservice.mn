// "Төлбөрийн нөхцөл" selector: one mode <-> the two stored booleans
// (isPostpaid / isInternal). Pure; the server contract is unchanged.

export type PaymentMode = "regular" | "postpaid" | "internal";

export const PAYMENT_MODES: ReadonlyArray<{ value: PaymentMode; label: string; hint: string }> = [
  { value: "regular", label: "Энгийн", hint: "Дуусгахад төлбөр бүрэн төлөгдсөн байх ёстой." },
  { value: "postpaid", label: "Дараа тооцоо", hint: "Тооцоог дараа нийлнэ." },
  { value: "internal", label: "Дотоод засвар", hint: "Төлбөргүй — дотоод зардалд бүртгэгдэнэ." },
];

export const INTERNAL_BLOCKED_BY_PAYMENTS_HINT =
  "Төлбөр бүртгэгдсэн тул дотоод засвар болгох боломжгүй.";

export function modeFromFlags(flags: { isPostpaid?: boolean | null; isInternal?: boolean | null }): PaymentMode {
  if (flags.isInternal) return "internal";
  if (flags.isPostpaid) return "postpaid";
  return "regular";
}

export function flagsFromMode(mode: PaymentMode): { isPostpaid: boolean; isInternal: boolean } {
  return { isPostpaid: mode === "postpaid", isInternal: mode === "internal" };
}

export function defaultModeForVehicle(vehicle: { isPostpaid?: boolean | null } | null | undefined): PaymentMode {
  return vehicle?.isPostpaid ? "postpaid" : "regular";
}

// Vehicle changed: re-default from the vehicle unless "internal" is selected.
export function modeAfterVehicleChange(
  current: PaymentMode,
  vehicle: { isPostpaid?: boolean | null } | null | undefined,
): PaymentMode {
  return current === "internal" ? current : defaultModeForVehicle(vehicle);
}
