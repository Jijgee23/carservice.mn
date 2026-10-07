"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  type OrderActionState,
  createOrderAction,
  updateOrderAction,
} from "@/app/_actions/orders";
import { IntakeSection } from "./intake-section";
import {
  getBranchDaySchedulePreview,
  type BranchDaySchedulePreview,
} from "@/app/_actions/schedule-preview";
import { Field, FormError } from "@/app/_components/auth-shell";
import { DatePicker, todayStr } from "@/app/_components/date-picker";
import { Btn, BtnLink, SquareAddButton } from "@/app/_components/landing-ops-ui";
import { Select } from "@/app/_components/select";
import { SchedulePreviewGrid } from "@/app/_components/schedule-preview-grid";
import { customerDisplay, customerPickerHint } from "@/lib/customers";
import { plateLabel } from "@/lib/vehicle-plate";
import { DurationHmInput } from "@/app/dashboard/services/duration-input";
import {
  CreateCustomerModal,
  type CreatedCustomer,
} from "@/app/dashboard/customers/create-customer-modal";
import {
  CreateVehicleModal,
  type CreatedVehicle,
} from "@/app/dashboard/vehicles/create-vehicle-modal";

import {
  INTERNAL_BLOCKED_BY_PAYMENTS_HINT,
  PAYMENT_MODES,
  defaultModeForVehicle,
  flagsFromMode,
  modeAfterVehicleChange,
  modeFromFlags,
  type PaymentMode,
} from "@/lib/orders/payment-mode";

type Initial = {
  id?: string;
  branchId: string;
  customerId: string;
  vehicleId: string;
  assignedToId: string | null;
  scheduledAt: Date | null;
  notes: string | null;
  isPostpaid?: boolean;
  isInternal?: boolean;
};

type Branch = { id: string; name: string; slotMinutes?: number | null };
type Customer = {
  id: string;
  fullName: string;
  phone: string;
  isOrganization?: boolean;
  orgName?: string | null;
  orgRegnum?: string | null;
};
type Vehicle = {
  id: string;
  plate: string;
  vin?: string | null;
  make: string;
  model: string;
  customerId: string | null;
  isPostpaid?: boolean;
  isAccountVehicle?: boolean;
  ownerIsOrganization?: boolean;
};
type Tech = {
  id: string;
  firstName: string;
  lastName: string;
  branchId: string | null;
  assignableBranchIds: string[];
};
export const ORDER_FORM_ID = "order-form";

const FIELD_MW = "max-w-xs";

function toLocalDatetimeInput(d: Date | null): string {
  if (!d) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function OrderForm({
  initial,
  branches,
  customers: initialCustomers,
  vehicles: initialVehicles,
  technicians,
  bookingCategories = [],
  bookingDurationMinutes = null,
  backHref = "/dashboard/orders",
  appointmentId,
  next,
  defaultAssignedToId,
  assigneeHint,
  hasPaidPayment = false,
}: {
  initial?: Initial;
  branches: Branch[];
  customers: Customer[];
  vehicles: Vehicle[];
  technicians: Tech[];
  bookingCategories?: Array<{ id: string; name: string }>;
  bookingDurationMinutes?: number | null;
  backHref?: string;
  // Цаг захиалгаас үүсгэж буй бол — үүсгэсэн захиалгыг буцаан холбоно.
  appointmentId?: string;
  // Амжилттай хадгалсны дараа буцах зам (жишээ нь: хуваарийн хуудас) —
  // ирээгүй бол одоогийн адил үүсгэсэн захиалга руугаа орно.
  next?: string;
  // Шинэ хуудасны анхны мастер (оноох эрхгүй ажилтанд — өөрөө).
  defaultAssignedToId?: string;
  // QA #28: цагийн мастер сонгогдох боломжгүй үед товч тайлбар.
  assigneeHint?: string;
  // Засварт: төлөгдсөн төлбөртэй бол "Дотоод засвар" сонгох боломжгүй.
  hasPaidPayment?: boolean;
}) {
  const isEdit = Boolean(initial?.id);
  const action = isEdit
    ? updateOrderAction.bind(null, initial!.id!)
    : createOrderAction;

  const [state, formAction, pending] = useActionState<
    OrderActionState,
    FormData
  >(action, null);

  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [vehicles, setVehicles] = useState<Vehicle[]>(initialVehicles);

  const [branchId, setBranchId] = useState(initial?.branchId ?? "");
  const [assignedToId, setAssignedToId] = useState(
    initial?.assignedToId ?? defaultAssignedToId ?? "",
  );
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [vehicleId, setVehicleId] = useState(initial?.vehicleId ?? "");
  // "Төлбөрийн нөхцөл": машины тохиргооноос урьдчилан бөглөгдөж, хэрэглэгч өөрчилж болно.
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(
    initial?.isPostpaid !== undefined || initial?.isInternal !== undefined
      ? modeFromFlags(initial)
      : defaultModeForVehicle(initialVehicles.find((x) => x.id === initial?.vehicleId)),
  );
  const { isPostpaid, isInternal } = flagsFromMode(paymentMode);
  const internalBlocked = isEdit && hasPaidPayment && paymentMode !== "internal";

  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showVehicleForm, setShowVehicleForm] = useState(false);

  // D-111: the two-step "давхцаж байна → press again" confirmation is gone.
  // createOrderAction/updateOrderAction no longer emit `confirmNeeded`, so the
  // armed state, the hidden `confirmed` input and the "Тийм, үргэлжлүүлэх"
  // button label that went with it have all been removed. Working-hours
  // violations still come back as an ordinary `scheduledAt` field error.

  // Заавал талбарыг (салбар/үйлчлүүлэгч/машин) илгээхээс өмнө client дээр
  // шалгаж алдааг шууд харуулна. Утга сонгосон талбарын алдааг (серверийнхийг
  // ч) арилгана — шинэ серверийн хариу ирэхэд дахин эхэлнэ.
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [clearedFields, setClearedFields] = useState<ReadonlySet<string>>(() => new Set());
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    setClearedFields(new Set());
  }
  const fe: Record<string, string> = { ...(state?.fieldErrors ?? {}) };
  for (const key of clearedFields) delete fe[key];
  Object.assign(fe, clientErrors);

  function clearFieldError(...keys: string[]) {
    setClientErrors((prev) => {
      if (!keys.some((k) => k in prev)) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
    setClearedFields((prev) => new Set([...prev, ...keys]));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    const missing: Record<string, string> = {};
    if (!branchId) missing.branchId = "Салбар сонгоно уу.";
    if (!customerId) missing.customerId = "Үйлчлүүлэгчээ сонгоно уу.";
    if (!vehicleId) missing.vehicleId = "Машинаа сонгоно уу.";
    if (!assignedToId) missing.assignedToId = "Хариуцах мастер сонгоно уу.";
    setClientErrors(missing);
    if (Object.keys(missing).length > 0) e.preventDefault();
  }

  // Шинэ захиалгад "одоо" гэсэн анхны утгыг зөвхөн client дээр mount-ын дараа
  // тавина (server/client hydration-ий хооронд минут шилжвэл текст зөрж,
  // hydration mismatch өгдөг байсан тул render дундаа `new Date()` дуудахгүй).
  const [autoScheduledAt, setAutoScheduledAt] = useState<Date | null>(
    () => initial?.scheduledAt ?? null,
  );
  // Товлосон огноо/цаг + ойролцоо хугацааг (аль аль нь uncontrolled input,
  // native form submit-д хэвээр ашиглагдана) зөвхөн доорх "ghost" урьдчилсан
  // харагдацад зориулж ажиглана — DatePicker/DurationHmInput-ийн жинхэнэ
  // утгыг удирдахгүй, зөвхөн нэмэлт onChange.
  const [scheduledAtLocal, setScheduledAtLocal] = useState(() =>
    toLocalDatetimeInput(initial?.scheduledAt ?? null),
  );
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  // Тэмдэглэл + ойролцоо хугацааг controlled байлгана: React 19 form action
  // илгээсний дараа uncontrolled талбарыг дахин тохируулдаг тул сервер
  // validation алдаа буцахад бичсэн утга алга болдог байсан (QA #16).
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // Хүлээн авах зураг staging хийгдэж байх үед илгээхийг түр хориглоно.
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [durationValues, setDurationValues] = useState({ hours: "", minutes: "" });
  useEffect(() => {
    if (!isEdit && !initial?.scheduledAt) {
      const now = new Date();
      setAutoScheduledAt(now);
      setScheduledAtLocal(toLocalDatetimeInput(now));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduledDateKey = scheduledAtLocal.slice(0, 10);
  const [preview, setPreview] = useState<BranchDaySchedulePreview | null>(null);
  const previewReqIdRef = useRef(0);
  useEffect(() => {
    // Салбар/огноо хоосон бол зүгээр татахгүй — доорх render-ийн нөхцөл
    // (`branchId && scheduledDateKey && preview`) аль хэдийн preview-г
    // харуулахгүй тул энд `setPreview(null)` дуудаж дахин render үүсгэх
    // шаардлагагүй.
    //
    // Засах горимд (захиалгын дэлгэрэнгүй хуудсан дахь маягт) хуваарийн
    // урьдчилсан харагдац огт харагдахгүй тул үүнийг татахгүй — эс бөгөөс
    // салбар/огноо өөрчлөх бүрд ашиггүй сервер дуудлага явна.
    if (isEdit || !branchId || !scheduledDateKey) return;
    const id = ++previewReqIdRef.current;
    // Захиалгыг цаг захиалгаас үүсгэж байгаа бол тухайн цаг захиалгын мөрийг
    // өөрөөсөө хасна — эс бөгөөс энэ захиалгын цаг яг тэр цаг захиалгаас
    // урьдчилан бөглөгдсэн тул "ghost" блок үргэлж өөрийнхөө эх сурвалжтай
    // давхцаж, худал давхцлын анхааруулга гарна.
    getBranchDaySchedulePreview(branchId, scheduledDateKey, appointmentId)
      .then((res) => {
        if (id === previewReqIdRef.current) setPreview(res);
      })
      .catch(() => {
        if (id === previewReqIdRef.current) setPreview(null);
      });
  }, [isEdit, branchId, scheduledDateKey, appointmentId]);

  // Одоо бөглөж буй захиалгын "ghost" блок — сонгосон цаг байхгүй бол алга.
  // Цаг захиалгаас үүссэн бол booking-ийн category-уудаар тооцсон immutable
  // хугацааны snapshot-ыг ашиглана. Шууд walk-in захиалгад хугацаа хоосон
  // байвал сервер талын default-той адил 30 минутын ghost харуулна.
  const ghost = useMemo(() => {
    if (!scheduledAtLocal) return null;
    const startMs = new Date(scheduledAtLocal).getTime();
    if (!Number.isFinite(startMs)) return null;
    const minutes =
      durationMinutes && durationMinutes > 0
        ? durationMinutes
        : bookingDurationMinutes && bookingDurationMinutes > 0
          ? bookingDurationMinutes
          : branches.find((branch) => branch.id === branchId)?.slotMinutes ?? 30;
    return { startMs, endMs: startMs + minutes * 60000, label: "Энэ захиалга" };
  }, [scheduledAtLocal, durationMinutes, bookingDurationMinutes, branches, branchId]);

  const customerById = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  );

  // Үйлчлүүлэгч сонгоогүй бол эзэмшигчтэй бүх машиныг харуулна (машинаа түрүүлж
  // сонгож болно — эзэмшигч нь автоматаар бичигдэнэ). Эзэмшигчгүй машиныг
  // харуулахгүй — сервер захиалгыг эзэмшигчтэй нь тааруулахыг шаарддаг.
  // Үйлчлүүлэгч сонгосон бол зөвхөн түүний машинууд.
  const filteredVehicles = useMemo(() => {
    if (!customerId) return vehicles.filter((v) => v.customerId);
    return vehicles.filter((v) => v.customerId === customerId);
  }, [vehicles, customerId]);

  // Хариуцах мастерыг сонгосон салбараар шүүнэ: тухайн салбарын ажилтан +
  // салбар харьяалалгүй (branchId=null, ж: эзэн/удирдлага бүх салбарыг
  // хариуцдаг) хүмүүс + тухайн салбарыг нэмэлтээр ажилладаг гэж тэмдэглэсэн
  // хүмүүс (олон салбарт дамжиж ажилладаг мастер). Салбар сонгоогүй бол
  // бүгдийг харуулна.
  function isTechAssignableAt(tech: Tech, branch: string): boolean {
    return (
      !tech.branchId ||
      tech.branchId === branch ||
      tech.assignableBranchIds.includes(branch)
    );
  }

  const filteredTechnicians = useMemo(() => {
    if (!branchId) return technicians;
    return technicians.filter((t) => isTechAssignableAt(t, branchId));
  }, [technicians, branchId]);

  // Салбар солиход одоо сонгогдсон мастер шинэ салбарт хамаарахгүй бол цэвэрлэнэ.
  function onBranchChange(v: string) {
    setBranchId(v);
    clearFieldError("branchId");
    const tech = technicians.find((t) => t.id === assignedToId);
    if (tech && !isTechAssignableAt(tech, v)) {
      setAssignedToId("");
    }
  }

  // Машин сонгоход эзэмшигчийг нь автоматаар үйлчлүүлэгч болгож тавина.
  function pickVehicle(id: string) {
    setVehicleId(id);
    if (id) setPaymentMode((cur) => modeAfterVehicleChange(cur, vehicles.find((x) => x.id === id)));
  }

  function onVehicleChange(v: string) {
    pickVehicle(v);
    // Цэвэрлэвэл: эзэмшигч ганц машинтай бол сонгох өөр машин байхгүй тул
    // үйлчлүүлэгчийг ч цэвэрлэж бүх машиныг дахин харуулна; олон машинтай
    // бол үйлчлүүлэгч хэвээр — тэр эзэмшигчийн өөр машиныг сонгоно.
    if (!v) {
      if (customerId && vehicles.filter((x) => x.customerId === customerId).length <= 1) {
        setCustomerId("");
      }
      return;
    }
    const veh = vehicles.find((x) => x.id === v);
    if (veh?.customerId && veh.customerId !== customerId) {
      setCustomerId(veh.customerId);
      clearFieldError("vehicleId", "customerId");
    } else {
      clearFieldError("vehicleId");
    }
  }

  // Үйлчлүүлэгч солиход — сонгосон машин нь шинэ эзэмшигчийнх биш бол цэвэрлэнэ.
  // Тухайн үйлчлүүлэгч яг ганц машинтай бол уг машиныг автоматаар сонгоно.
  function onCustomerChange(v: string) {
    setCustomerId(v);
    // Цэвэрлэвэл машиныг ч цэвэрлэж бүх машиныг дахин харуулна.
    if (!v) {
      setVehicleId("");
      return;
    }
    clearFieldError("customerId");
    const veh = vehicles.find((x) => x.id === vehicleId);
    if (veh && veh.customerId === v) return;
    const owned = vehicles.filter((x) => x.customerId === v);
    pickVehicle(owned.length === 1 ? owned[0].id : "");
  }

  // Байгууллага эсэх: машин дээр derived утга, эс бөгөөс эзэмшигч үйлчлүүлэгчийнх.
  function vehicleIsOrg(v: Vehicle): boolean {
    if (v.ownerIsOrganization !== undefined) return v.ownerIsOrganization;
    return v.customerId ? customerById.get(v.customerId)?.isOrganization === true : false;
  }
  const selectedCustomerIsOrg = customerById.get(customerId)?.isOrganization === true;
  const selectedVehicle = vehicles.find((v) => v.id === vehicleId);
  const selectedVehicleIsOrg = selectedVehicle ? vehicleIsOrg(selectedVehicle) : false;

  function onCustomerCreated(c: CreatedCustomer) {
    setCustomers((prev) => [c, ...prev]);
    setCustomerId(c.id);
    clearFieldError("customerId");
    setVehicleId("");
    setShowCustomerForm(false);
  }

  function onVehicleCreated(v: CreatedVehicle) {
    setVehicles((prev) => [v, ...prev]);
    setVehicleId(v.id);
    setPaymentMode((cur) => modeAfterVehicleChange(cur, v));
    clearFieldError("vehicleId");
    setShowVehicleForm(false);
  }

  return (
    <form id={ORDER_FORM_ID} action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {appointmentId && !isEdit ? (
        <input type="hidden" name="appointmentId" value={appointmentId} />
      ) : null}
      {next && !isEdit ? <input type="hidden" name="next" value={next} /> : null}
      {state?.ok ? (
        <div className="bg-[var(--oc-ok)]/10 border border-[var(--oc-ok)]/25 rounded-lg px-3 py-2 text-sm text-[var(--oc-ok)]">
          {state.message ?? "Хадгалагдлаа."}
        </div>
      ) : null}
      <FormError message={state?.message && !state.ok ? state.message : undefined} />

      {/* Тухайн өдрийн бодит хуваарь — календарын Өдөр харагдацтай адил
          дээд хэсэгт, бүтэн өргөнөөр. ЗӨВХӨН шинэ захиалга үүсгэхэд: тэнд
          цагаа сонгож байгаа тул өдрийн ачаалал хэрэгтэй. Захиалгын
          дэлгэрэнгүй хуудсан дахь засах маягтад харуулахгүй — тэр хуудас
          аль хэдийн товлогдсон нэг захиалгын тухай бөгөөд хуудсыг
          уртасгахаас өөр зүйл нэмэхгүй (хэрэглэгчийн шийдвэр). */}
      {!isEdit && branchId && scheduledDateKey && preview ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--oc-ink2)]">Өдрийн хуваарь</span>
          <SchedulePreviewGrid
            rows={preview.rows}
            axisStartMs={preview.axisStartMs}
            axisEndMs={preview.axisEndMs}
            ghost={ghost}
          />
        </div>
      ) : null}

      {bookingCategories.length > 0 ? (
        <div className="rounded-lg border border-violet-500/25 bg-violet-500/[0.07] px-4 py-3 max-w-3xl">
          <div className="text-xs font-medium text-violet-200 light:text-violet-800">
            Захиалгаар сонгосон ангилал
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {bookingCategories.map((category) => (
              <span
                key={category.id}
                className="rounded-full border border-violet-400/25 bg-violet-400/10 px-2.5 py-1 text-xs text-violet-100 light:text-violet-800"
              >
                {category.name}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--oc-muted3)]">
            Энэ нь хэрэглэгчийн хүсэлтийн ангилал. Бодит ажил, сэлбэг, оношилгоог доороос нэмж өөрчилнө үү.
          </p>
        </div>
      ) : null}

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 xl:grid-rows-[auto_auto_1fr]">
        <Field label="Салбар" required htmlFor="branchId" error={fe.branchId} className={FIELD_MW}>
          <Select
            id="branchId"
            name="branchId"
            required
            value={branchId}
            onChange={onBranchChange}
            error={fe.branchId}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
            disabled={branches.length <= 1}
          />
        </Field>

        <Field
          label="Хариуцах мастер"
          required
          htmlFor="assignedToId"
          hint={assigneeHint}
          error={fe.assignedToId}
          className={FIELD_MW}
        >
          <Select
            id="assignedToId"
            name="assignedToId"
            required
            value={assignedToId}
            onChange={(v) => {
              setAssignedToId(v);
              if (v) clearFieldError("assignedToId");
            }}
            error={fe.assignedToId}
            clearable
            clearLabel="Мастерыг цэвэрлэх"
            searchable
            searchPlaceholder="Нэрээр хайх…"
            options={filteredTechnicians.map((t) => ({
              value: t.id,
              label: `${t.lastName} ${t.firstName}`,
            }))}
          />
        </Field>

        <Field
          label="Үйлчлүүлэгч"
          required
          htmlFor="customerId"
          hint={selectedCustomerIsOrg ? "Байгууллага" : undefined}
          error={fe.customerId}
          className={FIELD_MW}
        >
          <div className="flex gap-2">
            <div className="flex-1 min-w-0">
              <Select
                id="customerId"
                name="customerId"
                required
                value={customerId}
                onChange={onCustomerChange}
                error={fe.customerId}
                clearable
                clearLabel="Үйлчлүүлэгчийг цэвэрлэх"
                searchable
                searchPlaceholder="Нэр, утас, регистрээр хайх…"
                placeholder={
                  customers.length === 0 ? "— Бүртгэгдээгүй —" : "— Сонгох —"
                }
                options={customers.map((c) => {
                  const d = customerDisplay(c);
                  return {
                    value: c.id,
                    label: d.primary,
                    hint: customerPickerHint(c, d.isOrganization ? d.secondary : null),
                  };
                })}
              />
            </div>
            <SquareAddButton
              active={showCustomerForm}
              onClick={() => setShowCustomerForm((v) => !v)}
              data-stop-row-click
              title="Шинэ үйлчлүүлэгч нэмэх"
            />
          </div>
        </Field>

        <Field
          label="Машин"
          required
          htmlFor="vehicleId"
          hint={
            selectedVehicleIsOrg
              ? "Эзэмшигч: байгууллага"
              : !customerId
              ? "Сонгоход эзэмшигч автоматаар бичигдэнэ"
              : filteredVehicles.length === 0
                ? "Машин бүртгэгдээгүй"
                : undefined
          }
          error={fe.vehicleId}
          className={FIELD_MW}
        >
          <div className="flex gap-2">
            <div className="flex-1 min-w-0">
              <Select
                id="vehicleId"
                name="vehicleId"
                required
                value={vehicleId}
                onChange={onVehicleChange}
                error={fe.vehicleId}
                clearable
                clearLabel="Машиныг цэвэрлэх"
                searchable
                searchPlaceholder="Дугаар, марк, эзэмшигчээр хайх…"
                options={filteredVehicles.map((v) => {
                  const owner = v.customerId
                    ? customerById.get(v.customerId)
                    : null;
                  const base =
                    !customerId && owner
                      ? `${v.make} ${v.model} · ${customerDisplay(owner).primary}`
                      : `${v.make} ${v.model}`;
                  const org = vehicleIsOrg(v) ? `${base} · Байгууллага` : base;
                  const hint = v.isAccountVehicle
                    ? `${org} · Хэрэглэгчийн бүртгэлээс — энэ хуудастай холбоно`
                    : v.isPostpaid
                      ? `${org} · Дараа төлбөрт`
                      : org;
                  return {
                    value: v.id,
                    // Дугааргүй машиныг VIN-ээр нь ялгаж харуулна/хайна.
                    label: plateLabel(v.plate, v.vin),
                    hint,
                  };
                })}
              />
            </div>
            <SquareAddButton
              active={showVehicleForm}
              disabled={!customerId}
              onClick={() => setShowVehicleForm((v) => !v)}
              data-stop-row-click
              title={
                customerId
                  ? "Шинэ машин нэмэх"
                  : "Эхлээд үйлчлүүлэгчээ сонгоно уу"
              }
            />
          </div>
        </Field>

        <Field
          label="Товлосон огноо"
          htmlFor="scheduledAt"
          hint="заавал биш"
          error={fe.scheduledAt}
          className={FIELD_MW}
        >
          <DatePicker
            key={autoScheduledAt ? "seeded" : "empty"}
            id="scheduledAt"
            name="scheduledAt"
            withTime
            min={todayStr()}
            defaultValue={toLocalDatetimeInput(autoScheduledAt)}
            onChange={(v) => setScheduledAtLocal(v)}
            error={Boolean(fe.scheduledAt)}
          />
        </Field>

        {!isEdit && !appointmentId ? (
          // Цаг захиалгаас үүссэн бол хугацааны тооцоолол автоматаар удамшина
          // (D-041 маягийн зарчим) — энд зөвхөн шууд ирсэн (walk-in) захиалгад
          // л ойролцоо хугацааг гараар оруулна. Хадгалагдсаны дараа энэ утга
          // өөрчлөгддөггүй (immutable анхны тооцоолол), тул засах маягтад алга.
          <Field
            label="Ойролцоо хугацаа"
            htmlFor="durationHours"
            hint="заавал биш"
            error={fe.durationMinutes}
            className={FIELD_MW}
          >
            <DurationHmInput
              defaultMinutes={null}
              values={durationValues}
              onValuesChange={setDurationValues}
              invalid={Boolean(fe.durationMinutes)}
              onChange={setDurationMinutes}
            />
          </Field>
        ) : null}

        <Field label="Тэмдэглэл" htmlFor="notes" hint="заавал биш" error={fe.notes} className="sm:col-span-2 lg:col-span-3 xl:col-span-2 xl:col-start-1 max-w-2xl self-start">
          <textarea
            id="notes"
            name="notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="auth-input resize-y"
            placeholder="Гомдол, тусгай хүсэлт..."
          />
        </Field>

        {/* Хүлээн авах: xl дээр үйлчлүүлэгч/машины доор 2 мөр эзэлнэ (зүүн талд
            огноо/хугацаа, тэмдэглэл); бусад өргөнд талбаруудын доор бүтэн мөр. */}
        {!isEdit ? (
          <IntakeSection
            error={fe.intake}
            onBusyChange={setIntakeBusy}
            className="sm:col-span-2 lg:col-span-3 xl:col-span-2 xl:col-start-3 xl:row-start-2 xl:row-span-2"
          />
        ) : null}
      </div>

      <fieldset className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel2)] p-3 max-w-2xl">
        <legend className="px-1 text-xs font-medium text-[var(--oc-ink2)]">Төлбөрийн нөхцөл</legend>
        <input type="hidden" name="isPostpaidField" value="1" />
        <input type="hidden" name="isInternalField" value="1" />
        {isPostpaid ? <input type="hidden" name="isPostpaid" value="on" /> : null}
        {isInternal ? <input type="hidden" name="isInternal" value="on" /> : null}
        <div className="mt-1 flex flex-wrap gap-2">
          {PAYMENT_MODES.map((m) => {
            const checked = paymentMode === m.value;
            const disabled = m.value === "internal" && internalBlocked;
            return (
              <label
                key={m.value}
                className={`rounded-md border px-2.5 py-1.5 text-xs ${
                  disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                } ${
                  checked
                    ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/[0.08] text-[var(--oc-accent)]"
                    : "border-[var(--oc-line)] text-[var(--oc-muted2)]"
                }`}
              >
                <input
                  type="radio"
                  name="paymentMode"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => setPaymentMode(m.value)}
                  className="sr-only"
                />
                {m.label}
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-[var(--oc-muted3)]">
          {PAYMENT_MODES.find((m) => m.value === paymentMode)?.hint}
        </p>
        {internalBlocked ? (
          <p className="mt-1 text-xs text-[var(--oc-muted3)]">{INTERNAL_BLOCKED_BY_PAYMENTS_HINT}</p>
        ) : null}
      </fieldset>

      <CreateCustomerModal
        open={showCustomerForm}
        onClose={() => setShowCustomerForm(false)}
        onCreated={onCustomerCreated}
      />

      <CreateVehicleModal
        open={showVehicleForm}
        onClose={() => setShowVehicleForm(false)}
        onCreated={onVehicleCreated}
        customers={customers}
        defaultCustomerId={customerId}
      />

      <div className="flex gap-2 pt-3 border-t border-[var(--oc-line2)]">
        <BtnLink href={backHref} variant="ghost">
          ← Буцах
        </BtnLink>
        <Btn type="submit" disabled={pending || intakeBusy}>
          {pending ? "..." : isEdit ? "Хадгалах" : "Засварын хуудас үүсгэх"}
        </Btn>
      </div>
    </form>
  );
}
