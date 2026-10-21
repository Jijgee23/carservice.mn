import { categoriesForKindWhere } from "@/lib/categories";
import { AddLinkButton, BtnLink, btnClass } from "@/app/_components/landing-ops-ui";
import { EmptyState } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { requireUser } from "@/lib/auth";
import { canCreate, canDelete, canEdit, canView } from "@/lib/auth/roles";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseSort } from "@/lib/list-sort";
import {
  SERVICE_KIND_DESCRIPTION,
  SERVICE_KIND_LABEL,
  SERVICE_KIND_SLUG,
  type ServiceKind,
} from "@/lib/services";
import { BulkServiceList, type BulkServiceRow } from "./bulk-service-list";

export async function ServiceList({
  type,
  pageParam,
  sortParam,
  dirParam,
}: {
  type: ServiceKind;
  pageParam?: string;
  sortParam?: string;
  dirParam?: string;
}) {
  const user = await requireUser();
  if (!canView(user, "services")) redirect("/dashboard");
  const canAdd = canCreate(user, "services");
  const canRemove = canDelete(user, "services");
  const canBulkEdit = canEdit(user, "services");

  const where = { tenantId: user.tenantId, type };
  const { page, pageSize, skip, take } = getPageInfo(pageParam);
  const sort = parseSort(
    { sort: sortParam, dir: dirParam },
    (type === "GOODS" ? ["name", "price", "stock"] : ["name", "price"]) as readonly (
      | "name"
      | "price"
      | "stock"
    )[],
    { key: "name", dir: "asc" },
  );
  const orderBy = [
    { isActive: "desc" as const },
    sort.key === "price"
      ? { price: sort.dir }
      : sort.key === "stock"
        ? { stock: { sort: sort.dir, nulls: "last" as const } }
        : { name: sort.dir },
    { id: "asc" as const },
  ];
  const [services, total, categories] = await Promise.all([
    prisma.service.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        _count: { select: { items: true } },
        unit: { select: { name: true } },
        durationUnit: { select: { name: true } },
        category: { select: { name: true } },
      },
    }),
    prisma.service.count({ where }),
    canBulkEdit
      ? prisma.category.findMany({
          where: { isActive: true, ...categoriesForKindWhere(user.tenantId, type) },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const meta = buildMeta(total, page, pageSize);

  const newHref = `/dashboard/services/new?type=${SERVICE_KIND_SLUG[type]}`;
  const isGoods = type === "GOODS";

  const bulkRows: BulkServiceRow[] = services.map((svc) => ({
    id: svc.id,
    code: svc.code,
    name: svc.name,
    description: svc.description,
    categoryName: svc.category?.name ?? null,
    isActive: svc.isActive,
    itemsCount: svc._count.items,
    unitName: svc.unit?.name ?? null,
    durationValue: svc.durationValue?.toString() ?? null,
    durationUnitName: svc.durationUnit?.name ?? null,
    price: svc.price.toString(),
    costPrice: svc.costPrice?.toString() ?? null,
    stock: svc.stock?.toString() ?? null,
  }));

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">
            {SERVICE_KIND_LABEL[type]}
          </h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            {SERVICE_KIND_DESCRIPTION[type]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(type === "LABOR" || type === "GOODS") ? (
            <a href={`/dashboard/services/export?type=${type === "LABOR" ? "labor" : "goods"}`} className={btnClass("ghost", "md")}>
              Excel татах
            </a>
          ) : null}
          {canAdd && (type === "LABOR" || type === "GOODS") ? (
            <BtnLink href={`/dashboard/services/import?type=${type === "LABOR" ? "labor" : "goods"}`} variant="ghost">
              Excel-ээс оруулах
            </BtnLink>
          ) : null}
          {canAdd ? <AddLinkButton href={newHref}>Нэмэх</AddLinkButton> : null}
        </div>
      </div>

      {services.length === 0 ? (
        <EmptyState
          title={`${SERVICE_KIND_LABEL[type]} бүртгээгүй байна`}
          description="Шинээр нэмж эхлээрэй."
          cta={canAdd ? <AddLinkButton href={newHref}>Эхний нэмэх</AddLinkButton> : null}
        />
      ) : (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
          <BulkServiceList
            rows={bulkRows}
            categories={categories}
            canBulkEdit={canBulkEdit}
            canRemove={canRemove}
            isGoods={isGoods}
            sort={sort}
          />
          <Pagination
            page={meta.page}
            totalPages={meta.totalPages}
            total={meta.total}
            params={{ sort: sortParam ?? "", dir: dirParam ?? "" }}
          />
        </div>
      )}
    </div>
  );
}
