import { PageHeader } from "@/app/_components/page-header";
import { requireSuperAdmin } from "@/lib/auth/system";
import { prisma } from "@/lib/prisma";
import { AdminCreateForm } from "./admin-create-form";
import { AdminRow } from "./admin-row";

export const metadata = { title: "Super admin эрхүүд" };

export const dynamic = "force-dynamic";

export default async function SystemAdminsPage() {
  const actor = await requireSuperAdmin();

  const admins = await prisma.superAdmin.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      kind: true,
      createdAt: true,
      createdBy: { select: { firstName: true, lastName: true } },
    },
  });
  // Сүүлийн идэвхтэй ROOT-ыг идэвхгүй болгохгүй (STAFF-ийг тоолохгүй — вэбийг удирдах ROOT л чухал).
  const activeRootCount = admins.filter((a) => a.isActive && a.kind === "ROOT").length;

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <PageHeader
        title="Super admin эрхүүд"
        description="Платформын удирдлагад (/system) хандах эрхтэй admin-уудыг урих, идэвхгүй болгох."
      />

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-[var(--oc-line2)]">
                <th className="text-left text-xs text-[var(--oc-muted3)] font-medium px-5 py-3">
                  Нэр
                </th>
                <th className="text-left text-xs text-[var(--oc-muted3)] font-medium px-5 py-3">
                  Имэйл
                </th>
                <th className="text-left text-xs text-[var(--oc-muted3)] font-medium px-5 py-3">
                  Урьсан
                </th>
                <th className="text-left text-xs text-[var(--oc-muted3)] font-medium px-5 py-3">
                  Бүртгүүлсэн
                </th>
                <th className="text-left text-xs text-[var(--oc-muted3)] font-medium px-5 py-3">
                  Төлөв
                </th>
                <th className="px-5 py-3 w-40" />
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <AdminRow
                  key={a.id}
                  admin={a}
                  isSelf={a.id === actor.id}
                  canDeactivate={a.kind === "STAFF" || activeRootCount > 1}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-5 max-w-xl">
        <h2 className="font-semibold text-[var(--oc-ink)] mb-1">Шинэ admin урих</h2>
        <p className="text-xs text-[var(--oc-muted3)] mb-4">
          «Бүрэн admin» танайтай яг адил super admin эрхтэй болно — зөвхөн итгэмжлэгдсэн хүнд олгоно уу.
          «System ажилтан» вэб /system-д нэвтэрдэггүй; мобайл апп-аар зөвхөн харилцагч бүртгэх, мэдээллийг нь засах,
          түр хаах/нээх эрхтэй (багц, төлбөр, зээл, устгах байхгүй).
        </p>
        <AdminCreateForm />
      </div>
    </div>
  );
}
