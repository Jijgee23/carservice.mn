// Нэг газар: үйлчлүүлэгчийн текст хайлтын нөхцөл. Байгууллагын регистрийн
// дугаар (`Customer.orgRegnum`, 7 цифр, tenant тус бүрд индекстэй) бүх
// хайлтад нэмэгдэнэ. Pure — Prisma client дуудахгүй; tenant/салбарын
// хязгаарлалтыг дуудагч өөрөө хариуцна.

import type { Prisma } from "@/app/generated/prisma/client";

/** Хайлтын текст 1–7 цифрээс бүрдсэн үед л регистрээр хайна (8 оронтой утас хамаарахгүй). */
export function orgRegnumSearchTerm(q: string | null | undefined): string | null {
  const t = (q ?? "").trim();
  return /^\d{1,7}$/.test(t) ? t : null;
}

/** `orgRegnum` startsWith нөхцөл, эсвэл хайлт регистр биш бол null. */
export function customerRegnumClause(
  q: string | null | undefined,
): Prisma.CustomerWhereInput | null {
  const term = orgRegnumSearchTerm(q);
  return term ? { orgRegnum: { startsWith: term } } : null;
}

/** Нэр (case-insensitive) + утас + регистр. Хоосон текст → хоосон массив. */
export function customerTextSearchClauses(
  q: string | null | undefined,
): Prisma.CustomerWhereInput[] {
  const t = (q ?? "").trim();
  if (!t) return [];
  const clauses: Prisma.CustomerWhereInput[] = [
    { fullName: { contains: t, mode: "insensitive" } },
    { phone: { contains: t } },
  ];
  const regnum = customerRegnumClause(t);
  if (regnum) clauses.push(regnum);
  return clauses;
}

/** `customer: {...}` relation-ээр хайдаг жагсаалтуудад: OR-д шууд тарааж болох clause-ууд. */
export function customerRelationSearchClauses<T>(
  q: string | null | undefined,
  wrap: (where: Prisma.CustomerWhereInput) => T,
): T[] {
  return customerTextSearchClauses(q).map(wrap);
}
