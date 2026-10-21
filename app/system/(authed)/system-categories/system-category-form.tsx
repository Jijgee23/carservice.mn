"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  type SystemCategoryActionState,
  createSystemCategoryAction,
  updateSystemCategoryAction,
} from "@/app/_actions/system-categories";
import { Btn, Field, FormError, ToggleChip } from "@/app/_components/landing-ops-ui";

type Initial = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

export function SystemCategoryForm({
  initial,
  onSuccess,
}: {
  initial?: Initial;
  // Амжилттай хадгалсны дараа дуудагдана (жиш. modal-ыг хаах, жагсаалтыг
  // дахин ачаалуулах) — өгөгдөөгүй бол зөвхөн form дотроо message харуулна.
  onSuccess?: () => void;
}) {
  const isEdit = Boolean(initial);
  const action = isEdit
    ? updateSystemCategoryAction.bind(null, initial!.id)
    : createSystemCategoryAction;
  const [state, formAction, pending] = useActionState<
    SystemCategoryActionState,
    FormData
  >(action, null);

  // `state` шинэ object болгонд биш, ЗӨВХӨН амжилттай болоход л дуудна —
  // тэмдэглэсэн object-ийн identity-г биш, "ok болсон эсэх"-ийг харьцуулна.
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (state?.ok && !notifiedRef.current) {
      notifiedRef.current = true;
      onSuccess?.();
    }
    if (!state?.ok) notifiedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const fe = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state?.ok && state.message ? (
        <div className="bg-[var(--oc-ok)]/10 border border-[var(--oc-ok)]/25 rounded-lg px-3 py-2 text-sm text-[var(--oc-ok)]">
          {state.message}
        </div>
      ) : null}
      {state?.message && !state.ok ? <FormError message={state.message} /> : null}

      <Field label="Нэр" htmlFor="name" error={fe.name}>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={initial?.name}
          placeholder="Жишээ: Шүүлтүүр"
          className={`auth-input ${fe.name ? "border-red-500/50" : ""}`}
        />
      </Field>

      <Field label="Тайлбар" htmlFor="description" hint="заавал биш" error={fe.description}>
        <textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={initial?.description ?? ""}
          className="auth-input resize-none"
        />
      </Field>

      <div className="flex items-center gap-3 w-full">
        <ToggleChip
          name="isActive"
          label="Идэвхтэй"
          defaultChecked={initial?.isActive ?? true}
          className="flex-1 justify-center rounded-lg"
        />
        <Btn type="submit" disabled={pending} className="flex-1">
          {pending ? "..." : isEdit ? "Хадгалах" : "Үүсгэх"}
        </Btn>
      </div>
    </form>
  );
}
