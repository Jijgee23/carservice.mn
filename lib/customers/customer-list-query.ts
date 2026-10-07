// P3-B6 — one validated Customer list/search query contract, shared by the
// dashboard page (`app/dashboard/customers/page.tsx`) and the mobile API
// route (`app/api/v1/customers/route.ts` GET). Mirrors
// `lib/orders/order-list-query.ts` (P1-B1): pure, no Prisma client calls, no
// env, no auth — the caller owns `tenantId` and `orderBy`.
//
// Measured before this slice: both callers already search the exact same
// three fields (`fullName` case-insensitive, `phone` case-sensitive, `email`
// case-insensitive) with an identical `OR`, so the search field set is
// unchanged by this extraction. The one difference was ordering — the
// dashboard sorts `createdAt desc`, the API route sorts `fullName asc` — and
// that is deliberately left to each caller (not part of this contract),
// exactly like `buildOrderListWhere` leaves ordering to its callers.

import { Prisma } from "@/app/generated/prisma/client";
import { normalizePlate } from "@/lib/vehicle-plate";
import {
  optionalText,
  parsePagination,
  rejectUnknownParams,
  type ListQueryParseError,
} from "@/lib/list-query-params";
import { customerRegnumClause } from "@/lib/customers/customer-search";

const ALLOWED_PARAMS = ["q", "kind", "page", "pageSize", "limit"] as const;

export type CustomerListQuery = {
  q?: string;
  /** Phase 4a: байгууллага / хувь хүн шүүлт. */
  kind?: "org" | "person";
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

export type CustomerListQueryParseResult =
  | { ok: true; value: CustomerListQuery }
  | ListQueryParseError;

/** Хоосон/байхгүй → undefined; org|person → утга; бусад → "invalid". */
export function parseCustomerKind(
  raw: string | null | undefined,
): "org" | "person" | undefined | "invalid" {
  const v = raw?.trim();
  if (!v) return undefined;
  return v === "org" || v === "person" ? v : "invalid";
}

/** Parse and validate the shared customers list/search query. */
export function parseCustomerListQuery(
  searchParams: URLSearchParams,
): CustomerListQueryParseResult {
  const unknown = rejectUnknownParams(searchParams, ALLOWED_PARAMS);
  if (unknown) return unknown;

  const pagination = parsePagination(searchParams);
  if ("ok" in pagination) return pagination;

  const kind = parseCustomerKind(searchParams.get("kind"));
  if (kind === "invalid") {
    return { ok: false, field: "kind", message: "kind нь org эсвэл person байх ёстой." };
  }

  return {
    ok: true,
    value: {
      q: optionalText(searchParams, "q"),
      ...(kind ? { kind } : {}),
      ...pagination,
    },
  };
}

export type BuildCustomerListWhereOptions = {
  tenantId: string;
};

/** Build the tenant-scoped Prisma predicate for the customers list query. */
export function buildCustomerListWhere(
  query: CustomerListQuery,
  options: BuildCustomerListWhereOptions,
): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = { tenantId: options.tenantId };
  if (query.kind === "org") where.isOrganization = true;
  else if (query.kind === "person") where.isOrganization = false;
  if (query.q) {
    const digits = query.q.replace(/[\s-]/g, "");
    // Хадгалагдсан дугаарууд normalizePlate-ээр канончлогдсон (зураасгүй,
    // Латин→Кирилл) тул хайлтыг ЯГ ингэж нормчилно. Нэг query хэвээр —
    // харин текст хайлт бүр tenantVehicles→vehicle.plate EXISTS нэмдэг.
    const plateQuery = normalizePlate(query.q);
    const or: Prisma.CustomerWhereInput[] = [
      { fullName: { contains: query.q, mode: "insensitive" } },
      { email: { contains: query.q, mode: "insensitive" } },
    ];
    if (plateQuery) {
      or.push({
        tenantVehicles: { some: { vehicle: { plate: { contains: plateQuery } } } },
      });
    }
    if (/\d/.test(digits)) or.push({ phone: { contains: digits } });
    // Phase 4a: байгууллагын нэр/регистрээр хайна (бусад заавруудын дараа).
    or.push({ orgName: { contains: query.q, mode: "insensitive" } });
    const regnum = customerRegnumClause(query.q);
    if (regnum) or.push(regnum);
    where.OR = or;
  }
  return where;
}
