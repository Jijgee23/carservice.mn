import { ClickableRow } from "@/app/_components/clickable-row";
import { AddLinkButton, Chip, TagChip } from "@/app/_components/landing-ops-ui";
import { PageHeader } from "@/app/_components/page-header";
import { requireSuperAdmin } from "@/lib/auth/system";
import { permissionLabel } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Роль" };

export const dynamic = "force-dynamic";

export default async function SystemRolesPage() {
  await requireSuperAdmin();

  const roles = await prisma.role.findMany({
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { users: true } } },
  });

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <PageHeader
        title="Роль"
        description="Бүх байгууллагад нэгдсэн ажилтны роль. Байгууллагын админ эдгээрээс сонгож ажилтандаа онооно; эрхийн өөрчлөлт бүх байгууллагад шууд хүчинтэй. Tenant-admin роль биш — үргэлж бүх эрхтэй."
        actions={<AddLinkButton href="/system/roles/new">Роль нэмэх</AddLinkButton>}
      />

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-[var(--oc-line)]">
                {["Нэр", "Эрхүүд", "Байгууллага өөрчилж болох", "Ажилтан", "Төрөл", "Төлөв"].map((h) => (
                  <th
                    key={h}
                    className="text-left font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-5 py-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--oc-line)]">
              {roles.map((r) => (
                <ClickableRow key={r.id} href={`/system/roles/${r.id}`}>
                  <td className="px-5 py-4">
                    <div className="text-sm font-medium text-[var(--oc-ink)]">{r.name}</div>
                    {r.description ? (
                      <div className="text-xs text-[var(--oc-muted3)] mt-0.5 max-w-md truncate">
                        {r.description}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap gap-1 max-w-md">
                      {r.permissions.slice(0, 5).map((p) => (
                        <TagChip key={p}>{permissionLabel(p)}</TagChip>
                      ))}
                      {r.permissions.length > 5 ? (
                        <span className="font-plex-mono text-[10px] text-[var(--oc-muted3)]">
                          +{r.permissions.length - 5}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-5 py-4 font-plex-mono text-sm text-[var(--oc-ink2)]">
                    {r.tenantEditablePermissions.length}
                  </td>
                  <td className="px-5 py-4 font-plex-mono text-sm text-[var(--oc-ink2)]">
                    {r._count.users}
                  </td>
                  <td className="px-5 py-4">
                    <Chip tone={r.key ? "accent" : "neutral"}>{r.key ? "Үндсэн" : "Нэмэлт"}</Chip>
                  </td>
                  <td className="px-5 py-4">
                    <Chip tone={r.isActive ? "ok" : "neutral"}>
                      {r.isActive ? "Идэвхтэй" : "Идэвхгүй"}
                    </Chip>
                  </td>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
