import { jsonError, jsonOk } from "@/lib/api";
import { cashErrorResponse, requireCashApiUser } from "@/lib/cash/http";
import { saveUpload, validateUpload } from "@/lib/storage";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

// POST /api/v1/cash/attachments (multipart: file = PNG/JPG/WEBP, <= 2MB)
// -> 201 { url, size, mime }. Pass `url` as `attachmentPath` to POST /cash/entries.
// Stored under /uploads/cash/{tenantId}/ — createCashEntry only accepts paths under the caller's own tenant prefix.
export async function POST(req: Request) {
  const auth = await requireCashApiUser(req);
  if (auth.response) return auth.response;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
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
  try {
    validateUpload(file);
  } catch (error) {
    return jsonError(400, error instanceof Error ? error.message : "Файл буруу байна.", { code: "CASH_ATTACHMENT_INVALID" });
  }
  try {
    const saved = await saveUpload(file, `cash/${auth.user.tenantId}`);
    return jsonOk({ url: saved.path, size: saved.size, mime: saved.mime }, { status: 201 });
  } catch (error) {
    return cashErrorResponse("attachments", error);
  }
}
