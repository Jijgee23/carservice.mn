import Link from "next/link";

/** Money writes (any payment method) are refused server-side while the branch has no open cash session. */
export const NO_OPEN_SESSION_REASON = "Касс нээгээгүй байна. Эхлээд кассаа нээнэ үү.";

/** Reason text + link to the register page; shown next to a DISABLED money action. */
export function NoOpenSessionNotice({ className = "" }: { className?: string }) {
  return (
    <p role="status" className={`text-xs text-[var(--oc-warn)] ${className}`}>
      {NO_OPEN_SESSION_REASON}{" "}
      <Link href="/dashboard/cash/sessions" className="underline text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]">
        Касс нээх
      </Link>
    </p>
  );
}
