import Link from "next/link";
import { Chip } from "@/app/_components/landing-ops-ui";
import type { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/roles";
import { effectiveBranchScope } from "@/lib/cash/scope";
import { getCurrentSession } from "@/lib/cash/session";
import { formatTugrik } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { sessionTotals } from "./cash/sessions/method-breakdown";
import { OpenSessionButton } from "./cash/sessions/session-dialogs";

type User = Awaited<ReturnType<typeof requireUser>>;

/** Самбарт хэт олон салбар харуулахгүй — үлдсэнийг кассын ээлжийн хуудсанд. */
const MAX_BRANCHES = 6;

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("mn-MN", {
    timeZone: "Asia/Ulaanbaatar",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Хяналтын самбарын «Касс»: салбар бүрийн одоогийн ээлж — нээлттэй бол кассын
 * (бэлэн) үлдэгдэл + ээлжийн орлого, хаалттай бол «Касс нээх». Кассын ээлжийн
 * хуудастай ижил эрх (`cash.manage`) ба салбарын хүрээ.
 */
export async function CashOverview({ user }: { user: User }) {
  if (!hasPermission(user, "cash.manage")) return null;

  const scopeBranchId = effectiveBranchScope(user, undefined);
  const branches = await prisma.branch.findMany({
    where: { tenantId: user.tenantId, isActive: true, ...(scopeBranchId ? { id: scopeBranchId } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
    take: MAX_BRANCHES + 1,
  });
  if (branches.length === 0) return null;
  const shown = branches.slice(0, MAX_BRANCHES);
  const sessions = await Promise.all(shown.map((b) => getCurrentSession({ actor: user, branchId: b.id })));
  // Ганц салбартай бол салбарын нэрийг харуулахгүй.
  const single = branches.length === 1;

  return (
    <section className="mt-6 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-semibold text-[var(--oc-ink)]">Касс</h2>
        <Link
          href="/dashboard/cash/sessions"
          className="font-plex-mono text-[11px] text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
        >
          Кассын ээлж →
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((b, i) => {
          const s = sessions[i];
          const totals = s ? sessionTotals(s) : null;
          return (
            <div key={b.id} className="rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-[var(--oc-ink)] truncate">{single ? "Одоогийн ээлж" : b.name}</span>
                {s ? <Chip tone="ok">Нээлттэй</Chip> : <Chip tone="neutral">Хаалттай</Chip>}
              </div>
              {s ? (
                <>
                  <div>
                    <div className="text-xs text-[var(--oc-muted3)]">Кассын үлдэгдэл (бэлэн)</div>
                    <div className="font-plex-mono text-2xl font-semibold tabular-nums text-[var(--oc-ink)]">
                      {formatTugrik(s.expectedCash)}
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-[var(--oc-muted3)]">Ээлжийн орлого</dt>
                      <dd className="tabular-nums text-[var(--oc-ink)]">{formatTugrik(totals?.income ?? "0")}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--oc-muted3)]">Эхний үлдэгдэл</dt>
                      <dd className="tabular-nums text-[var(--oc-ink)]">{formatTugrik(s.openingCash)}</dd>
                    </div>
                  </dl>
                  <div className="flex items-center justify-between gap-2 text-xs text-[var(--oc-muted3)]">
                    <span>
                      Нээсэн: {s.openedBy?.name ?? "—"} · {fmtTime(s.openedAt)}
                    </span>
                    <Link
                      href={`/dashboard/cash/sessions/${s.id}`}
                      className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
                    >
                      Дэлгэрэнгүй
                    </Link>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-[var(--oc-muted3)]">Касс нээгдээгүй байна.</p>
                  <OpenSessionButton branchId={b.id} branchName={single ? null : b.name} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {branches.length > MAX_BRANCHES ? (
        <p className="mt-3 text-xs text-[var(--oc-muted3)]">
          Бусад салбарын кассыг{" "}
          <Link href="/dashboard/cash/sessions" className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]">
            кассын ээлжийн хуудаснаас
          </Link>{" "}
          харна уу.
        </p>
      ) : null}
    </section>
  );
}
