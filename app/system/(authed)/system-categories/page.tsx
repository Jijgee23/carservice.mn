import { Chip } from "@/app/_components/landing-ops-ui";
import { ClickableRow } from "@/app/_components/clickable-row";
import { PageHeader } from "@/app/_components/page-header";
import { requireSuperAdmin } from "@/lib/auth/system";
import { prisma } from "@/lib/prisma";
import { CreateSystemCategoryButton } from "./create-system-category-modal";

export const metadata = { title: "Сэлбэгийн ангилал" };

export const dynamic = "force-dynamic";

export default async function SystemCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSuperAdmin();
  const q = ((await searchParams).q ?? "").trim();

  const categories = await prisma.category.findMany({
    where: {
      tenantId: null,
      kind: "GOODS",
      ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { _count: { select: { services: true } } },
  });

  // Хэдэн байгууллага ашиглаж байгаа (бараа бүртгэсэн тенантын тоо).
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

      <form className="mb-4 flex gap-2 max-w-md">
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Ангиллын нэрээр хайх…"
          className="auth-input flex-1"
        />
      </form>

      {categories.length === 0 ? (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-10 text-center text-sm text-[var(--oc-muted3)]">
          {q ? "Хайлтад тохирох ангилал алга." : "Одоогоор системийн ангилал алга байна."}
        </div>
      ) : (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-[var(--oc-line)]">
                  {["Нэр", "Бараа", "Байгууллага", "Төлөв"].map((h) => (
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
                {categories.map((c) => (
                  <ClickableRow key={c.id} href={`/system/system-categories/${c.id}`}>
                    <td className="px-5 py-3">
                      <div className="text-sm font-medium text-[var(--oc-ink)]">{c.name}</div>
                      {c.description ? (
                        <div className="text-xs text-[var(--oc-muted3)] mt-0.5 line-clamp-1">
                          {c.description}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 font-plex-mono text-sm text-[var(--oc-muted2)]">
                      {c._count.services}
                    </td>
                    <td className="px-5 py-3 font-plex-mono text-sm text-[var(--oc-muted2)]">
                      {tenantsBy.get(c.id) ?? 0}
                    </td>
                    <td className="px-5 py-3">
                      <Chip tone={c.isActive ? "ok" : "neutral"}>
                        {c.isActive ? "Идэвхтэй" : "Идэвхгүй"}
                      </Chip>
                    </td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
