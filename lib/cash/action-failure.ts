import { ACTION_GENERIC_ERROR_MESSAGE, knownAuthorizationMessage, logUnexpectedActionError } from "@/lib/action-errors";
import { PaymentBankError } from "@/lib/banks";
import { UploadValidationError } from "@/lib/storage";
import { CashError } from "./rules";

/**
 * B1: the message a cash server action may show. Known domain errors (CashError, PaymentBankError) and the
 * subscription-locked message pass through; anything else is logged by name/code only (a raw message can carry
 * SQL/column text or filesystem paths) and replaced by `fallback` (default: the generic message API routes use).
 */
export function safeCashActionMessage(label: string, error: unknown, fallback: string = ACTION_GENERIC_ERROR_MESSAGE): string {
  if (error instanceof CashError || error instanceof PaymentBankError || error instanceof UploadValidationError) return error.message;
  const known = knownAuthorizationMessage(error);
  if (known) return known;
  logUnexpectedActionError(`cash/${label}`, error);
  return fallback;
}
