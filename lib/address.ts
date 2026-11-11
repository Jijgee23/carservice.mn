import { prisma } from "@/lib/prisma";
import type { AddressData } from "@/lib/address-match";

/**
 * Каскад хаягийн dropdown-д зориулж Монголын засаг захиргааны лавлахыг
 * (City → District → Khoroo) бүхэлд нь уншина. Нийт ~870 мөр тул жижиг.
 *
 * ЧУХАЛ: энэ функц эрх зөвшөөрөгдсөн (requireUser tenant context-той) БОЛОН
 * public (нэвтрээгүй, жишээ: бүртгүүлэх) хуудаснаас аль алинаас нь дуудагддаг
 * тул энд өөрөө context тохируулахгүй (setBypassContext дуудвал authenticated
 * дуудагчийн tenant context-ийг санамсаргүй bypass болгож орлуулна). Context
 * тохируулах үүрэг дуудагч (page.tsx) талд байна — public хуудас өөрөө
 * bypass тавина.
 */
export async function getAddressData(): Promise<AddressData> {
  const [cities, districts, khoroos] = await Promise.all([
    prisma.city.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.district.findMany({
      select: { id: true, name: true, cityId: true },
      orderBy: { name: "asc" },
    }),
    prisma.khoroo.findMany({
      select: { id: true, name: true, cityId: true, districtId: true },
      orderBy: { id: "asc" },
    }),
  ]);

  return {
    cities: cities.map((c) => ({ id: c.id, name: c.name })),
    districts: districts.map((d) => ({
      id: d.id,
      name: d.name,
      cityId: d.cityId,
    })),
    khoroos: khoroos.map((k) => ({
      id: k.id,
      name: k.name,
      cityId: k.cityId,
      districtId: k.districtId,
    })),
  };
}
