import { requireAccount } from "@/lib/auth/account";
import { formatPhone } from "@/lib/phone";
import { PasswordForm } from "./password-form";

export const metadata = {
  title: "Нууц үг",
};

export const dynamic = "force-dynamic";

function fmtDate(d: Date): string {
  return d.toLocaleDateString("mn-MN", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit" });
}

export default async function AccountSecurityPage() {
  const account = await requireAccount();
  const hasPassword = Boolean(account.passwordHash);

  return (
    <div className="w-full flex flex-col gap-3.5 max-w-xl">
      <h1 className="font-semibold text-[var(--oc-ink2)] text-sm">Нууц үг</h1>
      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-5 flex flex-col gap-4">
        <div className="text-sm text-[var(--oc-ink2)]">
          {hasPassword ? (
            <>
              Нууц үг тохируулсан
              {account.passwordUpdatedAt ? <span className="text-[var(--oc-muted3)]"> ({fmtDate(account.passwordUpdatedAt)})</span> : null}. {formatPhone(account.phone)} +
              нууц үгээр эсвэл SMS кодоор нэвтэрнэ.
            </>
          ) : (
            <>Нууц үг тохируулаагүй — одоогоор зөвхөн SMS кодоор нэвтэрнэ. Тохируулбал утас + нууц үгээр шууд нэвтэрч болно.</>
          )}
        </div>
        {/* Only whether a password exists reaches the client — never the hash. */}
        <PasswordForm hasPassword={hasPassword} />
      </div>
    </div>
  );
}
