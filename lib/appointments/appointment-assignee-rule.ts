/**
 * Pure "master is required, never cleared" rules for appointments (QA #28,
 * user ruling): mirrors orders — users with `orders.assign` must pick a
 * master, everyone else is assigned to themselves, and a stored master can be
 * changed but never removed. Kept free of server-only imports so it is
 * unit-testable; the commands translate a rejection into AppointmentCommandError.
 */
export const ASSIGNEE_REQUIRED_CODE = "ASSIGNEE_REQUIRED";
export const ASSIGNEE_REQUIRED_FIELD_MESSAGE = "Хариуцах мастер сонгоно уу.";
export const ASSIGNEE_CLEAR_MESSAGE = "Хариуцах мастерыг арилгах боломжгүй — өөр мастер сонгоно уу.";

export type AssigneeRuleRejection = {
  ok: false;
  message: string;
  code: typeof ASSIGNEE_REQUIRED_CODE;
  fieldErrors: { assignedToId: string };
};

function reject(message: string): AssigneeRuleRejection {
  return {
    ok: false,
    message,
    code: ASSIGNEE_REQUIRED_CODE,
    fieldErrors: { assignedToId: ASSIGNEE_REQUIRED_FIELD_MESSAGE },
  };
}

/** Staff create: master mandatory; users without orders.assign get themselves. */
export function resolveCreateAssignee(input: {
  canAssign: boolean;
  actorId: string;
  requested: string | null | undefined;
}): { ok: true; assigneeId: string } | AssigneeRuleRejection {
  if (input.requested) return { ok: true, assigneeId: input.requested };
  if (!input.canAssign) return { ok: true, assigneeId: input.actorId };
  return reject(ASSIGNEE_REQUIRED_FIELD_MESSAGE);
}

/**
 * Plain assignee change (PATCH). `undefined` = untouched; `null` while a
 * master is stored = clear attempt (rejected). `null` on a master-less
 * appointment is a no-op.
 */
export function checkAssigneeChange(input: {
  requested: string | null | undefined;
  current: string | null;
}): { ok: true } | AssigneeRuleRejection {
  if (input.requested === null && input.current) return reject(ASSIGNEE_CLEAR_MESSAGE);
  return { ok: true };
}

/**
 * Confirm: the appointment must end up with a master. Returns the value to
 * pass on (`undefined` = keep the stored master).
 */
export function resolveConfirmAssignee(input: {
  canAssign: boolean;
  actorId: string;
  requested: string | null | undefined;
  current: string | null;
}): { ok: true; assigneeId: string | null | undefined } | AssigneeRuleRejection {
  if (input.requested === null && input.current) return reject(ASSIGNEE_CLEAR_MESSAGE);
  if (input.requested) return { ok: true, assigneeId: input.requested };
  if (input.current) return { ok: true, assigneeId: undefined };
  if (!input.canAssign) return { ok: true, assigneeId: input.actorId };
  return reject(ASSIGNEE_REQUIRED_FIELD_MESSAGE);
}
