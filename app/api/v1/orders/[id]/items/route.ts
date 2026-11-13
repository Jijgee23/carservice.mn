import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { ItemKind } from "@/app/generated/prisma/client";
import { addOrderItemCommand, assertOrderItemAddPrecheck, parseOrderItemDecimal } from "@/lib/orders/order-item-commands";
import { adoptCatalogItemForTenant } from "@/lib/services/catalog-adopt";
import { CATALOG_OPTION_PREFIX } from "@/lib/catalog/catalog-option";
import { OrderCommandError } from "@/lib/orders/order-commands";

function commandError(error: unknown): Response {
  if (error instanceof OrderCommandError) {
    return jsonError(error.status, error.message, { code: error.code, fieldErrors: error.fieldErrors });
  }
  console.error("[orders/items] command failed", error instanceof Error ? { name: error.name } : { name: "UnknownError" });
  return jsonError(500, "Үйлдлийг гүйцэтгэх боломжгүй байна.");
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "orders.edit");
  if (denied && !auth.user.role?.permissions.includes("orders.editOwn")) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;

  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, "JSON body шаардлагатай."); }
  if (body == null || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "JSON object шаардлагатай.");
  const b = body as Record<string, unknown>;
  const quantity = parseOrderItemDecimal(b.quantity ?? 1, 3);
  const unitPrice = b.unitPrice === undefined ? null : parseOrderItemDecimal(b.unitPrice, 2);
  if (!quantity || quantity.lte(0)) return jsonError(422, "Хүсэлт буруу.", { fieldErrors: { quantity: "Тоо хэмжээ буруу." } });
  if (b.unitPrice !== undefined && !unitPrice) return jsonError(422, "Хүсэлт буруу.", { fieldErrors: { unitPrice: "Үнэ буруу." } });
  const kind = typeof b.kind === "string" ? b.kind.trim() as ItemKind : "" as ItemKind;
  const description = typeof b.description === "string" ? b.description.trim() : "";
  let serviceId = typeof b.serviceId === "string" && b.serviceId.trim() ? b.serviceId.trim() : null;
  let catalogItemId = typeof b.catalogItemId === "string" && b.catalogItemId.trim() ? b.catalogItemId.trim() : null;
  if (serviceId?.startsWith(CATALOG_OPTION_PREFIX)) {
    catalogItemId ||= serviceId.slice(CATALOG_OPTION_PREFIX.length);
    serviceId = null;
  }
  const diagnosticTemplateId = typeof b.diagnosticTemplateId === "string" && b.diagnosticTemplateId.trim() ? b.diagnosticTemplateId.trim() : null;
  const { id } = await ctx.params;
  try {
    // Нэгдсэн сангаас сонгосон бол эхлээд тенантын ажил/сэлбэг болгон холбоно.
    // Захиалгын хүрээ/эрх/түгжээг adopt (тенантад Service үүсгэх) хийхээс өмнө шалгана.
    if (!serviceId && catalogItemId && !diagnosticTemplateId) {
      await assertOrderItemAddPrecheck(auth.user, id, scopeResult.branchId);
      const adopted = await adoptCatalogItemForTenant(auth.user, catalogItemId);
      if (!adopted.ok) return jsonError(422, adopted.message, { fieldErrors: { serviceId: adopted.message } });
      serviceId = adopted.serviceId;
    }
    const item = await addOrderItemCommand({ actor: auth.user, orderId: id, kind, description, quantity, unitPrice, serviceId, diagnosticTemplateId, scope: scopeResult.branchId });
    return jsonOk({ item }, { status: 201 });
  } catch (error) {
    return commandError(error);
  }
}
