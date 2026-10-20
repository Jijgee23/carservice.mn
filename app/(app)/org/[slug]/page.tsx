import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAccountVehicles } from "@/lib/account-vehicles-catalog";
import { getAccount } from "@/lib/auth/account";
import { openWeekdaysOf } from "@/lib/branches";
import { branchScheduleDisplaySelect } from "@/lib/branch-effective-schedule-server";
import { resolveCategoryDurationMinutes } from "@/lib/category-duration";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";
import { absoluteUrl, orgDescription, orgJsonLd, orgUrl } from "@/lib/seo";
import { JsonLd } from "@/app/_components/json-ld";
import { BookingForm } from "./booking-form";

export const dynamic = "force-dynamic";

async function loadOrg(slug: string) {
  return await prisma.tenant.findFirst({
    where: { slug, acceptsOnlineBooking: true, suspended: false, isTest: false },
    select: {
      id: true,
      slug: true,
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
  const [vehicles, categoryRows] = await Promise.all([
    // Хэрэглэгчийн бүх машин — өөрөө нэмсэн (AccountVehicle) дээр нэмээд
    // сервисүүдэд бүртгэлтэй, энэ хэрэглэгчид холбогдсон машинууд
    // (/account/vehicles хуудастай ижил логик). Утга нь global Vehicle id.
    account ? loadAccountVehicles(account.id, account.phone) : Promise.resolve([]),
    // Идэвхтэй ангилал + аль салбарт хамаарах (хоосон бол бүх салбарт) +
    // tenant-ийн default хугацаа (booking v2, `/api/v1/app/orgs/[slug]`-тэй адил).
    prisma.category.findMany({
      where: { tenantId: org.id, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        durationMinutes: true,
        branches: { select: { id: true } },
      },
    }),
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
    <div className="flex flex-col gap-6">
      <JsonLd data={orgJsonLd(org, org.branches)} />
      <Link
        href="/discover"
        className="text-sm text-white/40 hover:text-white/70 transition-colors"
      >
        ← Бүх газар
      </Link>

      <div className="flex items-center gap-4">
        {org.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={org.logoUrl}
            alt=""
            className="w-16 h-16 rounded-2xl object-contain bg-white/[0.04] border border-white/[0.06] shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/30 to-blue-500/30 border border-white/[0.06] shrink-0 flex items-center justify-center text-xl font-bold text-white/70">
            {org.name.slice(0, 1)}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold">
            {lockedBranch ? lockedBranch.name : org.name}
          </h1>
          <p className="text-white/40 text-sm mt-0.5">
            {lockedBranch ? `${org.name} · ${org.phone1}` : org.phone1}
          </p>
        </div>
      </div>

      {/* Захиалга */}
      <div className="w-full">
        <div className="glass rounded-2xl p-5 border border-white/[0.08]">
          <h2 className="font-semibold mb-4">Цаг захиалах</h2>
          {bookingBranches.length === 0 ? (
            <p className="text-sm text-white/40">
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
            />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-white/50">
                Цаг захиалахын тулд эхлээд нэвтэрнэ үү.
              </p>
              <Link
                href="/login"
                className="self-start bg-violet-600 hover:bg-violet-500 transition-colors px-5 py-2.5 rounded-xl font-medium text-sm"
              >
                Нэвтрэх / Бүртгүүлэх →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
