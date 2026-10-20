import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingForm } from "@/app/(app)/org/[slug]/booking-form";
import { loadAccountVehicles } from "@/lib/account-vehicles-catalog";
import { getAccount } from "@/lib/auth/account";
import { openWeekdaysOf } from "@/lib/branches";
import { branchScheduleDisplaySelect } from "@/lib/branch-effective-schedule-server";
import { resolveCategoryDurationMinutes } from "@/lib/category-duration";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

async function loadBranch(branchId: string) {
  return await prisma.branch.findFirst({
    where: {
      id: branchId,
      isActive: true,
      tenant: { acceptsOnlineBooking: true, suspended: false, isTest: false },
    },
    select: {
      id: true,
      name: true,
      tenantId: true,
      ...branchScheduleDisplaySelect(),
      tenant: { select: { name: true, logoUrl: true, phone1: true } },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ branchId: string }>;
}) {
  setBypassContext();
  const { branchId } = await params;
  const branch = await loadBranch(branchId);
  return { title: branch ? `${branch.name} — Цаг захиалах` : "Олдсонгүй" };
}

/**
 * `/book`-ийн олон-tenant category-first урсгалын сүүлчийн алхам: тодорхой
 * нэг салбар аль хэдийн сонгогдсон (`/book` дээр АНД-логикоор шүүгдсэн) тул
 * энд ангилал/салбар дахин сонгуулахгүй — шууд огноо/цагийн сонголт руу
 * (`BookingForm`-ийг `lockCategories` горимоор дахин ашиглана, `/org/[slug]`-
 * тэй яг адил машин/тэмдэглэл/огноо/цаг/илгээх урсгалтай).
 */
export default async function BookBranchPage({
  params,
  searchParams,
}: {
  params: Promise<{ branchId: string }>;
  searchParams: Promise<{ keys?: string }>;
}) {
  const { branchId } = await params;
  const { keys: keysParam } = await searchParams;
  setBypassContext();
  const branch = await loadBranch(branchId);
  if (!branch) notFound();

  const selectedKeyIds = (keysParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const account = await getAccount();
  const [vehicles, categoryRows] = await Promise.all([
    account ? loadAccountVehicles(account.id, account.phone) : Promise.resolve([]),
    prisma.category.findMany({
      where: { tenantId: branch.tenantId, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        durationMinutes: true,
        systemServiceKeyId: true,
        branches: { select: { id: true } },
      },
    }),
  ]);
  const branchCategories = categoryRows
    .filter((c) => c.branches.length === 0 || c.branches.some((b) => b.id === branch.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      systemServiceKeyId: c.systemServiceKeyId,
      durationMinutes: resolveCategoryDurationMinutes({
        categoryDefault: c.durationMinutes,
      }),
    }));

  // `/book`-д сонгосон түлхүүрүүдэд тохирох энэ салбарын ангилалууд.
  const preselectedCategoryIds = branchCategories
    .filter((c) => selectedKeyIds.includes(c.systemServiceKeyId))
    .map((c) => c.id);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/book?keys=${selectedKeyIds.map(encodeURIComponent).join(",")}`}
        className="text-sm text-white/40 hover:text-white/70 transition-colors"
      >
        ← Салбар дахин сонгох
      </Link>

      <div className="flex items-center gap-4">
        {branch.tenant.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branch.tenant.logoUrl}
            alt=""
            className="w-16 h-16 rounded-2xl object-contain bg-white/[0.04] border border-white/[0.06] shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/30 to-blue-500/30 border border-white/[0.06] shrink-0 flex items-center justify-center text-xl font-bold text-white/70">
            {branch.tenant.name.slice(0, 1)}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold">{branch.name}</h1>
          <p className="text-white/40 text-sm mt-0.5">
            {branch.tenant.name} · {branch.tenant.phone1}
          </p>
        </div>
      </div>

      <div className="w-full">
        <div className="glass rounded-2xl p-5 border border-white/[0.08]">
          <h2 className="font-semibold mb-4">Цаг захиалах</h2>
          {account ? (
            <BookingForm
              branches={[
                {
                  id: branch.id,
                  name: branch.name,
                  openWeekdays: openWeekdaysOf(branch),
                  schedule: {
                    openTime: branch.openTime,
                    closeTime: branch.closeTime,
                    schedules: branch.schedules,
                    scheduleExceptions: branch.scheduleExceptions,
                    scheduleSeasons: branch.scheduleSeasons,
                  },
                  categories: branchCategories,
                },
              ]}
              vehicles={vehicles}
              initialBranchId={branch.id}
              initialCategoryIds={preselectedCategoryIds}
              lockCategories
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
