import Link from "next/link";
import { notFound } from "next/navigation";
import { Btn, BtnLink, Chip } from "@/app/_components/landing-ops-ui";
import { requireSuperAdmin } from "@/lib/auth/system";
import {
  ACTIONS,
  PERMISSIONS,
  RESOURCES,
  STANDALONE_PERMISSIONS,
} from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { DEFAULT_TENANT_EDITABLE_PERMISSIONS } from "@/lib/roles/tenant-editable-defaults";
import { ROLE_FORM_ID, RoleForm } from "../role-form";
import { DeleteRoleButton } from "./danger-actions";

export const metadata = {
  title: "Роль засах",
};

export default async function EditRolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSuperAdmin();

  const { id } = await params;
  const [role, tenantCounts] = await Promise.all([
    prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    }),
    prisma.user.groupBy({
      by: ["tenantId"],
      where: { roleId: id },
      _count: { _all: true },
    }),
  ]);
  if (!role) notFound();

  const canDelete = !role.key && role._count.users === 0;

  return (
    <div className="p-4 sm:p-6">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/system/roles" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Роль
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">{role.name}</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">{role.name}</h1>
            <Chip tone={role.key ? "accent" : "neutral"}>
              {role.key ? "Үндсэн" : "Нэмэлт"}
            </Chip>
            <Chip tone={role.isActive ? "ok" : "neutral"}>
              {role.isActive ? "Идэвхтэй" : "Идэвхгүй"}
            </Chip>
          </div>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            {tenantCounts.length} байгууллага · {role._count.users} ажилтан · {role.permissions.length} эрх
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BtnLink href="/system/roles" variant="ghost">
            ← Буцах
          </BtnLink>
          <Btn type="submit" form={ROLE_FORM_ID}>
            Хадгалах
          </Btn>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px] items-start">
        <RoleForm
          initial={{
            id: role.id,
            name: role.name,
            description: role.description,
            permissions: role.permissions,
            tenantEditablePermissions: role.tenantEditablePermissions,
            isActive: role.isActive,
          }}
          resources={[...RESOURCES]}
          actions={[...ACTIONS]}
          standalonePermissions={STANDALONE_PERMISSIONS.map((p) => ({
            code: p.code,
            label: p.label,
            description: p.description,
          }))}
          permissionCatalog={PERMISSIONS.map((p) => ({ code: p.code, label: p.label, group: p.group }))}
          defaultTenantEditable={[...DEFAULT_TENANT_EDITABLE_PERMISSIONS]}
        />

        <div className="flex flex-col gap-6">
          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
            <h2 className="font-semibold text-[var(--oc-ink)] mb-3">Тойм</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--oc-muted3)]">Ашиглаж буй байгууллага</span>
                <span className="font-plex-mono font-semibold text-[var(--oc-ink)]">
                  {tenantCounts.length}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--oc-muted3)]">Ажилтан</span>
                <span className="font-plex-mono font-semibold text-[var(--oc-ink)]">
                  {role._count.users}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--oc-muted3)]">Сонгосон эрх</span>
                <span className="font-plex-mono font-semibold text-[var(--oc-ink)]">
                  {role.permissions.length}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--oc-muted3)]">Үүсгэсэн</span>
                <span className="font-plex-mono text-[var(--oc-ink2)]">
                  {role.createdAt.toLocaleDateString("mn-MN")}
                </span>
              </div>
            </dl>
          </div>

          <div className="rounded-[10px] border border-red-500/25 bg-[var(--oc-panel)] p-5">
            <h2 className="font-semibold text-red-400 light:text-red-600 mb-3">
              Ролийг устгах
            </h2>
            <p className="text-xs text-[var(--oc-muted3)] mb-3">
              {role.key
                ? "Үндсэн системийн ролийг устгах боломжгүй. Шаардлагагүй бол идэвхгүй болгоно уу."
                : canDelete
                  ? "Энэ рольтой ажилтан алга тул устгаж болно."
                  : `Энэ рольтой ${role._count.users} ажилтан байна. Устгахын оронд идэвхгүй болгоно уу.`}
            </p>
            <DeleteRoleButton roleId={role.id} roleName={role.name} canDelete={canDelete} />
          </div>
        </div>
      </div>
    </div>
  );
}
