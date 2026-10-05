import { jsonError, jsonOk } from "@/lib/api";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";
import { prisma } from "@/lib/prisma";

// POST /api/v1/app/appointments/[id]/cancel — өөрийн цагаа цуцлах (auth).
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");

  const { id } = await ctx.params;
  const appt = await prisma.appointment.findFirst({
    where: { id, accountId: account.id },
    select: { id: true, status: true, serviceOrderId: true },
  });
  if (!appt) return jsonError(404, "Цаг олдсонгүй.");
  if (appt.status !== "PENDING" && appt.status !== "CONFIRMED") {
    return jsonError(409, "Энэ цагийг цуцлах боломжгүй.");
  }
  // Засварын хуудас холбогдсон бол цуцлахгүй — ServiceOrder хөндөгдөхгүй тул
  // ажил үргэлжилсээр байна (web + апп-ын UI ч мөн нуудаг).
  if (appt.serviceOrderId) {
    return jsonError(409, "Засвар эхэлсэн тул энэ цагийг цуцлах боломжгүй.");
  }

  const updated = await prisma.appointment.updateMany({
    where: { id: appt.id, accountId: account.id, status: { in: ["PENDING", "CONFIRMED"] }, serviceOrderId: null },
    data: { status: "CANCELLED" },
  });
  if (updated.count !== 1) return jsonError(409, "Энэ цагийг цуцлах боломжгүй.");
  return jsonOk({ ok: true });
}
