import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Btn, BtnLink, Chip } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { getBranchVisibility } from "@/lib/branch-visibility";
import { canEdit } from "@/lib/auth/roles";
import { permissionLabel } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { EmployeeForm, EMPLOYEE_FORM_ID } from "../employee-form";
import { DeleteEmployeeButton, ResetPasswordButton } from "./danger-actions";

export const metadata = {
  title: "Ажилтан засах",
};

// Ажилтны байдлыг нэг харцаар харуулах curated permission жагсаалт (эрхийн
// БҮРЭН жагсаалт биш — "Үүргүүд" хэсэгт дэлгэрэнгүй тохируулна).
const QUICK_PERMISSIONS = [
  "orders.view",
  "orders.create",
  "payments.edit",
  "audit.view",
  "employees.view",
] as const;

function formatDateTime(d: Date): string {
  return `${d.toLocaleDateString("mn-MN")} ${d.toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit" })}`;
}

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!canEdit(me, "employees")) redirect("/dashboard/employees");
  // Энгийн багц (ганц салбар): салбарын талбарыг нууна.
  const { hideBranches, singleBranchId } = await getBranchVisibility(me);

  const { id } = await params;

  const employee = await prisma.user.findFirst({
    where: { id, tenantId: me.tenantId },
    include: { role: { select: { name: true, permissions: true } } },
  });
  if (!employee) notFound();

  // Идэвхтэй салбарууд + энэ ажилтны одоогийн харьяалал/сонголтод байгаа
  // (боловч хожим идэвхгүй болсон байж болзошгүй) салбаруудыг хамт харуулна.
  const currentBranchIds = [
    ...(employee.branchId ? [employee.branchId] : []),
    ...employee.assignableBranchIds,
  ];

  const [branches, roles] = await Promise.all([
    prisma.branch.findMany({
      where: {
        tenantId: me.tenantId,
        OR: [{ isActive: true }, { id: { in: currentBranchIds } }],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, district: true, slotCapacity: true },
    }),
    prisma.role.findMany({
      where: { tenantId: me.tenantId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const initials =
    `${employee.lastName.slice(0, 1)}${employee.firstName.slice(0, 1)}`.toUpperCase();

  // Тенант админы үүргийг засах боломжгүй (зөвхөн профайлаар нэр/нууц үг солино).
  if (employee.isOwner) {
    return (
      <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
        <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
          <Link href="/dashboard/employees" className="hover:text-[var(--oc-accent-hi)] transition-colors">
            Ажилтнууд
          </Link>
          <span>/</span>
          <span className="text-[var(--oc-muted)]">
            {employee.lastName} {employee.firstName}
          </span>
        </nav>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 shrink-0 rounded-full border border-[var(--oc-line)] bg-[var(--oc-panel2)] flex items-center justify-center font-bold text-[var(--oc-ink2)]">
            {initials}
          </div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">
            {employee.lastName} {employee.firstName}
          </h1>
        </div>
        <div className="rounded-[10px] border border-[var(--oc-accent)]/25 bg-[var(--oc-panel)] p-5 text-sm text-[var(--oc-muted2)]">
          Тенант админы үүрэг, мэдээллийг засах боломжгүй. Тус админ өөрөө{" "}
          <a href="/dashboard/profile" className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] underline">
            профайлаасаа
          </a>{" "}
          өөрчилнө.
        </div>
      </div>
    );
  }

  const scopeFilter = { tenantId: me.tenantId, assignedToId: employee.id };
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [
    activeJobs,
    completedThisMonth,
    completedTotal,
    durationOrders,
    lastSession,
    createdLog,
    recentLogs,
  ] = await Promise.all([
    prisma.serviceOrder.count({
      where: { ...scopeFilter, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
    }),
    prisma.serviceOrder.count({
      where: { ...scopeFilter, status: "COMPLETED", completedAt: { gte: monthStart } },
    }),
    prisma.serviceOrder.count({ where: { ...scopeFilter, status: "COMPLETED" } }),
    prisma.serviceOrder.findMany({
      where: { ...scopeFilter, status: "COMPLETED", startedAt: { not: null }, completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      take: 50,
      select: { startedAt: true, completedAt: true },
    }),
    prisma.userSession.findFirst({
      where: { userId: employee.id },
      orderBy: { lastSeenAt: "desc" },
      select: { lastSeenAt: true },
    }),
    prisma.auditLog.findFirst({
      where: { entity: "User", entityId: employee.id, action: "CREATE" },
      select: { createdAt: true, user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.auditLog.findMany({
      where: { tenantId: me.tenantId, userId: employee.id },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { summary: true, createdAt: true },
    }),
  ]);

  const avgDurationMin =
    durationOrders.length > 0
      ? Math.round(
          durationOrders.reduce(
            (sum, o) => sum + (o.completedAt!.getTime() - o.startedAt!.getTime()) / 60000,
            0,
          ) / durationOrders.length,
        )
      : null;

  const createdBy = createdLog
    ? `${createdLog.user ? `${createdLog.user.lastName} ${createdLog.user.firstName}` : "Систем"} · ${createdLog.createdAt.toLocaleDateString("mn-MN")}`
    : `${employee.createdAt.toLocaleDateString("mn-MN")}`;

  return (
    <div className="p-4 sm:p-6">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/employees" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Ажилтнууд
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">
          {employee.lastName} {employee.firstName}
        </span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 shrink-0 rounded-full border border-[var(--oc-line)] bg-[var(--oc-panel2)] flex items-center justify-center font-bold text-[var(--oc-ink2)]">
            {initials}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">
                {employee.lastName} {employee.firstName}
              </h1>
              {employee.role ? (
                <Chip tone="neutral" bordered>{employee.role.name}</Chip>
              ) : null}
              <Chip tone={employee.isActive ? "ok" : "neutral"}>
                {employee.isActive ? "Идэвхтэй" : "Идэвхгүй"}
              </Chip>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ResetPasswordButton employeeId={employee.id} />
          <BtnLink href="/dashboard/employees" variant="ghost">
            ← Буцах
          </BtnLink>
          <Btn type="submit" form={EMPLOYEE_FORM_ID}>
            Хадгалах
          </Btn>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        <EmployeeForm
          branches={branches}
          hideBranches={hideBranches}
          singleBranchId={singleBranchId}
          roles={roles}
          initial={{
            id: employee.id,
            firstName: employee.firstName,
            lastName: employee.lastName,
            email: employee.email ?? "",
            phone: employee.phone,
            roleId: employee.roleId,
            branchId: employee.branchId,
            assignableBranchIds: employee.assignableBranchIds,
            isActive: employee.isActive,
            activeUntil: employee.activeUntil,
          }}
          accessInfo={{
            lastSeenAt: lastSession ? formatDateTime(lastSession.lastSeenAt) : null,
            createdBy,
          }}
        />

        <div className="flex flex-col gap-6">
          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
            <h2 className="font-semibold text-[var(--oc-ink)] mb-4">Ажлын тойм</h2>
            <dl className="space-y-3 text-sm">
              <OverviewRow label="Идэвхтэй ажил" value={String(activeJobs)} />
              <OverviewRow label="Энэ сард дуусгасан" value={String(completedThisMonth)} />
              <OverviewRow
                label="Дундаж хугацаа"
                value={avgDurationMin != null ? `${avgDurationMin} мин` : "—"}
              />
              <OverviewRow label="Нийт дуусгасан ажил" value={String(completedTotal)} />
            </dl>
          </div>

          {employee.role ? (
            <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
              <h2 className="font-semibold text-[var(--oc-ink)] mb-3">{employee.role.name} эрх</h2>
              <ul className="space-y-2">
                {QUICK_PERMISSIONS.map((code) => {
                  const has = employee.role!.permissions.includes(code);
                  return (
                    <li key={code} className="flex items-center gap-2 text-[13px]">
                      <span className={has ? "text-[var(--oc-ok)]" : "text-[var(--oc-muted4)]"}>
                        {has ? "✓" : "✕"}
                      </span>
                      <span className={has ? "text-[var(--oc-ink2)]" : "text-[var(--oc-muted3)]"}>
                        {permissionLabel(code)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-[var(--oc-muted3)]">
                Эрхийн дэлгэрэнгүйг{" "}
                <Link href="/dashboard/employees/roles" className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]">
                  Үүргүүд
                </Link>{" "}
                хэсгээс тохируулна.
              </p>
            </div>
          ) : null}

          {recentLogs.length > 0 ? (
            <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
              <h2 className="font-semibold text-[var(--oc-ink)] mb-3">Сүүлийн үйлдэл</h2>
              <ul className="space-y-3">
                {recentLogs.map((log, i) => (
                  <li key={i} className="text-[13px]">
                    <div className="text-[var(--oc-ink2)]">{log.summary ?? "—"}</div>
                    <div className="text-xs text-[var(--oc-muted3)] mt-0.5">
                      {formatDateTime(log.createdAt)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-[10px] border border-red-500/25 bg-[var(--oc-panel)] p-5">
            <h2 className="font-semibold text-red-400 light:text-red-600 mb-3">
              Ажилтныг устгах
            </h2>
            <p className="text-xs text-[var(--oc-muted3)] mb-3">
              Засварын хуудастай холбоотой бол устгах боломжгүй — оронд нь идэвхгүй
              болгож болно.
            </p>
            <DeleteEmployeeButton
              employeeId={employee.id}
              employeeName={`${employee.lastName} ${employee.firstName}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--oc-muted3)]">{label}</span>
      <span className="font-plex-mono font-semibold text-[var(--oc-ink)]">{value}</span>
    </div>
  );
}
