"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  type AppointmentActionState,
  confirmAppointment,
  markAppointmentArrived,
  markAppointmentNoShow,
  rejectAppointment,
  rescheduleAppointmentAction,
  setAppointmentAssigneeAction,
} from "@/app/_actions/appointments";
import { DatePicker, todayStr } from "@/app/_components/date-picker";
import { ConfirmForm } from "@/app/_components/confirm-form";
import { Btn } from "@/app/_components/landing-ops-ui";
import { Select } from "@/app/_components/select";
import { useToast } from "@/app/_components/toast";

// Жагсаалтын мөр дэх "Батлах/Татгалзах/Ирээгүй" товчнууд. Урьд нь эдгээр
// action-ууд `Promise<void>` буцааж, `<form action={fn}>`-аар шууд дуудагддаг
// байсан — permission/branch scope/subscription lock зэрэг хүлээгдэж буй
// алдаа гарахад throw хийж, Next.js-ийн алдааны хуудас руу шидэгддэг байсан
// (хэрэглэгчид "алдаа шидээд гардаггүй" мэт харагддаг). Одоо бусад
// action-уудтай (status-controls.tsx) ижил `{ok,message}` хэлбэрт оруулж,
// toast-аар харуулна — алдаа гарсан ч мөр эвдрэхгүй.
export function AppointmentConfirmReject({
  appointmentId,
  canConfirm = true,
  overdue = false,
  needsAssignee = false,
  assigneeOptions = null,
  assigneeEmptyReason = null,
}: {
  appointmentId: string;
  canConfirm?: boolean;
  overdue?: boolean;
  /** Appointment has no master yet: confirming requires picking one (QA #28). */
  needsAssignee?: boolean;
  assigneeOptions?: { value: string; label: string }[] | null;
  /** Shown instead of a silently disabled button when no master can be picked. */
  assigneeEmptyReason?: string | null;
}) {
  const toast = useToast();
  // A single option (users without orders.assign only see themselves) is preselected.
  const [confirmAssignee, setConfirmAssignee] = useState(
    assigneeOptions?.length === 1 ? assigneeOptions[0].value : "",
  );
  const assigneeMissing = needsAssignee && !!assigneeOptions && !confirmAssignee;
  const [confirmState, confirmAction, confirmPending] = useActionState<
    AppointmentActionState,
    FormData
  >(confirmAppointment, null);
  const [rejectState, rejectAction, rejectPending] = useActionState<
    AppointmentActionState,
    FormData
  >(rejectAppointment, null);

  const handledConfirm = useRef<AppointmentActionState>(null);
  useEffect(() => {
    if (!confirmState || confirmState === handledConfirm.current) return;
    handledConfirm.current = confirmState;
    if (confirmState.ok) toast.success(confirmState.message ?? "Амжилттай.");
    else toast.error(confirmState.message ?? "Алдаа гарлаа.");
  }, [confirmState, toast]);

  const handledReject = useRef<AppointmentActionState>(null);
  useEffect(() => {
    if (!rejectState || rejectState === handledReject.current) return;
    handledReject.current = rejectState;
    if (rejectState.ok) toast.success(rejectState.message ?? "Амжилттай.");
    else toast.error(rejectState.message ?? "Алдаа гарлаа.");
  }, [rejectState, toast]);

  const pending = confirmPending || rejectPending;

  return (
    <>
      <form action={confirmAction}>
        <input type="hidden" name="id" value={appointmentId} />
        {needsAssignee && assigneeOptions && assigneeOptions.length === 0 && assigneeEmptyReason ? (
          <p className="text-xs text-[var(--oc-warn)] max-w-[260px] mb-1.5">{assigneeEmptyReason}</p>
        ) : null}
        {needsAssignee && assigneeOptions && assigneeOptions.length > 0 ? (
          <div className="min-w-[150px] inline-block align-middle mr-2">
            <Select
              name="assignedToId"
              value={confirmAssignee}
              onChange={setConfirmAssignee}
              options={assigneeOptions}
              placeholder="Мастер сонгох *"
            />
          </div>
        ) : null}
        <button
          type="submit"
          disabled={pending || !canConfirm || assigneeMissing}
          title={
            overdue
              ? "Цагийн хугацаа өнгөрсөн."
              : canConfirm
                ? undefined
                : "Захиалгын хураамж төлөгдсөний дараа батална."
          }
          className="text-xs px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 light:bg-emerald-100 light:hover:bg-emerald-200 light:border-emerald-300 light:text-emerald-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {confirmPending
            ? "Батлаж байна..."
            : overdue
              ? "Хугацаа хэтэрсэн"
              : canConfirm
                ? "Батлах"
                : "Төлбөрийн дараа батална"}
        </button>
      </form>
      <ConfirmForm action={rejectAction} message="Энэ цагийн хүсэлтийг татгалзах уу?">
        <input type="hidden" name="id" value={appointmentId} />
        <button
          type="submit"
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded-lg border border-red-500/25 bg-red-500/10 hover:bg-red-500/20 text-red-400 light:text-red-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {rejectPending ? "Татгалзаж байна..." : "Татгалзах"}
        </button>
      </ConfirmForm>
    </>
  );
}

export function AppointmentArrivedButton({ appointmentId }: { appointmentId: string }) {
  const toast = useToast();
  const [state, formAction, pending] = useActionState<
    AppointmentActionState,
    FormData
  >(markAppointmentArrived, null);

  const handled = useRef<AppointmentActionState>(null);
  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (state.ok) toast.success(state.message ?? "Амжилттай.");
    else toast.error(state.message ?? "Алдаа гарлаа.");
  }, [state, toast]);

  return (
    <ConfirmForm action={formAction} message="Энэ цагт үйлчлүүлэгч ирсэн гэж тэмдэглэх үү?">
      <input type="hidden" name="id" value={appointmentId} />
      <Btn type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Тэмдэглэж байна..." : "Ирсэн"}
      </Btn>
    </ConfirmForm>
  );
}

export function AppointmentNoShowButton({ appointmentId }: { appointmentId: string }) {
  const toast = useToast();
  const [state, formAction, pending] = useActionState<
    AppointmentActionState,
    FormData
  >(markAppointmentNoShow, null);

  const handled = useRef<AppointmentActionState>(null);
  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (state.ok) toast.success(state.message ?? "Амжилттай.");
    else toast.error(state.message ?? "Алдаа гарлаа.");
  }, [state, toast]);

  return (
    <ConfirmForm action={formAction} message="Энэ цагт үйлчлүүлэгч ирээгүй гэж тэмдэглэх үү?">
      <input type="hidden" name="id" value={appointmentId} />
      <Btn type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Тэмдэглэж байна..." : "Ирээгүй"}
      </Btn>
    </ConfirmForm>
  );
}

function toLocalDatetimeInput(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

// Баталгаажсан (CONFIRMED) цагийг өөр хугацаанд шилжүүлэх — "ирээгүй" гэж
// тэмдэглэхийн оронд, ирц алдсан цагийг сэргээх боломж.
//
// D-111 removed the schedule-overlap warning this control used to show. The
// confirm-then-continue state below is still reachable, but now only for the
// working-hours warning raised by moveLinkedAppointmentOrder when the booking
// is linked to a SCHEDULED order (D-087) — a real branch constraint. A plain
// unlinked reschedule no longer asks for a second click at all.
export function AppointmentRescheduleButton({
  appointmentId,
  requestedAt,
}: {
  appointmentId: string;
  requestedAt: string; // ISO
}) {
  const toast = useToast();
  const [state, formAction, pending] = useActionState<
    AppointmentActionState,
    FormData
  >(rescheduleAppointmentAction, null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [prevState, setPrevState] = useState<AppointmentActionState>(null);

  // Өөрийн state-ийг render дотор тохируулах нь зөв (React-ийн "previous
  // props" загвар), харин toast нь ToastProvider-ийн state — render үед
  // шинэчилбэл "Cannot update a component while rendering" алдаа өгнө.
  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) {
      setEditing(false);
      setConfirmArmed(false);
    } else if (state?.fieldErrors?.confirmNeeded) {
      setConfirmArmed(true);
    } else if (state) {
      setConfirmArmed(false);
    }
  }

  const toasted = useRef<AppointmentActionState>(null);
  useEffect(() => {
    if (!state || state === toasted.current) return;
    toasted.current = state;
    if (state.ok) toast.success(state.message ?? "Амжилттай.");
    else if (!state.fieldErrors?.confirmNeeded) toast.error(state.message ?? "Алдаа гарлаа.");
  }, [state, toast]);

  const conflictMessage =
    state && !state.ok && state.fieldErrors?.confirmNeeded ? state.message : null;

  if (!editing) {
    return (
      <Btn
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setValue(toLocalDatetimeInput(requestedAt));
          setConfirmArmed(false);
          setEditing(true);
        }}
      >
        Шилжүүлэх
      </Btn>
    );
  }

  return (
    <ConfirmForm
      action={formAction}
      className="flex w-full flex-wrap items-center gap-2"
      enabled={!confirmArmed}
      message="Энэ цагийн захиалгыг сонгосон шинэ хугацаа руу шилжүүлэх үү?"
    >
      <input type="hidden" name="id" value={appointmentId} />
      <input type="hidden" name="confirmed" value={confirmArmed ? "true" : ""} />
      <DatePicker
        withTime
        min={todayStr()}
        value={value}
        onChange={(v) => {
          setValue(v);
          setConfirmArmed(false);
        }}
        className="w-40"
      />
      <input type="hidden" name="requestedAt" value={value} />
      {conflictMessage ? (
        <span className="text-[11px] text-[var(--oc-warn)] max-w-[180px]">
          {conflictMessage}
        </span>
      ) : null}
      <button
        type="submit"
        disabled={pending || !value}
        className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:opacity-60 whitespace-nowrap ${
          confirmArmed ? "bg-[var(--oc-warn)]" : "bg-[var(--oc-accent)]"
        }`}
      >
        {pending ? "..." : confirmArmed ? "Тийм, хадгалах" : "Хадгалах"}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="rounded-lg border border-[var(--oc-line)] bg-white/[0.04] px-2.5 py-1.5 text-xs text-[var(--oc-ink2)] hover:bg-white/[0.08] whitespace-nowrap"
      >
        Болих
      </button>
    </ConfirmForm>
  );
}

/**
 * QA #28: inline "Хариуцах мастер" picker for a list row. Saves on change via
 * `setAppointmentAssigneeAction`; the server re-validates eligibility. A stored
 * master who is no longer eligible still appears (options include them).
 */
export function AppointmentAssigneePicker({
  appointmentId,
  value,
  options,
}: {
  appointmentId: string;
  value: string | null;
  options: { value: string; label: string }[];
}) {
  const toast = useToast();
  const [current, setCurrent] = useState(value ?? "");
  const [pending, startTransition] = useTransition();
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setCurrent(value ?? "");
  }

  function change(next: string) {
    // No clearing: a master can only be replaced by another one.
    if (!next || next === current) return;
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", appointmentId);
      fd.set("assignedToId", next);
      const res = await setAppointmentAssigneeAction(null, fd);
      if (res?.ok) {
        toast.success(res.message ?? "Амжилттай.");
      } else {
        setCurrent(previous);
        toast.error(res?.message ?? "Алдаа гарлаа.");
      }
    });
  }

  return (
    <div className={pending ? "opacity-60 pointer-events-none min-w-[150px]" : "min-w-[150px]"}>
      <Select
        name={`assignedToId-${appointmentId}`}
        value={current}
        onChange={change}
        options={options}
        placeholder="— Сонгох —"
      />
    </div>
  );
}
