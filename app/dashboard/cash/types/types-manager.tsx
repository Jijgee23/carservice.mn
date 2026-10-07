"use client";

import { useActionState, useRef, useState } from "react";
import { createCashTypeAction, updateCashTypeAction, type CashActionState } from "@/app/_actions/cash";
import { FormError } from "@/app/_components/auth-shell";
import { Btn, Chip } from "@/app/_components/landing-ops-ui";
import { useRetainedFormAction } from "../use-retained-form-action";

type TypeRow = { id: string; direction: "INCOME" | "EXPENSE"; name: string; isSystem: boolean; isActive: boolean };

export function TypesManager({
  direction,
  title,
  types,
}: {
  direction: "INCOME" | "EXPENSE";
  title: string;
  types: TypeRow[];
}) {
  return (
    <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--oc-line)] font-semibold text-[var(--oc-ink)]">{title}</div>
      <ul className="divide-y divide-[var(--oc-line)]">
        {types.map((t) => (
          <TypeItem key={t.id} type={t} />
        ))}
        {types.length === 0 ? <li className="px-5 py-4 text-sm text-[var(--oc-muted3)]">Ангилал алга.</li> : null}
      </ul>
      <AddTypeForm direction={direction} />
    </section>
  );
}

function AddTypeForm({ direction }: { direction: "INCOME" | "EXPENSE" }) {
  const formRef = useRef<HTMLFormElement>(null);
  const { state, pending, onSubmit } = useRetainedFormAction<CashActionState>(createCashTypeAction, () => formRef.current?.reset());
  return (
    <form ref={formRef} onSubmit={onSubmit} className="px-5 py-4 border-t border-[var(--oc-line)] flex flex-col gap-2">
      <input type="hidden" name="direction" value={direction} />
      <FormError message={state && !state.ok ? (state.fieldErrors?.name ?? state.message) : undefined} />
      <div className="flex gap-2">
        <input
          name="name"
          type="text"
          required
          maxLength={60}
          placeholder="Шинэ ангиллын нэр"
          className="compact-input flex-1 min-w-0"
        />
        <Btn type="submit" size="sm" disabled={pending}>
          {pending ? "..." : "Нэмэх"}
        </Btn>
      </div>
    </form>
  );
}

function TypeItem({ type }: { type: TypeRow }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="px-5 py-3">
      {editing && !type.isSystem ? (
        <RenameForm type={type} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-sm flex-1 min-w-0 ${type.isActive ? "text-[var(--oc-ink2)]" : "text-[var(--oc-muted4)] line-through"}`}>
            {type.name}
          </span>
          {type.isSystem ? <Chip tone="neutral">Систем</Chip> : null}
          {!type.isActive ? <Chip tone="warn">Идэвхгүй</Chip> : null}
          {!type.isSystem ? (
            <>
              <Btn type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
                Нэр засах
              </Btn>
              <ToggleActiveForm type={type} />
            </>
          ) : null}
        </div>
      )}
    </li>
  );
}

function RenameForm({ type, onDone }: { type: TypeRow; onDone: () => void }) {
  const { state, pending, onSubmit } = useRetainedFormAction<CashActionState>(updateCashTypeAction, () => onDone());
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="typeId" value={type.id} />
      <FormError message={state && !state.ok ? (state.fieldErrors?.name ?? state.message) : undefined} />
      <div className="flex gap-2">
        <input name="name" type="text" required maxLength={60} defaultValue={type.name} className="compact-input flex-1 min-w-0" />
        <Btn type="submit" size="sm" disabled={pending}>
          {pending ? "..." : "Хадгалах"}
        </Btn>
        <Btn type="button" variant="ghost" size="sm" onClick={onDone}>
          Болих
        </Btn>
      </div>
    </form>
  );
}

function ToggleActiveForm({ type }: { type: TypeRow }) {
  const [state, formAction, pending] = useActionState<CashActionState, FormData>(updateCashTypeAction, null);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="typeId" value={type.id} />
      <input type="hidden" name="isActive" value={type.isActive ? "0" : "1"} />
      {state && !state.ok ? <span className="text-xs text-red-400 light:text-red-600">{state.message}</span> : null}
      <Btn type="submit" variant={type.isActive ? "danger" : "ghost"} size="sm" disabled={pending}>
        {type.isActive ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
      </Btn>
    </form>
  );
}
