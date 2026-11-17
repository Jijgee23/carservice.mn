import type { ReactNode } from "react";

// Засах эрхгүй (зөвхөн `.view`) ажилтанд — жишээ нь засварчин — дэлгэрэнгүй
// хуудсанд маягтын оронд харуулах уншихад зориулсан мэдээлэл. Хоосон утгыг «—».
export function ReadOnlyDetails({
  title,
  rows,
  note,
}: {
  title: string;
  rows: Array<{ label: string; value: ReactNode; mono?: boolean }>;
  note?: string;
}) {
  return (
    <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-5">
      <h2 className="font-semibold text-[var(--oc-ink)] text-sm mb-4">{title}</h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0">
            <dt className="text-xs text-[var(--oc-muted3)]">{r.label}</dt>
            <dd
              className={`mt-0.5 text-sm text-[var(--oc-ink2)] break-words ${r.mono ? "font-plex-mono" : ""}`}
            >
              {r.value === null || r.value === undefined || r.value === "" ? "—" : r.value}
            </dd>
          </div>
        ))}
      </dl>
      {note ? <p className="mt-4 text-xs text-[var(--oc-muted3)]">{note}</p> : null}
    </div>
  );
}
