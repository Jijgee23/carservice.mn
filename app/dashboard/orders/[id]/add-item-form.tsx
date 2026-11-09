"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  type OrderActionState,
  addOrderItemAction,
} from "@/app/_actions/orders";
import { FormError } from "@/app/_components/auth-shell";
import { Btn, TabButton } from "@/app/_components/landing-ops-ui";
import { Select } from "@/app/_components/select";
import { formatPriceInput, formatTugrik, liveFormatPriceInput } from "@/lib/orders";
import { CATALOG_OPTION_PREFIX } from "@/lib/catalog/catalog-option";
import type { ServiceKind } from "@/lib/services";

export type ServiceOption = {
  id: string;
  type: ServiceKind;
  name: string;
  code: string | null;
  unit: string;
  price: string;
  stock: string | null;
  laborCategoryId: string | null;
  laborCategoryName: string | null;
  /** Нэгдсэн сангаас (тенант хараахан холбоогүй) — id нь CATALOG_OPTION_PREFIX-тэй. */
  fromCatalog?: boolean;
};

export type DiagnosticTemplateOption = {
  id: string;
  name: string;
  price: string;
  durationMin: number | null;
};

type Tab = "labor" | "diagnostic" | "part" | "custom";

const TAB_LABEL: Record<Tab, string> = {
  labor: "Ажил",
  diagnostic: "Оношилгоо",
  part: "Сэлбэг",
  custom: "Гараар оруулах",
};

export function AddItemForm({
  orderId,
  services: ownServices,
  catalogItems = [],
  diagnosticTemplates,
  canChangePrice,
  onAdded,
}: {
  orderId: string;
  services: ServiceOption[];
  // Нэгдсэн сангийн ажил/сэлбэг (тенант холбоогүй) — өөрийн жагсаалтын дараа харагдана.
  catalogItems?: ServiceOption[];
  diagnosticTemplates: DiagnosticTemplateOption[];
  // "orders.itemPrice" эрхгүй хэрэглэгч энд ч мөн нэгж үнийг санаатайгаар
  // өөрчилж чадахгүй — сонгосон үйлчилгээ/загварын каталогийн үнэ л
  // хэрэглэгдэнэ (readOnly), "Гараар оруулах" tab (эрхгүй бол каталогийн
  // үнэгүй, дур мэдэн үнэ оруулдаг тул) бүхэлдээ хаагдана.
  canChangePrice: boolean;
  // Захиалгын дэлгэрэнгүйг тусад нь (жишээ нь хуваарийн харагдацад) нэг удаа
  // client дээр татсан үед автоматаар шинэчлэгддэггүй тул нэмсний дараа
  // дуудагч талд мэдэгдэж дахин татуулах боломж — order/[id]/page.tsx шиг
  // бүтэн серверийн хуудсанд revalidatePath өөрөө шинэчилдэг тул шаардлагагүй.
  onAdded?: () => void;
}) {
  // Тенант ижил кодтойг өөрөө бүртгэсэн бол сангийн хуулбарыг давхар харуулахгүй
  // (server ч тэр тохиолдолд өөрийнхийг нь ашигладаг — catalog-adopt.ts).
  const services = useMemo(() => {
    const ownCodes = new Set(
      ownServices.filter((s) => s.code).map((s) => `${s.type}:${s.code}`),
    );
    return [
      ...ownServices,
      ...catalogItems.filter((c) => !c.code || !ownCodes.has(`${c.type}:${c.code}`)),
    ];
  }, [ownServices, catalogItems]);
  const laborServices = useMemo(
    () => services.filter((s) => s.type === "LABOR"),
    [services],
  );
  const partServices = useMemo(
    () => services.filter((s) => s.type === "GOODS"),
    [services],
  );

  const hasLabor = laborServices.length > 0;
  const hasDiag = diagnosticTemplates.length > 0;
  const hasPart = partServices.length > 0;

  const initialTab: Tab = hasLabor
    ? "labor"
    : hasDiag
      ? "diagnostic"
      : hasPart
        ? "part"
        : canChangePrice
          ? "custom"
          : "labor";

  // Tab-г энд (key-гүй эцэгт) хадгална — нэмсний дараа/алдааны дараа
  // FormContent дахин mount болоход хэрэглэгчийн сонгосон tab алга болохгүй.
  const [tab, setTab] = useState<Tab>(initialTab);

  const action = addOrderItemAction.bind(null, orderId);
  const [state, formAction, pending] = useActionState<
    OrderActionState,
    FormData
  >(action, null);

  useEffect(() => {
    if (state?.ok) onAdded?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Амжилттай нэмсний дараа формыг шинэчилнэ (key солигдоно).
  // Счетчик: зөвхөн амжилттай нэмэлтээр өснө, алдаа гарахад форм дахин mount
  // болж сонгосон сэлбэг/тоо алга болохгүй.
  const [formKey, setFormKey] = useState(0);
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state?.ok) setFormKey((k) => k + 1);
  }
  return (
    <FormContent
      key={formKey}
      formAction={formAction}
      pending={pending}
      state={state}
      tab={tab}
      setTab={setTab}
      services={services}
      diagnosticTemplates={diagnosticTemplates}
      canChangePrice={canChangePrice}
    />
  );
}

function FormContent({
  formAction,
  pending,
  state,
  tab,
  setTab,
  services,
  diagnosticTemplates,
  canChangePrice,
}: {
  formAction: (formData: FormData) => void;
  pending: boolean;
  state: OrderActionState;
  tab: Tab;
  setTab: (tab: Tab) => void;
  services: ServiceOption[];
  diagnosticTemplates: DiagnosticTemplateOption[];
  canChangePrice: boolean;
}) {
  const laborServices = useMemo(
    () => services.filter((s) => s.type === "LABOR"),
    [services],
  );
  const partServices = useMemo(
    () => services.filter((s) => s.type === "GOODS"),
    [services],
  );
  const hasLabor = laborServices.length > 0;
  const hasDiag = diagnosticTemplates.length > 0;
  const hasPart = partServices.length > 0;

  // Шинэ state ирэх бүрд алдааг дахин харуулна; хэрэглэгч засвар хийвэл нууна.
  const [dismissed, setDismissed] = useState(false);
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    setDismissed(false);
  }
  const [serviceId, setServiceId] = useState("");
  const [diagnosticTemplateId, setDiagnosticTemplateId] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [kind, setKind] = useState("LABOR");
  const [laborCat, setLaborCat] = useState("");
  const unitPriceRef = useRef<HTMLInputElement>(null);

  // Бичиж байх үед курсорыг үргэлж утгын төгсгөлд байлгана — таслал
  // нэмэгдэх/хасагдахад курсор дундуур үсэрч эвдрэхээс сэргийлнэ.
  useEffect(() => {
    const el = unitPriceRef.current;
    if (el && document.activeElement === el) {
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [unitPrice]);

  function switchTab(next: Tab) {
    setDismissed(true);
    setTab(next);
    setServiceId("");
    setDiagnosticTemplateId("");
    setDescription("");
    setUnitPrice("");
  }

  function pickService(id: string) {
    setDismissed(true);
    setServiceId(id);
    setDiagnosticTemplateId("");
    const svc = services.find((s) => s.id === id);
    if (svc) {
      setDescription(svc.code ? `${svc.name} (${svc.code})` : svc.name);
      setUnitPrice(formatPriceInput(svc.price));
    }
  }

  function pickTemplate(id: string) {
    setDismissed(true);
    setDiagnosticTemplateId(id);
    setServiceId("");
    const tpl = diagnosticTemplates.find((t) => t.id === id);
    if (tpl) {
      setDescription(tpl.name);
      setUnitPrice(formatPriceInput(tpl.price));
    }
  }

  // Ажлын ангилалууд — зөвхөн ажил үйлчилгээ дээр байгаа ангиллууд.
  const laborCategories = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of laborServices) {
      if (s.laborCategoryId && s.laborCategoryName) {
        map.set(s.laborCategoryId, s.laborCategoryName);
      }
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [laborServices]);

  const filteredLabor = laborCat
    ? laborServices.filter((s) => s.laborCategoryId === laborCat)
    : laborServices;

  const fe = dismissed ? {} : (state?.fieldErrors ?? {});
  const isCatalogPick = serviceId.startsWith(CATALOG_OPTION_PREFIX);
  const catalogTag = (s: ServiceOption) => (s.fromCatalog ? " · Нэгдсэн сан" : "");

  const canSubmit =
    tab === "custom"
      ? description.trim().length > 0
      : tab === "diagnostic"
        ? Boolean(diagnosticTemplateId)
        : Boolean(serviceId);

  const TABS: Tab[] = ["labor", "diagnostic", "part", "custom"];
  const tabEnabled: Record<Tab, boolean> = {
    labor: hasLabor,
    diagnostic: hasDiag,
    part: hasPart,
    // Каталогийн үнэгүй, дур мэдэн үнэ оруулах боломжтой tab тул
    // "orders.itemPrice" эрхгүй бол бүхэлдээ хаана.
    custom: canChangePrice,
  };

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <FormError
        message={
          !dismissed && state?.message && !state.ok ? state.message : undefined
        }
      />

      {/* Табууд */}
      <div className="flex flex-wrap items-center gap-1 self-start">
        {TABS.map((t) => (
          <TabButton
            key={t}
            active={tab === t}
            onClick={() => switchTab(t)}
            disabled={!tabEnabled[t]}
          >
            {TAB_LABEL[t]}
          </TabButton>
        ))}
      </div>

      {/* Always-present hidden fields for the server action */}
      <input type="hidden" name="serviceId" value={isCatalogPick ? "" : serviceId} />
      <input
        type="hidden"
        name="catalogItemId"
        value={isCatalogPick ? serviceId.slice(CATALOG_OPTION_PREFIX.length) : ""}
      />
      <input
        type="hidden"
        name="diagnosticTemplateId"
        value={diagnosticTemplateId}
      />
      {tab !== "custom" ? (
        <input type="hidden" name="description" value={description} />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-12">
        {tab === "labor" ? (
          <>
            <div className="sm:col-span-4">
              <Select
                name="laborCategoryFilter"
                value={laborCat}
                onChange={(v) => {
                  setLaborCat(v);
                  setServiceId("");
                  setDescription("");
                  setUnitPrice("");
                }}
                placeholder="Бүх ангилал"
                options={laborCategories.map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
              />
            </div>
            <div className="sm:col-span-3">
              <Select
                name="laborPick"
                value={serviceId}
                onChange={pickService}
                placeholder="— Ажил сонгох —"
                options={filteredLabor.map((s) => ({
                  value: s.id,
                  label: s.name,
                  hint: `${s.laborCategoryName ?? "Ангилалгүй"} · ${formatTugrik(s.price)}${catalogTag(s)}`,
                }))}
              />
              {fe.serviceId ? (
                <p className="mt-1 text-xs text-red-400 light:text-red-600">{fe.serviceId}</p>
              ) : null}
            </div>
          </>
        ) : null}

        {tab === "diagnostic" ? (
          <div className="sm:col-span-7">
            <Select
              name="diagnosticPick"
              value={diagnosticTemplateId}
              onChange={pickTemplate}
              placeholder="— Оношилгоо сонгох —"
              options={diagnosticTemplates.map((t) => ({
                value: t.id,
                label: t.name,
                hint: `${formatTugrik(t.price)}${t.durationMin ? ` · ${t.durationMin}мин` : ""}`,
              }))}
            />
            {fe.diagnosticTemplateId ? (
              <p className="mt-1 text-xs text-red-400 light:text-red-600">
                {fe.diagnosticTemplateId}
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === "part" ? (
          <div className="sm:col-span-7">
            <Select
              name="partPick"
              value={serviceId}
              onChange={pickService}
              placeholder="— Сэлбэг сонгох —"
              options={partServices.map((s) => ({
                value: s.id,
                label: `${s.name}${s.code ? ` · ${s.code}` : ""}`,
                hint: `${s.stock != null ? (Number(s.stock) > 0 ? `${s.stock} ${s.unit} · ` : "Үлдэгдэлгүй · ") : ""}${formatTugrik(s.price)}${catalogTag(s)}`,
              }))}
            />
            {fe.serviceId ? (
              <p className="mt-1 text-xs text-red-400 light:text-red-600">{fe.serviceId}</p>
            ) : null}
          </div>
        ) : null}

        {tab === "custom" ? (
          <>
            <div className="sm:col-span-2">
              <Select
                name="kind"
                required
                value={kind}
                onChange={setKind}
                error={fe.kind}
                options={[
                  { value: "LABOR", label: "Ажил" },
                  { value: "DIAGNOSTIC", label: "Оношилгоо" },
                  { value: "PART", label: "Сэлбэг" },
                  { value: "FEE", label: "Хураамж" },
                ]}
              />
            </div>
            <div className="sm:col-span-5">
              <input
                name="description"
                type="text"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Нэр (жишээ: Тосны солилт)"
                className={`auth-input ${fe.description ? "border-red-500/50" : ""}`}
              />
              {fe.description ? (
                <p className="mt-1 text-xs text-red-400 light:text-red-600">{fe.description}</p>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="sm:col-span-2">
          <input
            name="quantity"
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => {
              setDismissed(true);
              setQuantity(e.target.value);
            }}
            placeholder="Тоо"
            className={`auth-input ${fe.quantity ? "border-red-500/50" : ""}`}
          />
          {fe.quantity ? (
            <p className="mt-1 text-xs text-red-400 light:text-red-600">{fe.quantity}</p>
          ) : null}
        </div>

        <div className="sm:col-span-3">
          <div className="relative">
            <input
              ref={unitPriceRef}
              name="unitPrice"
              type="text"
              inputMode="decimal"
              required
              readOnly={!canChangePrice}
              title={
                canChangePrice
                  ? undefined
                  : "Каталогийн үнэ — өөрчлөх эрхгүй"
              }
              value={unitPrice}
              onChange={(e) => setUnitPrice(liveFormatPriceInput(e.target.value))}
              onBlur={(e) => setUnitPrice(formatPriceInput(e.target.value))}
              placeholder="Нэгж үнэ"
              className={`auth-input pr-7 ${canChangePrice ? "" : "opacity-70 cursor-not-allowed"} ${fe.unitPrice ? "border-red-500/50" : ""}`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--oc-muted3)]">
              ₮
            </span>
          </div>
          {fe.unitPrice ? (
            <p className="mt-1 text-xs text-red-400 light:text-red-600">{fe.unitPrice}</p>
          ) : null}
        </div>
      </div>

      <Btn type="submit" disabled={pending || !canSubmit} size="sm" className="self-end">
        {pending ? "Нэмж байна..." : "+ Мөр нэмэх"}
      </Btn>
    </form>
  );
}
