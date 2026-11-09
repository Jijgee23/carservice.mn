"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import {
  bulkUpdateEmployeeRoleBranchAction,
  deleteEmployeeAction,
  toggleEmployeeActiveAction,
} from "@/app/_actions/employees";
import type { BulkActionState } from "@/lib/bulk-action";
import { Btn, Chip } from "@/app/_components/landing-ops-ui";
import { ClickableRow } from "@/app/_components/clickable-row";
import { Modal } from "@/app/_components/modal";
import {
  SelectAllCell,
  SelectRowCell,
  SelectionActions,
  useRowSelection,
} from "@/app/_components/row-selection";
import { RowActionsMenu, RowMenuFormItem } from "@/app/_components/row-actions";
import { Select } from "@/app/_components/select";
import { useToast } from "@/app/_components/toast";

export type BulkEmployeeRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  verified: boolean;
  isActive: boolean;
  isOwner: boolean;
  deactivatedAt: string | null;
  activeUntil: string | null;
  roleName: string | null;
  branchName: string | null;
  isMe: boolean;
};

export type RoleOption = { id: string; name: string };
export type BranchOption = { id: string; name: string };

/**
 * Ажилтны жагсаалтын хүснэгт — захиалга/үйлчилгээ/цаг захиалгын хүснэгттэй
 * адил (харах: app/dashboard/orders/bulk-orders-table.tsx,
 * app/dashboard/services/bulk-service-list.tsx) мөр бүрт үргэлж checkbox
 * харагдана, "горим" асаах шаардлагагүй.
 */
export function BulkEmployeesTable({
  rows,
  roles,
  branches,
  hideBranches = false,
  canBulkEdit,
  canModify,
  canRemove,
}: {
  rows: BulkEmployeeRow[];
  roles: RoleOption[];
  branches: BranchOption[];
  /** Энгийн багц (ганц салбар): салбарын багана, сонголтыг нууна. */
  hideBranches?: boolean;
  canBulkEdit: boolean;
  canModify: boolean;
  canRemove: boolean;
}) {
  const selection = useRowSelection(rows);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      {canBulkEdit ? (
        <SelectionActions
          selection={selection}
          noun="ажилтан"
          actions={[
            {
              label: hideBranches ? "Үүрэг солих" : "Үүрэг/Салбар солих",
              onSelect: () => setPickerOpen(true),
            },
          ]}
        />
      ) : null}

      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full min-w-[820px]">
          <thead>
            <tr className="border-b border-[var(--oc-line)]">
              {canBulkEdit ? (
                <SelectAllCell selection={selection} />
              ) : null}
              {[
                "Ажилтан",
                "Имэйл",
                "Утас",
                "Үүрэг",
                ...(hideBranches ? [] : ["Салбар"]),
                "Төлөв",
                "Хугацаа",
                "Үйлдэл",
              ].map((h) => (
                <th
                  key={h}
                  className="text-left font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-5 py-3"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--oc-line)]" {...selection.dragArea}>
            {rows.map((u) => {
              const initials = ((u.lastName[0] ?? "") + (u.firstName[0] ?? "")).toUpperCase();
              const href = `/dashboard/employees/${u.id}`;
              return (
                <ClickableRow key={u.id} href={href}>
                  {canBulkEdit ? (
                    <SelectRowCell
                      selection={selection}
                      id={u.id}
                      label={`${u.lastName} ${u.firstName} сонгох`}
                    />
                  ) : null}
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full border border-[var(--oc-line)] bg-[var(--oc-panel2)] flex items-center justify-center text-xs font-bold text-[var(--oc-ink2)] shrink-0">
                        {initials}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-[var(--oc-ink)] flex items-center gap-1.5">
                          {u.lastName} {u.firstName}
                          {u.isMe ? (
                            <span className="font-plex-mono text-[10px] text-[var(--oc-accent)]">
                              (та)
                            </span>
                          ) : null}
                          {!u.verified ? (
                            <span title="Ажилтан анхны нэвтрэлт хийж нууц үгээ үүсгээгүй байна.">
                              <Chip tone="accent" bordered>идэвхжээгүй</Chip>
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 font-plex-mono text-sm text-[var(--oc-muted2)]">
                    {u.email}
                  </td>
                  <td className="px-5 py-4 font-plex-mono text-sm text-[var(--oc-muted2)] whitespace-nowrap">
                    {u.phone}
                  </td>
                  <td className="px-5 py-4">
                    {u.isOwner ? (
                      <Chip tone="accent">Админ</Chip>
                    ) : u.roleName ? (
                      <Chip tone="neutral" bordered>{u.roleName}</Chip>
                    ) : (
                      <span className="text-xs text-[var(--oc-muted4)]">—</span>
                    )}
                  </td>
                  {hideBranches ? null : (
                    <td className="px-5 py-4 text-sm text-[var(--oc-muted2)]">
                      {u.branchName ?? "—"}
                    </td>
                  )}
                  <td className="px-5 py-4">
                    <StatusPill
                      isActive={u.isActive}
                      activeUntil={u.activeUntil}
                      deactivatedAt={u.deactivatedAt}
                    />
                  </td>
                  <td className="px-5 py-4 font-plex-mono text-xs text-[var(--oc-muted3)] whitespace-nowrap">
                    {u.activeUntil ? new Date(u.activeUntil).toLocaleDateString("mn-MN") : "—"}
                  </td>
                  <td className="px-5 py-4">
                    <EmployeeRowActions
                      employee={u}
                      canModify={canModify}
                      canRemove={canRemove}
                    />
                  </td>
                </ClickableRow>
              );
            })}
          </tbody>
        </table>
      </div>

      {pickerOpen ? (
        <BulkRoleBranchModal
          employeeIds={[...selection.selected]}
          roles={roles}
          branches={branches}
          hideBranches={hideBranches}
          onClose={() => setPickerOpen(false)}
          onDone={() => {
            setPickerOpen(false);
            selection.clear();
          }}
        />
      ) : null}
    </>
  );
}

function StatusPill({
  isActive,
  activeUntil,
  deactivatedAt,
}: {
  isActive: boolean;
  activeUntil: string | null;
  deactivatedAt: string | null;
}) {
  const expired = activeUntil != null && new Date(activeUntil).getTime() <= Date.now();
  // Self-deactivated (reversible on next login) is distinct from
  // admin-blocked (isActive: false, deactivatedAt: null) — isActive stays
  // true while deactivatedAt is set, so this must be checked before the
  // isActive branch below.
  if (deactivatedAt) {
    return (
      <span title="Ажилтан өөрөө бүртгэлээ идэвхгүй болгосон — дахин нэвтэрснээр идэвхжинэ.">
        <Chip tone="accent" bordered>Өөрөө идэвхгүй болгосон</Chip>
      </span>
    );
  }
  if (!isActive) {
    return <Chip tone="neutral">Идэвхгүй</Chip>;
  }
  if (expired) {
    return <Chip tone="danger">Хугацаа дууссан</Chip>;
  }
  if (activeUntil) {
    return <Chip tone="accent">Түр</Chip>;
  }
  return <Chip tone="ok">Идэвхтэй</Chip>;
}

function EmployeeRowActions({
  employee,
  canModify,
  canRemove,
}: {
  employee: { id: string; lastName: string; firstName: string; isActive: boolean; isOwner: boolean; isMe: boolean };
  canModify: boolean;
  canRemove: boolean;
}) {
  const showToggle = canModify && !employee.isMe && !employee.isOwner;
  const showDelete = canRemove && !employee.isMe && !employee.isOwner;
  if (!showToggle && !showDelete) return null;

  return (
    <RowActionsMenu>
      {showToggle ? (
        <RowMenuFormItem
          action={toggleEmployeeActiveAction}
          hidden={{ id: employee.id, isActive: employee.isActive ? "" : "on" }}
        >
          {employee.isActive ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
        </RowMenuFormItem>
      ) : null}
      {showDelete ? (
        <RowMenuFormItem
          action={deleteEmployeeAction}
          hidden={{ id: employee.id }}
          confirmMessage={`"${employee.lastName} ${employee.firstName}" ажилтныг устгах уу?`}
          destructive
        >
          Устгах
        </RowMenuFormItem>
      ) : null}
    </RowActionsMenu>
  );
}

function BulkRoleBranchModal({
  employeeIds,
  roles,
  branches,
  hideBranches,
  onClose,
  onDone,
}: {
  employeeIds: string[];
  roles: RoleOption[];
  branches: BranchOption[];
  hideBranches: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [roleId, setRoleId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [state, formAction, pending] = useActionState<BulkActionState, FormData>(
    bulkUpdateEmployeeRoleBranchAction,
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
    <Modal
      open
      onClose={onClose}
      title={hideBranches ? "Үүрэг солих" : "Үүрэг/Салбар солих"}
      widthClassName="max-w-md"
    >
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="employeeIdsJson" value={JSON.stringify(employeeIds)} />
        <p className="text-sm text-[var(--oc-muted2)]">
          {hideBranches
            ? `${employeeIds.length} ажилтны үүргийг нэг зэрэг солих гэж байна.`
            : `${employeeIds.length} ажилтны үүрэг ба/эсвэл үндсэн салбарыг нэг зэрэг солих гэж байна.`}{" "}
          Зөвхөн доор сонгосон талбарууд өөрчлөгдөнө (Тенант админ хамрагдахгүй).
        </p>
        <div>
          <label className="text-xs text-[var(--oc-muted3)] mb-1 block">Шинэ үүрэг</label>
          <Select
            name="roleId"
            value={roleId}
            onChange={setRoleId}
            placeholder="— Өөрчлөхгүй —"
            options={roles.map((r) => ({ value: r.id, label: r.name }))}
          />
        </div>
        {hideBranches ? null : (
          <div>
            <label className="text-xs text-[var(--oc-muted3)] mb-1 block">Шинэ үндсэн салбар</label>
            <Select
              name="branchId"
              value={branchId}
              onChange={setBranchId}
              placeholder="— Өөрчлөхгүй —"
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
            />
          </div>
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
          <Btn type="submit" disabled={pending || (!roleId && !branchId)}>
            {pending ? "Хадгалж..." : "Хадгалах"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
