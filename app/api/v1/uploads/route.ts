import { enforceRateLimit, jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { intakeStagingSubdir } from "@/lib/orders/order-intake";
import { isModuleEnabled, moduleDisabledResponse } from "@/lib/plan-modules-server";
import { saveUpload, UploadValidationError } from "@/lib/storage";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

const ALLOWED_KINDS = new Set(["diagnostics", "signatures", "intake"]);

/** Ажилтан тутамд минутад 60 файл — зураг дараалан авахад хангалттай. */
const UPLOAD_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;

  const limited = enforceRateLimit(req, "api-uploads", UPLOAD_RATE_LIMIT, auth.user.id);
  if (limited) return limited;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonError(400, "Multipart form-data илгээнэ үү.");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return jsonError(400, "`file` талбарт зураг хавсаргана уу.");
  }

  const kindRaw = (formData.get("kind") ?? "diagnostics").toString();
  const kind = ALLOWED_KINDS.has(kindRaw) ? kindRaw : "diagnostics";
  let subdir: string;
  if (kind === "intake") {
    // Хүлээн авах зураг: захиалга үүсгэх эрхтэй, багц идэвхтэй ажилтны өөрийн staging хавтас.
    const denied = requirePermission(auth.user, "orders.create");
    if (denied) return denied;
    const locked = await requireActiveSubscriptionApi(auth.user);
    if (locked) return locked;
    subdir = intakeStagingSubdir(auth.user.tenantId, auth.user.id);
  } else {
    // Оношилгооны зураг / гарын үсэг: тайлан бөглөх эрх, идэвхтэй багц,
    // багцад оношилгооны модуль орсон байх ёстой (/api/v1/uploads зам нь
    // kind-аас хамаардаг тул API_MODULE_PATHS-аар бус энд шалгана).
    const denied = requirePermission(auth.user, "diagnostics.create");
    if (denied) return denied;
    const locked = await requireActiveSubscriptionApi(auth.user);
    if (locked) return locked;
    if (!(await isModuleEnabled(auth.user.tenantId, "enable_diagnostics"))) {
      return moduleDisabledResponse("enable_diagnostics");
    }
    // Тенант бүрийн файлыг тусад нь хадгална (cash/{tenantId}-тэй ижил).
    // Өмнө хадгалсан /uploads/diagnostics/... URL-ууд хэвээр ажиллана.
    subdir =
      kind === "signatures"
        ? `diagnostics/${auth.user.tenantId}/signatures`
        : `diagnostics/${auth.user.tenantId}`;
  }

  try {
    const saved = await saveUpload(file, subdir);
    return jsonOk(
      {
        url: saved.path,
        size: saved.size,
        mime: saved.mime,
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof UploadValidationError) return jsonError(400, e.message);
    // Файлын системийн алдаа серверийн зам агуулж болох тул буцаахгүй.
    console.error("[api/v1/uploads] save failed", e);
    return jsonError(500, "Файл хадгалахад алдаа гарлаа.");
  }
}
