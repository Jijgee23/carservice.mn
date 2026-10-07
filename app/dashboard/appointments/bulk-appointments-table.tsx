"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import {
  bulkChangeAppointmentCategoryAction,
} from "@/app/_actions/appointments";
import type { BulkActionState } from "@/lib/bulk-action";
import { Btn, BtnLink, Chip } from "@/app/_components/landing-ops-ui";
import {
  SelectAllCell,
  SelectRowCell,
  SelectionActions,
  useRowSelection,
} from "@/app/_components/row-selection";
import { Modal } from "@/app/_components/modal";
import { useToast } from "@/app/_components/toast";
import {
  APPOINTMENT_STATUS_BADGE,
  APPOINTMENT_STATUS_LABEL,
  type AppointmentStatus,
} from "@/lib/appointments";
import {
  APPOINTMENT_BOOKING_PAYMENT_BADGE,
  APPOINTMENT_BOOKING_PAYMENT_LABEL,
  type AppointmentBookingPaymentStatus,
} from "@/lib/appointment-payment-status";
import {
  AppointmentArrivedButton,
  AppointmentAssigneePicker,
  AppointmentConfirmReject,
  AppointmentNoShowButton,
  AppointmentRescheduleButton,
} from "./appointment-row-actions";

export type BulkAppointmentRow = {
  id: string;
  displayName: string;
  phoneLine: string | null;
  branchName: string;
  categoryNames: string[];
  requestedAtLabel: string;
  requestedAtIso: string;
  orderScheduledLabel: string | null;
  note: string | null;
  assignedToId: string | null;
  assigneeName: string | null;
  // null = мастер солих боломжгүй (эрхгүй / дууссан / засвартай холбогдсон).
  assigneeOptions: { value: string; label: string }[] | null;
  assigneeEmptyReason: string | null;
  status: AppointmentStatus;
  bookingPaymentStatus: AppointmentBookingPaymentStatus;
  serviceOrderId: string | null;
  serviceOrderNumber: string | null;
  orderHref: string;
  canConfirm: boolean;
  overdue: boolean;
  arrived: boolean;
};

export type AppointmentCategoryOption = { id: string; name: string };

/**
 * Цаг захиалгын жагсаалтын хүснэгт — захиалгын хүснэгттэй адил (харах:
 * app/dashboard/orders/bulk-orders-table.tsx) мөр бүрт үргэлж checkbox
 * харагдана, "горим" асаах шаардлагагүй.
 */
export function BulkAppointmentsTable({
  rows,
  categories,
  canBulkEdit,
  canRespond,
}: {
  rows: BulkAppointmentRow[];
  categories: AppointmentCategoryOption[];
  canBulkEdit: boolean;
  canRespond: boolean;
}) {
  const selection = useRowSelection(rows);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  return (
    <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
      {canBulkEdit ? (
        <SelectionActions
          selection={selection}
          noun="цаг захиалга"
          actions={[
            {
              label: "Ажлын төрөл солих",
              disabled: categories.length === 0,
              title: categories.length === 0 ? "Идэвхтэй ажлын төрөл алга." : undefined,
              onSelect: () => setCategoryPickerOpen(true),
            },
          ]}
        />
      ) : null}

      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="border-b border-[var(--oc-line)]">
              {canBulkEdit ? (
                <SelectAllCell selection={selection} />
              ) : null}
              {["Үйлчлүүлэгч", "Салбар", "Мастер", "Хүссэн цаг", "Тэмдэглэл", "Төлөв", "Үйлдэл"].map(
                (h) => (
                  <th
                    key={h}
                    className="text-left font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-5 py-3"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--oc-line)]" {...selection.dragArea}>
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-white/[0.02] transition-colors">
                {canBulkEdit ? (
                  <SelectRowCell
                    selection={selection}
                    id={a.id}
                    label={`${a.displayName} сонгох`}
                  />
                ) : null}
                <td className="px-5 py-4">
                  <div className="text-sm font-medium text-[var(--oc-ink)]">
                    {a.displayName}
                  </div>
                  {a.phoneLine ? (
                    <div className="font-plex-mono text-xs text-[var(--oc-muted3)]">
                      {a.phoneLine}
                    </div>
                  ) : null}
                </td>
                <td className="px-5 py-4 text-sm text-[var(--oc-muted2)]">
                  {a.branchName}
                  {a.categoryNames.length ? (
                    <span className="block text-xs text-[var(--oc-muted3)] mt-0.5">
                      {a.categoryNames.join(", ")}
                    </span>
                  ) : null}
                </td>
                <td className="px-5 py-4 text-sm text-[var(--oc-muted2)]" data-stop-row-click>
                  {a.assigneeOptions ? (
                    <AppointmentAssigneePicker
                      appointmentId={a.id}
                      value={a.assignedToId}
                      options={a.assigneeOptions}
                    />
                  ) : (
                    a.assigneeName ?? "—"
                  )}
                </td>
                <td className="px-5 py-4 font-plex-mono text-sm text-[var(--oc-muted2)] whitespace-nowrap">
                  {a.requestedAtLabel}
                  {a.orderScheduledLabel ? (
                    <span className="block text-xs text-[var(--oc-muted3)] mt-0.5">
                      {a.orderScheduledLabel}
                    </span>
                  ) : null}
                </td>
                <td className="px-5 py-4 text-sm text-[var(--oc-muted3)] max-w-[220px] truncate">
                  {a.note || "—"}
                </td>
                <td className="px-5 py-4">
                  {a.overdue ? (
                    <Chip tone="neutral">Хугацаа хэтэрсэн</Chip>
                  ) : (
                    <span
                      className={`font-plex-mono text-[11px] px-2.5 py-1 rounded-full ${APPOINTMENT_STATUS_BADGE[a.status]}`}
                    >
                      {APPOINTMENT_STATUS_LABEL[a.status]}
                    </span>
                  )}
                  {a.bookingPaymentStatus !== "NOT_REQUIRED" ? (
                    <span
                      className={`block w-fit mt-1 font-plex-mono text-[10px] px-2 py-0.5 rounded-full border ${APPOINTMENT_BOOKING_PAYMENT_BADGE[a.bookingPaymentStatus]}`}
                    >
                      {APPOINTMENT_BOOKING_PAYMENT_LABEL[a.bookingPaymentStatus]}
                    </span>
                  ) : null}
                </td>
                <td className="px-5 py-4" data-stop-row-click>
                  <div className="flex items-center justify-end gap-2">
                    {a.status === "CONFIRMED" && a.serviceOrderId ? (
                      <BtnLink
                        href={`/dashboard/orders/${a.serviceOrderId}`}
                        variant="ghost"
                        size="sm"
                        className="whitespace-nowrap"
                      >
                        №{a.serviceOrderNumber} харах
                      </BtnLink>
                    ) : null}

                    {canRespond && a.status === "PENDING" ? (
                      <AppointmentConfirmReject
                        appointmentId={a.id}
                        canConfirm={a.canConfirm}
                        overdue={a.overdue}
                        needsAssignee={!a.assignedToId}
                        assigneeOptions={a.assigneeOptions}
                        assigneeEmptyReason={a.assigneeEmptyReason}
                      />
                    ) : null}

                    {canRespond && a.status === "CONFIRMED" && !a.serviceOrderId ? (
                      <>
                        <BtnLink
                          href={a.orderHref}
                          size="sm"
                          className="whitespace-nowrap"
                        >
                          Засварын хуудас үүсгэх →
                        </BtnLink>
                        {!a.arrived ? (
                          <>
                            <AppointmentArrivedButton appointmentId={a.id} />
                            <AppointmentNoShowButton appointmentId={a.id} />
                            <AppointmentRescheduleButton
                              appointmentId={a.id}
                              requestedAt={a.requestedAtIso}
                            />
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {categoryPickerOpen ? (
        <BulkCategoryModal
          appointmentIds={[...selection.selected]}
          categories={categories}
          onClose={() => setCategoryPickerOpen(false)}
          onDone={() => {
            setCategoryPickerOpen(false);
            selection.clear();
          }}
        />
      ) : null}
    </div>
  );
}

function BulkCategoryModal({
  appointmentIds,
  categories,
  onClose,
  onDone,
}: {
  appointmentIds: string[];
  categories: AppointmentCategoryOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [state, formAction, pending] = useActionState<BulkActionState, FormData>(
    bulkChangeAppointmentCategoryAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      if (state.failed) {
        toast.warning("Хэсэгчлэн амжилттай", state.message);
      } else {
        toast.success("Амжилттай", state.message);
      }
      onDone();
    } else if (state.message) {
      toast.error("Алдаа гарлаа", state.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function toggleCategory(id: string) {
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <Modal open onClose={onClose} title="Ажлын төрөл солих" widthClassName="max-w-md">
      <form action={formAction} className="flex flex-col gap-4">
        <input
          type="hidden"
          name="appointmentIdsJson"
          value={JSON.stringify(appointmentIds)}
        />
        {selectedCategoryIds.map((id) => (
          <input key={id} type="hidden" name="categoryIds" value={id} />
        ))}
        <p className="text-sm text-[var(--oc-muted2)]">
          {appointmentIds.length} цаг захиалгын ажлын төрлийг солих гэж байна. Засварын
          хуудас аль хэдийн үүссэн цаг захиалгыг алгасна.
        </p>
        <div>
          <label className="text-xs text-[var(--oc-muted3)] mb-1 block">
            Ажлын төрөл
          </label>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => {
              const checked = selectedCategoryIds.includes(c.id);
              return (
                <label
                  key={c.id}
                  className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors select-none ${
                    checked
                      ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/[0.08] text-[var(--oc-accent)]"
                      : "border-[var(--oc-line)] text-[var(--oc-muted2)] hover:border-[var(--oc-line2)]"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => toggleCategory(c.id)}
                  />
                  {c.name}
                </label>
              );
            })}
          </div>
        </div>
        {state && !state.ok && state.errors?.length ? (
          <ul className="text-xs text-red-400 light:text-red-600 flex flex-col gap-0.5 max-h-32 overflow-auto">
            {state.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex justify-end gap-2">
          <Btn type="button" variant="ghost" onClick={onClose}>
            Болих
          </Btn>
          <Btn type="submit" disabled={pending || selectedCategoryIds.length === 0}>
            {pending ? "Хадгалж..." : "Хадгалах"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
