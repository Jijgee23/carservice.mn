"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { type AccountReviewState, submitAccountReviewAction } from "@/app/_actions/account-reviews";

const LABELS = ["", "Муу", "Дунд зэрэг", "Хэвийн", "Сайн", "Маш сайн"];

/** Дууссан засварын үнэлгээ (1–5 од + сэтгэгдэл); дахин илгээвэл засна. */
export function ReviewForm({
  orderId,
  branchId,
  initial,
  onSaved,
}: {
  /** Засварын үнэлгээ — эсвэл `branchId` (засваргүйгээр салбарт шууд). */
  orderId?: string;
  branchId?: string;
  initial: { rating: number; comment: string | null; reply: string | null } | null;
  /** Амжилттай хадгалагдсаны дараа (жиш: discover modal-ийг хаах). */
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState<AccountReviewState, FormData>(submitAccountReviewAction, null);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });
  useEffect(() => {
    if (state?.ok) onSavedRef.current?.();
  }, [state]);
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [hover, setHover] = useState(0);
  const shown = hover || rating;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="orderId" value={orderId ?? ""} />
      <input type="hidden" name="branchId" value={branchId ?? ""} />
      <input type="hidden" name="rating" value={rating || ""} />
      <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} од`}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            className={`text-2xl leading-none transition-colors ${n <= shown ? "text-amber-400" : "text-[var(--oc-line)]"}`}
          >
            ★
          </button>
        ))}
        <span className="ml-2 text-sm text-[var(--oc-muted2)]">{LABELS[shown] ?? ""}</span>
      </div>
      <textarea
        name="comment"
        defaultValue={initial?.comment ?? ""}
        rows={3}
        maxLength={1000}
        placeholder="Үйлчилгээний талаарх сэтгэгдлээ бичээрэй (заавал биш)"
        className="auth-input w-full resize-none"
      />
      {state?.message ? (
        <p className={`text-sm ${state.ok ? "text-[var(--oc-ok)]" : "text-red-400 light:text-red-700"}`}>{state.message}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending || rating === 0}
        className="self-start rounded-lg bg-[var(--oc-accent)] px-4 py-2 text-sm font-semibold text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Илгээж байна..." : initial ? "Үнэлгээ шинэчлэх" : "Үнэлгээ өгөх"}
      </button>
      {initial?.reply ? (
        <div className="rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] p-3 text-sm">
          <div className="text-xs text-[var(--oc-muted3)] mb-1">Засварын газрын хариу</div>
          <p className="whitespace-pre-wrap text-[var(--oc-ink2)]">{initial.reply}</p>
        </div>
      ) : null}
    </form>
  );
}
