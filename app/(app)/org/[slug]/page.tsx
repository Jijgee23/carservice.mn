import { BOOKABLE_CATEGORY_WHERE } from "@/lib/categories";
import { getBookingFeeNotice } from "@/lib/platform-settings";
import {
  BackLink,
  LoginPrompt,
  Panel,
  PlaceHeader,
} from "@/app/(app)/_components/consumer-ui";
import { notFound, redirect } from "next/navigation";
import { loadAccountVehicles } from "@/lib/account-vehicles-catalog";
import { getAccount } from "@/lib/auth/account";
import { openWeekdaysOf } from "@/lib/branches";
import { branchScheduleDisplaySelect } from "@/lib/branch-effective-schedule-server";
import { resolveCategoryDurationMinutes } from "@/lib/category-duration";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { plansWithFeature } from "@/lib/plan-limits-server";
import { prisma } from "@/lib/prisma";
import { isTenantBookable, PUBLIC_TENANT_WHERE } from "@/lib/tenant-visibility";
import { setBypassContext } from "@/lib/tenant-context";
import { absoluteUrl, orgDescription, orgJsonLd, orgUrl } from "@/lib/seo";
import { JsonLd } from "@/app/_components/json-ld";
import { BookingForm } from "./booking-form";

export const dynamic = "force-dynamic";

// Олон нийтэд харагдах газар. Онлайн захиалга авдаггүй (`bookable` false)
// бол энэ (захиалгын) хуудас салбарын дэлгэрэнгүй рүү шилжүүлнэ.
async function loadOrg(slug: string) {
  return await prisma.tenant.findFirst({
    where: { slug, ...PUBLIC_TENANT_WHERE },
    select: {
      id: true,
      slug: true,
      acceptsOnlineBooking: true,
      plan: true,
      name: true,
      logoUrl: true,
      phone1: true,
      branches: {
        where: { isActive: true },
        orderBy: { isPrimary: "desc" },
        select: {
          id: true,
          name: true,
          // SEO (тайлбар, JSON-LD хаяг/байршил/утас).
          phone: true,
          city: true,
          district: true,
          khoroo: true,
          address: true,
          latitude: true,
          longitude: true,
          ...branchScheduleDisplaySelect(),
        },
      },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  // Next.js `generateMetadata`-г Page component-оос тусад нь (өөр async
  // context-д) дуудна тул тэндэх setBypassContext() энд үзэгдэхгүй.
  setBypassContext();
  const { slug } = await params;
  const org = await loadOrg(slug);
  if (!org) return { title: "Олдсонгүй", robots: { index: false } };
  const description = orgDescription(org, org.branches);
  const title = `${org.name} — Автозасвар, автосервис · Цаг захиалах`;
  return {
    title,
    description,
    alternates: { canonical: orgUrl(org) },
    openGraph: {
      title,
      description,
      url: orgUrl(org),
      type: "website",
      ...(org.logoUrl ? { images: [{ url: absoluteUrl(org.logoUrl), alt: org.name }] } : {}),
    },
  };
}

export default async function OrgPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { slug } = await params;
  const { branch: branchParam } = await searchParams;
  // Нэвтрээгүй зочид ч үзэх нийтэд нээлттэй хуудас — slug-аар олох Tenant
  // хараахан тодорхойгүй, доор Account-ийн машины жагсаалт бас cross-tenant
  // (өөр tenant-д бүртгэгдсэн машиныг ч харуулна) тул bypass ашиглана.
  setBypassContext();
  const org = await loadOrg(slug);
  if (!org) notFound();
  const bookable = isTenantBookable(
    org,
    await plansWithFeature(PLAN_LIMIT_CODES.ENABLE_APPOINTMENTS),
  );
  if (!bookable) {
    // Захиалга авдаггүй — захиалгын маягтын оронд салбарын мэдээлэл (утас,
    // хаяг, цаг) руу. redirect() exception шиддэг тул try/catch-гүй.
    const target =
      org.branches.find((b) => b.id === branchParam) ?? org.branches[0];
    if (!target) notFound();
    redirect(`/org/${org.slug}/branch/${encodeURIComponent(target.id)}`);
  }

  // Discover-ийн салбарын дэлгэрэнгүйгээс тодорхой салбар сонгож ирсэн бол
  // (`?branch=`) байгууллага/салбарын сонголтыг ТҮГЖИНЭ — хэрэглэгч зөвхөн
  // ангилал, огноо/цагаа сонгоно. Энэ нь "салбараар захиалах" (branch-first)
  // урсгалыг "ангилалаар захиалах" (category-first, /book) урсгалаас цэвэр
  // тусгаарлана: BookingForm-д зөвхөн ЭНЭ ГАНЦ салбарыг дамжуулснаар (доор)
  // салбар сэлгэх сонголт бүхэлдээ алга болно (branches.length === 1 бол
  // booking-form.tsx салбар сонгох Select-ийг рендерлэдэггүй) — категори
  // сонгоход өөр салбар руу чимээгүйгээр шилжих боломж ч үгүй болно.
  const lockedBranch = branchParam
    ? org.branches.find((b) => b.id === branchParam)
    : undefined;
  const initialBranchId = lockedBranch?.id ?? "";
  const bookingBranches = lockedBranch ? [lockedBranch] : org.branches;

  const account = await getAccount();
  const [vehicles, categoryRows, bookingFee] = await Promise.all([
    // Хэрэглэгчийн бүх машин — өөрөө нэмсэн (AccountVehicle) дээр нэмээд
    // сервисүүдэд бүртгэлтэй, энэ хэрэглэгчид холбогдсон машинууд
    // (/account/vehicles хуудастай ижил логик). Утга нь global Vehicle id.
    account ? loadAccountVehicles(account.id, account.phone) : Promise.resolve([]),
    // Идэвхтэй ангилал + аль салбарт хамаарах (хоосон бол бүх салбарт) +
    // tenant-ийн default хугацаа (booking v2, `/api/v1/app/orgs/[slug]`-тэй адил).
    prisma.category.findMany({
      where: { tenantId: org.id, isActive: true, ...BOOKABLE_CATEGORY_WHERE },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        durationMinutes: true,
        branches: { select: { id: true } },
      },
    }),
    getBookingFeeNotice(),
  ]);
  // Салбар бүрд: тухайн салбарт хамаарах ангилалуудыг шийдэгдсэн хугацаатай нь
  // (category default ?? 30).
  const branchCategories = new Map(
    org.branches.map((b) => [
      b.id,
      categoryRows
        .filter((c) => c.branches.length === 0 || c.branches.some((cb) => cb.id === b.id))
        .map((c) => ({
          id: c.id,
          name: c.name,
          durationMinutes: resolveCategoryDurationMinutes({
            categoryDefault: c.durationMinutes,
          }),
        })),
    ]),
  );

  return (
    <div className="flex flex-col gap-5">
      <JsonLd data={orgJsonLd(org, org.branches)} />
      <BackLink href="/discover">Бүх газар</BackLink>

      <PlaceHeader
        name={org.name}
        logoUrl={org.logoUrl}
        eyebrow={lockedBranch ? org.name : "Онлайн цаг захиалга"}
        title={lockedBranch ? lockedBranch.name : org.name}
        subtitle={
          lockedBranch
            ? org.phone1
            : `${org.branches.length} салбар${org.phone1 ? ` · ${org.phone1}` : ""}`
        }
      />

      <Panel
        title="Цаг захиалах"
        description="Үйлчилгээ, машин, өдөр, цагаа сонгоод захиалгаа илгээнэ үү."
      >
        {bookingBranches.length === 0 ? (
          <p className="text-sm text-[var(--oc-muted3)]">
            Энэ газар идэвхтэй салбаргүй байна.
          </p>
        ) : account ? (
          <BookingForm
            branches={bookingBranches.map((b) => ({
              id: b.id,
              name: b.name,
              openWeekdays: openWeekdaysOf(b),
              schedule: {
                openTime: b.openTime,
                closeTime: b.closeTime,
                schedules: b.schedules,
                scheduleExceptions: b.scheduleExceptions,
                scheduleSeasons: b.scheduleSeasons,
              },
              categories: branchCategories.get(b.id) ?? [],
            }))}
            vehicles={vehicles}
            initialBranchId={initialBranchId}
            bookingFee={bookingFee}
          />
        ) : (
          <LoginPrompt
            next={`/org/${org.slug}${lockedBranch ? `?branch=${encodeURIComponent(lockedBranch.id)}` : ""}`}
          />
        )}
      </Panel>
    </div>
  );
}
