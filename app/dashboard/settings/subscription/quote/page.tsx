import Link from "next/link";
import { QuoteRequestForm } from "@/app/_components/quote-request-form";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Энтерпрайз — үнийн санал авах" };

export default async function DashboardQuotePage() {
  const user = await requireUser();
  return (
    <div className="p-4 sm:p-6 max-w-3xl w-full">
      <Link
        href="/dashboard/settings/subscription"
        className="text-sm text-[var(--oc-muted3)] hover:text-[var(--oc-muted)]"
      >
        ← Багц руу буцах
      </Link>
      <h1 className="mt-3 text-2xl font-semibold text-[var(--oc-ink)]">Энтерпрайз — үнийн санал авах</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--oc-muted3)]">
        Хэрэгтэй модулиудаа сонгоод илгээнэ үү. Үнийн саналыг бэлтгээд удахгүй тантай холбогдоно.
      </p>
      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6">
        <QuoteRequestForm
          source="dashboard"
          defaults={{
            orgName: user.tenant.name,
            contactName: `${user.lastName} ${user.firstName}`.trim(),
            phone: user.phone,
            email: user.email,
          }}
        />
      </div>
    </div>
  );
}
