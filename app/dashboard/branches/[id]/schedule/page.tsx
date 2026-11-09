import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { WEEK_DAYS, type Weekday } from "@/lib/branches";
import { getBranchVisibility, SINGLE_BRANCH_LABEL } from "@/lib/branch-visibility";
import { BranchScheduleManager } from "./schedule-manager";

// Энгийн багц (ганц салбар): гарчигт «салбар» гэж бичихгүй.
export async function generateMetadata() {
  const user = await requireUser();
  const { hideBranches } = await getBranchVisibility(user);
  return { title: hideBranches ? "Ажлын хуваарь" : "Салбарын хуваарь" };
}

export default async function BranchSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { hideBranches } = await getBranchVisibility(user);
  if (!canEdit(user, "branches")) redirect(hideBranches ? "/dashboard" : "/dashboard/branches");
  const { id } = await params;
  const [branch, tenantBranchCount] = await Promise.all([
    prisma.branch.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        schedules: true,
        scheduleExceptions: { orderBy: { date: "asc" } },
        scheduleSeasons: { orderBy: { startsOn: "asc" }, include: { days: true } },
      },
    }),
    prisma.branch.count({ where: { tenantId: user.tenantId } }),
  ]);
  if (!branch) notFound();

  const baseDays = Object.fromEntries(WEEK_DAYS.map((day) => {
    const saved = branch.schedules.find((item) => item.weekday === day.value);
    return [day.value, {
      isOpen: saved?.isOpen ?? Boolean(branch.openTime && branch.closeTime),
      openTime: saved?.openTime ?? branch.openTime ?? "",
      closeTime: saved?.closeTime ?? branch.closeTime ?? "",
    }];
  })) as Record<Weekday, { isOpen: boolean; openTime: string; closeTime: string }>;

  const exceptions = branch.scheduleExceptions.map((item) => ({
    id: item.id,
    date: item.date.toISOString().slice(0, 10),
    isOpen: item.isOpen,
    openTime: item.openTime,
    closeTime: item.closeTime,
    label: item.label,
  }));
  const seasons = branch.scheduleSeasons.map((item) => ({
    id: item.id,
    name: item.name,
    startsOn: item.startsOn.toISOString().slice(0, 10),
    endsOn: item.endsOn.toISOString().slice(0, 10),
    days: Object.fromEntries(WEEK_DAYS.map((day) => {
      const saved = item.days.find((entry) => entry.weekday === day.value);
      return [day.value, {
        isOpen: saved?.isOpen ?? false,
        openTime: saved?.openTime ?? "",
        closeTime: saved?.closeTime ?? "",
      }];
    })) as Record<Weekday, { isOpen: boolean; openTime: string; closeTime: string }>,
  }));

  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      {/* Энгийн багц (ганц салбар): салбарын жагсаалт, нэрийг харуулахгүй. */}
      {hideBranches ? (
        <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
          <Link href={`/dashboard/branches/${branch.id}`} className="hover:text-[var(--oc-accent-hi)]">{SINGLE_BRANCH_LABEL}</Link>
          <span>/</span>
          <span className="text-[var(--oc-muted)]">Хуваарь</span>
        </nav>
      ) : (
        <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
          <Link href="/dashboard/branches" className="hover:text-[var(--oc-accent-hi)]">Салбарууд</Link>
          <span>/</span>
          <Link href={`/dashboard/branches/${branch.id}`} className="hover:text-[var(--oc-accent-hi)]">{branch.name}</Link>
          <span>/</span>
          <span className="text-[var(--oc-muted)]">Хуваарь</span>
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">{hideBranches ? "Ажлын хуваарь" : `${branch.name} · Хуваарь`}</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">Онлайн захиалга болон ажилтны хуваарьт үйлчлэх тусгай өдрүүд, улирлын тохиргоо.</p>
        </div>
        <Link href={`/dashboard/branches/${branch.id}`} className="text-sm text-[var(--oc-accent)]">← Үндсэн мэдээлэл</Link>
      </div>
      <BranchScheduleManager
        branchId={branch.id}
        exceptions={exceptions}
        seasons={seasons}
        baseDays={baseDays}
        // Ганц идэвхтэй салбартай үед «бүх салбарт» сонголтыг харуулахгүй.
        tenantBranchCount={hideBranches ? 1 : tenantBranchCount}
      />
    </div>
  );
}
