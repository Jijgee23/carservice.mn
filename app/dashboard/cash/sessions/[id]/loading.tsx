export default function Loading() {
  return (
    <div className="p-4 sm:p-6 animate-pulse">
      <div className="h-7 w-48 rounded-lg bg-[var(--oc-panel2)] mb-6" />
      <div className="flex gap-2 mb-4">
        <div className="h-9 w-40 rounded-lg bg-[var(--oc-panel2)]" />
        <div className="h-9 w-32 rounded-lg bg-[var(--oc-panel2)]" />
      </div>
      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] h-96" />
    </div>
  );
}
