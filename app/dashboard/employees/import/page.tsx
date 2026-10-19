import Link from "next/link";
import { redirect } from "next/navigation";
import { BtnLink } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { canCreate } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { EmployeeImportWizard } from "./import-wizard";

export const metadata = {
  title: "Excel-ээс ажилтан оруулах",
};

export default async function EmployeeImportPage() {
  const me = await requireUser();
  if (!canCreate(me, "employees")) redirect("/dashboard/employees");

  const [branches, roles] = await Promise.all([
    prisma.branch.findMany({
      where: { tenantId: me.tenantId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    prisma.role.findMany({
      where: { tenantId: me.tenantId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="p-4 sm:p-6 max-w-full w-full">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/employees" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Ажилтнууд
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">Excel-ээс оруулах</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Excel-ээс ажилтан оруулах</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            Файлаа оруулаад баганаа тааруулж, үүргийг оноогоод олноор нь бүртгэнэ. Ажилтан анх нэвтрэхдээ
            утсанд ирсэн кодоор нууц үгээ тохируулна.
          </p>
        </div>
        <BtnLink href="/dashboard/employees" variant="ghost">
          ← Буцах
        </BtnLink>
      </div>

      {roles.length === 0 ? (
        <div className="rounded-[10px] border border-[var(--oc-accent)]/30 bg-[var(--oc-panel)] p-5 text-sm text-[var(--oc-ink2)]">
          Ажилтан бүрт үүрэг заавал оноогдоно, гэтэл идэвхтэй үүрэг алга.{" "}
          {me.isOwner ? (
            <Link href="/dashboard/employees/roles" className="text-[var(--oc-accent-hi)] underline underline-offset-2">
              Эхлээд үүрэг үүсгэнэ үү.
            </Link>
          ) : (
            "Админаар үүрэг үүсгүүлнэ үү."
          )}
        </div>
      ) : (
        <EmployeeImportWizard roles={roles} branches={branches} />
      )}
    </div>
  );
}
