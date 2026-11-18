// System талын харилцагч (tenant)-ийн ДУНДЫН цөм: вэб /system action болон мобайл /api/v1/system/tenants endpoint
// хоёул дуудна. Дуудагч setBypassContext + эрхийг (requireSuperAdmin / requireSystemApiUser) өөрөө шалгасан байх ёстой.
// Ажилтны (STAFF) хариунд орлого, зээл, багц, төлбөр, захиалгын тоо ОРОХГҮЙ — whitelist select/DTO.

import { prisma } from "@/lib/prisma";

type Db = Pick<typeof prisma, "tenant" | "user" | "branch">;

// ---------------------------------------------------------------- suspend / activate (вэб action-ийн логикийг гаргасан)

export type TenantStatusState = { suspended: boolean; creditSuspended: boolean; creditExempt: boolean };

export type SuspendResult = { ok: true; before: TenantStatusState; after: TenantStatusState } | { ok: false; reason: "NOT_FOUND" };

const STATUS_SELECT = { suspended: true, creditSuspended: true, creditExempt: true } as const;

/** Гараар зогсоосон — credit-ийн автомат нээлт хамаарахгүй (creditSuspended=false). */
export async function suspendTenant(id: string, db: Db = prisma): Promise<SuspendResult> {
  const before = await db.tenant.findUnique({ where: { id }, select: STATUS_SELECT });
  if (!before) return { ok: false, reason: "NOT_FOUND" };
  // update() нь олдохгүй id дээр P2025 шиддэг тул updateMany + count.
  const res = await db.tenant.updateMany({ where: { id }, data: { suspended: true, creditSuspended: false } });
  if (res.count === 0) return { ok: false, reason: "NOT_FOUND" };
  return { ok: true, before, after: { ...before, suspended: true, creditSuspended: false } };
}

/**
 * Credit-ээр зогсоосон байгууллагыг гараар сэргээвэл админы шийдвэр давуу: автомат блокоос чөлөөлнө (creditExempt),
 * эс бөгөөс маргаашийн cron дахин зогсооно.
 */
export async function activateTenant(id: string, db: Db = prisma): Promise<SuspendResult> {
  const before = await db.tenant.findUnique({ where: { id }, select: STATUS_SELECT });
  if (!before) return { ok: false, reason: "NOT_FOUND" };
  const creditExempt = before.creditSuspended ? true : before.creditExempt;
  await db.tenant.update({
    where: { id },
    data: { suspended: false, creditSuspended: false, ...(before.creditSuspended ? { creditExempt: true } : {}) },
  });
  return { ok: true, before, after: { suspended: false, creditSuspended: false, creditExempt } };
}

// ---------------------------------------------------------------- read (ажилтанд аюулгүй whitelist)

export type TenantStatusFilter = "active" | "suspended";

export function parseTenantStatusFilter(v: string | null): TenantStatusFilter | null | "invalid" {
  if (v == null || v === "") return null;
  return v === "active" || v === "suspended" ? v : "invalid";
}

export type TenantOwnerDto = { id: string; firstName: string; lastName: string; phone: string; email: string | null; activated: boolean };

export type TenantListItemDto = {
  id: string;
  name: string;
  registerNumber: string;
  phone1: string;
  email: string | null;
  plan: string;
  suspended: boolean;
  isTest: boolean;
  createdAt: string;
  owner: TenantOwnerDto | null;
};

type OwnerRow = { id: string; firstName: string; lastName: string; phone: string; email: string | null; verified: boolean };

export function toOwnerDto(u: OwnerRow): TenantOwnerDto {
  return { id: u.id, firstName: u.firstName, lastName: u.lastName, phone: u.phone, email: u.email, activated: u.verified };
}

const OWNER_SELECT = { id: true, firstName: true, lastName: true, phone: true, email: true, verified: true } as const;

export function buildTenantListWhere(input: { q: string | null; status: TenantStatusFilter | null }) {
  const q = input.q?.trim().slice(0, 100);
  return {
    ...(input.status === "suspended" ? { suspended: true } : {}),
    ...(input.status === "active" ? { suspended: false } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { registerNumber: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
            { phone1: { contains: q } },
          ],
        }
      : {}),
  };
}

export async function listTenants(
  input: { q: string | null; status: TenantStatusFilter | null; skip: number; take: number },
  db: Db = prisma,
): Promise<{ items: TenantListItemDto[]; total: number }> {
  const where = buildTenantListWhere(input);
  const [rows, total] = await Promise.all([
    db.tenant.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: input.skip,
      take: input.take,
      select: {
        id: true,
        name: true,
        registerNumber: true,
        phone1: true,
        email: true,
        plan: true,
        suspended: true,
        isTest: true,
        createdAt: true,
        users: { where: { isOwner: true, deletedAt: null }, orderBy: { createdAt: "asc" }, take: 1, select: OWNER_SELECT },
      },
    }),
    db.tenant.count({ where }),
  ]);
  return {
    total,
    items: rows.map((t) => ({
      id: t.id,
      name: t.name,
      registerNumber: t.registerNumber,
      phone1: t.phone1,
      email: t.email,
      plan: t.plan,
      suspended: t.suspended,
      isTest: t.isTest,
      createdAt: t.createdAt.toISOString(),
      owner: t.users[0] ? toOwnerDto(t.users[0]) : null,
    })),
  };
}

export type TenantDetailDto = Omit<TenantListItemDto, "owner"> & {
  slug: string;
  phone2: string | null;
  logoUrl: string | null;
  acceptsOnlineBooking: boolean;
  owners: TenantOwnerDto[];
  primaryBranch: {
    id: string;
    name: string;
    phone: string | null;
    city: string | null;
    district: string | null;
    khoroo: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  branchCount: number;
  employeeCount: number;
};

/** Олдохгүй бол null. Орлого, зээл, багц/төлбөр, захиалга, нууц үг зэрэг эмзэг талбарыг ХЭЗЭЭ Ч сонгохгүй. */
export async function getTenantDetail(id: string, db: Db = prisma): Promise<TenantDetailDto | null> {
  const t = await db.tenant.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      name: true,
      registerNumber: true,
      email: true,
      phone1: true,
      phone2: true,
      logoUrl: true,
      plan: true,
      suspended: true,
      isTest: true,
      acceptsOnlineBooking: true,
      createdAt: true,
      users: { where: { isOwner: true, deletedAt: null }, orderBy: { createdAt: "asc" }, select: OWNER_SELECT },
      branches: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        take: 1,
        select: { id: true, name: true, phone: true, city: true, district: true, khoroo: true, address: true, latitude: true, longitude: true },
      },
      _count: { select: { branches: true, users: { where: { deletedAt: null } } } },
    },
  });
  if (!t) return null;
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    registerNumber: t.registerNumber,
    email: t.email,
    phone1: t.phone1,
    phone2: t.phone2,
    logoUrl: t.logoUrl,
    plan: t.plan,
    suspended: t.suspended,
    isTest: t.isTest,
    acceptsOnlineBooking: t.acceptsOnlineBooking,
    createdAt: t.createdAt.toISOString(),
    owners: t.users.map(toOwnerDto),
    primaryBranch: t.branches[0] ?? null,
    branchCount: t._count.branches,
    employeeCount: t._count.users,
  };
}
