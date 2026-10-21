import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CategoriesSection } from "../categories-section";

export const metadata = {
  title: "Ангилал",
};

export default async function CategoriesPage() {
  const user = await requireUser();
  // Ангиллыг зөвхөн админ удирдана (actions нь isOwner шаарддаг).
  if (!user.isOwner) redirect("/dashboard/services");

  const [categories, branches, serviceKeys, systemCategories] = await Promise.all([
    prisma.category.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        durationMinutes: true,
        concurrentCapacity: true,
        systemServiceKeyId: true,
        kind: true,
        _count: { select: { services: true } },
        branches: { select: { id: true } },
      },
    }),
    prisma.branch.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.systemServiceKey.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Системийн (бүх байгууллагад нийтлэг, засах боломжгүй) ангиллууд.
    prisma.category.findMany({
      where: { tenantId: null, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true },
    }),
  ]);

  const rows = categories.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    isActive: c.isActive,
    servicesCount: c._count.services,
    branchIds: c.branches.map((b) => b.id),
    durationMinutes: c.durationMinutes,
    concurrentCapacity: c.concurrentCapacity,
    systemServiceKeyId: c.systemServiceKeyId,
    kind: c.kind,
  }));

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/services" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Үйлчилгээ
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">Ангилал</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Ангилал</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          Ангилал бүр нэг төрөлд (Ажил үйлчилгээ, Сэлбэг, Оношилгоо) эсвэл бүх төрөлд хамаарна. Онлайн цаг захиалгад зөвхөн ажил үйлчилгээний ангилал харагдана. Салбар оноовол тухайн салбарт, хоосон бол бүх салбарт санал болгоно.
        </p>
      </div>

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-5">
        <CategoriesSection
          categories={rows}
          branches={branches}
          serviceKeys={serviceKeys}
          systemCategories={systemCategories}
        />
      </div>
    </div>
  );
}
