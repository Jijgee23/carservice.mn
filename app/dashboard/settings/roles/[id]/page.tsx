import Link from "next/link";
import { notFound } from "next/navigation";
import { toggleTenantRolePermissionAction } from "@/app/_actions/tenant-role-overrides";
import { PermissionSwitchList, type PermissionSwitchGroup } from "@/app/_components/permission-switch-list";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getTenantRoleOverrideView } from "@/lib/roles/tenant-overrides";

export const metadata = {
  title: "Ролийн эрх",
};

// Owner-only: app/dashboard/settings/layout.tsx.
export default async function RoleOverrideDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const view = await getTenantRoleOverrideView(user.tenantId, id);
  if (!view) notFound();

  const editable = new Set(view.editablePermissions);
  const held = new Set(view.effectivePermissions);
  const role = new Set(view.rolePermissions);

  // Бүх эрх бүлгээр: өөрчилж болохыг switch, түгжигдсэнийг идэвхгүй (🔒) харуулна.
  const groups: PermissionSwitchGroup[] = Array.from(
    PERMISSIONS.reduce((m, p) => {
      const arr = m.get(p.group) ?? [];
      const isEditable = editable.has(p.code);
      arr.push({
        code: p.code,
        label: p.label,
        on: held.has(p.code),
        locked: !isEditable,
        lockedHint: "Системээс түгжсэн",
        hint: isEditable ? (role.has(p.code) ? "Ролийн анхдагч эрх" : "Ролид анхдагчаар байхгүй") : undefined,
      });
      m.set(p.group, arr);
      return m;
    }, new Map<string, PermissionSwitchGroup["items"]>()),
  ).map(([group, items]) => ({ group, items }));

  const toggle = toggleTenantRolePermissionAction.bind(null, id);

  return (
    <div className="p-4 sm:p-6 max-w-3xl w-full">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/settings/roles" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Ролийн эрх
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">{view.name}</span>
      </nav>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">{view.name}</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          Асаалттай = энэ ролийн ажилтнууд тэр эрхтэй. Өөрчлөлт шууд хадгалагдаж, бүх ажилтанд хүчинтэй болно.
        </p>
      </div>
      <PermissionSwitchList groups={groups} onToggle={toggle} />
    </div>
  );
}
