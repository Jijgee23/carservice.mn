import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getEnabledModules } from "@/lib/plan-modules-server";
import { canEdit } from "@/lib/auth/roles";
import { Btn, BtnLink, Chip } from "@/app/_components/landing-ops-ui";
import { prisma } from "@/lib/prisma";
import { BranchForm, BRANCH_FORM_ID } from "../branch-form";
import { getAddressData } from "@/lib/address";
import type { Weekday } from "@/lib/branches";

export const metadata = {
  title: "Салбар засах",
};

function isValidTime(s: string | null): s is string {
  return Boolean(s) && /^([01]\d|2[0-3]):[0-5]\d$/.test(s as string);
}

// Ажиллах цаг + slot тохиргооноос өдрийн зэрэг авах чадварыг тооцоолно.
function dailyCapacity(
  openTime: string | null,
  closeTime: string | null,
  slotMinutes: number | null,
  slotCapacity: number | null,
): number | null {
  if (!isValidTime(openTime) || !isValidTime(closeTime)) return null;
  const [oh, om] = openTime.split(":").map(Number);
  const [ch, cm] = closeTime.split(":").map(Number);
  const totalMin = ch * 60 + cm - (oh * 60 + om);
  if (totalMin <= 0) return null;
  const slots = Math.floor(totalMin / (slotMinutes ?? 30));
  return slots * (slotCapacity ?? 1);
}

export default async function EditBranchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const auditInPlan = (await getEnabledModules(user.tenant.plan)).has("enable_audit");
  if (!canEdit(user, "branches")) redirect("/dashboard/branches");

  const { id } = await params;
  const [branch, addressData, tagOptions, lastAudit] = await Promise.all([
    prisma.branch.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        schedules: { select: { weekday: true, isOpen: true, openTime: true, closeTime: true } },
        tags: { select: { id: true } },
        _count: { select: { users: true } },
      },
    }),
    getAddressData(),
    prisma.branchTag.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.auditLog.findFirst({
      where: { entity: "Branch", entityId: id },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        user: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);
  if (!branch) notFound();

  const openDays = branch.schedules
    .filter((s) => s.isOpen)
    .map((s) => s.weekday);
  const daySchedules = Object.fromEntries(
    branch.schedules.map((s) => [s.weekday, {
      isOpen: s.isOpen,
      openTime: s.openTime,
      closeTime: s.closeTime,
    }]),
  ) as Record<Weekday, { isOpen: boolean; openTime: string | null; closeTime: string | null }>;

  const capacity = dailyCapacity(
    branch.openTime,
    branch.closeTime,
    branch.slotMinutes,
    branch.slotCapacity,
  );

  const missing: string[] = [];
  if (!branch.district) missing.push("Дүүрэг / Сум сонгогдоогүй");
  if (!branch.khoroo) missing.push("Хороо / Баг сонгогдоогүй");
  if (branch.latitude == null || branch.longitude == null)
    missing.push("Газрын зураг дээр байршил тэмдэглээгүй");
  if (!branch.phone) missing.push("Утасны дугаар оруулаагүй");
  // Шинэ салбарт шошго ЗААВАЛ, харин хуучин шошгогүй салбаруудыг зөвхөн
  // сануулаад орхино — бусад мэдээлэл засахад нь саад болохгүй (харах:
  // app/_actions/branches.ts-ийн requireTag зөвхөн create дээр ажилладаг шийдвэр).
  if (branch.tags.length === 0)
    missing.push("Бизнесийн төрлүүд сонгогдоогүй (discover-т шүүгдэхгүй)");

  const shortId = branch.id.slice(-6).toUpperCase();

  return (
    <div className="p-4 sm:p-6">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/branches" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Салбарууд
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">{branch.name}</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">{branch.name}</h1>
          <span className="font-plex-mono text-[11px] px-2 py-1 rounded bg-[var(--oc-panel2)] border border-[var(--oc-line)] text-[var(--oc-muted3)]">
            ID {shortId}
          </span>
          <Chip tone={branch.isActive ? "ok" : "neutral"}>
            {branch.isActive ? "Ажиллаж байна" : "Идэвхгүй"}
          </Chip>
        </div>
        <div className="flex items-center gap-2">
          {branch.openTime && branch.closeTime ? (
            <Chip tone="neutral" bordered className="tabular-nums">
              {branch.openTime}–{branch.closeTime}
            </Chip>
          ) : null}
          <BtnLink href={`/dashboard/branches/${branch.id}/schedule`} variant="ghost">
            Нарийвчилсан хуваарь
          </BtnLink>
          <BtnLink href="/dashboard/branches" variant="ghost">
            ← Буцах
          </BtnLink>
          <Btn type="submit" form={BRANCH_FORM_ID}>
            Хадгалах
          </Btn>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        <BranchForm
          addressData={addressData}
          mapApiKey={process.env.GOOGLE_MAP_API_KEY ?? ""}
          mapId={process.env.GOOGLE_MAP_ID ?? ""}
          tagOptions={tagOptions}
          initial={{
            id: branch.id,
            name: branch.name,
            phone: branch.phone,
            city: branch.city,
            district: branch.district,
            khoroo: branch.khoroo,
            address: branch.address,
            latitude: branch.latitude,
            longitude: branch.longitude,
            openTime: branch.openTime,
            closeTime: branch.closeTime,
            slotMinutes: branch.slotMinutes,
            slotCapacity: branch.slotCapacity,
            openDays,
            daySchedules,
            isPrimary: branch.isPrimary,
            tagIds: branch.tags.map((t) => t.id),
          }}
        />

        <div className="flex flex-col gap-6">
          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
            <h2 className="font-semibold text-[var(--oc-ink)] mb-4">Тойм</h2>
            <dl className="space-y-3 text-sm">
              <OverviewRow label="Талбай" value={String(branch.slotCapacity ?? 1)} />
              <OverviewRow label="Ажилтан" value={String(branch._count.users)} />
              <OverviewRow
                label="Өдрийн хүчин чадал"
                value={capacity != null ? `${capacity} ажил` : "—"}
              />
              <OverviewRow
                label="Онлайн захиалга"
                value={branch.isActive ? "Нээлттэй" : "Хаалттай"}
                accentValue={branch.isActive}
              />
            </dl>
          </div>

          {missing.length > 0 ? (
            <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
              <h2 className="font-semibold text-[var(--oc-ink)] mb-3">Дутуу мэдээлэл</h2>
              <ul className="space-y-2">
                {missing.map((m) => (
                  <li key={m} className="flex items-start gap-2 text-[13px] text-[var(--oc-muted2)]">
                    <span className="text-[var(--oc-accent)] shrink-0">!</span>
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
            <div className="font-plex-mono text-[11px] uppercase tracking-[0.1em] text-[var(--oc-muted3)] mb-2">
              Сүүлд шинэчилсэн
            </div>
            {lastAudit ? (
              <p className="text-sm text-[var(--oc-ink2)]">
                {lastAudit.user
                  ? `${lastAudit.user.lastName} ${lastAudit.user.firstName}`
                  : "Систем"}{" "}
                <span className="text-[var(--oc-muted3)]">
                  · {lastAudit.createdAt.toLocaleDateString("mn-MN")}{" "}
                  {lastAudit.createdAt.toLocaleTimeString("mn-MN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </p>
            ) : (
              <p className="text-sm text-[var(--oc-muted3)]">Түүх алга.</p>
            )}
            {auditInPlan ? (
              <Link
                href={`/dashboard/audit?entity=Branch&q=${branch.id}`}
                className="mt-3 inline-block text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
              >
                Аудит лог харах →
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewRow({
  label,
  value,
  accentValue,
}: {
  label: string;
  value: string;
  accentValue?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--oc-muted3)]">{label}</span>
      <span
        className={`font-plex-mono font-semibold ${
          accentValue ? "text-[var(--oc-ok)]" : "text-[var(--oc-ink)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
