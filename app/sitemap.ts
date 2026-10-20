import type { MetadataRoute } from "next";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { plansWithFeature } from "@/lib/plan-limits-server";
import { prisma } from "@/lib/prisma";
import { branchUrl, orgUrl, SITE_URL } from "@/lib/seo";
import { setBypassContext } from "@/lib/tenant-context";
import { PUBLIC_TENANT_WHERE } from "@/lib/tenant-visibility";

// Цаг тутам дахин үүсгэнэ — шинэ байгууллага/салбар нэмэгдэхэд sitemap-д орно.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/discover`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/page/signup`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/page/guide`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/contact`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];

  // Discover-тэй ижил нөхцөл: онлайн захиалга авдаг, олон нийтэд харагдах
  // (suspended/isTest биш), ONLINE_BOOKING багцтай тенант.
  setBypassContext();
  const allowedPlans = await plansWithFeature(PLAN_LIMIT_CODES.ONLINE_BOOKING);
  const tenants = await prisma.tenant.findMany({
    where: { ...PUBLIC_TENANT_WHERE, acceptsOnlineBooking: true, plan: { in: allowedPlans } },
    select: {
      slug: true,
      updatedAt: true,
      branches: { where: { isActive: true }, select: { id: true, updatedAt: true } },
    },
  });

  const dynamicPages: MetadataRoute.Sitemap = tenants.flatMap((t) => [
    { url: orgUrl(t), lastModified: t.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 },
    ...t.branches.map((b) => ({
      url: branchUrl(t, b),
      lastModified: b.updatedAt > t.updatedAt ? b.updatedAt : t.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ]);

  return [...staticPages, ...dynamicPages];
}
