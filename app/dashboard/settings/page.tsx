import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getEnabledModules } from "@/lib/plan-modules-server";
import { prisma } from "@/lib/prisma";
import { CreditScoreCard } from "@/app/_components/credit-score-card";
import type { CreditBreakdown } from "@/lib/credit-score";
import { getCreditSettings } from "@/lib/credit-score-server";
import { AppointmentReminderForm } from "./appointment-reminder-form";
import { LogoForm } from "./logo-form";
import { TenantForm } from "./tenant-form";

export const metadata = {
  title: "Байгууллагын тохиргоо",
};

function SectionPanel({
  index,
  total,
  title,
  description,
  children,
}: {
  index: number;
  total: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="font-semibold text-[var(--oc-ink)]">{title}</h2>
          {description ? (
            <p className="text-xs text-[var(--oc-muted3)] mt-0.5">{description}</p>
          ) : null}
        </div>
        <span className="font-plex-mono text-[11px] text-[var(--oc-muted3)] shrink-0">
          {String(index).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </div>
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const user = await requireUser();
  const modules = await getEnabledModules(user.tenant.plan);

  const tenant = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
  });
  if (!tenant) redirect("/dashboard");
  const creditSettings = await getCreditSettings();

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Байгууллагын тохиргоо</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          Лого, нэр, регистр зэрэг тенант-ын мэдээлэл.
        </p>
      </div>

      <div className="grid gap-6">
        <SectionPanel
          index={1}
          total={5}
          title="Лого"
          description="Платформ дотор болон нэхэмжлэхэд харагдана."
        >
          <LogoForm currentLogoUrl={tenant.logoUrl} />
        </SectionPanel>

        <SectionPanel
          index={2}
          total={5}
          title="Үндсэн мэдээлэл"
          description="Нэр, регистр, харилцагч мэдээлэл."
        >
          <TenantForm
            initial={{
              name: tenant.name,
              registerNumber: tenant.registerNumber,
              email: tenant.email ?? "",
              phone1: tenant.phone1,
              phone2: tenant.phone2,
              acceptsOnlineBooking: tenant.acceptsOnlineBooking,
              requireCashSession: tenant.requireCashSession,
            }}
            onlineBookingInPlan={modules.has("online_booking")}
          />
        </SectionPanel>

        {modules.has("enable_appointments") ? (
          <SectionPanel
            index={3}
            total={5}
            title="Цаг захиалгын сануулга"
            description="Товлосон цагаас хэдэн хугацааны өмнө үйлчлүүлэгчид сануулга илгээхийг тохируулна."
          >
            <AppointmentReminderForm
              initialMinutes={tenant.appointmentReminderLeadMinutes}
            />
          </SectionPanel>
        ) : null}

        <SectionPanel
          index={4}
          total={5}
          title="Credit score"
          description="Үйлчлүүлэгчийн үнэлгээ, цаг захиалга баталсан, засвар дуусгасан, хугацаандаа дуусгасан хувиас өдөр бүр тооцогдоно."
        >
          <CreditScoreCard
            score={tenant.creditScore}
            breakdown={tenant.creditBreakdown as CreditBreakdown | null}
            updatedAt={tenant.creditUpdatedAt}
            threshold={creditSettings.threshold}
            blocked={tenant.creditSuspended ? "suspended" : tenant.creditHidden ? "hidden" : null}
          />
        </SectionPanel>

        <SectionPanel index={5} total={5} title="Бусад">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <Row label="Slug">
              <span className="font-plex-mono text-[var(--oc-ink2)]">{tenant.slug}</span>
            </Row>
            <Row label="Багц">
              <span className="text-[var(--oc-ink2)]">{tenant.plan}</span>
            </Row>
            <Row label="Бүртгүүлсэн">
              <span className="text-[var(--oc-ink2)]">
                {tenant.createdAt.toLocaleDateString("mn-MN")}
              </span>
            </Row>
          </dl>
        </SectionPanel>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-[var(--oc-muted3)]">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
