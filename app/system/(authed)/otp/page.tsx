import Link from "next/link";
import { EmptyState } from "@/app/_components/empty-state";
import { PageHeader } from "@/app/_components/page-header";
import { requireSuperAdmin } from "@/lib/auth/system";
import { getDevOtps, type OtpType } from "@/lib/auth/otp";

export const metadata = {
  title: "OTP кодууд",
};

// Шинэ код бүрт хуудас сэргээгдэх ёстой тул кэшлэхгүй.
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<OtpType, string> = {
  SIGNUP: "Бүртгэл",
  CHANGE_PASSWORD: "Нууц үг солих",
  RESET_PASSWORD: "Нууц үг сэргээх",
  CONSUMER_LOGIN: "Нэвтрэх (Account)",
  SET_PASSWORD: "Аккаунт идэвхжүүлэх",
  ACCOUNT_CLOSE: "Бүртгэл хаах",
  ACCOUNT_PASSWORD: "Нууц үг (Account)",
};

export default async function SystemOtpPage() {
  await requireSuperAdmin();

  const otps = getDevOtps();
  const now = Date.now();

  return (
    <div className="p-6 sm:p-8 max-w-4xl">
      <PageHeader
        title="OTP кодууд"
        description="Хэрэглэгч/ажилтны SMS-ээр хүлээж авах ёстой кодыг олж чадаагүй үед (support) шалгах зориулалттай. Зөвхөн санах ойд хадгалагдана (DB-д биш), сервер дахин ачаалахад арилна."
        actions={
          <Link
            href="/system/otp"
            className="text-sm border border-[var(--oc-line)] hover:border-[var(--oc-line2)] hover:bg-[var(--oc-panel2)] transition-colors px-4 py-2 rounded-lg font-medium text-[var(--oc-ink2)]"
          >
            ↻ Сэргээх
          </Link>
        }
      />

      {otps.length === 0 ? (
        <EmptyState padding="p-8">
          OTP код алга. Бүртгэл / нууц үг сэргээх үйлдэл хийгээд энэ хуудсыг
          сэргээнэ үү.
        </EmptyState>
      ) : (
        <div className="rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-[var(--oc-line2)]">
                {["Код", "Төрөл", "Имэйл / Утас", "Үүссэн", "Төлөв"].map((h) => (
                  <th
                    key={h}
                    className="text-left text-xs text-[var(--oc-muted4)] font-medium px-5 py-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {otps.map((o, i) => {
                const expired = o.expiresAt.getTime() <= now;
                return (
                  <tr
                    key={`${o.code}-${i}`}
                    className="border-b border-[var(--oc-line2)] last:border-0"
                  >
                    <td className="px-5 py-4">
                      <span
                        className={`font-mono text-lg font-bold tracking-widest tabular-nums ${
                          expired ? "text-[var(--oc-muted3)] line-through" : "text-emerald-300 light:text-emerald-700"
                        }`}
                      >
                        {o.code}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-[var(--oc-muted)]">
                      {TYPE_LABEL[o.type]}
                    </td>
                    <td className="px-5 py-4 text-sm text-[var(--oc-muted)]">
                      {o.email ?? o.phone}
                    </td>
                    <td className="px-5 py-4 text-xs text-[var(--oc-muted3)]">
                      {o.createdAt.toLocaleTimeString("mn-MN", { hour12: false })}
                    </td>
                    <td className="px-5 py-4">
                      {expired ? (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 light:bg-red-100 light:border-red-300 light:text-red-700">
                          Хугацаа дууссан
                        </span>
                      ) : (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 light:bg-emerald-100 light:border-emerald-300 light:text-emerald-700">
                          Хүчинтэй
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
