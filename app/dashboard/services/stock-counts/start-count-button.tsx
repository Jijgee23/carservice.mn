"use client";

import { useActionState, useState } from "react";
import { startStockCountAction, type StockCountActionState } from "@/app/_actions/stock-counts";
import { Btn, FormError } from "@/app/_components/landing-ops-ui";
import { Modal } from "@/app/_components/modal";

/** «Тооллого эхлүүлэх»: scope (all active goods or one category) + note. Success redirects to the new count. */
export function StartCountButton({ categories }: { categories: Array<{ id: string; name: string; goodsCount: number }> }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<StockCountActionState, FormData>(startStockCountAction, null);
  const total = categories.reduce((n, c) => n + c.goodsCount, 0);

  return (
    <>
      <Btn type="button" size="md" onClick={() => setOpen(true)}>
        + Тооллого эхлүүлэх
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="Тооллого эхлүүлэх" widthClassName="max-w-md">
        <form action={formAction} className="flex flex-col gap-4 p-5">
          <FormError message={state && !state.ok ? state.message : undefined} />
          <p className="text-xs text-[var(--oc-muted3)]">
            Эхлүүлэх үеийн системийн үлдэгдэл хадгалагдана. Тоолсон тоог хадгалж явж болно; «Дуусгах» үед зөрүүгээр үлдэгдэл
            засагдана. Тооллогын явцад засварт зарцуулсан бараа алдагдахгүй.
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sc-category" className="text-sm font-medium text-[var(--oc-ink2)]">
              Хамрах хүрээ
            </label>
            <select id="sc-category" name="categoryId" defaultValue="" className="compact-input w-full">
              <option value="">Бүх идэвхтэй бараа{total ? ` (${total})` : ""}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.goodsCount})
                </option>
              ))}
            </select>
            {state?.fieldErrors?.categoryId ? <p className="text-xs text-red-400 light:text-red-600">{state.fieldErrors.categoryId}</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sc-note" className="text-sm font-medium text-[var(--oc-ink2)]">
              Тэмдэглэл <span className="font-normal text-[var(--oc-muted3)]">(заавал биш)</span>
            </label>
            <textarea id="sc-note" name="note" rows={2} maxLength={500} className="compact-input w-full" placeholder="Жишээ: Сарын эцсийн тооллого" />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Btn type="submit" size="md" disabled={pending}>
              {pending ? "Эхлүүлж байна…" : "Эхлүүлэх"}
            </Btn>
            <Btn type="button" variant="ghost" size="md" onClick={() => setOpen(false)}>
              Болих
            </Btn>
          </div>
        </form>
      </Modal>
    </>
  );
}
