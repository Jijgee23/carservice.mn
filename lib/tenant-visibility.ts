// Тенант олон нийтэд (discover, апп-ын байгууллагын жагсаалт/газрын зураг,
// байгууллагын хуудас, онлайн цаг захиалга, нүүр хуудасны logo) харагдах эсэх.
// Түр зогсоосон (suspended) болон тест/демо (isTest) тенант хэзээ ч харагдахгүй,
// захиалга авахгүй — ажилтны тал (dashboard) хэвийн ажиллана.
export const PUBLIC_TENANT_WHERE = { suspended: false, isTest: false } as const;

export function isTenantPublic(tenant: { suspended: boolean; isTest: boolean }): boolean {
  return !tenant.suspended && !tenant.isTest;
}
