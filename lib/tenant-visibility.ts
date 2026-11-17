// Тенант олон нийтэд (discover, апп-ын байгууллагын жагсаалт/газрын зураг,
// байгууллагын хуудас, онлайн цаг захиалга, нүүр хуудасны logo) харагдах эсэх.
// Түр зогсоосон (suspended), тест/демо (isTest) болон credit score бага тул
// нуугдсан (creditHidden, lib/credit-score.ts) тенант хэзээ ч харагдахгүй,
// захиалга авахгүй — ажилтны тал (dashboard) хэвийн ажиллана.
export const PUBLIC_TENANT_WHERE = { suspended: false, isTest: false, creditHidden: false } as const;

export function isTenantPublic(tenant: { suspended: boolean; isTest: boolean; creditHidden: boolean }): boolean {
  return !tenant.suspended && !tenant.isTest && !tenant.creditHidden;
}

// Олон нийтэд харагдах тенант онлайн цаг захиалга АВАХ эсэх: эзэн нь
// «Онлайн цаг захиалга»-г асаасан БА багц нь «Цаг захиалга» модультай
// (`allowedPlans` = plansWithFeature(PLAN_LIMIT_CODES.ENABLE_APPOINTMENTS)).
// Discover / газрын зураг бүх нийтийн тенантыг харуулж, «Цаг захиалах» товчийг
// зөвхөн энэ нь true үед гаргана.
export function isTenantBookable<P>(
  tenant: { acceptsOnlineBooking: boolean; plan: P },
  allowedPlans: readonly P[],
): boolean {
  return tenant.acceptsOnlineBooking && allowedPlans.includes(tenant.plan);
}
