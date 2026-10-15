// Бүрмөсөн устгалтын tombstone. Мөрийг DELETE хийхгүй — захиалга, төлбөр,
// тенантын Customer бичлэгийн FK хадгалагдана. Unique phone/email-ийг чөлөөлж,
// ижил дугаараар дахин бүртгүүлэхэд шинэ бичлэг үүснэ.
const PREFIX = "deleted:";

export function isTombstonePhone(phone: string): boolean {
  return phone.startsWith(PREFIX);
}

export function accountTombstone(id: string, now: Date) {
  return {
    phone: `${PREFIX}${id}`,
    name: null,
    email: null,
    avatarUrl: null,
    passwordHash: null,
    passwordUpdatedAt: null,
    isActive: false,
    deactivatedAt: null,
    deletedAt: now,
  };
}

export function userTombstone(id: string, now: Date) {
  return {
    email: `deleted+${id}@deleted.invalid`,
    phone: `${PREFIX}${id}`,
    firstName: "Устгагдсан",
    lastName: "ажилтан",
    passwordHash: null,
    verified: false,
    isActive: false,
    roleId: null,
    failedLoginAttempts: 0,
    lockedAt: null,
    deactivatedAt: null,
    deletedAt: now,
  };
}
