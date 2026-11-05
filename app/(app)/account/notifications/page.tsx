import Link from "next/link";
import type { ReactNode } from "react";
import {
  BackLink,
  PageHero,
  SectionTitle,
} from "@/app/(app)/_components/consumer-ui";
import { EmptyState } from "@/app/_components/empty-state";
import { requireAccount } from "@/lib/auth/account";
import {
  NOTIFICATION_TYPE_LABEL,
  notificationHref,
} from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Мэдэгдэл" };

export const dynamic = "force-dynamic";

function formatTime(d: Date): string {
  return d.toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default async function AccountNotificationsPage() {
  const account = await requireAccount();

  const rows = await prisma.notification.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const unread = rows.filter((n) => !n.readAt).length;

  // Өдрөөр бүлэглэнэ: Өнөөдөр / Өчигдөр / огноо.
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const groups: { label: string; items: typeof rows }[] = [];
  for (const n of rows) {
    const key = dayKey(n.createdAt);
    const label =
      key === dayKey(now)
        ? "Өнөөдөр"
        : key === dayKey(yesterday)
          ? "Өчигдөр"
          : `${n.createdAt.getFullYear() !== now.getFullYear() ? `${n.createdAt.getFullYear()} оны ` : ""}${n.createdAt.getMonth() + 1}-р сарын ${n.createdAt.getDate()}`;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <div className="w-full flex flex-col gap-5">
      <BackLink href="/account">Миний захиалгууд</BackLink>

      <PageHero
        eyebrow="Мэдэгдлийн төв"
        title="Мэдэгдэл"
        description="Цаг захиалга, засвар, төлбөр болон бусад мэдэгдлүүдийн түүх"
        stats={[
          { label: "Уншаагүй", value: unread, tone: unread > 0 ? "accent" : undefined },
          { label: "Нийт", value: rows.length },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState>Одоогоор мэдэгдэл алга байна.</EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g.label} className="flex flex-col gap-2">
              <SectionTitle count={g.items.length}>{g.label}</SectionTitle>
              <div className="overflow-hidden rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] divide-y divide-[var(--oc-line2)]">
                {g.items.map((n) => {
                  const kind = notificationKind(n.type);
                  return (
                    <Link
                      key={n.id}
                      href={notificationHref(n.type, n.data)}
                      className={`group relative flex items-start gap-3.5 p-4 transition-colors hover:bg-[var(--oc-panel2)] ${
                        n.readAt ? "" : "bg-[var(--oc-accent)]/[0.04]"
                      }`}
                    >
                      {n.readAt ? null : (
                        <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-[var(--oc-accent)]" />
                      )}
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${KIND_STYLE[kind]}`}>
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          {KIND_ICON[kind]}
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <span className={`${n.readAt ? "font-medium text-[var(--oc-ink2)]" : "font-semibold text-[var(--oc-ink)]"}`}>
                            {n.title}
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-[var(--oc-muted3)]">
                            {formatTime(n.createdAt)}
                          </span>
                        </div>
                        <div className="mt-0.5 text-sm text-[var(--oc-muted)]">{n.body}</div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="text-[11px] font-medium text-[var(--oc-muted3)]">
                            {NOTIFICATION_TYPE_LABEL[n.type as keyof typeof NOTIFICATION_TYPE_LABEL] ?? n.type}
                          </span>
                          {n.readAt ? null : (
                            <span className="rounded-full bg-[var(--oc-accent)] px-1.5 py-px text-[10px] font-semibold text-[var(--oc-on-accent)]">
                              Шинэ
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

type Kind = "ok" | "bad" | "money" | "time" | "info";

function notificationKind(type: string): Kind {
  if (/payment|fee_paid/.test(type)) return "money";
  if (/confirmed|completed|unblocked/.test(type)) return "ok";
  if (/cancelled|rejected|expired|no_show|blocked/.test(type)) return "bad";
  if (/reminder|rescheduled|revised|in_progress|expiring/.test(type)) return "time";
  return "info";
}

const KIND_STYLE: Record<Kind, string> = {
  ok: "bg-emerald-500/15 text-emerald-400 light:text-emerald-600",
  bad: "bg-red-500/15 text-red-400 light:text-red-600",
  money: "bg-sky-500/15 text-sky-400 light:text-sky-600",
  time: "bg-amber-400/15 text-amber-400 light:text-amber-600",
  info: "bg-[var(--oc-accent)]/10 text-[var(--oc-accent)]",
};

const KIND_ICON: Record<Kind, ReactNode> = {
  ok: <path d="M20 6 9 17l-5-5" />,
  bad: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-6 6M9 9l6 6" />
    </>
  ),
  money: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  time: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  info: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
};
