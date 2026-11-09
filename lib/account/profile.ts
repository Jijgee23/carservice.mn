// P8-B0 — profile validation and update, extracted from
// `app/_actions/profile.ts`'s `updateProfileAction` so the web server action
// and the future `PATCH /api/v1/me` route (P8-B1) share one core.
// Framework-free: no `"use server"`, `revalidatePath`, cookies, or
// `logAudit` here (mirrors `lib/employees/core.ts` — the single-entity
// mutation's audit call stays in the action wrapper, after the core
// succeeds) so this file works against an in-memory fake client in tests.
// Messages are byte-identical to the pre-extraction action.

import { isValidPhone, normalizePhone } from "@/lib/phone";
import type { AccountClient } from "./types";

// Structural check instead of `instanceof Prisma.PrismaClientKnownRequestError`
// (mirrors `lib/employees/core.ts`'s `isPrismaErrorCode`) so a fake thrown by
// tests (`{ code: "P2002" }`) is recognized the same as the real class,
// keeping this file fake-able without a real Prisma client.
function isP2002(e: unknown): e is { code: "P2002"; meta?: { target?: string[] } } {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "P2002" &&
    "clientVersion" in e
  );
}

export type ProfileActor = { id: string; tenantId: string };

export type ProfileInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

export type ProfileData = {
  firstName: string;
  lastName: string;
  /** Заавал биш — хоосон бол null. */
  email: string | null;
  phone: string;
};

export type ProfileResult<T> =
  | { ok: true; data: T }
  | { ok: false; fieldErrors?: Record<string, string>; message?: string };

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Талбар бүрийг шалгаад, буруу бол `fieldErrors`-ыг буцаана (хоосон бол хүчинтэй). */
export function validateProfileInput(
  input: ProfileInput,
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  if (!input.firstName) fieldErrors.firstName = "Нэрээ оруулна уу.";
  if (!input.lastName) fieldErrors.lastName = "Овгоо оруулна уу.";
  if (input.email && !isEmail(input.email)) fieldErrors.email = "Имэйл хаяг буруу.";
  if (!input.phone) fieldErrors.phone = "Утасны дугаар оруулна уу.";
  else if (!isValidPhone(input.phone))
    fieldErrors.phone = "Утасны дугаар 8 оронтой тоо байх ёстой.";
  return fieldErrors;
}

/**
 * Хэрэглэгчийн профайлыг шинэчилнэ (нэр, овог, имэйл, утас). Имэйл/утасны
 * давхцал P2002-оор Монгол талбарын алдаа болж буцна. Caller амжилттай бол
 * audit бичнэ (`data`-г `after` болгон ашиглаж болно).
 */
export async function updateProfile(
  db: AccountClient,
  actor: ProfileActor,
  input: ProfileInput,
): Promise<ProfileResult<ProfileData>> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  // Нэвтрэх үед имэйлийг lowercase хийдэгтэй нийцүүлнэ.
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();

  const fieldErrors = validateProfileInput({ firstName, lastName, email, phone });
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  const normalizedPhone = normalizePhone(phone) ?? phone;

  try {
    await db.user.update({
      where: { id: actor.id },
      data: { firstName, lastName, email: email || null, phone: normalizedPhone },
    });
  } catch (e) {
    if (isP2002(e)) {
      const target = (e.meta?.target as string[] | undefined)?.join(",") ?? "";
      if (target.includes("phone")) {
        return {
          ok: false,
          fieldErrors: { phone: "Энэ утас өөр хэрэглэгчид бүртгэгдсэн байна." },
        };
      }
      return {
        ok: false,
        fieldErrors: { email: "Энэ имэйл өөр хэрэглэгчид бүртгэгдсэн байна." },
      };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Алдаа гарлаа.",
    };
  }

  return {
    ok: true,
    data: { firstName, lastName, email: email || null, phone: normalizedPhone },
  };
}
