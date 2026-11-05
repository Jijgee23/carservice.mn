"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlusIcon } from "@/app/_components/landing-ops-ui";
import { InlineAccountVehicleForm } from "./inline-account-vehicle-form";

export function AddAccountVehicle() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--oc-line)] bg-[var(--oc-panel)]/60 px-4 py-5 text-sm font-semibold text-[var(--oc-muted)] transition-colors hover:border-[var(--oc-accent)]/60 hover:bg-[var(--oc-accent)]/5 hover:text-[var(--oc-accent)]"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--oc-panel2)] transition-colors group-hover:bg-[var(--oc-accent)] group-hover:text-[var(--oc-on-accent)]">
          <PlusIcon />
        </span>
        Машин нэмэх
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-5">
      <div className="mb-3 text-base font-semibold text-[var(--oc-ink)]">
        Шинэ машин нэмэх
      </div>
      <InlineAccountVehicleForm
        onCreated={() => {
          setOpen(false);
          router.refresh();
        }}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}
