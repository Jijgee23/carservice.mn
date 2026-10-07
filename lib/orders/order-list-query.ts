import { Prisma } from "@/app/generated/prisma/client";
import {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/orders";
import { bookingDayBounds } from "@/lib/booking-time";
import { customerRelationSearchClauses } from "@/lib/customers/customer-search";

const MAX_PAGE_SIZE = 100;

export type OrderListQuery = {
  status?: OrderStatus;
  branchId?: string;
  assignedToId?: string;
  paymentStatus?: PaymentStatus;
  postpaid?: boolean;
  /** `internal=yes|no` — only / without internal repairs. Omitted = both. */
  internal?: boolean;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  vehicleId?: string;
  /** Case-insensitive substring of the vehicle plate. */
  plate?: string;
  customerId?: string;
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

export type OrderListQueryParseResult =
  | { ok: true; value: OrderListQuery }
  | { ok: false; field: string; message: string };

function optionalText(
  searchParams: URLSearchParams,
  name: string,
): string | undefined {
  const value = searchParams.get(name)?.trim();
  return value || undefined;
}

function parseEnum<T extends string>(
  searchParams: URLSearchParams,
  name: string,
  values: readonly T[],
): T | undefined | OrderListQueryParseResult {
  const raw = searchParams.get(name);
  if (raw == null) return undefined;
  const value = raw.trim();
  if (values.includes(value as T)) return value as T;
  return { ok: false, field: name, message: `${name} утга буруу байна.` };
}

function parseBoolean(
  searchParams: URLSearchParams,
  name: string,
): boolean | undefined | OrderListQueryParseResult {
  const raw = searchParams.get(name);
  if (raw == null) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return { ok: false, field: name, message: `${name} утга буруу байна.` };
}

function parseYesNo(
  searchParams: URLSearchParams,
  name: string,
): boolean | undefined | OrderListQueryParseResult {
  const raw = searchParams.get(name);
  if (raw == null) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "yes" || value === "true") return true;
  if (value === "no" || value === "false") return false;
  return { ok: false, field: name, message: `${name} утга буруу байна (yes эсвэл no).` };
}

function parseDate(
  searchParams: URLSearchParams,
  name: "dateFrom" | "dateTo",
): string | undefined | OrderListQueryParseResult {
  const raw = searchParams.get(name);
  if (raw == null) return undefined;
  const value = raw.trim();
  try {
    // bookingDayBounds validates both the shape and the calendar date, then
    // anchors the range to the product's Asia/Ulaanbaatar business timezone.
    bookingDayBounds(value);
  } catch {
    return { ok: false, field: name, message: `${name} огноо буруу байна.` };
  }
  return value;
}

function parsePositiveInteger(
  searchParams: URLSearchParams,
  name: string,
  defaultValue: number,
  maxValue?: number,
): number | OrderListQueryParseResult {
  const raw = searchParams.get(name);
  if (raw == null) return defaultValue;
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    return { ok: false, field: name, message: `${name} утга буруу байна.` };
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (maxValue != null && parsed > maxValue)) {
    return { ok: false, field: name, message: `${name} утга буруу байна.` };
  }
  return parsed;
}

/** Parse and validate the complete staff/mobile orders list query. */
export function parseOrderListQuery(
  searchParams: URLSearchParams,
): OrderListQueryParseResult {
  const status = parseEnum(searchParams, "status", ORDER_STATUSES);
  if (typeof status === "object") return status;
  const paymentStatus = parseEnum(searchParams, "paymentStatus", PAYMENT_STATUSES);
  if (typeof paymentStatus === "object") return paymentStatus;
  const postpaid = parseBoolean(searchParams, "postpaid");
  if (typeof postpaid === "object") return postpaid;
  const internal = parseYesNo(searchParams, "internal");
  if (typeof internal === "object") return internal;
  const dateFrom = parseDate(searchParams, "dateFrom");
  if (typeof dateFrom === "object") return dateFrom;
  const dateTo = parseDate(searchParams, "dateTo");
  if (typeof dateTo === "object") return dateTo;

  const page = parsePositiveInteger(searchParams, "page", 1);
  if (typeof page === "object") return page;
  // pageSize is the canonical name. If both aliases are present it wins over
  // limit, but both supplied values are validated before selecting it.
  let pageSize: number;
  if (searchParams.has("pageSize")) {
    const parsedPageSize = parsePositiveInteger(
      searchParams,
      "pageSize",
      50,
      MAX_PAGE_SIZE,
    );
    if (typeof parsedPageSize === "object") return parsedPageSize;
    pageSize = parsedPageSize;
    if (searchParams.has("limit")) {
      const limit = parsePositiveInteger(searchParams, "limit", 50, MAX_PAGE_SIZE);
      if (typeof limit === "object") return limit;
    }
  } else {
    const limit = parsePositiveInteger(searchParams, "limit", 50, MAX_PAGE_SIZE);
    if (typeof limit === "object") return limit;
    pageSize = limit;
  }
  const skip = (page - 1) * pageSize;
  if (!Number.isSafeInteger(skip)) {
    return { ok: false, field: "page", message: "page утга буруу байна." };
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return {
      ok: false,
      field: "dateFrom",
      message: "dateFrom нь dateTo-оос хойш байж болохгүй.",
    };
  }

  return {
    ok: true,
    value: {
      status,
      branchId: optionalText(searchParams, "branchId"),
      assignedToId: optionalText(searchParams, "assignedToId"),
      paymentStatus,
      postpaid,
      internal,
      dateFrom: typeof dateFrom === "string" ? dateFrom : undefined,
      dateTo: typeof dateTo === "string" ? dateTo : undefined,
      q: optionalText(searchParams, "q"),
      vehicleId: optionalText(searchParams, "vehicleId"),
      plate: optionalText(searchParams, "plate"),
      customerId: optionalText(searchParams, "customerId"),
      page,
      pageSize,
      skip,
      take: pageSize,
    },
  };
}

/** Арлын дугаар (VIN)-аар хайх нөхцөл: захиалгын snapshot болон машины одоогийн VIN.
 * 4-өөс богино текст бүх VIN-тэй тааралдахаас сэргийлж хоосон буцаана. */
export function orderVinSearchClauses(q: string): Prisma.ServiceOrderWhereInput[] {
  const vin = q.replace(/\s+/g, "").toUpperCase();
  if (vin.length < 4) return [];
  return [
    { vinSnapshot: { contains: vin, mode: "insensitive" } },
    { vehicle: { vin: { contains: vin, mode: "insensitive" } } },
  ];
}

function searchWhere(q: string): Prisma.ServiceOrderWhereInput {
  return {
    OR: [
      { number: { contains: q, mode: "insensitive" } },
      ...customerRelationSearchClauses(q, (customer) => ({ customer })),
      { plateSnapshot: { contains: q, mode: "insensitive" } },
      { vehicle: { plate: { contains: q, mode: "insensitive" } } },
      { vehicle: { make: { contains: q, mode: "insensitive" } } },
      { vehicle: { model: { contains: q, mode: "insensitive" } } },
      ...orderVinSearchClauses(q),
    ],
  };
}

export type BuildOrderListWhereOptions = {
  tenantId: string;
  workingBranchId?: string | null;
  readWhere: Prisma.ServiceOrderWhereInput;
};

/** Build the tenant- and access-scoped Prisma predicate for the list query. */
export function buildOrderListWhere(
  query: OrderListQuery,
  options: BuildOrderListWhereOptions,
): Prisma.ServiceOrderWhereInput {
  const scheduledAt: Prisma.DateTimeNullableFilter = {};
  if (query.dateFrom) scheduledAt.gte = bookingDayBounds(query.dateFrom).start;
  if (query.dateTo) scheduledAt.lt = bookingDayBounds(query.dateTo).end;
  const accessPredicates: Prisma.ServiceOrderWhereInput[] = [options.readWhere];
  if (query.q) accessPredicates.push(searchWhere(query.q));
  if (query.plate) {
    accessPredicates.push({
      OR: [
        { plateSnapshot: { contains: query.plate, mode: "insensitive" } },
        { vehicle: { plate: { contains: query.plate, mode: "insensitive" } } },
      ],
    });
  }

  return {
    // These predicates are intentionally unconditional. A route caller must
    // not be able to build an unscoped order read by omission, and access
    // predicates are kept in AND so client filters cannot overwrite them.
    tenantId: options.tenantId,
    ...(query.status ? { status: query.status } : {}),
    ...(options.workingBranchId
      ? { branchId: options.workingBranchId }
      : query.branchId
        ? { branchId: query.branchId }
        : {}),
    ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.postpaid !== undefined ? { isPostpaid: query.postpaid } : {}),
    ...(query.internal !== undefined ? { isInternal: query.internal } : {}),
    ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.dateFrom || query.dateTo ? { scheduledAt } : {}),
    AND: accessPredicates,
  };
}
