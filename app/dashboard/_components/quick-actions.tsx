import Link from "next/link";

/**
 * Байнгын түргэн үйлдэл: улсын дугаар/хуудасны дугаараар хайх + «Шинэ хуудас».
 * Server component — хайлт нь энгийн GET form (JS шаардахгүй), /dashboard/orders
 * `?q=`-г дугаар, үйлчлүүлэгч, машинаар шүүдэг (orders/page.tsx).
 */
export function QuickActions({ canCreateOrder }: { canCreateOrder: boolean }) {
  return (
    <div className="flex items-stretch gap-2 min-w-0 sm:w-[22rem] shrink-0">
      <form action="/dashboard/orders" method="get" role="search" className="flex-1 min-w-0">
        <label htmlFor="quick-plate-search" className="sr-only">
          Дугаараар хайх
        </label>
        <input
          id="quick-plate-search"
          name="q"
          type="search"
          inputMode="search"
          autoComplete="off"
          maxLength={40}
          placeholder="Дугаар, хуудас хайх…"
          className="h-full w-full min-h-11 rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel)] px-3 text-sm text-[var(--oc-ink)] placeholder:text-[var(--oc-muted3)] focus:border-[var(--oc-line2)] focus:outline-none"
        />
      </form>
      {canCreateOrder ? (
        <Link
          href="/dashboard/orders/new"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-[var(--oc-accent)] px-3 text-sm font-medium text-[var(--oc-carbon)] hover:opacity-90"
        >
          + Шинэ хуудас
        </Link>
      ) : null}
    </div>
  );
}
