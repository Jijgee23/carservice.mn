import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Btn, BtnLink, Chip } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { getBranchVisibility } from "@/lib/branch-visibility";
import {
  ACTIONS,
  RESOURCES,
  STANDALONE_PERMISSIONS,
} from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { ROLE_FORM_ID, RoleForm } from "../role-form";
import { DeleteRoleButton } from "./danger-actions";

export const metadata = {
  title: "Үүрэг засах",
};

export default async function EditRolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!me.isOwner) redirect("/dashboard/employees");
  // Энгийн багц (ганц салбар): салбарын эрхийн мөрийг нууна.
  const { hideBranches } = await getBranchVisibility(me);

  const { id } = await params;
  const [role, members] = await Promise.all([
    prisma.role.findFirst({
      where: { id, tenantId: me.tenantId },
      include: { _count: { select: { users: true } } },
    }),
    prisma.user.findMany({
      where: { roleId: id, tenantId: me.tenantId },
      orderBy: { createdAt: "asc" },
      take: 6,
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  if (!role) notFound();

  const canDelete = role._count.users === 0;

  return (
    <div className="p-4 sm:p-6">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/employees" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Ажилтнууд
        </Link>
        <span>/</span>
        <Link href="/dashboard/employees/roles" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Үүргүүд
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">{role.name}</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">{role.name}</h1>
            <Chip tone={role.isActive ? "ok" : "neutral"}>
              {role.isActive ? "Идэвхтэй" : "Идэвхгүй"}
            </Chip>
          </div>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            {role._count.users} ажилтан · {role.permissions.length} эрх
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BtnLink href="/dashboard/employees/roles" variant="ghost">
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
            isActive: role.isActive,
          }}
          resources={[...RESOURCES]}
          hideBranches={hideBranches}
          actions={[...ACTIONS]}
          standalonePermissions={STANDALONE_PERMISSIONS.map((p) => ({
            code: p.code,
            label: p.label,
            description: p.description,
          }))}
        />

        <div className="flex flex-col gap-6">
          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-[var(--oc-ink)]">Ажилтнууд</h2>
              <span className="font-plex-mono text-sm text-[var(--oc-ink2)]">
                {role._count.users}
              </span>
            </div>
            {members.length === 0 ? (
              <p className="text-xs text-[var(--oc-muted3)]">
                Энэ үүрэгтэй ажилтан алга.
              </p>
            ) : (
              <ul className="space-y-2">
                {members.map((m) => (
                  <li key={m.id} className="text-[13px] text-[var(--oc-ink2)]">
                    {m.lastName} {m.firstName}
                  </li>
                ))}
                {role._count.users > members.length ? (
                  <li className="text-xs text-[var(--oc-muted3)]">
                    + {role._count.users - members.length} бусад
                  </li>
                ) : null}
              </ul>
            )}
            <Link
              href={`/dashboard/employees?roleId=${role.id}`}
              className="mt-3 inline-block text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
            >
              Ажилтнуудыг харах →
            </Link>
          </div>

          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
            <h2 className="font-semibold text-[var(--oc-ink)] mb-3">Тойм</h2>
            <dl className="space-y-3 text-sm">
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
              Үүргийг устгах
            </h2>
            <p className="text-xs text-[var(--oc-muted3)] mb-3">
              {canDelete
                ? "Энэ үүрэгтэй ажилтан алга тул устгаж болно."
                : `Энэ үүрэгтэй ${role._count.users} ажилтан байна. Эхлээд тэдний үүргийг солино уу.`}
            </p>
            <DeleteRoleButton roleId={role.id} roleName={role.name} canDelete={canDelete} />
          </div>
        </div>
      </div>
    </div>
  );
}
