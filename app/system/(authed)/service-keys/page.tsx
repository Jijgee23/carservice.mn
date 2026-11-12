import { Prisma } from "@/app/generated/prisma/client";
import { bulkServiceKeysAction } from "@/app/_actions/system-service-keys";
import { FilterSelect, ResetFilters, SearchBox } from "@/app/_components/list-filters";
import { EmptyState, PageHeader } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireSuperAdmin } from "@/lib/auth/system";
import { formatShortDateTime, parseSort } from "@/lib/list-sort";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { AdminListTable, NumCell } from "../_components/admin-list-table";
import { CreateServiceKeyButton } from "./create-service-key-modal";

export const metadata = { title: "Системийн ангилал" };

export const dynamic = "force-dynamic";

const SORT_KEYS = ["name", "usage", "created"] as const;

type Search = { q?: string; status?: string; sort?: string; dir?: string; page?: string };

export default async function SystemServiceKeysPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = sp.status === "active" || sp.status === "inactive" ? sp.status : "";
  const sort = parseSort(sp, SORT_KEYS, { key: "created", dir: "desc" });
  const { page, pageSize, skip, take } = getPageInfo(sp.page);

  const where: Prisma.SystemServiceKeyWhereInput = {
    ...(q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] }
      : {}),
    ...(status ? { isActive: status === "active" } : {}),
  };
  const orderBy: Prisma.SystemServiceKeyOrderByWithRelationInput[] =
    sort.key === "name"
      ? [{ name: sort.dir }]
      : sort.key === "usage"
        ? [{ categories: { _count: sort.dir } }, { name: "asc" }]
        : [{ createdAt: sort.dir }, { id: sort.dir }];

  const [keys, total] = await Promise.all([
    prisma.systemServiceKey.findMany({
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
        createdBy: { select: { firstName: true, lastName: true } },
        _count: { select: { categories: true } },
      },
    }),
    prisma.systemServiceKey.count({ where }),
  ]);
  const meta = buildMeta(total, page, pageSize);

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <PageHeader
        title="Системийн ангилал"
        description="Байгууллага сонгохоос өмнө үйлчлүүлэгч ямар ажил хийлгэхээ сонгодог, платформ даяарх нэгдсэн ажлын жагсаалт. Тенант өөрийн ангиллаа эндхийн түлхүүрт холбож болно."
        actions={<CreateServiceKeyButton />}
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

      {keys.length === 0 ? (
        <EmptyState
          title="Ангилал алга"
          description={q || status ? "Энэ шүүлтэд тохирох ангилал алга." : "Одоогоор ажлын түлхүүр алга байна."}
        />
      ) : (
        <AdminListTable
          noun="ангилал"
          sort={sort}
          bulkAction={bulkServiceKeysAction}
          deleteNote="Байгууллагын ангилал холбогдсон түлхүүр устахгүй — идэвхгүй болж, шинэ холбоосоос нуугдана."
          columns={[
            { label: "Ашигласан ангилал", sortKey: "usage" },
            { label: "Үүсгэсэн" },
            { label: "Үүссэн", sortKey: "created", className: "whitespace-nowrap" },
          ]}
          rows={keys.map((k) => ({
            id: k.id,
            name: k.name,
            href: `/system/service-keys/${k.id}`,
            isActive: k.isActive,
            sub: k.description ?? undefined,
            cells: [
              <NumCell key="u">{k._count.categories}</NumCell>,
              <span key="b" className="text-[var(--oc-muted)]">{k.createdBy ? `${k.createdBy.lastName.charAt(0)}. ${k.createdBy.firstName}` : "—"}</span>,
              <span key="d" className="text-xs text-[var(--oc-muted3)] tabular-nums">{formatShortDateTime(k.createdAt)}</span>,
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
