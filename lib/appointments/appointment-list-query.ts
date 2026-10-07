import { Prisma } from "@/app/generated/prisma/client";
import { customerRelationSearchClauses } from "@/lib/customers/customer-search";

/**
 * PURE — parses the tenant mobile `GET /api/v1/appointments` search
 * parameter and builds the matching Prisma `where` fragment. Mirrors the
 * web dashboard's search exactly (`app/dashboard/appointments/page.tsx`,
 * which imports and calls `appointmentSearchWhere` directly): account name
 * (case-insensitive), account phone (case-sensitive — phone numbers have no
 * case), tenant customer fullName (case-insensitive), tenant customer phone
 * (case-sensitive), and note (case-insensitive). Do not add fields here
 * without also adding them to the web dashboard — this module exists to
 * keep the two in parity, not to widen search past it.
 *
 * No Prisma client calls, no env, no auth — the caller owns tenant/branch
 * scoping and must always AND this fragment with its own scope predicate.
 */

export type AppointmentListQuery = {
  q?: string;
};

/** Trim `?q=`; an empty or whitespace-only value is treated as absent. */
export function parseAppointmentListQuery(
  searchParams: URLSearchParams,
): AppointmentListQuery {
  const q = searchParams.get("q")?.trim();
  return { q: q || undefined };
}

/**
 * The web dashboard's exact five-clause OR, unchanged. Returns `undefined`
 * when `q` is absent so callers never attach a vacuous/always-true filter.
 */
export function appointmentSearchWhere(
  q: string | undefined,
): Prisma.AppointmentWhereInput["OR"] | undefined {
  if (!q) return undefined;
  return [
    { account: { name: { contains: q, mode: "insensitive" } } },
    { account: { phone: { contains: q } } },
    ...customerRelationSearchClauses(q, (customer) => ({ customer })),
    { note: { contains: q, mode: "insensitive" } },
  ];
}
