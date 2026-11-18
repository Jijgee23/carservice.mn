import Link from "next/link";
import { Btn, BtnLink } from "@/app/_components/landing-ops-ui";
import { requireSuperAdmin } from "@/lib/auth/system";
import {
  ACTIONS,
  PERMISSIONS,
  RESOURCES,
  STANDALONE_PERMISSIONS,
} from "@/lib/auth/permissions";
import { ROLE_FORM_ID, RoleForm } from "../role-form";

export const metadata = {
  title: "Шинэ роль",
};

export default async function NewRolePage() {
  await requireSuperAdmin();

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/system/roles" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Роль
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">Шинэ роль</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Шинэ роль</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            Бүх байгууллагад харагдах нэмэлт роль. Нэр өгч, нөөц бүрд эрхийг сонгоно уу.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BtnLink href="/system/roles" variant="ghost">
            ← Буцах
          </BtnLink>
          <Btn type="submit" form={ROLE_FORM_ID}>
            Үүсгэх
          </Btn>
        </div>
      </div>

      <RoleForm
        resources={[...RESOURCES]}
        actions={[...ACTIONS]}
        standalonePermissions={STANDALONE_PERMISSIONS.map((p) => ({
          code: p.code,
          label: p.label,
          description: p.description,
        }))}
        permissionCatalog={PERMISSIONS.map((p) => ({ code: p.code, label: p.label, group: p.group }))}
      />
    </div>
  );
}
