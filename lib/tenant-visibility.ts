// Тенант олон нийтэд (discover, апп-ын байгууллагын жагсаалт/газрын зураг,
// байгууллагын хуудас, онлайн цаг захиалга, нүүр хуудасны logo) харагдах эсэх.
// Түр зогсоосон (suspended), тест/демо (isTest) болон credit score бага тул
// нуугдсан (creditHidden, lib/credit-score.ts) тенант хэзээ ч харагдахгүй,
// захиалга авахгүй — ажилтны тал (dashboard) хэвийн ажиллана.
export const PUBLIC_TENANT_WHERE = { suspended: false, isTest: false, creditHidden: false } as const;

export function isTenantPublic(tenant: { suspended: boolean; isTest: boolean; creditHidden: boolean }): boolean {
  return !tenant.suspended && !tenant.isTest && !tenant.creditHidden;
}
