"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { type ReviewReplyState, replyReviewAction } from "@/app/_actions/reviews";
import { useToast } from "@/app/_components/toast";

export function ReplyForm({ reviewId, initial }: { reviewId: string; initial: string }) {
  const toast = useToast();
  const [state, formAction, pending] = useActionState<ReviewReplyState, FormData>(replyReviewAction, null);
  const handled = useRef<ReviewReplyState>(null);
  const [open, setOpen] = useState(Boolean(initial));

  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (state.ok) toast.success(state.message ?? "Хадгалагдлаа.");
    else toast.error(state.message ?? "Алдаа гарлаа.");
  }, [state, toast]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
      >
        Хариу бичих
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <textarea
        name="reply"
        defaultValue={initial}
        rows={2}
        maxLength={1000}
        placeholder="Үйлчлүүлэгчид харагдах хариу (хоосон хадгалбал хариуг устгана)"
        className="auth-input w-full resize-none text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="self-end rounded-lg bg-[var(--oc-accent)] px-3 py-1.5 text-xs font-medium text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)] disabled:opacity-60"
      >
        {pending ? "Хадгалж байна..." : "Хариу хадгалах"}
      </button>
    </form>
  );
}
