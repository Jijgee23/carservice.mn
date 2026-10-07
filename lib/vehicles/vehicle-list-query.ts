// P3-B6 — one validated Vehicle list/search query contract, shared by the
// dashboard page (`app/dashboard/vehicles/page.tsx`) and the mobile API
// route (`app/api/v1/vehicles/route.ts` GET). Mirrors
// `lib/orders/order-list-query.ts` (P1-B1): pure, no Prisma client calls, no
// env, no auth — the caller owns `tenantId` and `orderBy`. Tenant isolation
// runs through `TenantVehicle`, never the global `Vehicle` row (Phase 3
// invariant), matching the current GET handler and the dashboard page.
//
// Measured before this slice — the two callers actually diverged:
//   - Dashboard search: vehicle plate/make/model/vin (case-insensitive) OR
//     customer fullName (case-insensitive) OR customer phone (case-sensitive).
//   - API route search: vehicle plate/make/model/vin only — no customer name
//     or phone match.
//   - Dashboard also filters `assigned` (yes/no, on `customerId`) and
//     `postpaid` (yes/no, on `isPostpaid`); the API route has neither.
//   - The API route filters an exact `customerId`; the dashboard does not.
// The task's acceptance bar is "search matches the same rows as the
// dashboard does today", so the dashboard's broader six-clause search is
// adopted as the one canonical field set — this is a deliberate WIDENING of
// what `GET /api/v1/vehicles?q=` matches (it now also matches on owner name
// and phone, same as the dashboard always has). `assigned` and `postpaid`
// are added to the shared contract because the dashboard page needs them and
// now goes through this same builder; they were not invented for mobile,
// they already existed as dashboard-only params. `customerId` (exact) is
// kept for the mobile/API caller's existing use. If both `customerId` and
// `assigned` are supplied, the exact `customerId` filter wins — no existing
// caller combines them today, but a URL splicing both must not fall over.

import { Prisma } from "@/app/generated/prisma/client";
import {
  optionalText,
  parsePagination,
  parseYesNo,
  rejectUnknownParams,
  type ListQueryParseError,
} from "@/lib/list-query-params";
import { customerRelationSearchClauses } from "@/lib/customers/customer-search";

const ALLOWED_PARAMS = [
  "q",
  "customerId",
  "assigned",
  "postpaid",
  "ownerKind",
  "page",
  "pageSize",
  "limit",
] as const;

export type VehicleListQuery = {
  q?: string;
  customerId?: string;
  assigned?: "yes" | "no";
  postpaid?: "yes" | "no";
  /** Phase 4a: эзэмшигч байгууллага / хувь хүн (derived, vehicle-owner-kind). */
  ownerKind?: "org" | "person";
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

export type VehicleListQueryParseResult =
  | { ok: true; value: VehicleListQuery }
  | ListQueryParseError;

/** Parse and validate the shared vehicles list/search query. */
export function parseVehicleListQuery(
  searchParams: URLSearchParams,
): VehicleListQueryParseResult {
  const unknown = rejectUnknownParams(searchParams, ALLOWED_PARAMS);
  if (unknown) return unknown;

  const assigned = parseYesNo(searchParams, "assigned");
  if (typeof assigned === "object") return assigned;
  const postpaid = parseYesNo(searchParams, "postpaid");
  if (typeof postpaid === "object") return postpaid;

  const ownerKindRaw = searchParams.get("ownerKind")?.trim();
  if (ownerKindRaw && ownerKindRaw !== "org" && ownerKindRaw !== "person") {
    return { ok: false, field: "ownerKind", message: "ownerKind нь org эсвэл person байх ёстой." };
  }
  const ownerKind = ownerKindRaw ? (ownerKindRaw as "org" | "person") : undefined;

  const pagination = parsePagination(searchParams);
  if ("ok" in pagination) return pagination;

  return {
    ok: true,
    value: {
      q: optionalText(searchParams, "q"),
      customerId: optionalText(searchParams, "customerId"),
      assigned,
      postpaid,
      ...(ownerKind ? { ownerKind } : {}),
      ...pagination,
    },
  };
}

function searchWhere(q: string): Prisma.TenantVehicleWhereInput["OR"] {
  return [
    { vehicle: { plate: { contains: q, mode: "insensitive" } } },
    { vehicle: { make: { contains: q, mode: "insensitive" } } },
    { vehicle: { model: { contains: q, mode: "insensitive" } } },
    { vehicle: { vin: { contains: q, mode: "insensitive" } } },
    ...customerRelationSearchClauses(q, (customer) => ({ customer })),
  ];
}

// Prisma-д regex байхгүй тул `ownerKindFromRegnum`-ийн "7 оронтой цэвэр тоо"
// дүрмийг "ownerRegnum цифрээр эхэлнэ" гэж ойролцоолно: хүний регистр үсгээр
// (2 кирилл үсэг + 8 цифр) эхэлдэг, байгууллагын 7 орон цэвэр цифр. Урт шалгахгүй
// тул үсгээр эхлээгүй, цифрээр эхэлсэн өөр хэлбэр (HUR-д байхгүй) байгууллага
// гэж тоологдож болно - хүлээн зөвшөөрсөн ойролцоолол.
const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

function ownerRegnumLooksOrg(): Prisma.TenantVehicleWhereInput {
  return {
    vehicle: { OR: DIGITS.map((d) => ({ ownerRegnum: { startsWith: d } })) },
  };
}

/** isOrganization (customer холбоотой бол) эсвэл customer-гүй үед регистрийн ойролцоолол. */
export function ownerKindWhere(kind: "org" | "person"): Prisma.TenantVehicleWhereInput {
  if (kind === "org") {
    return {
      OR: [
        { customer: { isOrganization: true } },
        { customerId: null, ...ownerRegnumLooksOrg() },
      ],
    };
  }
  return {
    OR: [
      { customer: { isOrganization: false } },
      {
        customerId: null,
        OR: [{ vehicle: { ownerRegnum: null } }, { NOT: ownerRegnumLooksOrg() }],
      },
    ],
  };
}

export type BuildVehicleListWhereOptions = {
  tenantId: string;
};

/** Build the tenant-scoped `TenantVehicle` predicate for the vehicles list query. */
export function buildVehicleListWhere(
  query: VehicleListQuery,
  options: BuildVehicleListWhereOptions,
): Prisma.TenantVehicleWhereInput {
  const where: Prisma.TenantVehicleWhereInput = { tenantId: options.tenantId };
  if (query.q) where.OR = searchWhere(query.q);
  if (query.customerId) {
    where.customerId = query.customerId;
  } else if (query.assigned === "yes") {
    where.customerId = { not: null };
  } else if (query.assigned === "no") {
    where.customerId = null;
  }
  if (query.ownerKind) where.AND = [ownerKindWhere(query.ownerKind)];
  if (query.postpaid === "yes") where.isPostpaid = true;
  else if (query.postpaid === "no") where.isPostpaid = false;
  return where;
}
