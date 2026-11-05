// D-132: shared sanitization seam for server actions.
//
// Server actions must not return a raw `error.message` to the browser, but they
// must still surface the handful of messages that tell the user what to *do* —
// "you lack the permission", "your subscription lapsed". The pattern is an
// allow-list, and an allow-list built from literals copied out of the throwing
// function is how a case goes missing silently: nothing in the type system or
// the test suite notices that a throw site was never listed.
//
// So `SUBSCRIPTION_LOCKED_MESSAGE` is baked in here rather than passed in.
// Every mutation path in this app runs through `assertActiveSubscription`, so
// every caller of this helper needs it; making it opt-in would recreate exactly
// the defect this module exists to remove. Domain-specific messages — the ones
// only one feature can throw — come in through `extraMessages`, and should be
// passed as named constants shared with their throw site, never as literals.

import { ModuleDisabledError } from "@/lib/plan-modules";
import { SUBSCRIPTION_LOCKED_MESSAGE } from "@/lib/subscription";

/** What the user sees when the error was not one we recognise. */
export const ACTION_GENERIC_ERROR_MESSAGE = "Серверийн алдаа гарлаа. Дахин оролдоно уу.";

/**
 * Returns the message if it is safe to show the user, otherwise `null`.
 *
 * `null` means "unrecognised" — the caller must log it and return
 * `ACTION_GENERIC_ERROR_MESSAGE`, not fall back to `error.message`.
 */
export function knownAuthorizationMessage(
  error: unknown,
  extraMessages: readonly string[] = [],
): string | null {
  if (!(error instanceof Error)) return null;
  if (error.message === SUBSCRIPTION_LOCKED_MESSAGE) return SUBSCRIPTION_LOCKED_MESSAGE;
  // Багцад ороогүй модулийн үйлдэл (assertModuleEnabled) — мессеж нь аюулгүй.
  if (error instanceof ModuleDisabledError) return error.message;
  if (extraMessages.includes(error.message)) return error.message;
  return null;
}

/**
 * Log an unrecognised action error without leaking its message. Only the error
 * name and an optional string `code` are recorded, both length-capped, because
 * a Prisma or driver message can carry query fragments and row values.
 */
export function logUnexpectedActionError(label: string, error: unknown): void {
  const value = error as { name?: unknown; code?: unknown } | null;
  const metadata = {
    name: typeof value?.name === "string" ? value.name.slice(0, 80) : "UnknownError",
    ...(typeof value?.code === "string" ? { code: value.code.slice(0, 40) } : {}),
  };
  console.error(`[${label}] unexpected error`, metadata);
}

/**
 * Гадаад үйлчилгээний (HUR, ebarimt) алдаанаас хэрэглэгчид харуулж болох,
 * бидний өөрсдийн бичсэн мессеж. Бусад алдаа (fetch failed, DNS г.м.) дотоод
 * хост/сүлжээний мэдээлэл агуулж болзошгүй тул нууж, лог руу бичнэ.
 */
export class PublicUpstreamError extends Error {}
