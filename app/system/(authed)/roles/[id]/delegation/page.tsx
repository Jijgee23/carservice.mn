import Link from "next/link";
import { notFound } from "next/navigation";
import { setRoleEditablePermissionAction } from "@/app/_actions/system-roles";
import { PermissionSwitchList, type PermissionSwitchGroup } from "@/app/_components/permission-switch-list";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireSuperAdmin } from "@/lib/auth/system";
import { getRoleDelegation } from "@/lib/roles/delegation";
import { SENSITIVE_PERMISSION_CODES } from "@/lib/roles/tenant-editable-defaults";

export const metadata = { title: "Байгууллагад өөрчлөх эрх" };

export const dynamic = "force-dynamic";

export default async function RoleDelegationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const view = await getRoleDelegation(id);
  if (!view) notFound();

  const open = new Set(view.editablePermissions);
  const inRole = new Set(view.rolePermissions);
  const sensitive = new Set(SENSITIVE_PERMISSION_CODES);

  const groups: PermissionSwitchGroup[] = Array.from(
    PERMISSIONS.reduce((m, p) => {
      const arr = m.get(p.group) ?? [];
      arr.push({
        code: p.code,
        label: p.label,
        on: open.has(p.code),
        hint: `${inRole.has(p.code) ? "Ролид байгаа — байгууллага хасч болно" : "Ролид байхгүй — байгууллага нэмж болно"}${
          sensitive.has(p.code) ? " · эмзэг эрх" : ""
        }`,
      });
      m.set(p.group, arr);
      return m;
    }, new Map<string, PermissionSwitchGroup["items"]>()),
  ).map(([group, items]) => ({ group, items }));

  const toggle = setRoleEditablePermissionAction.bind(null, id);

  return (
    <div className="p-4 sm:p-6 max-w-3xl w-full">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/system/roles" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Роль
        </Link>
        <span>/</span>
        <Link href={`/system/roles/${id}`} className="hover:text-[var(--oc-accent-hi)] transition-colors">
          {view.name}
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">Байгууллагад өөрчлөх эрх</span>
      </nav>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">{view.name} — байгууллагад өөрчлөх эрх</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          Асаалттай эрхийг байгууллагын эзэн энэ ролиос нэмж/хасч чадна. Унтраасан эрх түгжигдсэн. Эргүүлэхэд шууд
          хадгалагдана. Мөнгө, ажилтан удирдах, аудит зэрэг эмзэг эрх анхнаасаа унтраастай.
        </p>
      </div>
      <PermissionSwitchList groups={groups} onToggle={toggle} />
    </div>
  );
}
