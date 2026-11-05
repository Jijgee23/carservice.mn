import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/system";
import { CatalogImportWizard } from "./catalog-import-wizard";

export const metadata = { title: "Нэгдсэн сан — Excel импорт" };

export const dynamic = "force-dynamic";

export default async function CatalogImportPage() {
  await requireSuperAdmin();
  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto w-full">
      <Link href="/system/catalog" className="text-sm text-[var(--oc-muted3)] hover:text-[var(--oc-muted)]">
        ← Нэгдсэн сан руу буцах
      </Link>
      <div className="rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6 mt-4">
        <h1 className="text-lg font-semibold text-[var(--oc-ink)]">Excel-ээс импорт</h1>
        <p className="mt-1 text-sm text-[var(--oc-muted3)]">
          Төрлөө сонгоод загвар файлыг бөглөж оруулна. Эхлээд урьдчилан шалгаж, алдаатай болон санд байгаа мөрүүдийг харуулна;
          баталгаажуулсны дараа зөвхөн шинэ мөрүүд санд нэмэгдэнэ. Нэг удаад 500 мөр, 2MB хүртэл.
        </p>
        <CatalogImportWizard />
      </div>
    </div>
  );
}
