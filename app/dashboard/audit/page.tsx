import { redirect } from "next/navigation";
import { Chip, type ChipTone } from "@/app/_components/landing-ops-ui";
import {
  FilterSelect,
  ResetFilters,
  SearchBox,
} from "@/app/_components/list-filters";
import { EmptyState } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/roles";
import { type EntityType } from "@/lib/audit";
import { extractAuditRefs, humanizeAuditSummary } from "@/lib/audit-summary";
import {
  AUDIT_PAGE_SIZE,
  auditPagination,
  buildAuditWhere,
  parseAuditPage,
} from "@/lib/audit-query";
import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Аудит лог",
};

const ACTION_LABEL: Record<string, string> = {
  CREATE: "Үүсгэсэн",
  UPDATE: "Шинэчлэсэн",
  DELETE: "Устгасан",
  STATUS_CHANGE: "Статус",
  PAYMENT_CHANGE: "Төлбөр",
  STOCK_CHANGE: "Нөөц",
  ITEM_ADDED: "Мөр нэмсэн",
  ITEM_REMOVED: "Мөр устгасан",
  ITEM_UPDATED: "Мөр зассан",
  ITEM_CANCELLED: "Мөр цуцалсан",
  ITEM_STATUS_CHANGE: "Мөрийн явц",
  LOGIN: "Нэвтэрсэн",
  LOGOUT: "Гарсан",
  OTHER: "Бусад",
};

const ACTION_TONE: Record<string, ChipTone> = {
  CREATE: "ok",
  UPDATE: "accent",
  DELETE: "danger",
  STATUS_CHANGE: "accent",
  PAYMENT_CHANGE: "warn",
  STOCK_CHANGE: "neutral",
  ITEM_ADDED: "ok",
  ITEM_REMOVED: "danger",
  ITEM_UPDATED: "accent",
  ITEM_CANCELLED: "danger",
  ITEM_STATUS_CHANGE: "accent",
  LOGIN: "neutral",
  LOGOUT: "neutral",
  OTHER: "neutral",
};

const ENTITY_LABEL: Record<EntityType, string> = {
  ServiceOrder: "Засварын хуудас",
  Service: "Үйлчилгээ",
  Customer: "Үйлчлүүлэгч",
  Vehicle: "Машин",
  User: "Ажилтан",
  Branch: "Салбар",
  Category: "Ангилал",
  Unit: "Нэгж",
  Tenant: "Байгууллага",
  Role: "Үүрэг",
  DiagnosticTemplate: "Оношилгооны загвар",
  DiagnosticReport: "Оношилгооны тайлан",
  Appointment: "Цаг захиалга",
  Notification: "Мэдэгдэл",
  CashTransaction: "Кассын бичлэг",
  CashTransactionType: "Кассын төрөл",
  CashSession: "Кассын ээлж",
  PostpaidSettlement: "Тооцоо нийлэлт",
};

const ACTION_OPTIONS = Object.entries(ACTION_LABEL).map(([value, label]) => ({
  value,
  label,
}));

const ENTITY_OPTIONS = Object.entries(ENTITY_LABEL).map(([value, label]) => ({
  value,
  label,
}));

function entityHref(entity: string, entityId: string): string | null {
  switch (entity) {
    case "ServiceOrder":
      return `/dashboard/orders/${entityId}`;
    case "Service":
      return `/dashboard/services/${entityId}`;
    case "Customer":
      return `/dashboard/customers/${entityId}`;
    case "Vehicle":
      return `/dashboard/vehicles/${entityId}`;
    case "User":
      return `/dashboard/employees/${entityId}`;
    case "Branch":
      return `/dashboard/branches/${entityId}`;
    default:
      return null;
  }
}

function fmtDate(d: Date): string {
  return d.toLocaleString("mn-MN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    action?: string;
    entity?: string;
    userId?: string;
    page?: string;
  }>;
}) {
  const me = await requireUser();
  if (!hasPermission(me, "audit.view")) redirect("/dashboard");

  const {
    q = "",
    action = "",
    entity = "",
    userId = "",
    page: pageStr = "1",
  } = await searchParams;
  const page = parseAuditPage(pageStr);

  const where = buildAuditWhere(me.tenantId, { q, action, entity, userId });
  const { skip, take } = auditPagination(page);

  const [logs, total, users] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    }),
    prisma.auditLog.count({ where }),
    prisma.user.findMany({
      where: { tenantId: me.tenantId },
      orderBy: [{ firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);

  const summaryRefs = logs.map((l) => extractAuditRefs(l.summary ?? ""));
  const orderIds = Array.from(
    new Set([
      ...logs.filter((l) => l.entity === "ServiceOrder").map((l) => l.entityId),
      ...summaryRefs.flatMap((r) => r.orderIds),
    ]),
  );
  const itemIds = Array.from(new Set(summaryRefs.flatMap((r) => r.itemIds)));
  const serviceIds = Array.from(
    new Set(logs.filter((l) => l.entity === "Service").map((l) => l.entityId)),
  );
  const [orderRows, itemRows, serviceRows] = await Promise.all([
    orderIds.length
      ? prisma.serviceOrder.findMany({
          where: { tenantId: me.tenantId, id: { in: orderIds } },
          select: { id: true, number: true },
        })
      : [],
    itemIds.length
      ? prisma.serviceItem.findMany({
          where: { order: { tenantId: me.tenantId }, id: { in: itemIds } },
          select: { id: true, description: true },
        })
      : [],
    serviceIds.length
      ? prisma.service.findMany({
          where: { tenantId: me.tenantId, id: { in: serviceIds } },
          select: { id: true, name: true },
        })
      : [],
  ]);
  const orderNumbers = new Map(orderRows.map((o) => [o.id, o.number] as const));
  const itemLabels = new Map(itemRows.map((i) => [i.id, i.description] as const));
  const serviceNames = new Map(serviceRows.map((s) => [s.id, s.name] as const));

  const totalPages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Аудит лог</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          Тенант доторх чухал үйлдлийн түүх — засварын хуудасны статус, төлбөр, нөөц, мөр нэмэх/устгах.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SearchBox placeholder="Тайлбар, entity ID-аар хайх" />
        <FilterSelect
          paramName="action"
          placeholder="Бүх үйлдэл"
          options={ACTION_OPTIONS}
        />
        <FilterSelect
          paramName="entity"
          placeholder="Бүх обьект"
          options={ENTITY_OPTIONS}
        />
        <FilterSelect
          paramName="userId"
          placeholder="Бүх ажилтан"
          options={users.map((u) => ({
            value: u.id,
            label: `${u.lastName} ${u.firstName}`,
          }))}
        />
        <ResetFilters paramNames={["q", "action", "entity", "userId"]} />
      </div>

      {logs.length === 0 ? (
        <EmptyState
          title="Лог олдсонгүй"
          description="Шүүлтүүрээ өөрчилж үзнэ үү эсвэл системд үйлдэл хийгдсэн эсэхийг шалгана уу."
        />
      ) : (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="px-5 py-3 border-b border-[var(--oc-line)] font-plex-mono text-xs text-[var(--oc-muted3)] flex items-center justify-between">
            <span>
              Нийт {total.toLocaleString("mn-MN")} бичлэг · {page}/{totalPages}{" "}
              хуудас
            </span>
          </div>

          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr className="border-b border-[var(--oc-line)]">
                  {[
                    "Огноо",
                    "Хэрэглэгч",
                    "Обьект",
                    "Үйлдэл",
                    "Тайлбар",
                  ].map((h) => (
                    <th
                      key={h}
                      className="text-left font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-5 py-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--oc-line)]">
                {logs.map((l) => {
                  const href = entityHref(l.entity, l.entityId);
                  const entityLabel =
                    ENTITY_LABEL[l.entity as EntityType] ?? l.entity;
                  return (
                    <tr
                      key={l.id}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-5 py-3 font-plex-mono text-xs text-[var(--oc-muted2)] whitespace-nowrap">
                        {fmtDate(l.createdAt)}
                      </td>
                      <td className="px-5 py-3 text-sm text-[var(--oc-ink2)]">
                        {l.user ? (
                          <>
                            {l.user.lastName} {l.user.firstName}
                            <div className="text-xs text-[var(--oc-muted4)]">
                              {l.user.email}
                            </div>
                          </>
                        ) : (
                          <span className="text-[var(--oc-muted4)] text-xs">Систем</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-sm">
                        {href ? (
                          <a
                            href={href}
                            className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
                          >
                            {entityLabel}
                          </a>
                        ) : (
                          <span className="text-[var(--oc-ink2)]">{entityLabel}</span>
                        )}
                        <div className="font-plex-mono text-xs text-[var(--oc-muted4)]">
                          {orderNumbers.has(l.entityId)
                            ? `#${orderNumbers.get(l.entityId)}`
                            : l.entity === "Service" && serviceNames.has(l.entityId)
                              ? serviceNames.get(l.entityId)
                              : `${l.entityId.slice(0, 10)}…`}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <Chip tone={ACTION_TONE[l.action] ?? "neutral"}>
                          {ACTION_LABEL[l.action] ?? l.action}
                        </Chip>
                      </td>
                      <td className="px-5 py-3 text-sm text-[var(--oc-ink2)]">
                        {l.summary ? humanizeAuditSummary(l.summary, { orderNumbers, itemLabels }) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            params={{ q, action, entity, userId }}
          />
        </div>
      )}
    </div>
  );
}
