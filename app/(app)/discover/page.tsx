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
import { getAccount } from "@/lib/auth/account";
import { customerOwnershipFilters } from "@/lib/vehicles";
import type { MyBranchReview, PendingReview } from "./discover-review-modal";
import { DiscoverClient, type DiscoverOrg } from "./discover-client";

export const metadata = {
  title: "Автозасвар, авто сервисүүд — Ойролцоох газраа олж цаг захиалах",
  description:
    "Ойролцоох авто засвар, авто сервис, оношилгоо, дугуй засвар, угаалгын газруудыг газрын зураг дээрээс олж, ажлын цаг, байршлыг харж онлайнаар цаг захиалаарай.",
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
      creditHidden: false, // credit score бага тул нуугдсан (lib/credit-score.ts)
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
          ratingAvg: true,
          ratingCount: true,
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
        rating: b.ratingAvg == null ? null : Number(b.ratingAvg.toString()),
        ratingCount: b.ratingCount,
      };
    }),
  }));

  // Нэвтэрсэн хэрэглэгчийн ҮНЭЛЭЭГҮЙ дууссан засварууд салбараар — салбар
  // дээр дарахад үнэлгээ өгөх modal гаргана (discover-review-modal.tsx).
  const account = await getAccount();
  const pendingReviews: Record<string, PendingReview[]> = {};
  // Хэрэглэгчийн салбар бүрт өгсөн үнэлгээ (засваргүйг засах + «үнэлсэн» эсэх).
  const myReviews: Record<string, MyBranchReview> = {};
  if (account) {
    setBypassContext();
    const mine = await prisma.review.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: "asc" },
      select: { branchId: true, orderId: true, rating: true, comment: true, reply: true },
    });
    for (const r of mine) {
      const prev = myReviews[r.branchId];
      // Засваргүй үнэлгээ (засах боломжтой) давуу; эс бол сүүлийнх.
      if (!prev || r.orderId == null || prev.editable === false) {
        myReviews[r.branchId] = {
          rating: r.rating,
          comment: r.comment,
          reply: r.reply,
          editable: r.orderId == null,
        };
      }
    }
    const unrated = await prisma.serviceOrder.findMany({
      where: {
        status: "COMPLETED",
        isInternal: false,
        review: { is: null },
        OR: customerOwnershipFilters(account.id, account.phone),
      },
      orderBy: { completedAt: "desc" },
      take: 100,
      select: {
        id: true,
        number: true,
        branchId: true,
        plateSnapshot: true,
        completedAt: true,
        createdAt: true,
        vehicle: { select: { plate: true } },
      },
    });
    for (const o of unrated) {
      (pendingReviews[o.branchId] ??= []).push({
        orderId: o.id,
        number: o.number,
        plate: o.vehicle.plate || o.plateSnapshot || "",
        date: (o.completedAt ?? o.createdAt).toISOString(),
      });
    }
  }

  const branchCount = orgs.reduce((n, o) => n + o.branches.length, 0);
  const openCount = orgs.reduce((n, o) => n + o.branches.filter((b) => b.open).length, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] px-5 py-6 sm:px-7 sm:py-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--oc-accent)]/10 blur-2xl"
        />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--oc-accent)]">
              Онлайн цаг захиалга
            </div>
            <h1 className="mt-1.5 text-2xl sm:text-3xl font-bold text-[var(--oc-ink)]">
              Ойролцоох авто засвараа олоорой
            </h1>
            <p className="mt-2 text-sm text-[var(--oc-muted)]">
              Үйлчилгээний газраа газрын зураг эсвэл жагсаалтаас сонгож, онлайнаар
              цаг захиална уу.
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-2 sm:gap-3 shrink-0">
            {[
              { label: "Газар", value: orgs.length },
              { label: "Салбар", value: branchCount },
              { label: "Одоо нээлттэй", value: openCount, ok: true },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-3 py-2.5 min-w-[5.5rem]"
              >
                <dt className="text-[11px] text-[var(--oc-muted3)] whitespace-nowrap">{s.label}</dt>
                <dd className={`mt-0.5 text-xl font-bold tabular-nums ${s.ok ? "text-emerald-400 light:text-emerald-600" : "text-[var(--oc-ink)]"}`}>
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <DiscoverClient
        orgs={orgs}
        apiKey={process.env.GOOGLE_MAP_API_KEY ?? ""}
        mapId={process.env.GOOGLE_MAP_ID ?? ""}
        pendingReviews={pendingReviews}
        myReviews={myReviews}
        loggedIn={account != null}
      />
    </div>
  );
}
