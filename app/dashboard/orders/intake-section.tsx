"use client";

import { compressImage, COMPRESS_FAILED } from "@/lib/client/compress-image";
import { useEffect, useRef, useState } from "react";
import { stageIntakeFileAction } from "@/app/_actions/order-intake";
import { Field } from "@/app/_components/landing-ops-ui";
import { INTAKE_NOTES_MAX, INTAKE_PHOTOS_MAX, formatMileageKm } from "@/lib/orders/order-intake";
import {
  CHECKLIST_NOTE_MAX,
  CHECKLIST_STATUSES,
  CHECKLIST_STATUS_LABEL,
  type ChecklistItemDef,
  type ChecklistStatus,
} from "@/lib/orders/order-settings";

/** Tenant-ийн «нээх үеийн шаардлага» + шалгах жагсаалт (TenantOrderSettings). */
export type IntakeRules = {
  requireMileage: boolean;
  requireSignature: boolean;
  minIntakePhotos: number;
  requireChecklist: boolean;
  checklist: ChecklistItemDef[];
};

export const NO_INTAKE_RULES: IntakeRules = {
  requireMileage: false,
  requireSignature: false,
  minIntakePhotos: 0,
  requireChecklist: false,
  checklist: [],
};

/** Хүлээн авах хэсэгт заавал бөглөх зүйл байгаа эсэх. */
export function hasIntakeRequirements(r: IntakeRules): boolean {
  return r.requireMileage || r.requireSignature || r.minIntakePhotos > 0 || (r.requireChecklist && r.checklist.length > 0);
}

const Req = () => <span className="text-red-400"> *</span>;

// QA #14: захиалга үүсгэх үеийн «Хүлээн авах» хэсэг. Утгууд hidden input-ээр
// createOrderAction руу явна; үүссэний дараа бүрмөсөн түгжигдэнэ.

// Утасны том зургийг илгээхээс өмнө browser дээр жижигрүүлнэ (2MB хязгаар) —
// оношилгооны маягттай нэг функц.

async function stage(file: File): Promise<string> {
  const fd = new FormData();
  fd.set("file", file);
  const res = await stageIntakeFileAction(fd);
  if (!res.ok) throw new Error(res.message);
  return res.path;
}

export function IntakeSection({
  error,
  onBusyChange,
  className = "",
  rules = NO_INTAKE_RULES,
}: {
  error?: string;
  onBusyChange: (busy: boolean) => void;
  className?: string;
  rules?: IntakeRules;
}) {
  const required = hasIntakeRequirements(rules);
  // Заавал бөглөх зүйлтэй бол анхнаасаа нээлттэй.
  const [open, setOpen] = useState(required);
  const [checks, setChecks] = useState<Record<string, { status: ChecklistStatus | ""; note: string }>>({});
  const [notes, setNotes] = useState("");
  // Гүйлт: цифрийг тайлбартайгаар таслалаар бүлэглэнэ ("152,300"); илгээхдээ таслалгүй тоо.
  const [mileage, setMileage] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [savingSignature, setSavingSignature] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = uploading !== null || savingSignature;
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const room = INTAKE_PHOTOS_MAX - photos.length;
    const accepted = files.slice(0, Math.max(room, 0));
    const nextErrors: string[] = [];
    if (files.length > accepted.length) {
      nextErrors.push(`Хамгийн ихдээ ${INTAKE_PHOTOS_MAX} зураг — ${files.length - accepted.length} файл алгасав.`);
    }
    setUploading({ done: 0, total: accepted.length });
    for (const [i, file] of accepted.entries()) {
      try {
        const path = await stage(await compressImage(file));
        setPhotos((prev) => [...prev, path]);
      } catch (err) {
        const message = err instanceof Error && err.message !== COMPRESS_FAILED ? err.message : "зургийг уншиж чадсангүй.";
        nextErrors.push(`${file.name}: ${message}`);
      }
      setUploading({ done: i + 1, total: accepted.length });
    }
    setUploading(null);
    setErrors(nextErrors);
  }

  async function onSignatureSaved(blob: Blob) {
    setSavingSignature(true);
    try {
      setSignature(await stage(new File([blob], "signature.png", { type: "image/png" })));
      setErrors([]);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "Гарын үсэг хадгалж чадсангүй."]);
    } finally {
      setSavingSignature(false);
    }
  }

  const mileageDigits = mileage.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const answered = rules.checklist.filter((c) => checks[c.id]?.status);
  const summary = [
    mileageDigits ? formatMileageKm(Number(mileageDigits)) : null,
    notes.trim() ? "тэмдэглэл" : null,
    photos.length > 0 ? `${photos.length} зураг` : null,
    signature ? "гарын үсэг" : null,
    answered.length > 0 ? `шалгах жагсаалт ${answered.length}/${rules.checklist.length}` : null,
  ].filter(Boolean);
  const requiredLabels = [
    rules.requireMileage ? "гүйлт" : null,
    rules.minIntakePhotos > 0 ? `${rules.minIntakePhotos}+ зураг` : null,
    rules.requireSignature ? "гарын үсэг" : null,
    rules.requireChecklist && rules.checklist.length > 0 ? "шалгах жагсаалт" : null,
  ].filter(Boolean);
  const checklistValue = JSON.stringify(
    answered.map((c) => ({
      id: c.id,
      status: checks[c.id]!.status,
      ...(checks[c.id]!.note.trim() ? { note: checks[c.id]!.note.trim() } : {}),
    })),
  );
  function setCheck(id: string, patch: Partial<{ status: ChecklistStatus | ""; note: string }>) {
    setChecks((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { status: "", note: "" }), ...patch } }));
  }
  const allErrors = [...(error ? [error] : []), ...errors];

  return (
    <div className={`min-w-0 flex flex-col gap-3 ${className}`}>
      {/* Хаасан ч бичсэн зүйл илгээгдэнэ — санамсаргүй алдахгүйн тулд. */}
      <input type="hidden" name="intakeNotes" value={notes} />
      <input type="hidden" name="intakeMileageKm" value={mileageDigits} />
      {photos.map((p) => (
        <input key={p} type="hidden" name="intakePhotoPaths" value={p} />
      ))}
      {signature ? <input type="hidden" name="intakeSignaturePath" value={signature} /> : null}
      {answered.length > 0 ? <input type="hidden" name="intakeChecklist" value={checklistValue} /> : null}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded-md border border-[var(--oc-line)] px-3 py-1.5 text-sm font-medium text-[var(--oc-ink2)] hover:bg-[var(--oc-line2)]"
        >
          {open ? "▾" : "▸"} Хүлээн авах
        </button>
        <span className="text-xs text-[var(--oc-muted3)]">
          {summary.length > 0
            ? `Бүртгэсэн: ${summary.join(", ")}`
            : required
              ? `Заавал: ${requiredLabels.join(", ")}. Үүсгэсний дараа засах боломжгүй.`
              : "Машины одоогийн байдал (заавал биш). Үүсгэсний дараа засах боломжгүй."}
        </span>
      </div>

      {open ? (
        <div className="flex flex-col gap-4 rounded-[10px] border border-[var(--oc-line)] p-4">
          <div className="w-40">
            <Field label={<>Гүйлт (км){rules.requireMileage ? <Req /> : null}</>} htmlFor="intakeMileageInput">
              <input
                id="intakeMileageInput"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={mileage}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 7);
                  setMileage(digits.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
                }}
                className="auth-input"
                placeholder="152,300"
              />
            </Field>
          </div>
          {rules.checklist.length > 0 ? (
            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium text-[var(--oc-muted2)]">
                Шалгах жагсаалт{rules.requireChecklist ? <Req /> : null}
                <span className="ml-2 font-normal text-[var(--oc-muted3)]">
                  {answered.length}/{rules.checklist.length}
                </span>
              </div>
              <ul className="flex flex-col divide-y divide-[var(--oc-line)] rounded-md border border-[var(--oc-line)]">
                {rules.checklist.map((c) => {
                  const cur = checks[c.id];
                  return (
                    <li key={c.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center">
                      <span className="flex-1 text-sm text-[var(--oc-ink2)]">{c.label}</span>
                      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={c.label}>
                        {CHECKLIST_STATUSES.map((st) => {
                          const on = cur?.status === st;
                          const tone =
                            st === "ISSUE"
                              ? "border-red-500/60 bg-red-500/10 text-red-400"
                              : st === "OK"
                                ? "border-[var(--oc-ok)] bg-[var(--oc-ok)]/10 text-[var(--oc-ok)]"
                                : "border-[var(--oc-line2)] bg-[var(--oc-line2)]/40 text-[var(--oc-ink2)]";
                          return (
                            <button
                              key={st}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              onClick={() => setCheck(c.id, { status: on ? "" : st })}
                              className={`rounded-md border px-2.5 py-1 text-xs ${on ? tone : "border-[var(--oc-line)] text-[var(--oc-muted2)] hover:bg-[var(--oc-line2)]"}`}
                            >
                              {CHECKLIST_STATUS_LABEL[st]}
                            </button>
                          );
                        })}
                      </div>
                      {cur?.status === "ISSUE" ? (
                        <input
                          type="text"
                          maxLength={CHECKLIST_NOTE_MAX}
                          value={cur.note}
                          onChange={(e) => setCheck(c.id, { note: e.target.value })}
                          placeholder="Тэмдэглэл"
                          className="auth-input sm:max-w-56"
                          aria-label={`${c.label} — тэмдэглэл`}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <Field label="Тэмдэглэл" htmlFor="intakeNotesInput" hint="гүйлт, шатахуун, гэмтэл, үлдээсэн эд зүйл…">
            <textarea
              id="intakeNotesInput"
              rows={5}
              maxLength={INTAKE_NOTES_MAX}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="auth-input resize-y"
              placeholder="Жишээ: 152,300 км, шатахуун 1/4, урд баруун хаалга зурагдсан..."
            />
          </Field>

          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-[var(--oc-muted2)]">
              Зураг
              {rules.minIntakePhotos > 0 ? (
                <>
                  {` (хамгийн багадаа ${rules.minIntakePhotos})`}
                  <Req />
                </>
              ) : null}
            </div>
            {photos.length > 0 ? (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {photos.map((p) => (
                  <div key={p} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- /uploads нь runtime файл */}
                    <img
                      src={p}
                      alt="Хүлээн авах зураг"
                      className="aspect-square w-full rounded-md object-cover border border-[var(--oc-line)]"
                    />
                    <button
                      type="button"
                      onClick={() => setPhotos((prev) => prev.filter((x) => x !== p))}
                      aria-label="Зураг хасах"
                      className="absolute top-1 right-1 rounded bg-black/60 px-1.5 text-xs text-white hover:bg-red-600"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex items-center gap-3 flex-wrap">
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onPick} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading !== null || photos.length >= INTAKE_PHOTOS_MAX}
                className="rounded-md border border-[var(--oc-line)] px-3 py-1.5 text-sm text-[var(--oc-ink2)] hover:bg-[var(--oc-line2)] disabled:opacity-50"
              >
                {uploading ? `Илгээж байна… ${uploading.done}/${uploading.total}` : "+ Зураг нэмэх"}
              </button>
              <span className="text-xs text-[var(--oc-muted3)]">
                {photos.length}/{INTAKE_PHOTOS_MAX} · автоматаар жижигрүүлнэ
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-[var(--oc-muted2)]">
              Үйлчлүүлэгчийн гарын үсэг{rules.requireSignature ? <Req /> : null}
            </div>
            {signature ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- /uploads нь runtime файл */}
                <img src={signature} alt="Гарын үсэг" className="h-20 rounded-md border border-[var(--oc-line)] bg-white" />
                <button type="button" onClick={() => setSignature(null)} className="text-xs text-[var(--oc-muted2)] underline">
                  Дахин зурах
                </button>
              </div>
            ) : (
              <SignaturePad onSave={onSignatureSaved} saving={savingSignature} />
            )}
          </div>
        </div>
      ) : null}

      {allErrors.length > 0 ? (
        <ul className="text-xs text-red-500 flex flex-col gap-0.5">
          {allErrors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SignaturePad({ onSave, saving }: { onSave: (blob: Blob) => void; saving: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current!.getContext("2d")!;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setDirty(true);
  }

  function stop() {
    drawing.current = false;
  }

  function clear() {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setDirty(false);
  }

  function save() {
    canvasRef.current!.toBlob((blob) => {
      if (blob) onSave(blob);
    }, "image/png");
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={600}
        height={200}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={stop}
        onPointerLeave={stop}
        className="w-full max-w-sm aspect-[3/1] rounded-md border border-[var(--oc-line)] bg-white touch-none cursor-crosshair"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-md border border-[var(--oc-line)] px-3 py-1 text-sm text-[var(--oc-ink2)] hover:bg-[var(--oc-line2)] disabled:opacity-50"
        >
          {saving ? "Хадгалж байна…" : "Гарын үсэг хадгалах"}
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={!dirty || saving}
          className="text-xs text-[var(--oc-muted2)] underline disabled:opacity-50"
        >
          Арилгах
        </button>
      </div>
    </div>
  );
}
