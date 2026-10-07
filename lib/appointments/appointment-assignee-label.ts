/** Display name of an appointment's master — same "Last First" order as the orders list. */
export function appointmentAssigneeLabel(
  assignee: { firstName: string | null; lastName: string | null } | null | undefined,
): string | null {
  if (!assignee) return null;
  const label = [assignee.lastName, assignee.firstName].filter(Boolean).join(" ").trim();
  return label || null;
}

/** Select used by every appointment read that shows the master. Not filtered by eligibility — a stored assignee keeps showing. */
export const APPOINTMENT_ASSIGNEE_SELECT = { select: { id: true, firstName: true, lastName: true } } as const;

export type AssigneeCandidate = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  branchId: string | null;
  assignableBranchIds: string[];
};

export type AssigneeOption = { value: string; label: string };

/**
 * Picker options for one branch. `candidates` already passed
 * `buildAssignableUserWhere` (orderAssignableWhere + active role), so this only
 * applies the branch rule and the optional "self only" restriction for staff
 * without `orders.assign`. A stored assignee who is no longer eligible is
 * appended so the current value keeps rendering instead of silently vanishing.
 */
export function assigneeOptionsForBranch(
  candidates: readonly AssigneeCandidate[],
  branchId: string,
  opts: { onlyUserId?: string | null; current?: { id: string; firstName: string | null; lastName: string | null } | null } = {},
): AssigneeOption[] {
  const options = candidates
    .filter(
      (c) =>
        (c.branchId == null || c.branchId === branchId || c.assignableBranchIds.includes(branchId)) &&
        (!opts.onlyUserId || c.id === opts.onlyUserId),
    )
    .map((c) => ({ value: c.id, label: appointmentAssigneeLabel(c) ?? c.id }));
  const current = opts.current;
  if (current && !options.some((o) => o.value === current.id)) {
    options.push({ value: current.id, label: appointmentAssigneeLabel(current) ?? current.id });
  }
  return options;
}

export const CARRIED_ASSIGNEE_INELIGIBLE_MESSAGE =
  "Цаг захиалгын мастер идэвхгүй болсон тул өөр мастер сонгоно уу.";

export const NO_ASSIGN_PERMISSION_MESSAGE =
  "Цаг бүртгэхэд хариуцах мастер шаардлагатай. Танд мастер оноох эрх (orders.assign) байхгүй тул менежерт хандана уу.";
export const NO_ELIGIBLE_MASTER_MESSAGE = "Энэ салбарт сонгох боломжтой мастер алга.";

/** Why the master picker is empty: self-only users who are not eligible vs. a branch with no eligible master. */
export function emptyAssigneeReason(onlyUserId: string | null | undefined): string {
  return onlyUserId ? NO_ASSIGN_PERMISSION_MESSAGE : NO_ELIGIBLE_MASTER_MESSAGE;
}

/** True when a carried-over (not explicitly chosen) appointment master failed the order eligibility check. */
export function isCarriedAssigneeIneligible(error: unknown, carriedOver: boolean): boolean {
  return carriedOver && (error as { code?: unknown } | null)?.code === "ASSIGNEE_INELIGIBLE";
}
