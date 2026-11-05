"use client";

// Discover дээр салбарт үнэлгээ өгөх modal. Нэвтэрсэн хэрэглэгч:
//  - тухайн салбарт ҮНЭЛЭЭГҮЙ дууссан засвартай бол засвараа сонгож үнэлнэ
//    (баталгаажсан, «✓ Үйлчлүүлсэн», credit score-д тооцогдоно);
//  - эс бол засваргүйгээр салбарт шууд (account × branch тутам нэг, засна).
// Нэвтрээгүй бол нэвтрэх санал.
import Link from "next/link";
import { useState } from "react";
import { ReviewForm } from "@/app/(app)/account/orders/[id]/review-form";
import { Modal } from "@/app/_components/modal";

export type PendingReview = {
  orderId: string;
  number: string | null;
  plate: string;
  date: string; // ISO
};

export type MyBranchReview = {
  rating: number;
  comment: string | null;
  reply: string | null;
  /** Засваргүй (салбарт шууд) үнэлгээ бол энд засаж болно. */
  editable: boolean;
};

export type ReviewTarget = {
  branchId: string;
  orgName: string;
  branchName: string;
  logoUrl: string | null;
  /** «Дараа» / үнэлсний дараа үргэлжлүүлэх хуудас (жагсаалтаас ирсэн бол). */
  continueHref: string | null;
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("mn-MN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function DiscoverReviewModal({
  target,
  loggedIn,
  orders,
  mine,
  onClose,
  onRated,
}: {
  target: ReviewTarget | null;
  loggedIn: boolean;
  orders: PendingReview[];
  mine: MyBranchReview | null;
  /** Хаах/«Дараа» — энэ салбарт энэ хуудсанд дахин асуухгүй. */
  onClose: () => void;
  /** Үнэлгээ хадгалагдсан (orderId — засвартай бол). */
  onRated: (orderId: string | null) => void;
}) {
  const [orderId, setOrderId] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [savedOne, setSavedOne] = useState(false);
  const active = orders.find((o) => o.orderId === orderId) ?? orders[0] ?? null;
  const open = target !== null;

  function close() {
    setDone(false);
    setSavedOne(false);
    setOrderId(null);
    onClose();
  }

  const continueLink = target?.continueHref ? (
    <Link
      href={target.continueHref}
      onClick={close}
      className={
        done
          ? "rounded-lg bg-[var(--oc-accent)] px-4 py-2 text-sm font-semibold text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)]"
          : "rounded-lg px-3 py-2 text-sm text-[var(--oc-muted)] hover:bg-[var(--oc-panel2)] hover:text-[var(--oc-ink)]"
      }
    >
      {done ? "Салбарыг үзэх →" : "Алгасаад салбар руу →"}
    </Link>
  ) : (
    <button
      type="button"
      onClick={close}
      className="rounded-lg px-3 py-2 text-sm text-[var(--oc-muted)] hover:bg-[var(--oc-panel2)] hover:text-[var(--oc-ink)]"
    >
      {done ? "Хаах" : "Дараа"}
    </button>
  );

  return (
    <Modal open={open} onClose={close} title="Үнэлгээ өгөх" widthClassName="max-w-lg">
      {target ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            {target.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={target.logoUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl border border-[var(--oc-line)] bg-[#fff] object-contain" />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[var(--oc-accent)]/20 bg-[var(--oc-accent)]/10 text-lg font-bold text-[var(--oc-accent)]">
                {target.orgName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate font-semibold text-[var(--oc-ink)]">{target.branchName}</div>
              <div className="truncate text-xs text-[var(--oc-muted3)]">{target.orgName}</div>
            </div>
          </div>

          {!loggedIn ? (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-[var(--oc-line)] bg-[var(--oc-panel2)] p-4">
              <div className="text-2xl text-amber-400">★★★★★</div>
              <p className="text-sm text-[var(--oc-muted)]">Үнэлгээ өгөхийн тулд нэвтэрнэ үү.</p>
              <Link
                href="/login"
                className="rounded-lg bg-[var(--oc-accent)] px-4 py-2 text-sm font-semibold text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)]"
              >
                Нэвтрэх / Бүртгүүлэх →
              </Link>
            </div>
          ) : done ? (
            <div className="flex flex-col items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-6 text-center">
              <div className="text-3xl text-amber-400">★★★★★</div>
              <div className="font-semibold text-[var(--oc-ink)]">Үнэлгээ өгсөнд баярлалаа!</div>
              <div className="text-xs text-[var(--oc-muted)]">Таны үнэлгээ бусад хэрэглэгчдэд газраа сонгоход тусална.</div>
            </div>
          ) : active ? (
            <>
              {savedOne ? (
                <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-400 light:text-emerald-700">
                  ✓ Үнэлгээ хадгалагдлаа. Үлдсэн {orders.length} засвараа ч үнэлэх үү?
                </p>
              ) : (
                <p className="text-sm text-[var(--oc-muted)]">
                  Та энэ салбарт үйлчлүүлсэн байна. Үйлчилгээ танд хэр таалагдсан бэ?
                </p>
              )}
              {orders.length > 1 ? (
                <label className="text-xs text-[var(--oc-muted3)]">
                  Аль засварыг үнэлэх вэ?
                  <select value={active.orderId} onChange={(e) => setOrderId(e.target.value)} className="auth-input mt-1 w-full">
                    {orders.map((o) => (
                      <option key={o.orderId} value={o.orderId}>
                        {fmt(o.date)} · {o.plate}
                        {o.number ? ` · №${o.number}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-3 py-2 text-xs text-[var(--oc-muted)]">
                  <span className="rounded-md border border-[var(--oc-line)] bg-[var(--oc-panel)] px-1.5 py-px font-plex-mono font-semibold text-[var(--oc-ink2)]">
                    {active.plate}
                  </span>
                  <span>{fmt(active.date)}</span>
                  {active.number ? <span>· №{active.number}</span> : null}
                </div>
              )}
              <ReviewForm
                key={active.orderId}
                orderId={active.orderId}
                initial={null}
                onSaved={() => {
                  onRated(active.orderId);
                  if (orders.length <= 1) setDone(true);
                  else {
                    setOrderId(null);
                    setSavedOne(true);
                  }
                }}
              />
            </>
          ) : mine && !mine.editable ? (
            <div className="flex flex-col gap-2 rounded-xl border border-[var(--oc-line)] bg-[var(--oc-panel2)] p-4 text-sm">
              <div>
                <span className="text-amber-400">{"★".repeat(mine.rating)}</span>
                <span className="text-[var(--oc-line)]">{"★".repeat(5 - mine.rating)}</span>
                <span className="ml-2 text-[var(--oc-muted3)]">Таны үнэлгээ</span>
              </div>
              {mine.comment ? <p className="whitespace-pre-wrap text-[var(--oc-ink2)]">{mine.comment}</p> : null}
              <p className="text-xs text-[var(--oc-muted3)]">
                Засвартай холбоотой үнэлгээг{" "}
                <Link href="/account/history" className="text-[var(--oc-accent)] hover:underline">
                  Үйлчилгээний түүх
                </Link>
                -ээс засна.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-[var(--oc-muted)]">
                {mine ? "Та энэ салбарт өмнө нь үнэлгээ өгсөн байна — засах боломжтой." : "Энэ газрын талаарх сэтгэгдлээ хуваалцаарай."}
              </p>
              <ReviewForm
                key={`branch-${target.branchId}`}
                branchId={target.branchId}
                initial={mine ? { rating: mine.rating, comment: mine.comment, reply: mine.reply } : null}
                onSaved={() => {
                  onRated(null);
                  setDone(true);
                }}
              />
            </>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-[var(--oc-line2)] pt-3">{continueLink}</div>
        </div>
      ) : null}
    </Modal>
  );
}
