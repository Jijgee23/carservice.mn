import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { recomputeAllCredit } from "@/lib/credit-score-server";
import { setBypassContext } from "@/lib/tenant-context";

/**
 * Бүх засварын газрын credit score-ыг дахин тооцож, босгоос доош орсон бол
 * автоматаар блоклоно / сэргэсэн бол нээнэ (lib/credit-score.ts). Өдөрт нэг
 * удаа дуудна.
 *
 * Setup: env-д `CRON_SECRET=<random>`, `Authorization: Bearer <CRON_SECRET>`.
 */
export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}

async function run(req: Request) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  // Бүх тенант дундуур тооцдог cron тул RLS-г тойрч гарна.
  setBypassContext();
  const results = await recomputeAllCredit();
  return NextResponse.json({
    ok: true,
    tenants: results.length,
    blocked: results.filter((r) => r.event === "blocked").length,
    unblocked: results.filter((r) => r.event === "unblocked").length,
    ranAt: new Date().toISOString(),
  });
}
