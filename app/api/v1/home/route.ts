import { jsonOk, requireApiUser } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { loadDashboardFocus } from "@/lib/dashboard-focus";
import { serializeHome } from "@/lib/dashboard-home-dto";
import { resolveHomeLayout } from "@/lib/dashboard-persona";

/**
 * GET /api/v1/home — вэб dashboard-ын «дүрээр» (persona) тохируулсан нүүр дэлгэц.
 * Auth only (вэбийн нүүр хуудастай адил; өгөгдөл бүр эрх, салбараар тасалддаг).
 * Салбарын хүрээ: X-Working-Branch header (overview-тэй адил).
 *
 * 200 { persona, layout, access, orders, appointments, payments, reviews }
 *   persona: "manager" | "mechanic" | "frontdesk" | "cashier"
 *   layout.kpis / main / side — апп харуулах карт, widget-ийн дараалал.
 * Мөнгөний дүн string, огноо ISO.
 */
export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;

  const scope = await resolveWorkingBranch(req, auth.user);
  if (scope.response) return scope.response;

  const layout = resolveHomeLayout(auth.user);
  const focus = await loadDashboardFocus({
    id: auth.user.id,
    tenantId: auth.user.tenantId,
    isOwner: auth.user.isOwner,
    role: auth.user.role,
    ...(scope.branchId ? { workingBranchId: scope.branchId } : {}),
  });
  return jsonOk(serializeHome(layout, focus));
}
