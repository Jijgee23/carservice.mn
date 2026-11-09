import Link from "next/link";
import { redirect } from "next/navigation";
import { Btn, BtnLink } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { getBranchVisibility } from "@/lib/branch-visibility";
import {
  ACTIONS,
  RESOURCES,
  STANDALONE_PERMISSIONS,
} from "@/lib/auth/permissions";
import { ROLE_FORM_ID, RoleForm } from "../role-form";

export const metadata = {
  title: "Шинэ үүрэг",
};

export default async function NewRolePage() {
  const me = await requireUser();
  if (!me.isOwner) redirect("/dashboard/employees");
  // Энгийн багц (ганц салбар): салбарын эрхийн мөрийг нууна.
  const { hideBranches } = await getBranchVisibility(me);

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/employees" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Ажилтнууд
        </Link>
        <span>/</span>
        <Link href="/dashboard/employees/roles" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Үүргүүд
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">Шинэ үүрэг</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Шинэ үүрэг</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            Үүрэгт нэр өгч, нөөц бүрд харах/үүсгэх/засах/устгах эрхийг сонгоно уу.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BtnLink href="/dashboard/employees/roles" variant="ghost">
            ← Буцах
          </BtnLink>
          <Btn type="submit" form={ROLE_FORM_ID}>
            Үүсгэх
          </Btn>
        </div>
      </div>

      <RoleForm
        resources={[...RESOURCES]}
        hideBranches={hideBranches}
        actions={[...ACTIONS]}
        standalonePermissions={STANDALONE_PERMISSIONS.map((p) => ({
          code: p.code,
          label: p.label,
          description: p.description,
        }))}
      />
    </div>
  );
}
