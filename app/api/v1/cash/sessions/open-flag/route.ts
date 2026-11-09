import { jsonOk, requireApiUser } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { cashErrorResponse } from "@/lib/cash/http";
import { branchCashSessionOpen, resolveSessionBranch } from "@/lib/cash/session";
import { isCashSessionRequired } from "@/lib/cash/session-required";

// GET /api/v1/cash/sessions/open-flag?branchId=  (branchId optional when the working branch is pinned)
// Permission: payments.create OR cash.manage (so the order payment form can warn without cash.manage).
// -> { branchId, open: boolean, sessionOpen: boolean, required: boolean }
//    `open` = төлбөр бүртгэж болох эсэх (тохиргоо унтраалттай бол үргэлж true — хуучин апп сануулахгүй);
//    `sessionOpen` = бодит нээлттэй ээлж байгаа эсэх; `required` = Tenant.requireCashSession.
export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const requested = new URL(req.url).searchParams.get("branchId");
  try {
    const branchId = resolveSessionBranch(auth.user, scopeResult.branchId, requested);
    const [sessionOpen, required] = await Promise.all([
      branchCashSessionOpen(auth.user, branchId),
      isCashSessionRequired(auth.user.tenantId),
    ]);
    return jsonOk({ branchId, open: sessionOpen || !required, sessionOpen, required });
  } catch (error) {
    return cashErrorResponse("sessions.openFlag", error);
  }
}
