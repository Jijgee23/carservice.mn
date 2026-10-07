"use client";

import Link from "next/link";
import {
  startTransition,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createReportAction,
  type ReportActionState,
} from "@/app/_actions/diagnostic-reports";
import { Field, FormError } from "@/app/_components/auth-shell";
import { EmptyState } from "@/app/_components/empty-state";
import { Btn, BtnLink } from "@/app/_components/landing-ops-ui";
import { customerLabel, orgRegnumLabel } from "@/lib/customers";
import {
  CHECK_TONE_ACCENT,
  CHECK_TONE_CHIP,
  checkOptionTone,
  DIAGNOSTIC_TYPE_LABEL,
  itemPositions,
  positionedKey,
  type DiagnosticType,
  type TemplateItem,
  type TemplateSchema,
} from "@/lib/diagnostics";

type BranchLite = { id: string; name: string };
type CustomerLite = {
  id: string;
  fullName: string;
  phone: string;
  isOrganization?: boolean;
  orgRegnum?: string | null;
};
type VehicleLite = {
  id: string;
  plate: string;
  make: string;
  model: string;
  customerId: string | null;
};
type TemplateLite = {
  id: string;
  name: string;
  type: DiagnosticType;
  schema: TemplateSchema;
};

export function StandaloneDiagnosticForm({
  branches,
  customers,
  vehicles,
  templates,
  defaultBranchId,
}: {
  branches: BranchLite[];
  customers: CustomerLite[];
  vehicles: VehicleLite[];
  templates: TemplateLite[];
  defaultBranchId: string | null;
}) {
  const [state, formAction, pending] = useActionState<
    ReportActionState,
    FormData
  >(createReportAction, null);

  const [branchId, setBranchId] = useState(defaultBranchId ?? branches[0]?.id ?? "");
  const [customerId, setCustomerId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [templateId, setTemplateId] = useState("");

  const filteredVehicles = useMemo(
    () =>
      customerId
        ? vehicles.filter((v) => v.customerId === customerId)
        : vehicles,
    [vehicles, customerId],
  );

  const template = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );

  const ready = Boolean(branchId && customerId && vehicleId && templateId);

  const formRef = useRef<HTMLFormElement>(null);

  // Алдааны мессежийг харагдуулахын тулд form-ын эхэнд гүйлгэнэ.
  useEffect(() => {
    if (state && !state.ok && state.message) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [state]);

  // action prop ашиглавал React 19 action дууссаны дараа form-ыг reset хийж
  // бөглөсөн хариултууд арилдаг. onSubmit-ээр гардан дамжуулбал алдаа буцахад
  // input-уудын утга хэвээр үлдэнэ.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="flex flex-col gap-6"
      noValidate
    >
      <FormError message={state?.message} />

      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <input type="hidden" name="templateId" value={templateId} />

      <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6 flex flex-col gap-5">
        <h2 className="font-semibold text-[var(--oc-ink)]">Үндсэн мэдээлэл</h2>

        <Field label="Салбар" htmlFor="branch-select">
          <select
            id="branch-select"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="auth-input disabled:cursor-not-allowed disabled:opacity-50"
            required
            disabled={branches.length <= 1}
          >
            <option value="">— Сонгоно уу —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id} className="bg-[var(--surface)]">
                {b.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Үйлчлүүлэгч" htmlFor="customer-select">
          <select
            id="customer-select"
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setVehicleId("");
            }}
            className="auth-input"
            required
          >
            <option value="">— Үйлчлүүлэгч сонгох —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id} className="bg-[var(--surface)]">
                {[customerLabel(c), orgRegnumLabel(c), c.phone].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>
          {customers.length === 0 ? (
            <p className="text-xs text-[var(--oc-muted3)] mt-1">
              Үйлчлүүлэгч алга.{" "}
              <Link
                href="/dashboard/customers/new"
                className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
              >
                Шинэ нэмэх →
              </Link>
            </p>
          ) : null}
        </Field>

        <Field label="Машин" htmlFor="vehicle-select">
          <select
            id="vehicle-select"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            className="auth-input"
            required
            disabled={!customerId}
          >
            <option value="">
              {customerId
                ? "— Машин сонгох —"
                : "— Эхлээд үйлчлүүлэгчээ сонго —"}
            </option>
            {filteredVehicles.map((v) => (
              <option key={v.id} value={v.id} className="bg-[var(--surface)]">
                {v.plate} · {v.make} {v.model}
              </option>
            ))}
          </select>
          {customerId && filteredVehicles.length === 0 ? (
            <p className="text-xs text-[var(--oc-muted3)] mt-1">
              Энэ үйлчлүүлэгчид машин алга.{" "}
              <Link
                href="/dashboard/vehicles/new"
                className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
              >
                Шинэ нэмэх →
              </Link>
            </p>
          ) : null}
        </Field>

        <Field label="Оношилгооны загвар" htmlFor="template-select">
          <select
            id="template-select"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="auth-input"
            required
          >
            <option value="">— Загвар сонгох —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id} className="bg-[var(--surface)]">
                [{DIAGNOSTIC_TYPE_LABEL[t.type]}] {t.name}
              </option>
            ))}
          </select>
          {templates.length === 0 ? (
            <p className="text-xs text-[var(--oc-muted3)] mt-1">
              Идэвхтэй загвар алга.{" "}
              <Link
                href="/dashboard/services/diagnostics/new"
                className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
              >
                Шинэ үүсгэх →
              </Link>
            </p>
          ) : null}
        </Field>

        <Field label="Гүйлт (км, заавал биш)" htmlFor="mileage">
          <input
            id="mileage"
            name="mileageAtReport"
            type="number"
            min="0"
            className="auth-input"
            placeholder="123456"
          />
        </Field>

        <Field label="Тэмдэглэл" htmlFor="notes">
          <textarea
            id="notes"
            name="notes"
            rows={2}
            className="auth-input resize-none"
            placeholder="Нэмэлт мэдээлэл..."
          />
        </Field>
      </section>

      {template ? (
        <>
          {template.schema.sections.map((section) => (
            <section
              key={section.id}
              className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6 flex flex-col gap-4"
            >
              <h2 className="font-semibold text-[var(--oc-ink)]">{section.title}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 items-start">
                {section.items.map((item) => {
                  const positioned = Boolean(itemPositions(item));
                  return (
                    <div
                      key={item.id}
                      className={positioned ? "md:col-span-2 2xl:col-span-3" : ""}
                    >
                      <ItemControl item={item} />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6">
            <Field
              label="Үйлчлүүлэгчийн гарын үсэг (зураг)"
              htmlFor="signature"
            >
              <input
                id="signature"
                name="signature"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="block w-full text-sm text-[var(--oc-muted2)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--oc-panel2)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--oc-ink2)] hover:file:bg-[var(--oc-line)] file:cursor-pointer"
              />
              <p className="text-[11px] text-[var(--oc-muted4)] mt-1.5">
                PNG, JPG, WEBP · хамгийн ихдээ 2MB
              </p>
            </Field>
          </section>
        </>
      ) : (
        <EmptyState>Загвар сонгосны дараа асуултууд харагдана.</EmptyState>
      )}

      <div className="flex gap-3">
        <BtnLink href="/dashboard/diagnostics/reports" variant="ghost" className="flex-1">
          ← Цуцлах
        </BtnLink>
        <Btn type="submit" disabled={pending || !ready} className="flex-1">
          Тайлан хадгалах
        </Btn>
      </div>
    </form>
  );
}

function ItemControl({ item }: { item: TemplateItem }) {
  const positions = itemPositions(item);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm font-medium text-[var(--oc-ink2)]">
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
              <div className="text-xs font-medium text-[var(--oc-muted3)]">
                {pos.label}
              </div>
              <FieldInputs item={item} fieldId={positionedKey(item.id, pos.code)} />
            </div>
          ))}
        </div>
      ) : (
        <FieldInputs item={item} fieldId={item.id} />
      )}
    </div>
  );
}

// Нэг талбарын (item эсвэл байрлал-түлхүүрийн) оролтуудыг гаргана.
function FieldInputs({
  item,
  fieldId,
}: {
  item: TemplateItem;
  fieldId: string;
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
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--oc-panel2)] border border-[var(--oc-line)] cursor-pointer hover:bg-white/[0.06] text-sm text-[var(--oc-muted2)] transition-colors ${CHECK_TONE_CHIP[tone]}`}
              >
                <input
                  type="radio"
                  name={`${baseName}[value]`}
                  value={opt}
                  required={item.required}
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
          className="block w-full text-sm text-[var(--oc-muted2)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--oc-panel2)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--oc-ink2)] hover:file:bg-[var(--oc-line)] file:cursor-pointer"
        />
      ) : null}
      {item.type === "photo" ? (
        <p className="text-[11px] text-[var(--oc-muted4)]">
          {photoCount > 0
            ? `${photoCount} зураг сонгогдсон`
            : "PNG, JPG, WEBP · хамгийн ихдээ 2MB"}
        </p>
      ) : null}

      {item.type === "signature" ? (
        <>
          <input
            name={`signatures[${fieldId}]`}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required={item.required}
            className="block w-full text-sm text-[var(--oc-muted2)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--oc-panel2)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--oc-ink2)] hover:file:bg-[var(--oc-line)] file:cursor-pointer"
          />
          <p className="text-[11px] text-[var(--oc-muted4)]">
            PNG, JPG, WEBP · хамгийн ихдээ 2MB
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
