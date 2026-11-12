"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Btn, Chip } from "@/app/_components/landing-ops-ui";
import { Modal } from "@/app/_components/modal";
import { RowActionsMenu, RowMenuButton } from "@/app/_components/row-actions";
import { SelectAllCell, SelectRowCell, SelectionActions, useRowSelection } from "@/app/_components/row-selection";
import { SortableTh, TH_CLASS } from "@/app/_components/sortable-th";
import type { SortDir } from "@/lib/list-sort";
import type { AdminBulkOp, AdminBulkResult } from "@/lib/system-admin-bulk";

/**
 * Super admin-ы лавлах жагсаалтуудын (нэгдсэн сан, сэлбэгийн ангилал,
 * системийн ангилал) нийтлэг хүснэгт: мөр сонголт (checkbox / чирэх / баруун
 * товч), эрэмбэлэх толгой, мөрийн «⋯» цэс (засах, идэвхжүүлэх/идэвхгүй
 * болгох, устгах) ба олноор идэвхжүүлэх/идэвхгүй болгох/устгах.
 *
 * Шүүлт, эрэмбэ, хуудаслалт нь server талд (URL параметр) — энэ компонент
 * зөвхөн харуулж, `bulkAction` server action-ийг дуудна. Хэрэглэгдэж буй мөр
 * устгахад server нь устгахын оронд идэвхгүй болгодог (`deactivated`).
 */

export type AdminColumn = {
  label: string;
  /** Өгвөл толгой дээр дарж эрэмбэлнэ (`?sort=` утга). */
  sortKey?: string;
  className?: string;
};

export type AdminRow = {
  id: string;
  name: string;
  href: string;
  isActive: boolean;
  /** Нэрийн доорх жижиг мөр (тайлбар, код г.м.). */
  sub?: ReactNode;
  /** Нэр, төлөвөөс бусад багануудын нүд — `columns`-ийн дараалалтай ижил. */
  cells: ReactNode[];
};

const TD = "px-4 py-2.5 text-sm";

export function AdminListTable({
  rows,
  columns,
  nameLabel = "Нэр",
  noun,
  sort,
  bulkAction,
  deleteNote,
}: {
  rows: AdminRow[];
  columns: AdminColumn[];
  nameLabel?: string;
  /** "{N} {noun} сонгогдсон" — ж: "ангилал". */
  noun: string;
  sort: { key: string; dir: SortDir };
  bulkAction: (ids: string[], op: AdminBulkOp) => Promise<AdminBulkResult>;
  /** Устгах баталгаажуулалтад харуулах тайлбар. */
  deleteNote: string;
}) {
  const router = useRouter();
  const selection = useRowSelection(rows);
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);

  function run(ids: string[], op: AdminBulkOp) {
    if (ids.length === 0) return;
    setNotice(null);
    start(async () => {
      const res = await bulkAction(ids, op);
      setConfirmIds(null);
      if (!res.ok) {
        setNotice({ ok: false, text: res.message });
        return;
      }
      setNotice({ ok: true, text: summarize(res, op) });
      selection.clear();
      router.refresh();
    });
  }

  const selectedIds = [...selection.selected];
  const confirmRows = rows.filter((r) => confirmIds?.includes(r.id));

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div aria-live="polite" className="empty:hidden">
        {notice ? (
          <p
            role={notice.ok ? "status" : "alert"}
            className={`rounded-[10px] border px-4 py-2.5 text-sm ${
              notice.ok
                ? "border-[var(--oc-line)] bg-[var(--oc-panel)] text-[var(--oc-ink2)]"
                : "border-red-500/30 bg-red-500/10 text-red-400 light:text-red-600"
            }`}
          >
            {notice.text}
          </p>
        ) : null}
      </div>

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
        <SelectionActions
          selection={selection}
          noun={noun}
          actions={[
            { label: "Идэвхжүүлэх", onSelect: () => run(selectedIds, "activate"), disabled: pending, variant: "ghost" },
            { label: "Идэвхгүй болгох", onSelect: () => run(selectedIds, "deactivate"), disabled: pending, variant: "ghost" },
            { label: "Устгах", onSelect: () => setConfirmIds(selectedIds), disabled: pending },
          ]}
        />
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-[var(--oc-line)]">
                <SelectAllCell selection={selection} className="w-10 pl-4 pr-1 py-2.5" />
                <SortableTh label={nameLabel} sortKey="name" current={sort} className={`${TH_CLASS} px-4`} />
                {columns.map((c) =>
                  c.sortKey ? (
                    <SortableTh key={c.label} label={c.label} sortKey={c.sortKey} current={sort} className={`${TH_CLASS} px-4 ${c.className ?? ""}`} />
                  ) : (
                    <th key={c.label} className={`${TH_CLASS} px-4 ${c.className ?? ""}`}>
                      {c.label}
                    </th>
                  ),
                )}
                <th className={`${TH_CLASS} px-4`}>Төлөв</th>
                <th className={`${TH_CLASS} px-4 w-12`}>
                  <span className="sr-only">Үйлдэл</span>
                </th>
              </tr>
            </thead>
            <tbody {...selection.dragArea} className="divide-y divide-[var(--oc-line)]">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`hover:bg-white/[0.02] ${selection.selected.has(r.id) ? "bg-[var(--oc-accent)]/[0.06]" : ""} ${
                    r.isActive ? "" : "opacity-70"
                  }`}
                >
                  <SelectRowCell selection={selection} id={r.id} label={`Сонгох: ${r.name}`} className="w-10 pl-4 pr-1 py-2.5" />
                  <td className={TD}>
                    <Link href={r.href} className="font-medium text-[var(--oc-ink)] hover:underline">
                      {r.name}
                    </Link>
                    {r.sub ? <div className="mt-0.5 text-xs text-[var(--oc-muted3)] line-clamp-1">{r.sub}</div> : null}
                  </td>
                  {r.cells.map((cell, i) => (
                    <td key={columns[i]?.label ?? i} className={`${TD} ${columns[i]?.className ?? ""}`}>
                      {cell}
                    </td>
                  ))}
                  <td className={TD}>
                    <Chip tone={r.isActive ? "ok" : "neutral"}>{r.isActive ? "Идэвхтэй" : "Идэвхгүй"}</Chip>
                  </td>
                  <td className="px-2 py-1 text-right">
                    <RowActionsMenu>
                      <RowMenuButton onClick={() => router.push(r.href)}>Засах</RowMenuButton>
                      <RowMenuButton onClick={() => run([r.id], r.isActive ? "deactivate" : "activate")} disabled={pending}>
                        {r.isActive ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
                      </RowMenuButton>
                      <RowMenuButton destructive onClick={() => setConfirmIds([r.id])} disabled={pending}>
                        Устгах
                      </RowMenuButton>
                    </RowActionsMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={confirmIds !== null} onClose={() => setConfirmIds(null)} title="Устгах" widthClassName="max-w-md">
        <div className="flex flex-col gap-3 text-sm text-[var(--oc-ink2)]">
          <p>
            Сонгосон <b className="text-[var(--oc-ink)]">{confirmRows.length}</b> мөрийг устгах уу?
          </p>
          <ul className="list-disc pl-5 text-xs text-[var(--oc-muted3)] max-h-40 overflow-auto">
            {confirmRows.map((r) => (
              <li key={r.id}>{r.name}</li>
            ))}
          </ul>
          <p className="text-xs text-[var(--oc-muted3)]">{deleteNote}</p>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Btn type="button" variant="ghost" size="md" onClick={() => setConfirmIds(null)} disabled={pending}>
              Болих
            </Btn>
            <Btn type="button" variant="danger" size="md" disabled={pending} onClick={() => run(confirmIds ?? [], "delete")}>
              {pending ? "Устгаж байна…" : "Устгах"}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function summarize(res: Extract<AdminBulkResult, { ok: true }>, op: AdminBulkOp): string {
  const parts: string[] = [];
  if (op === "delete") {
    if (res.deleted) parts.push(`${res.deleted} мөр устгагдлаа.`);
    if (res.deactivated) parts.push(`${res.deactivated} мөр ашиглагдаж байгаа тул устгалгүй идэвхгүй болголоо.`);
  } else if (res.updated) {
    parts.push(`${res.updated} мөр ${op === "activate" ? "идэвхжлээ" : "идэвхгүй боллоо"}.`);
  }
  if (res.notFound) parts.push(`${res.notFound} мөр олдсонгүй.`);
  return parts.join(" ") || "Өөрчлөгдөх мөр алга.";
}

/** Хүснэгтэд ашиглах жижиг тоон нүд. */
export function NumCell({ children }: { children: ReactNode }) {
  return <span className="font-plex-mono tabular-nums text-[var(--oc-muted2)]">{children}</span>;
}
