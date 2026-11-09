// GET/PATCH/DELETE /api/v1/branches/[id] — мобайл staff API. Бизнес дүрэм
// нь вэбийн server action-уудтай (app/_actions/branches.ts) нэг —
// lib/branches-commands.ts-ийг дуудна.
//
// Алдааны хэлбэр: `{ error, code?, fieldErrors?, impact?, needsConfirm? }`.

import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import {
  branchBodyToFormData,
  deleteBranch,
  getBranchDetail,
  updateBranch,
  type BranchJsonBody,
} from "@/lib/branches-commands";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET — салбарын дэлгэрэнгүй (засах form-ийн талбарууд + 7 хоногийн хуваарь
 * + шошго + ажилтны тоо).
 *
 * Эрх: `branches.edit` — вэбийн app/dashboard/branches/[id] хуудас canEdit
 * шаарддагтай адил; тенант доторх аль ч салбар (хуудастай адил).
 * 200: { branch: BranchDetail }. 404 NOT_FOUND.
 */
export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "branches.edit");
  if (denied) return denied;
  const { id } = await ctx.params;

  const branch = await getBranchDetail(auth.user.tenantId, id);
  if (!branch) return jsonError(404, "Салбар олдсонгүй.", { code: "NOT_FOUND" });
  return jsonOk({ branch });
}

/**
 * PATCH — салбарыг шинэчилнэ (вэбийн updateBranchAction).
 *
 * Эрх: `branches.edit`; идэвхтэй багц шаардана (403 SUBSCRIPTION_EXPIRED).
 * Body (JSON, бүгд заавал биш): POST /branches-тэй ижил талбарууд + `confirm?: boolean`.
 * Ирээгүй талбар/шошго/өдөр одоогийн утгаараа үлдэнэ; `null` нь талбарыг хоосолно.
 * Үр дүнд нь салбар бүхэлдээ (талбар + 7 өдөр + шошго) вэб form шиг дахин хадгалагдана.
 *
 * Хуваарийн нөлөө (ирээдүйн захиалга):
 *  - бүрэн хүчингүй болох захиалга байвал → 409 { code: "SCHEDULE_IMPACT",
 *    impact, needsConfirm: false } (хатуу хориг, ажилтан эхлээд шийдвэрлэнэ);
 *  - зөвхөн богиносох бол `confirm: true`-гүйгээр → 409 { code: "SCHEDULE_IMPACT",
 *    impact, needsConfirm: true }; `confirm: true`-тэй дахин илгээвэл хадгалж богиносгоно.
 * 200: { branch: BranchDetail, scheduleClipped: number }.
 * Алдаа: 400 VALIDATION { fieldErrors }, 404 NOT_FOUND, 409 PRIMARY_LOCKED
 * (үндсэн салбарын isPrimary-г false болгох), 409 SCHEDULE_IMPACT, 500.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "branches.edit");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as BranchJsonBody | null;
  if (!body || typeof body !== "object") {
    return jsonError(400, "JSON body шаардлагатай.", { code: "VALIDATION" });
  }

  const current = await getBranchDetail(auth.user.tenantId, id);
  if (!current) return jsonError(404, "Салбар олдсонгүй.", { code: "NOT_FOUND" });

  const result = await updateBranch(
    auth.user,
    id,
    branchBodyToFormData(body, current),
    body.confirm === true,
  );
  if (!result.ok) {
    switch (result.code) {
      case "VALIDATION": {
        const first = Object.values(result.fieldErrors)[0] ?? "Өгөгдөл буруу.";
        return jsonError(400, first, { code: "VALIDATION", fieldErrors: result.fieldErrors });
      }
      case "SCHEDULE_IMPACT":
        return jsonError(409, result.message, {
          code: "SCHEDULE_IMPACT",
          impact: result.impact,
          needsConfirm: result.needsConfirm,
        });
      case "NOT_FOUND":
        return jsonError(404, result.message, { code: "NOT_FOUND" });
      case "PRIMARY_LOCKED":
        return jsonError(409, result.message, { code: "PRIMARY_LOCKED" });
      default:
        return jsonError(500, result.message, { code: result.code });
    }
  }

  const branch = await getBranchDetail(auth.user.tenantId, id);
  return jsonOk({ branch, scheduleClipped: result.clipped });
}

/**
 * DELETE — салбарыг устгана (вэбийн deleteBranchAction).
 *
 * Эрх: `branches.delete`; идэвхтэй багц шаардана (403 SUBSCRIPTION_EXPIRED).
 * 200: { branch: { id } }.
 * Алдаа: 404 NOT_FOUND, 409 PRIMARY_LOCKED (үндсэн салбар), 409 HAS_EMPLOYEES
 * (ажилтан бүртгэлтэй), 409 FK_CONFLICT (засварын хуудас/цаг захиалгатай).
 */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "branches.delete");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const { id } = await ctx.params;

  const result = await deleteBranch(auth.user, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") return jsonError(404, "Салбар олдсонгүй.", { code: "NOT_FOUND" });
    return jsonError(409, result.message, { code: result.code });
  }
  return jsonOk({ branch: { id } });
}
