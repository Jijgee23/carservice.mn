import { jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { listPickerAccounts } from "@/lib/payment-account-service";
import { prisma } from "@/lib/prisma";

// GET /api/v1/banks — active payment accounts for pickers (any authenticated staff, numbers masked).
// `banks` / `enabledBanks` / `configured` are kept for installed older staff apps: they list the legacy
// bank codes of the tenant's active legacy bank accounts. Custom accounts need the new `accounts` field.
const LEGACY_LABELS: Record<string, string> = {
  KHAN: "Хаан банк",
  GOLOMT: "Голомт банк",
  TDB: "Худалдаа хөгжлийн банк",
  STATE: "Төрийн банк",
  XAC: "Хас банк",
  CAPITRON: "Капитрон банк",
  ARIG: "Ариг банк",
  BOGD: "Богд банк",
  TRANS: "Тээвэр хөгжлийн банк",
  NIBANK: "Үндэсний хөрөнгө оруулалтын банк",
  CHINGGIS: "Чингис хаан банк",
};

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  try {
    const tenantId = auth.user.tenantId;
    const [accounts, legacy] = await Promise.all([
      listPickerAccounts(tenantId),
      prisma.paymentAccount.findMany({
        where: { tenantId, isActive: true, type: "BANK_ACCOUNT", legacyCode: { not: null } },
        select: { legacyCode: true },
        orderBy: { legacyCode: "asc" },
      }),
    ]);
    const enabledBanks = legacy.map((r) => r.legacyCode as string);
    return jsonOk({
      accounts,
      banks: Object.entries(LEGACY_LABELS).map(([code, label]) => ({ code, label })),
      enabledBanks,
      configured: enabledBanks.length > 0,
    });
  } catch {
    console.error("[banks] load failed");
    return jsonError(500, "Серверийн алдаа гарлаа. Дахин оролдоно уу.");
  }
}
