"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import {
  bulkAssignOrderAction,
  bulkChangeOrderStatusAction,
  type BulkOrderActionState,
} from "@/app/_actions/orders";
import { Btn } from "@/app/_components/landing-ops-ui";
import {
  SelectAllCell,
  SelectRowCell,
  SelectionActions,
  useRowSelection,
} from "@/app/_components/row-selection";
import { Modal } from "@/app/_components/modal";
import { Select } from "@/app/_components/select";
import { useToast } from "@/app/_components/toast";
import {
  ITEM_KIND_BADGE,
  ITEM_KIND_LABEL,
  ORDER_STATUSES,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_BADGE,
  PAYMENT_STATUS_LABEL,
  INTERNAL_BADGE,
  INTERNAL_LABEL,
  POSTPAID_BADGE,
  POSTPAID_LABEL,
  type ItemKind,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/orders";
import { SortableTh } from "@/app/_components/sortable-th";
import type { SortDir } from "@/lib/list-sort";
import { OrderRow } from "./order-row";

export type BulkOrderRow = {
  id: string;
  number: string;
  customerLabel: string;
  vehicleMakeModel: string;
  vehiclePlate: string;
  formerPlate: string | null;
  items: { id: string; description: string; kind: ItemKind }[];
  itemCount: number;
  branchName: string;
  assignedToLabel: string | null;
  scheduledAtLabel: string | null;
  totalLabel: string;
  paymentStatus: PaymentStatus;
  isPostpaid: boolean;
  isInternal: boolean;
  status: OrderStatus;
};

export type AssignableEmployee = { id: string; label: string };

/**
 * Захиалгын жагсаалтын хүснэгт — мөр бүрт үргэлж checkbox харагдана
 * (тусгай "горим" асаах шаардлагагүй). Дор хаяж нэг захиалга сонгогдмогц
 * хөвөгч цэсэнд статус/хариуцагч өөрчлөх товч гарч ирнэ.
 */
export function BulkOrdersTable({
  rows,
  employees,
  canBulkEdit,
  canAssign,
  currentUserId,
  sort,
}: {
  rows: BulkOrderRow[];
  employees: AssignableEmployee[];
  canBulkEdit: boolean;
  canAssign: boolean;
  currentUserId: string;
  sort: { key: string; dir: SortDir };
}) {
  const selection = useRowSelection(rows);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [assignPickerOpen, setAssignPickerOpen] = useState(false);

  return (
    <>
      {canBulkEdit ? (
        <SelectionActions
          selection={selection}
          noun="захиалга"
          actions={[
            { label: "Статус солих", onSelect: () => setStatusPickerOpen(true) },
            // bulkAssignOrderAction orders.assign шаарддаг — эрхгүйд харуулахгүй.
            ...(canAssign
              ? [{
                  label: "Хариуцагч оноох",
                  variant: "ghost" as const,
                  onSelect: () => setAssignPickerOpen(true),
                }]
              : []),
          ]}
        />
      ) : null}

      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full min-w-[800px]">
          <thead>
            <tr className="border-b border-[var(--oc-line)]">
              {canBulkEdit ? (
                <SelectAllCell selection={selection} />
              ) : null}
              {[
                "#",
                "Үйлчлүүлэгч",
                "Машин",
                "Үйлчилгээ",
                "Салбар",
                "Хариуцагч",
              ].map((h) => (
                <th
                  key={h}
                  className="text-left text-xs text-[var(--oc-muted3)] font-medium px-5 py-3"
                >
                  {h}
                </th>
              ))}
              <SortableTh label="Огноо" sortKey="date" current={sort} className="text-left text-xs text-[var(--oc-muted3)] font-medium px-5 py-3" />
              <SortableTh label="Дүн" sortKey="amount" current={sort} className="text-left text-xs text-[var(--oc-muted3)] font-medium px-5 py-3" />
              <th className="text-left text-xs text-[var(--oc-muted3)] font-medium px-5 py-3">
                Статус
              </th>
            </tr>
          </thead>
          <tbody {...selection.dragArea}>
            {rows.map((o) => (
              <OrderRow key={o.id} href={`/dashboard/orders/${o.id}`}>
                {canBulkEdit ? (
                  <SelectRowCell
                    selection={selection}
                    id={o.id}
                    label={`#${o.number} сонгох`}
                  />
                ) : null}
                <td className="px-5 py-4">
                  <Link
                    href={`/dashboard/orders/${o.id}`}
                    className="font-mono text-sm font-semibold text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
                  >
                    #{o.number}
                  </Link>
                </td>
                <td className="px-5 py-4 text-sm text-[var(--oc-ink2)]">{o.customerLabel}</td>
                <td className="px-5 py-4 text-sm">
                  <div className="text-[var(--oc-ink2)]">{o.vehicleMakeModel}</div>
                  <div className="text-xs text-[var(--oc-muted3)] font-mono">
                    {o.vehiclePlate}
                  </div>
                  {o.formerPlate ? (
                    <div className="text-[11px] text-[var(--oc-muted3)]">
                      хуучин: {o.formerPlate}
                    </div>
                  ) : null}
                </td>
                <td className="px-5 py-4 text-xs">
                  {o.itemCount === 0 ? (
                    <span className="text-[var(--oc-muted3)]">—</span>
                  ) : (
                    <div className="flex flex-col gap-1 max-w-[220px]">
                      {o.items.map((it) => (
                        <div key={it.id} className="flex items-center gap-1.5">
                          <span
                            className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full ${
                              ITEM_KIND_BADGE[it.kind]
                            }`}
                          >
                            {ITEM_KIND_LABEL[it.kind]}
                          </span>
                          <span className="text-[var(--oc-muted2)] truncate">
                            {it.description}
                          </span>
                        </div>
                      ))}
                      {o.itemCount > o.items.length ? (
                        <span className="text-[var(--oc-muted3)]">
                          +{o.itemCount - o.items.length} өөр
                        </span>
                      ) : null}
                    </div>
                  )}
                </td>
                <td className="px-5 py-4 text-sm text-[var(--oc-muted2)]">{o.branchName}</td>
                <td className="px-5 py-4 text-sm text-[var(--oc-muted2)]">
                  {o.assignedToLabel ?? "—"}
                </td>
                <td className="px-5 py-4 text-xs text-[var(--oc-muted3)] whitespace-nowrap">
                  {o.scheduledAtLabel ?? "—"}
                </td>
                <td className="px-5 py-4 text-sm">
                  <div className="text-[var(--oc-ink2)]">{o.totalLabel}</div>
                  {o.isInternal ? (
                    <span
                      className={`mt-1 inline-block whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded-full ${INTERNAL_BADGE}`}
                    >
                      {INTERNAL_LABEL}
                    </span>
                  ) : (
                    <span
                      className={`mt-1 inline-block whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded-full ${
                        PAYMENT_STATUS_BADGE[o.paymentStatus]
                      }`}
                    >
                      {PAYMENT_STATUS_LABEL[o.paymentStatus]}
                    </span>
                  )}
                  {o.isPostpaid ? (
                    <span
                      className={`mt-1 ml-1 inline-block whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded-full ${POSTPAID_BADGE}`}
                    >
                      {POSTPAID_LABEL}
                    </span>
                  ) : null}
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`inline-block whitespace-nowrap text-xs px-2.5 py-1 rounded-full ${
                      ORDER_STATUS_BADGE[o.status]
                    }`}
                  >
                    {ORDER_STATUS_LABEL[o.status]}
                  </span>
                </td>
              </OrderRow>
            ))}
          </tbody>
        </table>
      </div>

      {statusPickerOpen ? (
        <BulkStatusModal
          orderIds={[...selection.selected]}
          onClose={() => setStatusPickerOpen(false)}
          onDone={() => {
            setStatusPickerOpen(false);
            selection.clear();
          }}
        />
      ) : null}
      {assignPickerOpen ? (
        <BulkAssignModal
          orderIds={[...selection.selected]}
          employees={employees}
          canAssign={canAssign}
          currentUserId={currentUserId}
          onClose={() => setAssignPickerOpen(false)}
          onDone={() => {
            setAssignPickerOpen(false);
            selection.clear();
          }}
        />
      ) : null}
    </>
  );
}

function BulkStatusModal({
  orderIds,
  onClose,
  onDone,
}: {
  orderIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [state, formAction, pending] = useActionState<BulkOrderActionState, FormData>(
    bulkChangeOrderStatusAction,
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

  return (
    <Modal open onClose={onClose} title="Статус солих" widthClassName="max-w-md">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="orderIdsJson" value={JSON.stringify(orderIds)} />
        <p className="text-sm text-[var(--oc-muted2)]">
          {orderIds.length} захиалгын статусыг өөрчлөх гэж байна. Тухайн захиалгаас
          шилжих боломжгүй статус сонгогдвол зөвхөн тэр захиалгыг алгасна.
        </p>
        <div>
          <label className="text-xs text-[var(--oc-muted3)] mb-1 block">
            Шинэ статус
          </label>
          <Select
            name="status"
            required
            placeholder="— Статус сонгох —"
            options={ORDER_STATUSES.map((st) => ({
              value: st,
              label: ORDER_STATUS_LABEL[st],
            }))}
          />
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
          <Btn type="submit" disabled={pending}>
            {pending ? "Хадгалж..." : "Хадгалах"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

function BulkAssignModal({
  orderIds,
  employees,
  canAssign,
  currentUserId,
  onClose,
  onDone,
}: {
  orderIds: string[];
  employees: AssignableEmployee[];
  canAssign: boolean;
  currentUserId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [state, formAction, pending] = useActionState<BulkOrderActionState, FormData>(
    bulkAssignOrderAction,
    null,
  );
  // Хариуцах мастер заавал — "хариуцагчгүй болгох" сонголт байхгүй.
  const [assigneeId, setAssigneeId] = useState("");

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

  return (
    <Modal open onClose={onClose} title="Хариуцагч оноох" widthClassName="max-w-md">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="orderIdsJson" value={JSON.stringify(orderIds)} />
        <p className="text-sm text-[var(--oc-muted2)]">
          {orderIds.length} захиалганд нэг зэрэг хариуцагч оноох гэж байна.
        </p>
        {canAssign ? (
          <div>
            <label className="text-xs text-[var(--oc-muted3)] mb-1 block">
              Хариуцагч
            </label>
            <Select
              name="assignedToId"
              value={assigneeId}
              onChange={setAssigneeId}
              required
              searchable
              searchPlaceholder="Нэрээр хайх…"
              options={employees.map((e) => ({ value: e.id, label: e.label }))}
            />
          </div>
        ) : (
          <>
            <input type="hidden" name="assignedToId" value={currentUserId} />
            <p className="text-sm text-[var(--oc-muted2)]">
              Танд бусдыг хариуцагчаар оноох эрх байхгүй тул зөвхөн өөрийгөө
              оноож болно.
            </p>
          </>
        )}
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
          <Btn type="submit" disabled={pending || (canAssign && !assigneeId)}>
            {pending ? "Хадгалж..." : "Хадгалах"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
