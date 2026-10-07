"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  type AppointmentActionState,
  registerAppointmentByStaff,
} from "@/app/_actions/appointments";
import {
  getBranchDaySchedulePreview,
  type BranchDaySchedulePreview,
} from "@/app/_actions/schedule-preview";
import { Field, FormError } from "@/app/_components/auth-shell";
import {
  BranchTimePicker,
  type BranchTimePickerHandle,
} from "@/app/_components/branch-time-picker";
import { Btn, BtnLink, SquareAddButton } from "@/app/_components/landing-ops-ui";
import { Select } from "@/app/_components/select";
import { SchedulePreviewGrid } from "@/app/_components/schedule-preview-grid";
import {
  CreateCustomerModal,
  type CreatedCustomer,
} from "@/app/dashboard/customers/create-customer-modal";
import {
  assigneeOptionsForBranch,
  emptyAssigneeReason,
  type AssigneeCandidate,
} from "@/lib/appointments/appointment-assignee-label";
import type { Weekday } from "@/lib/branches";
import { customerLabel, customerPickerHint } from "@/lib/customers";

export const APPOINTMENT_FORM_ID = "appointment-form";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// Хуваарийн хуудаснаас ирсэн ISO-г browser-ийн локал огноогоор "YYYY-MM-DD"
// болгоно (order-form.tsx-ийн toLocalDatetimeInput-той адил зарчим).
function toLocalDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

type Branch = { id: string; name: string; openWeekdays: Weekday[] };
type Customer = {
  id: string;
  fullName: string;
  phone: string;
  isOrganization?: boolean;
  orgRegnum?: string | null;
};
type Vehicle = { id: string; plate: string; make: string; model: string; customerId: string | null };
type Category = { id: string; name: string; branchIds: string[] };

export function AppointmentForm({
  branches,
  customers: initialCustomers,
  vehicles = [],
  categories,
  assignees = [],
  assigneeOnlyUserId,
  currentUserId,
  defaultBranchId,
  initialScheduledAt,
  backHref = "/dashboard/appointments",
  next,
}: {
  branches: Branch[];
  customers: Customer[];
  vehicles?: Vehicle[];
  categories: Category[];
  // QA #28: хариуцах мастер сонгох боломжтой ажилтнууд (orderAssignableWhere).
  assignees?: AssigneeCandidate[];
  // orders.assign эрхгүй бол зөвхөн өөрийгөө сонгож болно.
  assigneeOnlyUserId?: string | null;
  /** Preselected as the master when eligible (QA #28, same as orders). */
  currentUserId?: string | null;
  defaultBranchId?: string;
  // Хуваарийн хуудаснаас хоосон цаг дээр дарж орж ирсэн бол тухайн цаг
  // (ISO) — сонгосон огноо/цагийг урьдчилан бөглөнө.
  initialScheduledAt?: string;
  backHref?: string;
  // Амжилттай бүртгэсний дараа буцах зам (жишээ нь: хуваарийн хуудас) —
  // ирээгүй бол өмнөх адил цаг захиалгын жагсаалт руу орно.
  next?: string;
}) {
  const [state, formAction, pending] = useActionState<
    AppointmentActionState,
    FormData
  >(registerAppointmentByStaff, null);

  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [branchId, setBranchId] = useState(defaultBranchId ?? "");
  const [customerId, setCustomerIdRaw] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  // The current user is preselected as the master when eligible for the branch.
  const defaultAssigneeFor = (forBranchId: string) =>
    currentUserId && forBranchId &&
    assigneeOptionsForBranch(assignees, forBranchId, { onlyUserId: assigneeOnlyUserId }).some(
      (o) => o.value === currentUserId,
    )
      ? currentUserId
      : "";
  const [assignedToId, setAssignedToId] = useState(() => defaultAssigneeFor(defaultBranchId ?? ""));
  function setCustomerId(id: string) {
    setCustomerIdRaw(id);
    setVehicleId("");
  }
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [selectedIso, setSelectedIso] = useState("");
  // Дүүрсэн цагийг ажилтан зөвхөн баталгаажуулсны дараа бүртгэж болно —
  // reviseExpectedFinishAction/order-form.tsx-ийн адил "зөөлөн анхааруулга,
  // хатуу хориглол биш" зарчим (COWORK.md-г үз). Цаг солигдмогц дахин
  // баталгаажуулах шаардлагатай тул шинэ сонголт бүрт цэвэрлэнэ.
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [prevState, setPrevState] = useState<AppointmentActionState>(null);
  if (state !== prevState) {
    setPrevState(state);
    setConfirmArmed(Boolean(state?.fieldErrors?.confirmNeeded));
  }
  const initialDate = initialScheduledAt ? toLocalDateKey(initialScheduledAt) : undefined;
  // Booking v2: олон ангилал сонгож болно (customer-ийн урсгалтай адил).
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const timePickerRef = useRef<BranchTimePickerHandle>(null);

  // Сонгосон өдөр + тухайн өдрийн нийт үргэлжлэх хугацаа (BranchTimePicker-ээс
  // мэдээлэгдэнэ) — доод дахь бодит хуваарийн preview grid-д зориулав.
  const [selectedDateKey, setSelectedDateKey] = useState(initialDate ?? "");
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [preview, setPreview] = useState<BranchDaySchedulePreview | null>(null);
  const previewReqIdRef = useRef(0);

  useEffect(() => {
    if (!branchId || !selectedDateKey) return;
    const id = ++previewReqIdRef.current;
    getBranchDaySchedulePreview(branchId, selectedDateKey)
      .then((res) => {
        if (id === previewReqIdRef.current) setPreview(res);
      })
      .catch(() => {
        if (id === previewReqIdRef.current) setPreview(null);
      });
  }, [branchId, selectedDateKey]);

  // Одоо бөглөж буй цаг захиалгын "ghost" блок — сонголт хийгээгүй бол алга.
  const ghost = useMemo(() => {
    if (!selectedIso) return null;
    const startMs = new Date(selectedIso).getTime();
    if (!Number.isFinite(startMs)) return null;
    const minutes = durationMinutes && durationMinutes > 0 ? durationMinutes : 30;
    return { startMs, endMs: startMs + minutes * 60000, label: "Энэ цаг захиалга" };
  }, [selectedIso, durationMinutes]);

  const fe = state?.fieldErrors ?? {};
  const selectedBranch = branches.find((b) => b.id === branchId);

  // Сонгосон салбарт хамаарах ангилал (салбаргүй ангилал бүх салбарт).
  const branchCategories = branchId
    ? categories.filter(
        (c) => c.branchIds.length === 0 || c.branchIds.includes(branchId),
      )
    : [];

  const assigneeOptions = branchId
    ? assigneeOptionsForBranch(assignees, branchId, { onlyUserId: assigneeOnlyUserId })
    : [];

  function onBranchChange(v: string) {
    setBranchId(v);
    setAssignedToId(defaultAssigneeFor(v));
    setSelectedIso("");
    setCategoryIds([]);
    setSelectedDateKey("");
    setDurationMinutes(null);
    setPreview(null);
  }

  function onTimeChange(iso: string) {
    setSelectedIso(iso);
    setConfirmArmed(false);
  }

  function toggleCategory(id: string, checked: boolean) {
    const next = checked
      ? [...categoryIds, id]
      : categoryIds.filter((x) => x !== id);
    setCategoryIds(next);
    timePickerRef.current?.reload(next);
  }

  function onCustomerCreated(c: CreatedCustomer) {
    setCustomers((prev) => [c, ...prev]);
    setCustomerId(c.id);
    setShowCustomerForm(false);
  }

  return (
    <form
      id={APPOINTMENT_FORM_ID}
      action={formAction}
      className="flex flex-col gap-5"
      noValidate
    >
      <FormError
        message={
          state?.message && !state.ok && !state.fieldErrors?.confirmNeeded
            ? state.message
            : undefined
        }
      />
      <input type="hidden" name="requestedAt" value={selectedIso} />
      <input type="hidden" name="confirmed" value={confirmArmed ? "true" : ""} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {categoryIds.map((id) => (
        <input key={id} type="hidden" name="categoryIds" value={id} />
      ))}

      {/* Тухайн өдрийн бодит хуваарь — календарын Өдөр харагдацтай адил
          дээд хэсэгт, бүтэн өргөнөөр (сонгосон салбар/өдрөөс хамааран). */}
      {branchId && selectedDateKey && preview ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-white/70">Өдрийн хуваарь</span>
          <SchedulePreviewGrid
            rows={preview.rows}
            axisStartMs={preview.axisStartMs}
            axisEndMs={preview.axisEndMs}
            ghost={ghost}
          />
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 items-start">
        {/* Зүүн багана: салбар, үйлчлүүлэгч, тэмдэглэл */}
        <div className="flex flex-col gap-4">
          <Field label="Салбар" htmlFor="branchId" error={fe.branchId}>
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

          {branchId && branchCategories.length > 0 ? (
            <Field
              label="Үйлчилгээний ангилал"
              htmlFor="category-0"
              hint="заавал биш, олон сонголт боломжтой"
              error={fe.categoryId}
            >
              <div className="flex flex-wrap gap-2">
                {branchCategories.map((c, i) => {
                  const checked = categoryIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      htmlFor={`category-${i}`}
                      className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors select-none ${
                        checked
                          ? "bg-violet-600 border-violet-500 text-white font-medium"
                          : "border-white/[0.12] bg-white/[0.04] text-white/70 hover:border-violet-500/40"
                      }`}
                    >
                      <input
                        id={`category-${i}`}
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={(e) => toggleCategory(c.id, e.target.checked)}
                      />
                      {c.name}
                    </label>
                  );
                })}
              </div>
            </Field>
          ) : null}

          <Field label="Үйлчлүүлэгч" htmlFor="customerId" error={fe.customerId}>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <Select
                  id="customerId"
                  name="customerId"
                  required
                  value={customerId}
                  onChange={setCustomerId}
                  error={fe.customerId}
                  placeholder={
                    customers.length === 0 ? "— Бүртгэгдээгүй —" : "— Сонгох —"
                  }
                  options={customers.map((c) => ({
                    value: c.id,
                    label: customerLabel(c),
                    hint: customerPickerHint(c),
                  }))}
                />
              </div>
              <SquareAddButton
                active={showCustomerForm}
                onClick={() => setShowCustomerForm((v) => !v)}
                title="Шинэ үйлчлүүлэгч нэмэх"
              />
            </div>
          </Field>

          <Field label="Машин (заавал биш)" htmlFor="vehicleId" error={fe.vehicleId}>
            <Select
              id="vehicleId"
              name="vehicleId"
              value={vehicleId}
              onChange={setVehicleId}
              error={fe.vehicleId}
              disabled={!customerId}
              placeholder={customerId ? "— Сонгох —" : "— Эхлээд үйлчлүүлэгч сонгоно уу —"}
              options={vehicles
                .filter((v) => v.customerId === customerId)
                .map((v) => ({ value: v.id, label: `${v.plate} · ${v.make} ${v.model}` }))}
            />
          </Field>

          <Field label="Хариуцах мастер *" htmlFor="assignedToId" error={fe.assignedToId}>
            <Select
              id="assignedToId"
              name="assignedToId"
              value={assignedToId}
              onChange={setAssignedToId}
              error={fe.assignedToId}
              disabled={!branchId}
              placeholder={branchId ? "— Сонгох —" : "— Эхлээд салбар сонгоно уу —"}
              options={assigneeOptions}
            />
            {branchId && assigneeOptions.length === 0 ? (
              <p className="mt-1 text-xs text-[var(--oc-warn)]">{emptyAssigneeReason(assigneeOnlyUserId)}</p>
            ) : null}
          </Field>

          <CreateCustomerModal
            open={showCustomerForm}
            onClose={() => setShowCustomerForm(false)}
            onCreated={onCustomerCreated}
          />

          <Field label="Тэмдэглэл" htmlFor="note" hint="заавал биш">
            <textarea
              id="note"
              name="note"
              rows={2}
              className="auth-input resize-y"
              placeholder="Гомдол, тусгай хүсэлт..."
            />
          </Field>
        </div>

        {/* Дунд + баруун багана: календар | боломжит цаг */}
        <BranchTimePicker
          key={branchId || "none"}
          ref={timePickerRef}
          branchId={branchId}
          categoryIds={categoryIds}
          openWeekdays={selectedBranch?.openWeekdays}
          value={selectedIso}
          onChange={onTimeChange}
          error={fe.requestedAt}
          initialDate={initialDate}
          initialIso={initialScheduledAt}
          onDateChange={setSelectedDateKey}
          onAvailabilityChange={(a) => setDurationMinutes(a?.durationMinutes ?? null)}
          allowOverbook
        />
      </div>

      {confirmArmed ? (
        <p className="text-sm text-amber-400 light:text-amber-700">
          {state?.message ?? "Энэ цаг дүүрсэн байна."}
        </p>
      ) : null}

      <div className="flex gap-2 pt-3 border-t border-[var(--oc-line2)]">
        <BtnLink href={backHref} variant="ghost">
          ← Буцах
        </BtnLink>
        <Btn type="submit" disabled={pending || !selectedIso}>
          {pending ? "..." : confirmArmed ? "Тийм, бүртгэх" : "Цаг бүртгэх"}
        </Btn>
      </div>
    </form>
  );
}
