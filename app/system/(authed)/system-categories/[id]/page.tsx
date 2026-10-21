import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmForm } from "@/app/_components/confirm-form";
import { requireSuperAdmin } from "@/lib/auth/system";
import { deleteSystemCategoryAction } from "@/app/_actions/system-categories";
import { prisma } from "@/lib/prisma";
import { SystemCategoryForm } from "../system-category-form";

export const metadata = { title: "Сэлбэгийн ангилал засах" };

export default async function EditSystemCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSuperAdmin();
  const { id } = await params;

  const category = await prisma.category.findFirst({
    where: { id, tenantId: null, kind: "GOODS" },
    include: {
      _count: {
        select: { services: true, diagnosticTemplates: true, appointments: true, appointmentLinks: true, orderLinks: true },
      },
    },
  });
  if (!category) notFound();

  const n = category._count;
  const used = n.services + n.diagnosticTemplates + n.appointments + n.appointmentLinks + n.orderLinks;
  const tenants = await prisma.service.groupBy({ by: ["tenantId"], where: { categoryId: id } });

  return (
    <div className="p-4 sm:p-6 flex-1 flex flex-col min-h-0 w-full max-w-xl">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/system/system-categories" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Сэлбэгийн ангилал
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">{category.name}</span>
      </nav>

      <h1 className="text-2xl font-semibold text-[var(--oc-ink)] mb-1">Ангилал засах</h1>
      <p className="text-sm text-[var(--oc-muted3)] mb-6">
        {tenants.length} байгууллагын {n.services} бараа энэ ангилалд бүртгэлтэй.
      </p>

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6 mb-6">
        <SystemCategoryForm
          initial={{
            id: category.id,
            name: category.name,
            description: category.description,
            isActive: category.isActive,
          }}
        />
      </div>

      <div className="rounded-[10px] border border-red-500/25 bg-[var(--oc-panel)] p-5 sm:p-6">
        <h2 className="font-semibold text-red-400 light:text-red-600 mb-2 text-sm">Аюултай бүс</h2>
        <p className="text-xs text-[var(--oc-muted3)] mb-4">
          {used > 0
            ? "Бараа холбогдсон тул идэвхгүй болгоно (устгагдахгүй, шинэ бараанд сонгогдохгүй)."
            : "Ашиглаагүй тул бүрмөсөн устгагдана."}
        </p>
        <ConfirmForm
          action={deleteSystemCategoryAction}
          message={
            used > 0
              ? `"${category.name}" ангиллыг идэвхгүй болгох уу?`
              : `"${category.name}" ангиллыг устгах уу?`
          }
        >
          <input type="hidden" name="id" value={category.id} />
          <button
            type="submit"
            className="text-sm text-red-400 hover:text-red-300 light:text-red-600 light:hover:text-red-700 transition-colors px-3 py-2 rounded-lg hover:bg-red-500/10 border border-red-500/25"
          >
            {used > 0 ? "Идэвхгүй болгох" : "Устгах"}
          </button>
        </ConfirmForm>
      </div>
    </div>
  );
}
