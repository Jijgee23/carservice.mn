import Link from "next/link";
import { Prisma } from "@/app/generated/prisma/client";
import { deleteReviewAction, setReviewHiddenAction } from "@/app/_actions/system-credit";
import { ConfirmForm } from "@/app/_components/confirm-form";
import { FilterSelect, ResetFilters, SearchBox } from "@/app/_components/list-filters";
import { EmptyState, PageHeader } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireSuperAdmin } from "@/lib/auth/system";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Үнэлгээ" };

export const dynamic = "force-dynamic";

type Search = { q?: string; rating?: string; status?: string; page?: string };

function fmt(d: Date): string {
  return d.toLocaleDateString("mn-MN", { year: "2-digit", month: "2-digit", day: "2-digit" });
}

export default async function SystemReviewsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const rating = Number(sp.rating);
  const status = sp.status ?? "";
  const { page, pageSize, skip, take } = getPageInfo(sp.page);

  const where: Prisma.ReviewWhereInput = {};
  if (Number.isInteger(rating) && rating >= 1 && rating <= 5) where.rating = rating;
  if (status === "hidden") where.hidden = true;
  if (status === "visible") where.hidden = false;
  if (q) {
    where.OR = [
      { comment: { contains: q, mode: "insensitive" } },
      { tenant: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [rows, total] = await Promise.all([
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
        hiddenReason: true,
        createdAt: true,
        tenant: { select: { id: true, name: true } },
        branch: { select: { name: true } },
        account: { select: { name: true, phone: true } },
        orderId: true,
      },
    }),
    prisma.review.count({ where }),
  ]);
  const meta = buildMeta(total, page, pageSize);

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <PageHeader
        title="Үнэлгээ"
        description="Үйлчлүүлэгчдийн засварын газруудад өгсөн үнэлгээ. Доромжилсон/хуурамч үнэлгээг нуух (салбарын дундаж, credit score-оос хасагдана) эсвэл устгах."
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SearchBox placeholder="Сэтгэгдэл, байгууллагаар хайх..." />
        <FilterSelect
          paramName="rating"
          placeholder="Бүх од"
          options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} ★` }))}
        />
        <FilterSelect
          paramName="status"
          placeholder="Бүх төлөв"
          options={[
            { value: "visible", label: "Харагдаж буй" },
            { value: "hidden", label: "Нуусан" },
          ]}
        />
        <ResetFilters paramNames={["q", "rating", "status"]} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Үнэлгээ алга" description="Энэ шүүлтэд тохирох үнэлгээ байхгүй." />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className={`rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 ${r.hidden ? "opacity-70" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-plex-mono text-amber-400">
                  {"★".repeat(r.rating)}
                  <span className="text-[var(--oc-line)]">{"★".repeat(5 - r.rating)}</span>
                </span>
                <Link href={`/system/tenants/${r.tenant.id}`} className="text-[var(--oc-ink2)] hover:underline">
                  {r.tenant.name}
                </Link>
                <span className="text-xs text-[var(--oc-muted3)]">
                  {r.branch.name} · {r.account.name?.trim() || r.account.phone} · {fmt(r.createdAt)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10.5px] ${r.orderId ? "bg-emerald-500/10 text-emerald-400 light:text-emerald-700" : "border border-[var(--oc-line)] text-[var(--oc-muted3)]"}`}
                  title={r.orderId ? "Засвартай холбоотой — credit score-д тооцогдоно" : "Засваргүй — credit score-д тооцогдохгүй"}
                >
                  {r.orderId ? "✓ Засвартай" : "Засваргүй"}
                </span>
                {r.hidden ? (
                  <span className="rounded-full border border-[var(--oc-line)] px-2 py-0.5 text-[10.5px] text-[var(--oc-muted3)]">
                    Нуусан{r.hiddenReason ? `: ${r.hiddenReason}` : ""}
                  </span>
                ) : null}
              </div>
              {r.comment ? <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--oc-muted)]">{r.comment}</p> : null}
              {r.reply ? (
                <p className="mt-2 rounded-lg bg-[var(--oc-panel2)] p-2.5 text-xs text-[var(--oc-muted2)]">Хариу: {r.reply}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <form action={setReviewHiddenAction} className="flex items-center gap-2">
                  <input type="hidden" name="reviewId" value={r.id} />
                  <input type="hidden" name="hidden" value={r.hidden ? "false" : "true"} />
                  {r.hidden ? null : (
                    <input name="reason" placeholder="Шалтгаан (заавал биш)" maxLength={200} className="auth-input !py-1 text-xs w-56" />
                  )}
                  <button
                    type="submit"
                    className="rounded-lg border border-[var(--oc-line)] px-3 py-1 text-xs text-[var(--oc-ink2)] hover:bg-[var(--oc-panel2)]"
                  >
                    {r.hidden ? "Ил болгох" : "Нуух"}
                  </button>
                </form>
                <ConfirmForm action={deleteReviewAction} message="Энэ үнэлгээг бүрмөсөн устгах уу?">
                  <input type="hidden" name="reviewId" value={r.id} />
                  <button type="submit" className="px-2 py-1 text-xs text-red-400 hover:text-red-300 light:text-red-700">
                    Устгах
                  </button>
                </ConfirmForm>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={meta.page}
        totalPages={meta.totalPages}
        total={meta.total}
        params={{ q, rating: sp.rating ?? "", status }}
        tone="danger"
      />
    </div>
  );
}
