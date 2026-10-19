import { rescheduleAppointmentByAccountCore } from "@/lib/appointments/account-reschedule";
import { jsonError, jsonOk } from "@/lib/api";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";

// POST /api/v1/app/appointments/[id]/reschedule — өөрийн PENDING/CONFIRMED
// цагаа өөр хугацаанд шилжүүлэх (auth). Веб (`rescheduleAppointmentByAccount`
// server action)-тэй яг адил цөм логик (`rescheduleAppointmentByAccountCore`)
// ашиглана — багтаамж/давхцлын шалгалт, audit, ажилтанд мэдэгдэх зэрэг бүгд
// хоёр талдаа адил ажиллана.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  const requestedRaw = (body as { requestedAt?: unknown })?.requestedAt;
  if (typeof requestedRaw !== "string" || !requestedRaw) {
    return jsonError(400, "requestedAt шаардлагатай.");
  }
  const requestedAt = new Date(requestedRaw);
  if (!Number.isFinite(requestedAt.getTime())) {
    return jsonError(400, "requestedAt буруу.");
  }

  const result = await rescheduleAppointmentByAccountCore(account, id, requestedAt);
  if (!result?.ok) {
    // `fieldErrors` (жишээ нь: "Өнгөрсөн цаг сонгох боломжгүй") нь validation
    // алдаа тул `message`-гүй ирдэг — эндээс уншиж 400-аар буцаана.
    const fieldMessage = Object.values(result?.fieldErrors ?? {})[0];
    if (fieldMessage) return jsonError(400, fieldMessage);
    const message = result?.message ?? "Шилжүүлэх боломжгүй.";
    const status = message === "Цаг захиалга олдсонгүй." ? 404 : 409;
    return jsonError(status, message);
  }
  return jsonOk({ ok: true });
}
