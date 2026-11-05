import { BOOKABLE_CATEGORY_WHERE } from "@/lib/categories";
import {
  BackLink,
  LoginPrompt,
  Panel,
  PlaceHeader,
} from "@/app/(app)/_components/consumer-ui";
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
      tenant: { acceptsOnlineBooking: true, suspended: false, isTest: false, creditHidden: false },
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
      // Онлайн захиалга — зөвхөн ажил үйлчилгээний (эсвэл бүх төрлийн) ангилал.
      where: { tenantId: branch.tenantId, isActive: true, ...BOOKABLE_CATEGORY_WHERE },
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
    .filter((c) => c.systemServiceKeyId !== null && selectedKeyIds.includes(c.systemServiceKeyId))
    .map((c) => c.id);

  return (
    <div className="flex flex-col gap-5">
      <BackLink href={`/book?keys=${selectedKeyIds.map(encodeURIComponent).join(",")}`}>
        Салбар дахин сонгох
      </BackLink>

      <PlaceHeader
        name={branch.tenant.name}
        logoUrl={branch.tenant.logoUrl}
        eyebrow={branch.tenant.name}
        title={branch.name}
        subtitle={branch.tenant.phone1}
      />

      <Panel title="Цаг захиалах" description="Машин, өдөр, цагаа сонгоод захиалгаа илгээнэ үү.">
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
          <LoginPrompt />
        )}
      </Panel>
    </div>
  );
}
