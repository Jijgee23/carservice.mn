import Link from "next/link";
import { Prisma } from "@/app/generated/prisma/client";
import { FilterSelect, ResetFilters, SearchBox } from "@/app/_components/list-filters";
import { EmptyState, PageHeader } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireSuperAdmin } from "@/lib/auth/system";
import { normalizeCatalogCode, normalizeCatalogName } from "@/lib/catalog/normalize";
import { formatTugrik } from "@/lib/orders";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Нэгдсэн сан" };

export const dynamic = "force-dynamic";

const TYPE_LABEL = { LABOR: "Ажил", GOODS: "Сэлбэг / Бараа" } as const;

type Search = { q?: string; type?: string; status?: string; page?: string };

export default async function SystemCatalogPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const type = sp.type === "LABOR" || sp.type === "GOODS" ? sp.type : "";
  const status = sp.status ?? "";
  const { page, pageSize, skip, take } = getPageInfo(sp.page);

  const where: Prisma.CatalogItemWhereInput = {};
  if (type) where.type = type;
  if (status === "active") where.isActive = true;
  if (status === "inactive") where.isActive = false;
  if (q) {
    const codeKey = normalizeCatalogCode(q);
    where.OR = [
      { nameKey: { contains: normalizeCatalogName(q) } },
      ...(codeKey ? [{ codeKey: { contains: codeKey } }, { barcode: codeKey }] : []),
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.catalogItem.findMany({
      where,
      orderBy: [{ services: { _count: "desc" } }, { name: "asc" }],
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
        category: { select: { name: true } },
        _count: { select: { services: true } },
      },
    }),
    prisma.catalogItem.count({ where }),
  ]);
  const meta = buildMeta(total, page, pageSize);

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
          paramName="status"
          placeholder="Бүх төлөв"
          options={[
            { value: "active", label: "Идэвхтэй" },
            { value: "inactive", label: "Идэвхгүй" },
          ]}
        />
        <ResetFilters paramNames={["q", "type", "status"]} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Мөр алга" description="Энэ шүүлтэд тохирох ажил/сэлбэг санд алга." />
      ) : (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead>
              <tr className="border-b border-[var(--oc-line2)]">
                {["Нэр", "Код / баркод", "Төрөл", "Нэгж", "Санал болгох үнэ", "Ангилал", "Байгууллага", "Төлөв"].map((h) => (
                  <th key={h} className="text-left text-xs text-[var(--oc-muted4)] font-medium px-5 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--oc-line2)] last:border-0 hover:bg-white/[0.02]">
                  <td className="px-5 py-3 text-sm">
                    <Link href={`/system/catalog/${r.id}`} className="text-[var(--oc-ink2)] hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 font-plex-mono text-xs text-[var(--oc-muted2)]">
                    {r.code ?? "—"}
                    {r.barcode ? <div className="text-[11px] text-[var(--oc-muted3)]">▮ {r.barcode}</div> : null}
                  </td>
                  <td className="px-5 py-3 text-sm text-[var(--oc-muted)]">{TYPE_LABEL[r.type as keyof typeof TYPE_LABEL] ?? r.type}</td>
                  <td className="px-5 py-3 text-sm text-[var(--oc-muted)]">{r.unitName || "—"}</td>
                  <td className="px-5 py-3 font-plex-mono text-xs text-[var(--oc-ink2)]">{formatTugrik(r.price.toString())}</td>
                  <td className="px-5 py-3 text-sm text-[var(--oc-muted)]">{r.category?.name ?? "—"}</td>
                  <td className="px-5 py-3 text-sm text-[var(--oc-muted)] tabular-nums">{r._count.services}</td>
                  <td className="px-5 py-3 text-xs">
                    {r.isActive ? (
                      <span className="text-[var(--oc-ok)]">Идэвхтэй</span>
                    ) : (
                      <span className="text-[var(--oc-muted3)]">Идэвхгүй</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={meta.page}
        totalPages={meta.totalPages}
        total={meta.total}
        params={{ q, type, status }}
        tone="danger"
      />
    </div>
  );
}
