import Link from "next/link";
import { Prisma } from "@/app/generated/prisma/client";
import { bulkCatalogItemsAction } from "@/app/_actions/system-catalog";
import { FilterSelect, ResetFilters, SearchBox } from "@/app/_components/list-filters";
import { EmptyState, PageHeader } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireSuperAdmin } from "@/lib/auth/system";
import { normalizeCatalogCode, normalizeCatalogName } from "@/lib/catalog/normalize";
import { formatShortDateTime, parseSort } from "@/lib/list-sort";
import { formatTugrik } from "@/lib/orders";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { AdminListTable, NumCell } from "../_components/admin-list-table";

export const metadata = { title: "Нэгдсэн сан" };

export const dynamic = "force-dynamic";

const TYPE_LABEL = { LABOR: "Ажил", GOODS: "Сэлбэг / Бараа" } as const;

const SORT_KEYS = ["name", "price", "usage", "created"] as const;

type Search = { q?: string; type?: string; status?: string; category?: string; sort?: string; dir?: string; page?: string };

export default async function SystemCatalogPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const type = sp.type === "LABOR" || sp.type === "GOODS" ? sp.type : "";
  const status = sp.status === "active" || sp.status === "inactive" ? sp.status : "";
  const category = sp.category ?? "";
  const sort = parseSort(sp, SORT_KEYS, { key: "created", dir: "desc" });
  const { page, pageSize, skip, take } = getPageInfo(sp.page);

  const where: Prisma.CatalogItemWhereInput = {};
  if (type) where.type = type;
  if (status === "active") where.isActive = true;
  if (status === "inactive") where.isActive = false;
  if (category === "none") where.categoryId = null;
  else if (category) where.categoryId = category;
  if (q) {
    const codeKey = normalizeCatalogCode(q);
    where.OR = [
      { nameKey: { contains: normalizeCatalogName(q) } },
      ...(codeKey ? [{ codeKey: { contains: codeKey } }, { barcode: codeKey }] : []),
    ];
  }

  const orderBy: Prisma.CatalogItemOrderByWithRelationInput[] =
    sort.key === "name"
      ? [{ name: sort.dir }]
      : sort.key === "price"
        ? [{ price: sort.dir }, { name: "asc" }]
        : sort.key === "usage"
          ? [{ services: { _count: sort.dir } }, { name: "asc" }]
          : [{ createdAt: sort.dir }, { id: sort.dir }];

  const [rows, total, categories] = await Promise.all([
    prisma.catalogItem.findMany({
      where,
      orderBy,
      skip,
      take,
      select: {
        id: true,
        type: true,
        name: true,
        code: true,
        barcode: true,
        unitName: true,
        price: true,
        isActive: true,
        createdAt: true,
        category: { select: { name: true } },
        _count: { select: { services: true } },
      },
    }),
    prisma.catalogItem.count({ where }),
    prisma.category.findMany({
      where: { tenantId: null, kind: "GOODS" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const meta = buildMeta(total, page, pageSize);
  const filtered = Boolean(q || type || status || category);

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <PageHeader
        title="Нэгдсэн сан"
        description="Бүх байгууллагын хуваалцдаг ажил, сэлбэгийн сан. Байгууллага гараар бүртгэхэд энд нэмэгдэнэ; нэр/код/нэгж/үнийг засах, давхардлыг нэгтгэх."
        actions={
          <div className="flex gap-2">
            <Link
              href="/system/catalog/import"
              className="rounded-lg border border-[var(--oc-line)] px-3 py-2 text-sm font-medium text-[var(--oc-ink2)] hover:bg-[var(--oc-panel2)]"
            >
              Excel импорт
            </Link>
            <Link
              href={`/system/catalog/new${type ? `?type=${type}` : ""}`}
              className="rounded-lg bg-[var(--oc-accent)] px-3 py-2 text-sm font-medium text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)]"
            >
              + Шинээр бүртгэх
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SearchBox placeholder="Нэр, код, баркодоор хайх..." />
        <FilterSelect
          paramName="type"
          placeholder="Бүх төрөл"
          options={[
            { value: "LABOR", label: TYPE_LABEL.LABOR },
            { value: "GOODS", label: TYPE_LABEL.GOODS },
          ]}
        />
        <FilterSelect
          paramName="category"
          placeholder="Бүх ангилал"
          searchable
          searchPlaceholder="Ангилал хайх..."
          options={[{ value: "none", label: "Ангилалгүй" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
        />
        <FilterSelect
          paramName="status"
          placeholder="Бүх төлөв"
          options={[
            { value: "active", label: "Идэвхтэй" },
            { value: "inactive", label: "Идэвхгүй" },
          ]}
        />
        <ResetFilters paramNames={["q", "type", "category", "status", "sort", "dir"]} />
        <span className="ml-auto text-xs text-[var(--oc-muted3)] tabular-nums">Нийт {total}</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Мөр алга"
          description={filtered ? "Энэ шүүлтэд тохирох ажил/сэлбэг санд алга." : "Санд одоогоор ажил, сэлбэг алга. Excel импорт эсвэл «Шинээр бүртгэх»-ээр нэмнэ үү."}
        />
      ) : (
        <AdminListTable
          noun="мөр"
          sort={sort}
          bulkAction={bulkCatalogItemsAction}
          deleteNote="Аль нэг байгууллага ашиглаж буй мөр устахгүй — идэвхгүй болж, шинэ сонголтоос нуугдана. Давхардлыг мөрийн хуудасны «Нэгтгэх»-ээр нэгтгэнэ үү."
          columns={[
            { label: "Төрөл" },
            { label: "Нэгж" },
            { label: "Санал болгох үнэ", sortKey: "price" },
            { label: "Ангилал" },
            { label: "Байгууллага", sortKey: "usage" },
            { label: "Үүссэн", sortKey: "created", className: "whitespace-nowrap" },
          ]}
          rows={rows.map((r) => ({
            id: r.id,
            name: r.name,
            href: `/system/catalog/${r.id}`,
            isActive: r.isActive,
            sub:
              r.code || r.barcode ? (
                <span className="font-plex-mono">
                  {r.code ?? ""}
                  {r.code && r.barcode ? " · " : ""}
                  {r.barcode ? `▮ ${r.barcode}` : ""}
                </span>
              ) : undefined,
            cells: [
              <span key="t" className="text-[var(--oc-muted)]">{TYPE_LABEL[r.type as keyof typeof TYPE_LABEL] ?? r.type}</span>,
              <span key="u" className="text-[var(--oc-muted)]">{r.unitName || "—"}</span>,
              <span key="p" className="font-plex-mono text-xs text-[var(--oc-ink2)]">{formatTugrik(r.price.toString())}</span>,
              <span key="c" className="text-[var(--oc-muted)]">{r.category?.name ?? "—"}</span>,
              <NumCell key="n">{r._count.services}</NumCell>,
              <span key="d" className="text-xs text-[var(--oc-muted3)] tabular-nums">{formatShortDateTime(r.createdAt)}</span>,
            ],
          }))}
        />
      )}

      <Pagination
        page={meta.page}
        totalPages={meta.totalPages}
        total={meta.total}
        params={{ q, type, category, status, sort: sp.sort ?? "", dir: sp.dir ?? "" }}
        tone="danger"
      />
    </div>
  );
}
