import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listTenantRoleOverrides } from "@/lib/roles/tenant-overrides";

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
          Ролийг сонгоод эрх бүрийг switch-ээр асаах/унтраана — өөрчлөлт шууд хадгалагдана. Системийн админ
          түгжсэн эрхийг өөрчлөх боломжгүй. Тодорхой ажилтны эрхийг ажилтны хуудаснаас хязгаарлана.
        </p>
      </div>

      {roles.length === 0 ? (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6 text-sm text-[var(--oc-muted2)]">
          Системийн админ одоогоор ролийн эрхийг өөрчлөх боломжийг бүх ролиос түгжсэн байна.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {roles.map((r) => {
            const changed = r.add.length + r.remove.length;
            return (
              <li key={r.roleId}>
                <Link
                  href={`/dashboard/settings/roles/${r.roleId}`}
                  className="block h-full rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 transition-colors hover:border-[var(--oc-line2)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-semibold text-[var(--oc-ink)]">{r.name}</h2>
                    <span className="font-plex-mono text-[11px] text-[var(--oc-muted3)] shrink-0">
                      {changed > 0 ? `${changed} өөрчилсөн` : "Анхдагч"}
                    </span>
                  </div>
                  {r.description ? <p className="text-xs text-[var(--oc-muted3)] mt-1 line-clamp-2">{r.description}</p> : null}
                  <p className="mt-3 text-xs text-[var(--oc-muted2)]">
                    {r.effectivePermissions.length} эрхтэй · {r.editablePermissions.length} эрх өөрчилж болно
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
