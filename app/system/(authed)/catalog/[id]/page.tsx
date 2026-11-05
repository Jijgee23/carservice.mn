import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/system";
import { normalizeCatalogName } from "@/lib/catalog/normalize";
import { prisma } from "@/lib/prisma";
import { CatalogItemForm, CatalogMergeForm } from "./catalog-forms";

export const metadata = { title: "Нэгдсэн сан" };

export const dynamic = "force-dynamic";

export default async function SystemCatalogItemPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;

  const item = await prisma.catalogItem.findUnique({
    where: { id },
    include: {
      services: {
        orderBy: { createdAt: "asc" },
        take: 50,
        select: { id: true, price: true, tenant: { select: { id: true, name: true } } },
      },
      _count: { select: { services: true } },
    },
  });
  if (!item) notFound();

  // Нэгтгэх боломжтой мөрүүд: ижил төрөл, нэрийн эхний үг таарсан (давхардлын нэр дэвшигч).
  const firstWord = normalizeCatalogName(item.name).split(" ")[0] ?? "";
  const [candidates, systemCategories] = await Promise.all([
    prisma.catalogItem.findMany({
      where: { type: item.type, id: { not: item.id }, nameKey: { contains: firstWord.slice(0, 6) } },
      orderBy: { name: "asc" },
      take: 50,
      select: { id: true, name: true, code: true, _count: { select: { services: true } } },
    }),
    prisma.category.findMany({
      where: { tenantId: null, isActive: true, OR: [{ kind: item.type }, { kind: null }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto w-full">
      <Link href="/system/catalog" className="text-sm text-[var(--oc-muted3)] hover:text-[var(--oc-muted)]">
        ← Нэгдсэн сан руу буцах
      </Link>

      <div className="rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6 mt-4">
        <h1 className="text-lg font-semibold text-[var(--oc-ink)]">{item.name}</h1>
        <p className="mt-0.5 text-xs text-[var(--oc-muted3)]">
          {item.type === "LABOR" ? "Ажил" : "Сэлбэг / Бараа"} · {item._count.services} байгууллага ашиглаж байна. Нэр/код
          өөрчлөхөд бүгдэд нь шинэчлэгдэнэ; үнэ нь зөвхөн шинээр бүртгэх үеийн санал болгох үнэ.
        </p>

        <CatalogItemForm
          initial={{
            id: item.id,
            name: item.name,
            code: item.code ?? "",
            barcode: item.barcode ?? "",
            isGoods: item.type === "GOODS",
            unitName: item.unitName,
            price: item.price.toString(),
            categoryId: item.categoryId ?? "",
            description: item.description ?? "",
            isActive: item.isActive,
          }}
          categories={systemCategories}
        />

        <CatalogMergeForm
          sourceId={item.id}
          candidates={candidates.map((c) => ({
            id: c.id,
            label: `${c.name}${c.code ? ` · ${c.code}` : ""} (${c._count.services})`,
          }))}
        />

        {item.services.length > 0 ? (
          <div className="mt-6 border-t border-[var(--oc-line2)] pt-5">
            <div className="text-xs text-[var(--oc-muted3)] mb-2">Ашиглаж буй байгууллага</div>
            <ul className="flex flex-col gap-1 text-sm">
              {item.services.map((s) => (
                <li key={s.id} className="flex justify-between gap-3">
                  <Link href={`/system/tenants/${s.tenant.id}`} className="text-[var(--oc-ink2)] hover:underline">
                    {s.tenant.name}
                  </Link>
                  <span className="font-plex-mono text-xs text-[var(--oc-muted2)]">{s.price.toString()}₮</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
