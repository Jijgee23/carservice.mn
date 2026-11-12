import { Prisma } from "@/app/generated/prisma/client";
import { bulkSystemCategoriesAction } from "@/app/_actions/system-categories";
import { FilterSelect, ResetFilters, SearchBox } from "@/app/_components/list-filters";
import { EmptyState, PageHeader } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireSuperAdmin } from "@/lib/auth/system";
import { formatShortDateTime, parseSort } from "@/lib/list-sort";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { AdminListTable, NumCell } from "../_components/admin-list-table";
import { CreateSystemCategoryButton } from "./create-system-category-modal";

export const metadata = { title: "Сэлбэгийн ангилал" };

export const dynamic = "force-dynamic";

const SORT_KEYS = ["name", "goods", "created"] as const;

type Search = { q?: string; status?: string; sort?: string; dir?: string; page?: string };

export default async function SystemCategoriesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = sp.status === "active" || sp.status === "inactive" ? sp.status : "";
  const sort = parseSort(sp, SORT_KEYS, { key: "created", dir: "desc" });
  const { page, pageSize, skip, take } = getPageInfo(sp.page);

  const where: Prisma.CategoryWhereInput = {
    tenantId: null,
    kind: "GOODS",
    ...(q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] }
      : {}),
    ...(status ? { isActive: status === "active" } : {}),
  };
  const orderBy: Prisma.CategoryOrderByWithRelationInput[] =
    sort.key === "name"
      ? [{ name: sort.dir }]
      : sort.key === "goods"
        ? [{ services: { _count: sort.dir } }, { name: "asc" }]
        : [{ createdAt: sort.dir }, { id: sort.dir }];

  const [categories, total] = await Promise.all([
    prisma.category.findMany({
      where,
      orderBy,
      skip,
      take,
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        createdAt: true,
        _count: { select: { services: true, catalogItems: true } },
      },
    }),
    prisma.category.count({ where }),
  ]);
  const meta = buildMeta(total, page, pageSize);

  // Хэдэн байгууллага ашиглаж байгаа (бараа бүртгэсэн тенантын тоо) — энэ хуудасны мөрүүдэд.
  const usage = categories.length
    ? await prisma.service.groupBy({
        by: ["categoryId", "tenantId"],
        where: { categoryId: { in: categories.map((c) => c.id) } },
      })
    : [];
  const tenantsBy = new Map<string, number>();
  for (const u of usage) {
    if (u.categoryId) tenantsBy.set(u.categoryId, (tenantsBy.get(u.categoryId) ?? 0) + 1);
  }

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <PageHeader
        title="Сэлбэгийн ангилал"
        description="Бүх байгууллагад нийтлэг сэлбэг/барааны системийн ангилал. Байгууллагууд сэлбэг бүртгэхдээ сонгоно, засах боломжгүй."
        actions={<CreateSystemCategoryButton />}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SearchBox placeholder="Нэр, тайлбараар хайх..." />
        <FilterSelect
          paramName="status"
          placeholder="Бүх төлөв"
          options={[
            { value: "active", label: "Идэвхтэй" },
            { value: "inactive", label: "Идэвхгүй" },
          ]}
        />
        <ResetFilters paramNames={["q", "status", "sort", "dir"]} />
        <span className="ml-auto text-xs text-[var(--oc-muted3)] tabular-nums">Нийт {total}</span>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          title="Ангилал алга"
          description={q || status ? "Энэ шүүлтэд тохирох ангилал алга." : "Одоогоор системийн ангилал алга байна."}
        />
      ) : (
        <AdminListTable
          noun="ангилал"
          sort={sort}
          bulkAction={bulkSystemCategoriesAction}
          deleteNote="Бараа, загвар, захиалга эсвэл нэгдсэн сангийн мөр холбогдсон ангилал устахгүй — идэвхгүй болж, шинэ сонголтоос нуугдана."
          columns={[
            { label: "Бараа", sortKey: "goods" },
            { label: "Сангийн мөр" },
            { label: "Байгууллага" },
            { label: "Үүссэн", sortKey: "created", className: "whitespace-nowrap" },
          ]}
          rows={categories.map((c) => ({
            id: c.id,
            name: c.name,
            href: `/system/system-categories/${c.id}`,
            isActive: c.isActive,
            sub: c.description ?? undefined,
            cells: [
              <NumCell key="g">{c._count.services}</NumCell>,
              <NumCell key="c">{c._count.catalogItems}</NumCell>,
              <NumCell key="t">{tenantsBy.get(c.id) ?? 0}</NumCell>,
              <span key="d" className="text-xs text-[var(--oc-muted3)] tabular-nums">{formatShortDateTime(c.createdAt)}</span>,
            ],
          }))}
        />
      )}

      <Pagination
        page={meta.page}
        totalPages={meta.totalPages}
        total={meta.total}
        params={{ q, status, sort: sp.sort ?? "", dir: sp.dir ?? "" }}
        tone="danger"
      />
    </div>
  );
}
