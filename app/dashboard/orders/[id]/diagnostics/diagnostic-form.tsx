"use client";

import Link from "next/link";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  createReportAction,
  startDiagnosticItemAction,
  type ReportActionState,
} from "@/app/_actions/diagnostic-reports";
import { Field, FormError, SubmitButton } from "@/app/_components/auth-shell";
import { compressFormDataImages } from "@/lib/client/compress-image";
import {
  CHECK_TONE_ACCENT,
  CHECK_TONE_CHIP,
  checkOptionTone,
  isItemVisible,
  itemPositions,
  positionedKey,
  type TemplateItem,
  type TemplateSchema,
} from "@/lib/diagnostics";

// "Бүгдийг тэмдэглэх" товчоор санал болгох check сонголтууд.
const BULK_OPTIONS = ["Хэвийн", "Анхаарах"];

export function DiagnosticForm({
  orderId,
  itemId,
  templateId,
  templateName,
  schema,
  backHref,
}: {
  orderId: string;
  itemId?: string;
  templateId: string;
  templateName: string;
  schema: TemplateSchema;
  backHref: string;
}) {
  const [state, formAction, pending] = useActionState<
    ReportActionState,
    FormData
  >(createReportAction, null);

  // Check item-уудын одоогийн утгуудыг хадгалаад showWhen-ийг үнэлэхэд хэрэглэнэ.
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Асуултын үгээр хайх — олон бүлэгтэй урт загварт хурдан олоход. Тохирохгүй
  // мөр/бүлгийг DOM-оос устгахгүй, зөвхөн CSS-ээр (`hidden`) нуудаг — учир нь
  // аль хэдийн бичсэн хариулт (input) DOM-оос уствал алдагдана.
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  function setAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  const formRef = useRef<HTMLFormElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Тухайн бүлгийн "check" төрлийн бүх мөрийг (байрлал бүрийг оролцуулан)
  // нэг л сонголт руу шууд шилжүүлнэ — өдөр тутам ихэнх мөр "Хэвийн" байдаг
  // тул мөр бүрийг тус тусад нь дарах шаардлагагүй болгоно. Уугуул radio
  // input тул DOM-оор шууд тэмдэглэж, React-ийн onChange (showWhen-д
  // ашиглагддаг) хэвийн ажиллуулахын тулд жинхэнэ "change" event илгээнэ.
  function markSection(sectionId: string, value: string) {
    markContainer(sectionRefs.current[sectionId], value);
  }

  // Загварын БҮХ бүлгийн check мөрийг нэг дор тэмдэглэнэ (бүлэг тус бүрийн
  // товч хэвээр — зөвхөн тухайн бүлэгт үйлчилнэ).
  function markAll(value: string) {
    for (const container of Object.values(sectionRefs.current)) {
      markContainer(container, value);
    }
  }

  function markContainer(container: HTMLDivElement | null, value: string) {
    if (!container) return;
    const radios = container.querySelectorAll<HTMLInputElement>(
      `input[type="radio"][value="${CSS.escape(value)}"]`,
    );
    radios.forEach((radio) => {
      if (radio.checked) return;
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  // Бүх харагдаж буй бүлгийн check мөрүүдэд ашиглагдаж буй сонголтуудаас
  // "бүгдийг тэмдэглэх" товч гаргана (бүлгийн товчтой ижил дүрэм).
  const allCheckOptions = new Set<string>();
  for (const section of schema.sections) {
    for (const it of section.items) {
      if (it.type === "check" && isItemVisible(it, answers)) {
        for (const opt of it.options ?? []) allCheckOptions.add(opt);
      }
    }
  }
  const globalBulkOptions = BULK_OPTIONS.filter((o) => allCheckOptions.has(o));

  // Анхны хариулт өгөх мөчид мөрийг автоматаар "Эхэлсэн" болгоно (нэг л
  // удаа). Хайлтын input нь хариулт биш тул тоолохгүй. Тайлан хадгалахад
  // сервер мөрийг "Дууссан" болгоно (createReportAction).
  const startedRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  function handleFormChange(e: React.FormEvent<HTMLFormElement>) {
    if (!itemId || startedRef.current) return;
    if (e.target === searchRef.current) return;
    startedRef.current = true;
    startTransition(() => startDiagnosticItemAction(orderId, itemId));
  }

  // Алдааны мессежийг харагдуулахын тулд form-ын эхэнд гүйлгэнэ.
  useEffect(() => {
    if (state && !state.ok && state.message) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [state]);

  // action prop ашиглавал React 19 action дууссаны дараа form-ыг reset хийж
  // бөглөсөн хариултууд арилдаг. onSubmit-ээр гардан дамжуулбал алдаа буцахад
  // input-уудын утга хэвээр үлдэнэ.
  const [compressing, setCompressing] = useState(false);
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Утасны камерын зураг 2MB/хүсэлт 4MB хязгаарт унахаас сэргийлж шахна.
    setCompressing(true);
    try {
      await compressFormDataImages(fd);
    } finally {
      setCompressing(false);
    }
    startTransition(() => formAction(fd));
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      onChange={handleFormChange}
      className="flex flex-col gap-6"
      noValidate
    >
      <input type="hidden" name="orderId" value={orderId} />
      {itemId ? <input type="hidden" name="itemId" value={itemId} /> : null}
      <input type="hidden" name="templateId" value={templateId} />

      <FormError message={state?.message} />

      <div className="glass rounded-2xl px-5 py-4 border border-white/[0.08] flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-white/40">Загвар</div>
          <div className="text-sm font-medium text-white/90">{templateName}</div>
        </div>
        {globalBulkOptions.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">Бүх асуултыг:</span>
            {globalBulkOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => markAll(opt)}
                className="text-xs px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/70 hover:text-white/90 transition-colors"
              >
                {opt}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="relative">
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          placeholder="Асуултаар хайх..."
          className="auth-input pr-9"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Хайлт цэвэрлэх"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors text-xs"
          >
            ✕
          </button>
        ) : null}
      </div>

      {q && !schema.sections.some((section) =>
        section.items
          .filter((it) => isItemVisible(it, answers))
          .some((it) => it.label.toLowerCase().includes(q)),
      ) ? (
        <div className="text-sm text-white/40 text-center py-4">
          «{query}» гэсэн асуулт олдсонгүй.
        </div>
      ) : null}

      {schema.sections.map((section) => {
        const visibleItems = section.items.filter((it) =>
          isItemVisible(it, answers),
        );
        if (visibleItems.length === 0) return null;
        const sectionMatches =
          !q || visibleItems.some((it) => it.label.toLowerCase().includes(q));
        // Бүлэгт байгаа "check" мөрүүдийн options-оос давхцалгүй цуглуулж,
        // зөвхөн бодитоор ашиглагдаж буй сонголтуудад (ихэвчлэн Хэвийн/
        // Анхаарах) л "бүгдийг тэмдэглэх" товч харуулна.
        const checkOptions = new Set<string>();
        for (const it of visibleItems) {
          if (it.type === "check") {
            for (const opt of it.options ?? []) checkOptions.add(opt);
          }
        }
        const bulkOptions = BULK_OPTIONS.filter((o) =>
          checkOptions.has(o),
        );
        return (
          <section
            key={section.id}
            className={`glass rounded-2xl p-5 sm:p-6 border border-white/[0.08] flex flex-col gap-4 ${sectionMatches ? "" : "hidden"}`}
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-semibold">{section.title}</h2>
              {bulkOptions.length > 0 ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/40">Бүгдийг:</span>
                  {bulkOptions.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => markSection(section.id, opt)}
                      className="text-xs px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/70 hover:text-white/90 transition-colors"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div
              ref={(el) => {
                sectionRefs.current[section.id] = el;
              }}
              className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 items-start"
            >
              {visibleItems.map((item) => {
                const positioned = Boolean(itemPositions(item));
                const itemMatches =
                  !q || item.label.toLowerCase().includes(q);
                return (
                  <div
                    key={item.id}
                    className={`${positioned ? "md:col-span-2 2xl:col-span-3" : ""} ${itemMatches ? "" : "hidden"}`}
                  >
                    <ItemControl
                      item={item}
                      onCheckChange={(v) => setAnswer(item.id, v)}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="glass rounded-2xl p-5 sm:p-6 border border-white/[0.08] flex flex-col gap-3">
        <Field label="Үйлчлүүлэгчийн гарын үсэг (зураг сонгох)" htmlFor="signature">
          <input
            id="signature"
            name="signature"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="block w-full text-sm text-white/60 file:mr-3 file:rounded-lg file:border-0 file:bg-white/[0.08] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white/80 hover:file:bg-white/[0.12] file:cursor-pointer"
          />
          <p className="text-xs text-white/40 mt-1.5">
            PNG, JPG, WEBP · утасны зургийг автоматаар жижигрүүлнэ
          </p>
        </Field>
      </section>

      <div className="flex gap-3">
        <Link
          href={backHref}
          className="flex-1 glass hover:bg-white/[0.08] transition-all py-3 rounded-xl font-semibold text-sm text-white/60 text-center"
        >
          ← Цуцлах
        </Link>
        <div className="flex-1">
          <SubmitButton pending={pending || compressing}>Тайлан хадгалах</SubmitButton>
        </div>
      </div>
    </form>
  );
}

function ItemControl({
  item,
  onCheckChange,
}: {
  item: TemplateItem;
  onCheckChange: (value: string) => void;
}) {
  const positions = itemPositions(item);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm font-medium text-white/80">
        <span>{item.label}</span>
        {item.required ? (
          <span className="text-red-400 text-xs light:text-red-600">*</span>
        ) : null}
      </div>

      {positions ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {positions.map((pos) => (
            <div
              key={pos.code}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 flex flex-col gap-2"
            >
              <div className="text-xs font-medium text-white/55">
                {pos.label}
              </div>
              <FieldInputs item={item} fieldId={positionedKey(item.id, pos.code)} />
            </div>
          ))}
        </div>
      ) : (
        <FieldInputs
          item={item}
          fieldId={item.id}
          onCheckChange={onCheckChange}
        />
      )}
    </div>
  );
}

// Нэг талбарын (item эсвэл байрлал-түлхүүрийн) оролтуудыг гаргана.
function FieldInputs({
  item,
  fieldId,
  onCheckChange,
}: {
  item: TemplateItem;
  fieldId: string;
  onCheckChange?: (value: string) => void;
}) {
  const baseName = `data[${fieldId}]`;
  const [photoCount, setPhotoCount] = useState(0);

  return (
    <>
      {item.type === "check" ? (
        <div className="flex flex-wrap gap-2">
          {(item.options ?? []).map((opt) => {
            const tone = checkOptionTone(opt);
            return (
              <label
                key={opt}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] cursor-pointer hover:bg-white/[0.08] text-sm text-white/70 transition-colors ${CHECK_TONE_CHIP[tone]}`}
              >
                <input
                  type="radio"
                  name={`${baseName}[value]`}
                  value={opt}
                  required={item.required}
                  onChange={(e) => onCheckChange?.(e.target.value)}
                  className={CHECK_TONE_ACCENT[tone]}
                />
                {opt}
              </label>
            );
          })}
        </div>
      ) : null}

      {item.type === "text" ? (
        <textarea
          name={`${baseName}[value]`}
          required={item.required}
          rows={2}
          className="auth-input resize-none"
          placeholder="Текст бичих..."
        />
      ) : null}

      {item.type === "number" ? (
        <input
          name={`${baseName}[value]`}
          type="number"
          step="any"
          required={item.required}
          className="auth-input"
          placeholder="0"
        />
      ) : null}

      {item.type === "photo" ? (
        <input
          name={`photos[${fieldId}]`}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          required={item.required}
          onChange={(e) => setPhotoCount(e.target.files?.length ?? 0)}
          className="block w-full text-sm text-white/60 file:mr-3 file:rounded-lg file:border-0 file:bg-white/[0.08] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white/80 hover:file:bg-white/[0.12] file:cursor-pointer"
        />
      ) : null}
      {item.type === "photo" ? (
        <p className="text-xs text-white/40">
          {photoCount > 0
            ? `${photoCount} зураг сонгогдсон`
            : "PNG, JPG, WEBP · утасны зургийг автоматаар жижигрүүлнэ"}
        </p>
      ) : null}

      {item.type === "signature" ? (
        <>
          <input
            name={`signatures[${fieldId}]`}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required={item.required}
            className="block w-full text-sm text-white/60 file:mr-3 file:rounded-lg file:border-0 file:bg-white/[0.08] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white/80 hover:file:bg-white/[0.12] file:cursor-pointer"
          />
          <p className="text-xs text-white/40">
            PNG, JPG, WEBP · утасны зургийг автоматаар жижигрүүлнэ
          </p>
        </>
      ) : null}

      <input
        name={`${baseName}[note]`}
        type="text"
        className="auth-input text-xs"
        placeholder="Нэмэлт тэмдэглэл (заавал биш)..."
      />
    </>
  );
}
