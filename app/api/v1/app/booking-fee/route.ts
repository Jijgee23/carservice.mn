// Contract — GET /api/v1/app/booking-fee (нийтэд нээлттэй)
//
// Онлайн цаг захиалгын хураамж — захиалга илгээхээс ӨМНӨ харуулахад (вэбийн
// захиалгын маягттай ижил, lib/platform-settings.ts getBookingFeeNotice).
// 200: { fee: { amount: number, ttlMinutes: number } | null }
//   null бол үнэгүй. Хураамжтай бол захиалга үүссэний дараа QPay-ээр
//   ttlMinutes (15) минутын дотор төлөхгүй бол цаг чөлөөлөгдөнө.

import { enforceRateLimit, jsonOk, PUBLIC_CATALOG_RATE_LIMIT } from "@/lib/api";
import { getBookingFeeNotice } from "@/lib/platform-settings";

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, "public-catalog", PUBLIC_CATALOG_RATE_LIMIT);
  if (limited) return limited;
  return jsonOk({ fee: await getBookingFeeNotice() });
}
