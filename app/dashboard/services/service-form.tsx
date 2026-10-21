"use client";

import { categoryAllowsKind, type CategoryKind } from "@/lib/categories";
import { useActionState, useState } from "react";
import {
  type ServiceActionState,
  createServiceAction,
  updateServiceAction,
} from "@/app/_actions/services";
import { Field, FormError } from "@/app/_components/auth-shell";
import { Btn, BtnLink } from "@/app/_components/landing-ops-ui";
import { Select } from "@/app/_components/select";
import { formatPriceInput, liveFormatPriceInput } from "@/lib/orders";
import {
  SERVICE_KINDS,
  SERVICE_KIND_DESCRIPTION,
  SERVICE_KIND_LABEL,
  SERVICE_KIND_SLUG,
  type ServiceKind,
} from "@/lib/services";
import { defaultUnitNameFor } from "@/lib/units";

type Initial = {
  id?: string;
  type: ServiceKind;
  name: string;
  code: string | null;
  unitId: string | null;
  price: string;
  costPrice: string | null;
  stock: string | null;
  durationValue: string | null;
  durationUnitId: string | null;
  reminderIntervalMonths: number | null;
  description: string | null;
  isActive: boolean;
  categoryId: string | null;
};

export type CategoryOption = {
  id: string;
  name: string;
  isActive: boolean;
  /** null = бүх төрөлд; өөр бол зөвхөн тухайн төрөлд (lib/categories.ts). */
  kind: CategoryKind | null;
  /** Системийн (бүх байгууллагад нийтлэг) ангилал. */
  isSystem: boolean;
};

export type UnitOption = {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
};

export const SERVICE_FORM_ID = "service-form";

// Талбарууд grid нүдээ бүрэн дүүргэнэ (өмнө max-w-xs байсан тул хуудас "суга"
// харагддаг байв). min-w-0 — Select/input нүднээс халихгүй.
const FIELD_MW = "min-w-0";

export function ServiceForm({
  initial,
  fixedType,
  categories,
  units,
}: {
  initial?: Initial;
  fixedType?: ServiceKind;
  categories: CategoryOption[];
  units: UnitOption[];
}) {
  const isEdit = Boolean(initial?.id);
  const action = isEdit
    ? updateServiceAction.bind(null, initial!.id!)
    : createServiceAction;
  const [state, formAction, pending] = useActionState<
    ServiceActionState,
    FormData
  >(action, null);

  const [type, setType] = useState<ServiceKind>(
    initial?.type ?? fixedType ?? "LABOR",
  );
  const [categoryId, setCategoryId] = useState<string>(
    initial?.categoryId ?? "",
  );
  // Шинэ бичлэгт: сэлбэг → `ширхэг`, ажил → `хүн/цаг`.
  const unitIdFor = (t: string) => {
    const name = defaultUnitNameFor(t);
    return units.find((u) => u.isActive && u.name === name)?.id ?? "";
  };
  const defaultUnitId = unitIdFor(type);
  const [unitId, setUnitId] = useState<string>(
    initial?.unitId ?? (isEdit ? "" : defaultUnitId),
  );
  // Шинэ бичлэгт хугацааны нэгжийг `мин`-ээр анхдагчаар сонгоно.
  const defaultDurationUnitId =
    units.find((u) => u.isActive && u.name === "мин")?.id ?? "";
  const [durationUnitId, setDurationUnitId] = useState<string>(
    initial?.durationUnitId ?? (isEdit ? "" : defaultDurationUnitId),
  );

  // Controlled — action амжилтгүй болсон үед утгууд цэвэрлэгдэхгүй
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  // Мөнгөн дүнг мянгатын таслалтай ("45,000") бичүүлнэ — засварын хуудасны
  // үнийн талбартай ижил; сервер тал (parseDecimal) таслалыг цэвэрлэнэ.
  const [price, setPrice] = useState(
    initial?.price ? formatPriceInput(initial.price) : "",
  );
  const [costPrice, setCostPrice] = useState(
    initial?.costPrice ? formatPriceInput(initial.costPrice) : "",
  );
  const [stock, setStock] = useState(initial?.stock ?? "0");
  const [durationValue, setDurationValue] = useState(
    initial?.durationValue ?? "",
  );
  const [reminderIntervalMonths, setReminderIntervalMonths] = useState(
    initial?.reminderIntervalMonths != null ? String(initial.reminderIntervalMonths) : "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  const fe = state?.fieldErrors ?? {};
  const isGoods = type === "GOODS";

  const backHref = `/dashboard/services/${SERVICE_KIND_SLUG[type]}`;

  // Сонгосон төрөлд тохирох ангилал (сэлбэгт системийн ангиллууд ч орно).
  const visibleCategories = categories.filter(
    (c) => (c.isActive && categoryAllowsKind(c.kind, type)) || c.id === initial?.categoryId,
  );
  const hasAnyCategory = categories.length > 0;

  const visibleUnits = (selectedId: string | null | undefined) =>
    units.filter((u) => u.isActive || u.id === selectedId);
  const hasAnyUnit = units.length > 0;

  return (
    <form id={SERVICE_FORM_ID} action={formAction} className="flex flex-col gap-5" noValidate>
      <FormError message={state?.message} />

      <Field label="Төрөл" htmlFor="type" error={fe.type}>
        {isEdit || fixedType ? (
          <>
            <input type="hidden" name="type" value={type} />
            <div className="px-3 py-2 rounded-lg bg-[var(--oc-panel2)] border border-[var(--oc-line)] text-sm text-[var(--oc-ink2)]">
              {SERVICE_KIND_LABEL[type]}
              <span className="text-[var(--oc-muted3)] ml-2">
                · {SERVICE_KIND_DESCRIPTION[type]}
              </span>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {SERVICE_KINDS.map((k) => (
              <label
                key={k}
                className={`flex flex-col gap-1 p-3 rounded-lg border cursor-pointer transition-colors ${
                  type === k
                    ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/[0.08]"
                    : "border-[var(--oc-line)] bg-[var(--oc-panel2)] hover:border-[var(--oc-line2)]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="type"
                    value={k}
                    checked={type === k}
                    onChange={() => {
                      setType(k);
                      // Шинэ бичлэгт нэгж анхдагч хэвээр бол төрөлд нийцүүлж солино.
                      if (!isEdit && unitId === defaultUnitId) setUnitId(unitIdFor(k));
                    }}
                    className="accent-[var(--oc-accent)]"
                  />
                  <span className="text-sm font-medium text-[var(--oc-ink2)]">
                    {SERVICE_KIND_LABEL[k]}
                  </span>
                </div>
                <span className="text-xs text-[var(--oc-muted3)] pl-6">
                  {SERVICE_KIND_DESCRIPTION[k]}
                </span>
              </label>
            ))}
          </div>
        )}
      </Field>

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        <Field
          label="Ангилал"
          htmlFor="categoryId"
          error={fe.categoryId}
          hint={
            hasAnyCategory
              ? undefined
              : "Үйлчилгээ → Ангилалд эхлээд бүртгээрэй."
          }
          className={FIELD_MW}
        >
          <Select
            id="categoryId"
            name="categoryId"
            required
            value={categoryId}
            onChange={setCategoryId}
            error={fe.categoryId}
            placeholder={
              hasAnyCategory ? "— Ангилал —" : "Ангилал бүртгэгдээгүй"
            }
            // Сэлбэгт системийн 34 + өөрийн ангилал — шууд бичиж хайна.
            searchable
            searchPlaceholder="Ангиллын нэрээр хайх…"
            options={visibleCategories.map((c) => ({
              value: c.id,
              label: `${c.name}${c.isActive ? "" : " (идэвхгүй)"}`,
              hint: c.isSystem ? "систем" : undefined,
            }))}
          />
        </Field>

        <Field label="Нэр" required htmlFor="name" error={fe.name} className={FIELD_MW}>
          <input
            id="name"
            name="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`auth-input ${fe.name ? "border-red-500/50" : ""}`}
            placeholder={
              isGoods
                ? "Жишээ: 5W-30 моторын тос"
                : type === "DIAGNOSTIC"
                  ? "Жишээ: Компьютерийн оношилгоо"
                  : "Жишээ: Тосны солилт"
            }
          />
        </Field>
        <Field
          label={isGoods ? "SKU / код" : "Код"}
          htmlFor="code"
          hint="заавал биш"
          error={fe.code}
          className={FIELD_MW}
        >
          <input
            id="code"
            name="code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`auth-input uppercase ${fe.code ? "border-red-500/50" : ""}`}
            placeholder={isGoods ? "OIL-5W30" : "LAB-OIL"}
          />
        </Field>

        <Field
          label="Хэмжих нэгж"
          htmlFor="unitId"
          error={fe.unitId}
          hint={
            hasAnyUnit
              ? undefined
              : "Тохиргоо → Хэмжих нэгжүүдэд бүртгээрэй."
          }
          className={FIELD_MW}
        >
          <Select
            id="unitId"
            name="unitId"
            required
            value={unitId}
            onChange={setUnitId}
            error={fe.unitId}
            placeholder={hasAnyUnit ? "— Нэгж —" : "Бүртгэгдээгүй"}
            options={visibleUnits(initial?.unitId).map((u) => ({
              value: u.id,
              label: `${u.name}${u.code ? ` (${u.code})` : ""}${u.isActive ? "" : " — идэвхгүй"}`,
            }))}
          />
        </Field>
        <Field
          label={isGoods ? "Борлуулах үнэ (₮)" : "Үнэ (₮)"}
          required
          htmlFor="price"
          error={fe.price}
          className={FIELD_MW}
        >
          <input
            id="price"
            name="price"
            type="text"
            inputMode="decimal"
            required
            value={price}
            onChange={(e) => setPrice(liveFormatPriceInput(e.target.value))}
            onBlur={(e) => setPrice(formatPriceInput(e.target.value))}
            className={`auth-input tabular-nums ${fe.price ? "border-red-500/50" : ""}`}
            placeholder="45,000"
          />
        </Field>

        {isGoods ? (
          <>
            <Field
              label="Өртөг үнэ (₮)"
              htmlFor="costPrice"
              hint="заавал биш"
              error={fe.costPrice}
              className={FIELD_MW}
            >
              <input
                id="costPrice"
                name="costPrice"
                type="text"
                inputMode="decimal"
                value={costPrice}
                onChange={(e) => setCostPrice(liveFormatPriceInput(e.target.value))}
                onBlur={(e) => setCostPrice(formatPriceInput(e.target.value))}
                className={`auth-input tabular-nums ${fe.costPrice ? "border-red-500/50" : ""}`}
                placeholder="32,000"
              />
            </Field>
            {!isEdit ? (
              <Field
                label="Эхний үлдэгдэл"
                htmlFor="stock"
                hint="Дараа орлого/зарлагаар тохируулна"
                error={fe.stock}
                className={FIELD_MW}
              >
                <input
                  id="stock"
                  name="stock"
                  type="text"
                  inputMode="decimal"
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  className={`auth-input ${fe.stock ? "border-red-500/50" : ""}`}
                  placeholder="0"
                />
              </Field>
            ) : (
              <input type="hidden" name="stock" value={initial?.stock ?? "0"} />
            )}
          </>
        ) : (
          <>
            <Field
              label="Хугацаа"
              htmlFor="durationValue"
              hint="товлогоонд хэрэг болно"
              error={fe.durationValue}
              className={FIELD_MW}
            >
              <input
                id="durationValue"
                name="durationValue"
                type="text"
                inputMode="decimal"
                value={durationValue}
                onChange={(e) => setDurationValue(e.target.value)}
                className={`auth-input ${fe.durationValue ? "border-red-500/50" : ""}`}
                placeholder="1.5"
              />
            </Field>
            <Field
              label="Хугацааны нэгж"
              htmlFor="durationUnitId"
              error={fe.durationUnitId}
              className={FIELD_MW}
            >
              <Select
                id="durationUnitId"
                name="durationUnitId"
                value={durationUnitId}
                onChange={setDurationUnitId}
                error={fe.durationUnitId}
                placeholder="— Нэгжгүй —"
                options={visibleUnits(initial?.durationUnitId).map((u) => ({
                  value: u.id,
                  label: `${u.name}${u.code ? ` (${u.code})` : ""}${u.isActive ? "" : " — идэвхгүй"}`,
                }))}
              />
            </Field>
          </>
        )}

        <Field
          label="Сануулга давтамж"
          htmlFor="reminderIntervalMonths"
          hint="сараар — жишээ нь тос 6 сар тутам, заавал биш"
          error={fe.reminderIntervalMonths}
          className={FIELD_MW}
        >
          <div className="flex items-center gap-2">
            <input
              id="reminderIntervalMonths"
              name="reminderIntervalMonths"
              type="text"
              inputMode="numeric"
              value={reminderIntervalMonths}
              onChange={(e) => setReminderIntervalMonths(e.target.value)}
              className={`auth-input ${fe.reminderIntervalMonths ? "border-red-500/50" : ""}`}
              placeholder="6"
            />
            <span className="text-sm text-[var(--oc-muted3)] shrink-0">сар</span>
          </div>
        </Field>
      </div>

      <Field label="Тайлбар" htmlFor="description" hint="заавал биш">
        <textarea
          id="description"
          name="description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="auth-input resize-none"
        />
      </Field>

      <label className="flex items-center gap-2 text-sm text-[var(--oc-ink2)]">
        <input
          type="checkbox"
          name="isActive"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="accent-[var(--oc-accent)]"
        />
        Идэвхтэй (засварын хуудсан дээр сонгох боломжтой)
      </label>

      <div className="flex gap-2 pt-3 border-t border-[var(--oc-line2)]">
        <BtnLink href={backHref} variant="ghost">
          ← Буцах
        </BtnLink>
        <Btn type="submit" disabled={pending}>
          {pending ? "..." : isEdit ? "Хадгалах" : "Үүсгэх"}
        </Btn>
      </div>
    </form>
  );
}
