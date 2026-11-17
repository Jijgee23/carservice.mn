"use client";

import { useActionState, useMemo, useState } from "react";
import {
  type OrderSettingsActionState,
  updateOrderSettingsAction,
} from "@/app/_actions/order-settings";
import { Field, FormError } from "@/app/_components/auth-shell";
import { Btn } from "@/app/_components/landing-ops-ui";
import {
  CHECKLIST_LABEL_MAX,
  CHECKLIST_MAX_ITEMS,
  INTAKE_PHOTOS_REQUIRED_MAX,
  NUMBER_PADDING_MAX,
  NUMBER_PADDING_MIN,
  NUMBER_PREFIX_MAX,
  PRINT_FOOTER_NOTE_MAX,
  PRINT_HEADER_NOTE_MAX,
  formatOrderNumber,
  type ChecklistItemDef,
  type OrderSettings,
} from "@/lib/orders/order-settings";

function Section({
  index,
  title,
  description,
  children,
}: {
  index: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="font-semibold text-[var(--oc-ink)]">{title}</h2>
          {description ? <p className="text-xs text-[var(--oc-muted3)] mt-0.5">{description}</p> : null}
        </div>
        <span className="font-plex-mono text-[11px] text-[var(--oc-muted3)] shrink-0">
          {String(index).padStart(2, "0")} / 05
        </span>
      </div>
      {children}
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  title,
  description,
  error,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  description?: string;
  error?: string;
}) {
  return (
    <div>
      <label
        className={`flex items-start gap-3 p-3.5 rounded-[10px] border cursor-pointer transition-colors ${
          checked
            ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/[0.08]"
            : "border-[var(--oc-line)] bg-[var(--oc-panel2)] hover:border-[var(--oc-line2)]"
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 accent-[var(--oc-accent)]"
        />
        <span className="flex-1">
          <span className="block text-sm font-medium text-[var(--oc-ink2)]">{title}</span>
          {description ? <span className="block text-xs text-[var(--oc-muted3)] mt-0.5">{description}</span> : null}
        </span>
      </label>
      {error ? <p className="mt-1 text-xs text-red-400 light:text-red-600">{error}</p> : null}
    </div>
  );
}

let tmpSeq = 0;
const tmpId = () => `new${Date.now().toString(36)}${(tmpSeq++).toString(36)}`;

export function OrderSettingsForm({
  initial,
  year,
  canCloseUnpaidLabel,
}: {
  initial: OrderSettings;
  year: number;
  /** Төлбөр дутуу хаах эрхийн нэр (тайлбарт). */
  canCloseUnpaidLabel: string;
}) {
  const [state, formAction, pending] = useActionState<OrderSettingsActionState, FormData>(
    updateOrderSettingsAction,
    null,
  );
  const [s, setS] = useState<OrderSettings>(initial);
  const [dirty, setDirty] = useState(false);
  const set = <K extends keyof OrderSettings>(k: K, v: OrderSettings[K]) => {
    setDirty(true);
    setS((prev) => ({ ...prev, [k]: v }));
  };
  const fe = state?.fieldErrors ?? {};

  const sample = useMemo(() => {
    const pad = Math.min(Math.max(Number(s.numberPadding) || NUMBER_PADDING_MIN, NUMBER_PADDING_MIN), NUMBER_PADDING_MAX);
    return formatOrderNumber({ ...s, numberPadding: pad }, 1, year);
  }, [s, year]);

  function updateItem(i: number, label: string) {
    const next = [...s.intakeChecklist];
    next[i] = { ...next[i], label };
    set("intakeChecklist", next);
  }
  function moveItem(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= s.intakeChecklist.length) return;
    const next = [...s.intakeChecklist];
    [next[i], next[j]] = [next[j], next[i]];
    set("intakeChecklist", next);
  }
  function removeItem(i: number) {
    set("intakeChecklist", s.intakeChecklist.filter((_, k) => k !== i));
  }
  function addItem() {
    if (s.intakeChecklist.length >= CHECKLIST_MAX_ITEMS) return;
    set("intakeChecklist", [...s.intakeChecklist, { id: tmpId(), label: "" } as ChecklistItemDef]);
  }

  return (
    <form
      action={(fd) => {
        fd.set("settings", JSON.stringify(s));
        setDirty(false);
        formAction(fd);
      }}
      className="flex flex-col gap-5"
      noValidate
    >
      {state?.ok && state.message && !dirty ? (
        <div className="bg-[var(--oc-ok)]/10 border border-[var(--oc-ok)]/25 rounded-lg px-3 py-2 text-sm text-[var(--oc-ok)]">
          {state.message}
        </div>
      ) : null}
      <FormError message={state?.message && !state.ok ? state.message : undefined} />

      <Section index={1} title="Дугаарлалт" description="Шинээр нээх засварын хуудасны дугаарын хэлбэр. Өмнөх дугаарууд өөрчлөгдөхгүй.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Угтвар" htmlFor="numberPrefix" error={fe.numberPrefix} hint={`≤${NUMBER_PREFIX_MAX} тэмдэгт, хоосон байж болно`}>
            <input
              id="numberPrefix"
              type="text"
              maxLength={NUMBER_PREFIX_MAX}
              value={s.numberPrefix}
              onChange={(e) => set("numberPrefix", e.target.value)}
              placeholder="ж: ZS-"
              className={`auth-input ${fe.numberPrefix ? "border-red-500/50" : ""}`}
            />
          </Field>
          <Field label="Дарааллын оронгийн тоо" htmlFor="numberPadding" error={fe.numberPadding}>
            <input
              id="numberPadding"
              type="number"
              min={NUMBER_PADDING_MIN}
              max={NUMBER_PADDING_MAX}
              value={s.numberPadding}
              onChange={(e) => set("numberPadding", Number(e.target.value))}
              className={`auth-input ${fe.numberPadding ? "border-red-500/50" : ""}`}
            />
          </Field>
          <div className="flex flex-col justify-end">
            <div className="text-xs text-[var(--oc-muted3)] mb-1">Жишээ</div>
            <div className="font-plex-mono text-lg text-[var(--oc-ink)]">{sample}</div>
          </div>
        </div>
        <div className="mt-4 max-w-xl">
          <Toggle
            checked={s.numberIncludeYear}
            onChange={(v) => set("numberIncludeYear", v)}
            title="Он оруулах"
            description="Дугаарт оныг оруулж, жил бүр 1-ээс эхэлнэ. Асаах/унтраахад дараалал шинээр тооцогдоно."
          />
        </div>
      </Section>

      <Section index={2} title="Нээх үеийн шаардлага" description="Засварын хуудас нээхэд заавал бөглөх зүйлс (вэб болон апп хоёуланд).">
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle checked={s.requireAssignee} onChange={(v) => set("requireAssignee", v)} title="Хариуцагч заавал" description="Нээхдээ хариуцах мастерыг сонгоно." />
          <Toggle checked={s.requireMileage} onChange={(v) => set("requireMileage", v)} title="Гүйлт (км) заавал" description="Хүлээн авах үеийн одометрийн заалт." />
          <Toggle checked={s.requireSignature} onChange={(v) => set("requireSignature", v)} title="Үйлчлүүлэгчийн гарын үсэг заавал" />
          <Toggle
            checked={s.requireChecklist}
            onChange={(v) => set("requireChecklist", v)}
            title="Шалгах жагсаалт заавал"
            description="Доорх жагсаалтын бүх мөрийг бөглөнө."
            error={fe.requireChecklist}
          />
        </div>
        <div className="mt-4 max-w-xs">
          <Field label="Хүлээн авалтын зураг (хамгийн багадаа)" htmlFor="minIntakePhotos" error={fe.minIntakePhotos} hint="0 = заавал биш">
            <input
              id="minIntakePhotos"
              type="number"
              min={0}
              max={INTAKE_PHOTOS_REQUIRED_MAX}
              value={s.minIntakePhotos}
              onChange={(e) => set("minIntakePhotos", Number(e.target.value))}
              className={`auth-input ${fe.minIntakePhotos ? "border-red-500/50" : ""}`}
            />
          </Field>
        </div>
      </Section>

      <Section
        index={3}
        title="Хүлээн авалтын шалгах жагсаалт"
        description="Машин хүлээн авахдаа мөр бүрт Хэвийн / Асуудалтай / Хамаарахгүй сонгож, тэмдэглэл бичнэ. Хэвлэх хуудсанд гарна."
      >
        {fe.intakeChecklist ? <p className="mb-3 text-xs text-red-400 light:text-red-600">{fe.intakeChecklist}</p> : null}
        {s.intakeChecklist.length === 0 ? (
          <p className="mb-3 text-sm text-[var(--oc-muted3)]">Жагсаалт хоосон — хүлээн авах үед харагдахгүй.</p>
        ) : (
          <ol className="mb-3 flex flex-col gap-2">
            {s.intakeChecklist.map((item, i) => (
              <li key={item.id} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-right font-plex-mono text-xs text-[var(--oc-muted3)]">{i + 1}.</span>
                <input
                  type="text"
                  maxLength={CHECKLIST_LABEL_MAX}
                  value={item.label}
                  onChange={(e) => updateItem(i, e.target.value)}
                  placeholder="ж: Тосны түвшин"
                  className="auth-input flex-1"
                  aria-label={`Мөр ${i + 1}`}
                />
                <button type="button" onClick={() => moveItem(i, -1)} disabled={i === 0} className="px-2 py-1 text-sm text-[var(--oc-muted2)] disabled:opacity-30" aria-label="Дээш">↑</button>
                <button type="button" onClick={() => moveItem(i, 1)} disabled={i === s.intakeChecklist.length - 1} className="px-2 py-1 text-sm text-[var(--oc-muted2)] disabled:opacity-30" aria-label="Доош">↓</button>
                <button type="button" onClick={() => removeItem(i)} className="px-2 py-1 text-xs text-red-400 hover:text-red-300 light:text-red-600" aria-label="Устгах">Устгах</button>
              </li>
            ))}
          </ol>
        )}
        <Btn type="button" variant="ghost" size="sm" onClick={addItem} disabled={s.intakeChecklist.length >= CHECKLIST_MAX_ITEMS}>
          + Мөр нэмэх
        </Btn>
      </Section>

      <Section index={4} title="Хаах" description="Засварын хуудсыг «Дууссан» болгохын өмнөх шаардлага.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            checked={s.requireDiagnosticsFilled}
            onChange={(v) => set("requireDiagnosticsFilled", v)}
            title="Оношилгоо бүрэн бөглөгдсөн байх"
            description="Унтраавал бөглөөгүй оношилгоотой ч хаана."
          />
          <Toggle
            checked={s.requireItemsCompleted}
            onChange={(v) => set("requireItemsCompleted", v)}
            title="Бүх ажил дууссан байх"
            description="Унтраавал хаах үед дуусаагүй ажлууд автоматаар «Дууссан» болно."
          />
          <Toggle
            checked={s.allowCloseUnpaid}
            onChange={(v) => set("allowCloseUnpaid", v)}
            title="Төлбөр дутуу засварыг хаахыг зөвшөөрөх"
            description={`Зөвхөн «${canCloseUnpaidLabel}» эрхтэй ажилтан хаана; үлдэгдэл нь дараа төлбөрт (авлага) болно.`}
          />
        </div>
      </Section>

      <Section index={5} title="Хэвлэх загвар" description="Засварын хуудас хэвлэхэд хэрэглэгдэнэ.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Анхдагч хэмжээ" htmlFor="printFormat" error={fe.printFormat}>
            <select
              id="printFormat"
              value={s.printFormat}
              onChange={(e) => set("printFormat", e.target.value as OrderSettings["printFormat"])}
              className="auth-input"
            >
              <option value="a4">A4</option>
              <option value="80mm">80мм (чек)</option>
            </select>
          </Field>
        </div>
        <div className="mt-4 grid gap-4">
          <Field label="Толгойн тэмдэглэл" htmlFor="printHeaderNote" error={fe.printHeaderNote} hint={`Гарчгийн доор · ≤${PRINT_HEADER_NOTE_MAX}`}>
            <textarea
              id="printHeaderNote"
              rows={2}
              maxLength={PRINT_HEADER_NOTE_MAX}
              value={s.printHeaderNote ?? ""}
              onChange={(e) => set("printHeaderNote", e.target.value)}
              className="auth-input"
              placeholder="ж: Ажлын цаг 09:00–19:00 · Утас 7700-0000"
            />
          </Field>
          <Field label="Доод тэмдэглэл (нөхцөл, баталгаа)" htmlFor="printFooterNote" error={fe.printFooterNote} hint={`≤${PRINT_FOOTER_NOTE_MAX}`}>
            <textarea
              id="printFooterNote"
              rows={4}
              maxLength={PRINT_FOOTER_NOTE_MAX}
              value={s.printFooterNote ?? ""}
              onChange={(e) => set("printFooterNote", e.target.value)}
              className="auth-input"
              placeholder="ж: Хийгдсэн ажилд 30 хоногийн баталгаа олгоно. Сэлбэг буцаалтгүй."
            />
          </Field>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Toggle checked={s.printSignatureLines} onChange={(v) => set("printSignatureLines", v)} title="Гарын үсгийн мөр" description="«Хүлээлгэн өгсөн / Хүлээн авсан»." />
          <Toggle checked={s.printShowChecklist} onChange={(v) => set("printShowChecklist", v)} title="Шалгах жагсаалтыг хэвлэх" />
        </div>
      </Section>

      <div className="sticky bottom-0 z-10 flex items-center gap-3 pt-3 pb-3 -mb-1 border-t border-[var(--oc-line2)] bg-[var(--oc-carbon)]/95 backdrop-blur-md">
        <span className="text-xs text-[var(--oc-muted3)] flex-1">{dirty ? "Хадгалагдаагүй өөрчлөлт байна" : ""}</span>
        <Btn type="submit" disabled={pending}>
          {pending ? "..." : "Хадгалах"}
        </Btn>
      </div>
    </form>
  );
}
