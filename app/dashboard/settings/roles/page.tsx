import { requireUser } from "@/lib/auth";
import { permissionLabel } from "@/lib/auth/permissions";
import { listTenantRoleOverrides } from "@/lib/roles/tenant-overrides";
import { RoleOverrideCard } from "./role-override-card";

export const metadata = {
  title: "Ролийн эрх",
};

// Owner-only: app/dashboard/settings/layout.tsx.
export default async function RoleOverridesPage() {
  const user = await requireUser();
  const roles = await listTenantRoleOverrides(user.tenantId);

  return (
    <div className="p-4 sm:p-6 max-w-4xl w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Ролийн эрх</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          Системээс зөвшөөрсөн эрхүүдийг ролиос нэмж эсвэл хасна. Түгжигдсэн эрхийг өөрчлөх боломжгүй.
          Тодорхой ажилтны эрхийг хязгаарлахыг ажилтны хуудаснаас хийнэ.
        </p>
      </div>

      {roles.length === 0 ? (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6 text-sm text-[var(--oc-muted2)]">
          Одоогоор өөрчилж болох эрх байхгүй байна. Системийн админ танай байгууллагад ролийн эрх
          өөрчлөх боломжийг нээгээгүй байна.
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {roles.map((r) => (
            <RoleOverrideCard
              key={r.roleId}
              roleId={r.roleId}
              name={r.name}
              description={r.description}
              lockedCount={r.rolePermissions.filter((c) => !r.editablePermissions.includes(c)).length}
              items={r.editablePermissions.map((code) => ({
                code,
                label: permissionLabel(code),
                inRole: r.rolePermissions.includes(code),
                on: r.effectivePermissions.includes(code),
              }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
