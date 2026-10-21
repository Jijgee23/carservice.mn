import Link from "next/link";
import { redirect } from "next/navigation";
import { BtnLink } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { canCreate } from "@/lib/auth/roles";
import { categoriesForKindWhere } from "@/lib/categories";
import { prisma } from "@/lib/prisma";
import { parseImportKind, SERVICE_KIND_IMPORT_LABEL } from "@/lib/services/import";
import { ServiceImportWizard } from "./service-import-wizard";

export const metadata = {
  title: "Excel-ээс оруулах — Ажил, сэлбэг",
};

export default async function ServiceImportPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const user = await requireUser();
  const { type: slugRaw } = await searchParams;
  const type = parseImportKind(slugRaw) ?? "GOODS";
  const slug = type === "LABOR" ? "labor" : "goods";
  if (!canCreate(user, "services")) redirect(`/dashboard/services/${slug}`);

  const [categories, units] = await Promise.all([
    prisma.category.findMany({
      // Өөрийн + системийн, тухайн төрөлд тохирох (эсвэл бүх төрөлд) ангилал.
      where: { isActive: true, ...categoriesForKindWhere(user.tenantId, type) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.unit.findMany({
      where: { tenantId: user.tenantId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
  ]);
  const noun = SERVICE_KIND_IMPORT_LABEL[type];

  return (
    <div className="p-4 sm:p-6 max-w-full w-full">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href={`/dashboard/services/${slug}`} className="hover:text-[var(--oc-accent-hi)] transition-colors">
          {type === "LABOR" ? "Ажил" : "Сэлбэг"}
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">Excel-ээс оруулах</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Excel-ээс {noun} оруулах</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            Файлаа оруулаад баганаа тааруулж, ангилал/нэгжийг оноогоод олноор нь бүртгэнэ. Системд бүртгэлтэй кодтой мөр
            алгасагдана.
          </p>
        </div>
        <BtnLink href={`/dashboard/services/${slug}`} variant="ghost">
          ← Буцах
        </BtnLink>
      </div>

      {categories.length === 0 || units.length === 0 ? (
        <div className="rounded-[10px] border border-[var(--oc-accent)]/30 bg-[var(--oc-panel)] p-5 text-sm text-[var(--oc-ink2)]">
          Мөр бүрт ангилал болон хэмжих нэгж заавал оноогдоно — {categories.length === 0 ? "идэвхтэй ангилал" : "идэвхтэй нэгж"}{" "}
          алга.{" "}
          <Link href="/dashboard/services/categories" className="text-[var(--oc-accent-hi)] underline underline-offset-2">
            Ангилал, нэгжээ тохируулна уу.
          </Link>
        </div>
      ) : (
        <ServiceImportWizard type={type} slug={slug} categories={categories} units={units} />
      )}
    </div>
  );
}
