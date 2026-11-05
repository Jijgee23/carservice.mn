import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/system";
import { loadSystemCategories } from "@/lib/catalog/catalog-admin";
import { parseCatalogType } from "@/lib/catalog/catalog-input";
import { CatalogCreateForm } from "./catalog-create-form";

export const metadata = { title: "Нэгдсэн сан — шинээр бүртгэх" };

export const dynamic = "force-dynamic";

export default async function NewCatalogItemPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requireSuperAdmin();
  const initialType = parseCatalogType((await searchParams).type) ?? "GOODS";
  const goodsCategories = await loadSystemCategories("GOODS");

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto w-full">
      <Link href="/system/catalog" className="text-sm text-[var(--oc-muted3)] hover:text-[var(--oc-muted)]">
        ← Нэгдсэн сан руу буцах
      </Link>
      <div className="rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6 mt-4">
        <h1 className="text-lg font-semibold text-[var(--oc-ink)]">Шинээр бүртгэх</h1>
        <p className="mt-1 text-sm text-[var(--oc-muted3)]">
          Санд нэмсэн ажил/сэлбэг бүх байгууллагын бүртгэх хайлтад шууд гарна. Ижил кодтой (кодгүй бол ижил нэртэй) мөр
          байвал давхардуулахгүй.
        </p>
        <CatalogCreateForm initialType={initialType} goodsCategories={goodsCategories} />
      </div>
    </div>
  );
}
