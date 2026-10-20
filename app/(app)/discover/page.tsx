import {
  type Weekday,
  branchStatusNow,
  formatAddress,
  worksEffectiveWeekends,
} from "@/lib/branches";
import { branchScheduleDisplaySelect } from "@/lib/branch-effective-schedule-server";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { plansWithFeature } from "@/lib/plan-limits-server";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";
import { DiscoverClient, type DiscoverOrg } from "./discover-client";

export const metadata = {
  title: "Авто засвар, автосервисүүд — Цаг захиалга",
  description:
    "Ойролцоох авто засвар, оношилгоо, дугуй, угаалгын газруудыг газрын зураг дээрээс олж, ажлын цаг, байршлыг харж онлайнаар цаг захиалаарай.",
  alternates: { canonical: "/discover" },
};

// Каталог нь нийтэд нээлттэй (нэвтрэхгүйгээр үзнэ).
export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  // Олон tenant-ийн нийтэд нээлттэй каталог — цор ганц tenant гэж байхгүй.
  setBypassContext();
  // Багц нь онлайн захиалга дэмждэг tenant-уудыг л харуулна.
  const allowedPlans = await plansWithFeature(PLAN_LIMIT_CODES.ONLINE_BOOKING);
  const now = new Date();
  const tenants = await prisma.tenant.findMany({
    where: {
      acceptsOnlineBooking: true,
      suspended: false,
      isTest: false, // тест/демо тенант олон нийтэд харагдахгүй (lib/tenant-visibility.ts)
      plan: { in: allowedPlans },
    },
    orderBy: { name: "asc" },
    select: {
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
          phone: true,
          city: true,
          district: true,
          khoroo: true,
          address: true,
          latitude: true,
          longitude: true,
          tags: { select: { id: true, name: true } },
          ...branchScheduleDisplaySelect(),
        },
      },
      // Идэвхтэй ангилал + аль салбарт хамаарах (хоосон бол бүх салбарт) —
      // "тухайн салбар ямар үйлчилгээ үзүүлдэг"-ийг харуулахад ашиглана
      // (org/[slug]/page.tsx-ийн booking category логиктой ижил зарчим).
      categories: {
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: {
          name: true,
          branches: { select: { id: true } },
        },
      },
    },
  });

  const orgs: DiscoverOrg[] = tenants.map((t) => ({
    slug: t.slug,
    name: t.name,
    logoUrl: t.logoUrl,
    phone: t.phone1,
    branches: t.branches.map((b) => {
      const status = branchStatusNow(
        {
          openTime: b.openTime,
          closeTime: b.closeTime,
          schedules: b.schedules.map((s) => ({
            weekday: s.weekday as Weekday,
            isOpen: s.isOpen,
            openTime: s.openTime,
            closeTime: s.closeTime,
          })),
          scheduleExceptions: b.scheduleExceptions,
          scheduleSeasons: b.scheduleSeasons,
        },
        now,
      );
      const weekend = worksEffectiveWeekends({
        openTime: b.openTime,
        closeTime: b.closeTime,
        schedules: b.schedules,
        scheduleExceptions: b.scheduleExceptions,
        scheduleSeasons: b.scheduleSeasons,
      },
        now,
      );
      // Энэ салбарт хамаарах ангилал: хамаарах салбаргүй (бүх салбарт) эсвэл
      // энэ салбарыг шууд сонгосон ангилал.
      const matchingCategories = t.categories.filter(
        (c) => c.branches.length === 0 || c.branches.some((x) => x.id === b.id),
      );
      const services = matchingCategories.map((c) => c.name);
      return {
        id: b.id,
        name: b.name,
        phone: b.phone,
        address: formatAddress(b),
        city: b.city,
        district: b.district,
        lat: b.latitude,
        lng: b.longitude,
        open: status.open,
        hours: status.hours,
        weekend,
        services,
        tags: b.tags,
      };
    }),
  }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">Цаг захиалах</h1>
        <p className="text-white/40 text-sm mt-1">
          Авто үйлчилгээний газраа газрын зураг эсвэл жагсаалтаас сонгож,
          онлайнаар цаг захиална уу.
        </p>
      </div>

      <DiscoverClient
        orgs={orgs}
        apiKey={process.env.GOOGLE_MAP_API_KEY ?? ""}
        mapId={process.env.GOOGLE_MAP_ID ?? ""}
      />
    </div>
  );
}
