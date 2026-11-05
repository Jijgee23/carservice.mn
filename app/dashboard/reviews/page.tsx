import Link from "next/link";
import { redirect } from "next/navigation";
import { FilterSelect, ResetFilters } from "@/app/_components/list-filters";
import { EmptyState, PageHeader } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireUser } from "@/lib/auth";
import { canView, hasPermission, workingBranchScopeId } from "@/lib/auth/roles";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { ReplyForm } from "./reply-form";

export const metadata = { title: "Үнэлгээ" };

function fmt(d: Date): string {
  return d.toLocaleDateString("mn-MN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ rating?: string; replied?: string; page?: string }>;
}) {
  const user = await requireUser();
  if (!canView(user, "customers")) redirect("/dashboard");
  const canReply = hasPermission(user, "customers.edit");
  const sp = await searchParams;
  const rating = Number(sp.rating);
  const { page, pageSize, skip, take } = getPageInfo(sp.page);
  const scope = workingBranchScopeId(user);

  const where = {
    tenantId: user.tenantId,
    ...(scope ? { branchId: scope } : {}),
    ...(Number.isInteger(rating) && rating >= 1 && rating <= 5 ? { rating } : {}),
    ...(sp.replied === "no" ? { reply: null } : sp.replied === "yes" ? { reply: { not: null } } : {}),
  };

  const [rows, total, branches] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        rating: true,
        comment: true,
        reply: true,
        hidden: true,
        createdAt: true,
        branch: { select: { name: true } },
        order: { select: { id: true, number: true } },
        account: { select: { name: true } },
      },
    }),
    prisma.review.count({ where }),
    prisma.branch.findMany({
      where: { tenantId: user.tenantId, ...(scope ? { id: scope } : {}), ratingCount: { gt: 0 } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, ratingAvg: true, ratingCount: true },
    }),
  ]);
  const meta = buildMeta(total, page, pageSize);

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <PageHeader
        title="Үнэлгээ"
        description="Үйлчлүүлэгчдийн дууссан засварт өгсөн үнэлгээ. Хариу нийтэд (байгууллагын хуудсанд) харагдана."
      />

      {branches.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {branches.map((b) => (
            <div key={b.id} className="rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel)] px-3 py-2 text-sm">
              <span className="text-[var(--oc-ink2)]">{b.name}</span>
              <span className="ml-2 font-plex-mono text-amber-400">★ {Number(b.ratingAvg ?? 0).toFixed(1)}</span>
              <span className="ml-1 text-xs text-[var(--oc-muted3)]">({b.ratingCount})</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <FilterSelect
          paramName="rating"
          placeholder="Бүх од"
          options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} ★` }))}
        />
        <FilterSelect
          paramName="replied"
          placeholder="Хариу — бүгд"
          options={[
            { value: "no", label: "Хариу бичээгүй" },
            { value: "yes", label: "Хариу бичсэн" },
          ]}
        />
        <ResetFilters paramNames={["rating", "replied"]} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Үнэлгээ алга" description="Үйлчлүүлэгчид дууссан засвартаа апп/вэбээс үнэлгээ өгөхөд энд харагдана." />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-plex-mono text-amber-400" aria-label={`${r.rating} од`}>
                  {"★".repeat(r.rating)}
                  <span className="text-[var(--oc-line)]">{"★".repeat(5 - r.rating)}</span>
                </span>
                <span className="text-[var(--oc-ink2)]">{r.account.name?.trim() || "Үйлчлүүлэгч"}</span>
                <span className="text-xs text-[var(--oc-muted3)]">
                  {r.branch.name} · {fmt(r.createdAt)} ·{" "}
                  {r.order ? (
                    <Link href={`/dashboard/orders/${r.order.id}`} className="hover:underline">
                      {r.order.number ? `#${r.order.number}` : "засвар"}
                    </Link>
                  ) : (
                    <span title="Засваргүйгээр салбарт шууд өгсөн үнэлгээ (credit score-д тооцогдохгүй)">засваргүй</span>
                  )}
                </span>
                {r.hidden ? (
                  <span className="rounded-full border border-[var(--oc-line)] px-2 py-0.5 text-[10.5px] text-[var(--oc-muted3)]">
                    Системээс нуусан
                  </span>
                ) : null}
              </div>
              {r.comment ? <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--oc-muted)]">{r.comment}</p> : null}
              {canReply ? (
                <ReplyForm reviewId={r.id} initial={r.reply ?? ""} />
              ) : r.reply ? (
                <p className="mt-3 rounded-lg bg-[var(--oc-panel2)] p-3 text-sm text-[var(--oc-ink2)]">{r.reply}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={meta.page}
        totalPages={meta.totalPages}
        total={meta.total}
        params={{ rating: sp.rating ?? "", replied: sp.replied ?? "" }}
      />
    </div>
  );
}
