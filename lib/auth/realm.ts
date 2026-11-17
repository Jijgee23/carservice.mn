/**
 * Нэвтрэлтийн гурван тусдаа хэсэг (realm) ба тус бүрийн нүүр хуудас.
 * Pure модуль — proxy.ts болон server component-уудад хоёуланд нь ашиглана.
 */
export type Realm = "system" | "tenant" | "account";

export const REALM_HOME: Record<Realm, string> = {
  system: "/system",
  tenant: "/dashboard",
  account: "/account",
};
