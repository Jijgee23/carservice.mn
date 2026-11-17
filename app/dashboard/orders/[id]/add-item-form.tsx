"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { type CatalogSearchHit, searchOrderCatalogAction } from "@/app/_actions/catalog";
import {
  type OrderActionState,
  addOrderItemAction,
} from "@/app/_actions/orders";
import { FormError } from "@/app/_components/auth-shell";
import { Btn, TabButton } from "@/app/_components/landing-ops-ui";
import { Select } from "@/app/_components/select";
import { formatPriceInput, formatTugrik, liveFormatPriceInput } from "@/lib/orders";
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
  services,
  diagnosticTemplates,
  canChangePrice,
  onAdded,
}: {
  orderId: string;
  // Байгууллагын өөрийн ажил/сэлбэг. Олдохгүй бол формоос нэгдсэн сангаас
  // хайж болно — сонгосныг server байгууллагын ажил/сэлбэгт ЯГ ашигласан нэр,
  // үнээр нь нэмнэ (lib/services/catalog-adopt.ts).
  services: ServiceOption[];
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
  const hasLabor = services.some((s) => s.type === "LABOR");
  const hasDiag = diagnosticTemplates.length > 0;
  const hasPart = services.some((s) => s.type === "GOODS");

  const initialTab: Tab = hasLabor
    ? "labor"
    : hasDiag
      ? "diagnostic"
      : hasPart
        ? "part"
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

/** Нэгдсэн сангаас сонгосон (байгууллага хараахан бүртгээгүй) мөр. */
type CatalogPick = { id: string; type: "LABOR" | "GOODS"; name: string; code: string | null; price: string };

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
  const hasDiag = diagnosticTemplates.length > 0;

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
  // Нэгдсэн сангаас хайх панел (null = хаалттай) ба сонгосон сангийн мөр.
  const [catalogQuery, setCatalogQuery] = useState<string | null>(null);
  const [catalogPick, setCatalogPick] = useState<CatalogPick | null>(null);
  const unitPriceRef = useRef<HTMLInputElement>(null);

  // Бичиж байх үед курсорыг үргэлж утгын төгсгөлд байлгана — таслал
  // нэмэгдэх/хасагдахад курсор дундуур үсэрч эвдрэхээс сэргийлнэ.
  useEffect(() => {
    const el = unitPriceRef.current;
    if (el && document.activeElement === el) {
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [unitPrice]);

  function resetPick() {
    setServiceId("");
    setDiagnosticTemplateId("");
    setCatalogPick(null);
    setCatalogQuery(null);
    setDescription("");
    setUnitPrice("");
  }

  function switchTab(next: Tab) {
    setDismissed(true);
    setTab(next);
    resetPick();
  }

  function pickService(id: string) {
    setDismissed(true);
    setServiceId(id);
    setDiagnosticTemplateId("");
    setCatalogPick(null);
    setCatalogQuery(null);
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

  function openCatalog(query: string) {
    setDismissed(true);
    setServiceId("");
    setCatalogPick(null);
    setDescription("");
    setUnitPrice("");
    setCatalogQuery(query);
  }

  function pickCatalog(hit: CatalogSearchHit, type: "LABOR" | "GOODS") {
    setDismissed(true);
    setCatalogQuery(null);
    setCatalogPick({ id: hit.id, type, name: hit.name, code: hit.code, price: hit.price });
    setServiceId("");
    setDescription(hit.name);
    setUnitPrice(formatPriceInput(hit.price));
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
  const catalogType: "LABOR" | "GOODS" = tab === "part" ? "GOODS" : "LABOR";
  const searchableTab = tab === "labor" || tab === "part";

  const canSubmit =
    tab === "custom"
      ? description.trim().length > 0
      : tab === "diagnostic"
        ? Boolean(diagnosticTemplateId)
        : catalogPick
          ? description.trim().length > 0
          : Boolean(serviceId);

  const TABS: Tab[] = ["labor", "diagnostic", "part", "custom"];
  const tabEnabled: Record<Tab, boolean> = {
    // Өөрийн жагсаалт хоосон ч нэгдсэн сангаас хайж нэмж болно.
    labor: true,
    diagnostic: hasDiag,
    part: true,
    // Каталогийн үнэгүй, дур мэдэн үнэ оруулах боломжтой tab тул
    // "orders.itemPrice" эрхгүй бол бүхэлдээ хаана.
    custom: canChangePrice,
  };

  // Өөрийн жагсаалтад бичсэн нэр олдохгүй үед — сонгогчийн төгсгөлд сангаас
  // хайх мөр гарна.
  const catalogCreatable = {
    getLabel: (q: string) => ({
      label: `«${q.trim()}» — мэдээллийн сангаас хайх`,
      hint: "Өөрийн жагсаалтад олдохгүй бол",
    }),
    onCreate: (q: string) => openCatalog(q.trim()),
  };

  const ownPicker = (options: { value: string; label: string; hint?: string }[], placeholder: string, name: string) => (
    <>
      <Select
        name={name}
        value={serviceId}
        onChange={pickService}
        placeholder={options.length === 0 ? "Бүртгэлтэй зүйл алга" : placeholder}
        searchable
        searchPlaceholder="Нэр, кодоор хайх…"
        creatable={catalogCreatable}
        options={options}
      />
      {fe.serviceId ? (
        <p className="mt-1 text-xs text-red-400 light:text-red-600">{fe.serviceId}</p>
      ) : null}
      <button
        type="button"
        onClick={() => openCatalog("")}
        className="mt-1 text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
      >
        Олдохгүй байна уу? Мэдээллийн сангаас хайх
      </button>
    </>
  );

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
      <input type="hidden" name="serviceId" value={catalogPick ? "" : serviceId} />
      <input type="hidden" name="catalogItemId" value={catalogPick?.id ?? ""} />
      <input
        type="hidden"
        name="diagnosticTemplateId"
        value={diagnosticTemplateId}
      />
      {tab !== "custom" && !catalogPick ? (
        <input type="hidden" name="description" value={description} />
      ) : null}

      {searchableTab && catalogQuery !== null ? (
        <CatalogSearchPanel
          type={catalogType}
          initialQuery={catalogQuery}
          onPick={(hit) => pickCatalog(hit, catalogType)}
          onClose={() => setCatalogQuery(null)}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-12">
        {searchableTab && catalogPick ? (
          <div className="sm:col-span-7">
            <div className="relative">
              <input
                name="description"
                type="text"
                required
                maxLength={200}
                value={description}
                onChange={(e) => {
                  setDismissed(true);
                  setDescription(e.target.value);
                }}
                placeholder="Нэр"
                className={`auth-input pr-24 ${fe.description || fe.serviceId ? "border-red-500/50" : ""}`}
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-[var(--oc-accent)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--oc-accent)]">
                Нэгдсэн сан
              </span>
            </div>
            {fe.description || fe.serviceId ? (
              <p className="mt-1 text-xs text-red-400 light:text-red-600">{fe.description ?? fe.serviceId}</p>
            ) : null}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--oc-muted3)]">
              <span>
                Сан: {catalogPick.name}
                {catalogPick.code ? ` · ${catalogPick.code}` : ""} · {formatTugrik(catalogPick.price)}
              </span>
              <button
                type="button"
                onClick={() => openCatalog("")}
                className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
              >
                Сангаас дахин хайх
              </button>
              <button
                type="button"
                onClick={() => {
                  setDismissed(true);
                  resetPick();
                }}
                className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
              >
                Болих
              </button>
            </div>
          </div>
        ) : null}

        {tab === "labor" && !catalogPick ? (
          <>
            <div className="sm:col-span-3">
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
            <div className="sm:col-span-4">
              {ownPicker(
                filteredLabor.map((s) => ({
                  value: s.id,
                  label: s.name,
                  hint: `${s.laborCategoryName ?? "Ангилалгүй"} · ${formatTugrik(s.price)}`,
                })),
                "— Ажил сонгох —",
                "laborPick",
              )}
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

        {tab === "part" && !catalogPick ? (
          <div className="sm:col-span-7">
            {ownPicker(
              partServices.map((s) => ({
                value: s.id,
                label: `${s.name}${s.code ? ` · ${s.code}` : ""}`,
                hint: `${s.stock != null ? (Number(s.stock) > 0 ? `${s.stock} ${s.unit} · ` : "Үлдэгдэлгүй · ") : ""}${formatTugrik(s.price)}`,
              })),
              "— Сэлбэг сонгох —",
              "partPick",
            )}
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

      {searchableTab && catalogPick ? (
        <p className="text-xs text-[var(--oc-muted3)]">
          Нэмэхэд энэ {catalogPick.type === "GOODS" ? "сэлбэг" : "ажил"} таны «Үйлчилгээ» жагсаалтад дээрх нэр
          {canChangePrice ? ", үнээр" : "ээр"} бүртгэгдэж, дараагийн удаа өөрийн жагсаалтаас шууд олдоно.
        </p>
      ) : null}

      <Btn type="submit" disabled={pending || !canSubmit} size="sm" className="self-end">
        {pending ? "Нэмж байна..." : "+ Мөр нэмэх"}
      </Btn>
    </form>
  );
}

/** Нэгдсэн сангаас (байгууллага хараахан бүртгээгүй) ажил/сэлбэг хайх. */
function CatalogSearchPanel({
  type,
  initialQuery,
  onPick,
  onClose,
}: {
  type: "LABOR" | "GOODS";
  initialQuery: string;
  onPick: (hit: CatalogSearchHit) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<CatalogSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState("");
  const requestRef = useRef(0);
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) return;
    const req = ++requestRef.current;
    const timer = setTimeout(() => {
      setLoading(true);
      void searchOrderCatalogAction(type, trimmed)
        .then((rows) => {
          if (req !== requestRef.current) return;
          setResults(rows);
          setSearched(trimmed);
        })
        .catch(() => {
          if (req === requestRef.current) setResults([]);
        })
        .finally(() => {
          if (req === requestRef.current) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [trimmed, type]);

  const shown = trimmed.length >= 2 ? results : [];

  return (
    <div className="rounded-[10px] border border-[var(--oc-accent)]/30 bg-[var(--oc-panel2)] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-[var(--oc-ink2)]">
          Мэдээллийн сангаас {type === "GOODS" ? "сэлбэг" : "ажил"} хайх
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-ink2)]"
        >
          Хаах
        </button>
      </div>
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Form-ыг илгээхгүй — эхний үр дүнг сонгоно.
          if (e.key === "Enter") {
            e.preventDefault();
            if (shown[0]) onPick(shown[0]);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Нэр, код, баркодоор хайх (2+ тэмдэгт)"
        className="auth-input"
      />
      <div className="mt-2 max-h-64 overflow-auto">
        {trimmed.length < 2 ? (
          <p className="px-1 py-2 text-xs text-[var(--oc-muted3)]">Хайх үгээ бичнэ үү.</p>
        ) : loading && searched !== trimmed ? (
          <p className="px-1 py-2 text-xs text-[var(--oc-muted3)]">Хайж байна…</p>
        ) : shown.length === 0 ? (
          <p className="px-1 py-2 text-xs text-[var(--oc-muted3)]">
            Сангаас олдсонгүй. «Гараар оруулах» табаас нэмж болно.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--oc-line)]">
            {shown.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => onPick(hit)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-[var(--oc-accent)]/[0.08]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-[var(--oc-ink2)]">{hit.name}</span>
                    <span className="block truncate text-xs text-[var(--oc-muted3)]">
                      {[hit.code, hit.unitName].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 font-plex-mono text-xs text-[var(--oc-ink2)]">
                    {formatTugrik(hit.price)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
