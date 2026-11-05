"use client";

import { useActionState, useEffect, useRef } from "react";
import { type ChooseBranchState, chooseBranchAction } from "@/app/_actions/auth";
import { FormError } from "@/app/_components/landing-ops-ui";
import { ALL_BRANCHES } from "@/lib/auth/session";

export type BranchOption = {
  id: string;
  name: string;
  city: string | null;
  district: string | null;
  address: string | null;
  openTime: string | null;
  closeTime: string | null;
};

export function ChooseBranchForm({
  branches,
  allowAllBranches,
  next,
}: {
  branches: BranchOption[];
  allowAllBranches: boolean;
  next: string;
}) {
  const [state, formAction, pending] = useActionState<
    ChooseBranchState,
    FormData
  >(chooseBranchAction, null);

  // Сонгох салбар ганцхан бол (өмнөх session-тэй орж ирсэн үед) хуудсыг
  // алгасаж шууд сонгоно — «Бүх салбар» нэг салбартай үед ялгаагүй.
  // Нэвтрэх үед ихэвчлэн аль хэдийн оноогддог (lib/auth/initial-working-branch.ts).
  const single = branches.length === 1;
  const autoRef = useRef<HTMLFormElement>(null);
  const autoSent = useRef(false);
  useEffect(() => {
    if (single && !autoSent.current && autoRef.current) {
      autoSent.current = true;
      autoRef.current.requestSubmit();
    }
  }, [single]);

  if (single && !(state && !state.ok)) {
    return (
      <form ref={autoRef} action={formAction} className="py-6 text-center text-sm text-[var(--oc-muted3)]">
        <input type="hidden" name="branchId" value={branches[0].id} />
        <input type="hidden" name="next" value={next} />
        {branches[0].name} руу орж байна…
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FormError message={state && !state.ok ? state.message : undefined} />

      <div className="grid gap-3 sm:grid-cols-2">
        {branches.map((b) => {
          const detail = [b.district, b.address].filter(Boolean).join(" · ");
          return (
            <form key={b.id} action={formAction}>
              <input type="hidden" name="branchId" value={b.id} />
              <input type="hidden" name="next" value={next} />
              <button
                type="submit"
                disabled={pending}
                className="w-full h-full text-left rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] hover:border-[var(--oc-accent)]/50 hover:bg-[var(--oc-panel2)] transition-colors p-4 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="font-semibold text-[var(--oc-ink)]">{b.name}</div>
                {detail ? (
                  <div className="mt-1 text-xs text-[var(--oc-muted3)]">{detail}</div>
                ) : null}
                {b.openTime && b.closeTime ? (
                  <div className="mt-1.5 font-plex-mono text-[11px] text-[var(--oc-muted3)]">
                    {b.openTime}–{b.closeTime}
                  </div>
                ) : null}
              </button>
            </form>
          );
        })}

        {allowAllBranches ? (
          <form action={formAction}>
            <input type="hidden" name="branchId" value={ALL_BRANCHES} />
            <input type="hidden" name="next" value={next} />
            <button
              type="submit"
              disabled={pending}
              className="w-full h-full text-left rounded-[10px] border border-dashed border-[var(--oc-accent)]/40 bg-[var(--oc-accent)]/[0.05] hover:bg-[var(--oc-accent)]/[0.1] transition-colors p-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="font-semibold text-[var(--oc-accent)]">Бүх салбар</div>
              <div className="mt-1 text-xs text-[var(--oc-muted3)]">
                Бүх салбарын өгөгдлийг нэгэн зэрэг харах
              </div>
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
