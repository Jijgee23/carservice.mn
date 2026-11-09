import Link from "next/link";
import { redirect } from "next/navigation";
import { Btn, BtnLink } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { getBranchVisibility } from "@/lib/branch-visibility";
import { canCreate } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { EmployeeForm, EMPLOYEE_FORM_ID } from "../employee-form";

export const metadata = {
  title: "Шинэ ажилтан",
};

export default async function NewEmployeePage() {
  const me = await requireUser();
  if (!canCreate(me, "employees")) redirect("/dashboard/employees");
  // Энгийн багц (ганц салбар): салбар сонгохгүй, ганц салбарыг онооно.
  const { hideBranches, singleBranchId } = await getBranchVisibility(me);

  const [branches, roles] = await Promise.all([
    prisma.branch.findMany({
      where: { tenantId: me.tenantId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, district: true, slotCapacity: true },
    }),
    prisma.role.findMany({
      where: { tenantId: me.tenantId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/employees" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Ажилтнууд
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">Шинэ ажилтан</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Шинэ ажилтан</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            Ажилтны үндсэн мэдээллийг оруулна уу. Тэр энэ имэйл, нууц үгээр нэвтрэх болно.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BtnLink href="/dashboard/employees" variant="ghost">
            ← Буцах
          </BtnLink>
          {roles.length > 0 || me.isOwner ? (
            <Btn type="submit" form={EMPLOYEE_FORM_ID}>
              Үүсгэх
            </Btn>
          ) : null}
        </div>
      </div>

      {roles.length === 0 && !me.isOwner ? (
        <div className="rounded-[10px] border border-[var(--oc-accent)]/30 bg-[var(--oc-panel)] p-5 text-sm text-[var(--oc-ink2)]">
          Эхлээд{" "}
          <a
            href="/dashboard/employees/roles/new"
            className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] underline"
          >
            хэрэглэгчийн үүрэг үүсгэнэ үү
          </a>
          . Ажилтны үүргийг үүсгэсэн үүргүүдээс сонгох болно.
        </div>
      ) : (
        <EmployeeForm
          branches={branches}
          roles={roles}
          canGrantOwner={me.isOwner}
          hideBranches={hideBranches}
          singleBranchId={singleBranchId}
        />
      )}
    </div>
  );
}
