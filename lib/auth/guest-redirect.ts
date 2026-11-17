import { redirect } from "next/navigation";
import { hasActiveUserSession } from "@/lib/auth";
import { getAccount } from "@/lib/auth/account";
import { hasActiveSystemSession } from "@/lib/auth/system";
import { REALM_HOME, type Realm } from "@/lib/auth/realm";
import { safeNextWithin } from "@/lib/safe-redirect";

const CHECKS: Record<Realm, () => Promise<boolean>> = {
  tenant: hasActiveUserSession,
  system: hasActiveSystemSession,
  account: async () => Boolean(await getAccount()),
};

const ORDER: Realm[] = ["tenant", "system", "account"];

/**
 * Идэвхтэй (DB-ээр баталгаажсан) session-тэй realm-ийг буцаана. `prefer`
 * realm-ийг эхэлж шалгана — хэрэглэгч олон realm-д зэрэг нэвтэрсэн бол өөрийн
 * хуудасны realm-д нь явуулахын тулд.
 *
 * JWT-г биш DB-г бүрэн шалгадаг нь чухал: зөвхөн JWT-ээр шийдвэл цуцлагдсан
 * session дээр login ↔ нүүр хуудас redirect loop үүснэ (харах: proxy.ts).
 */
export async function getSignedInRealm(prefer?: Realm): Promise<Realm | null> {
  const order = prefer ? [prefer, ...ORDER.filter((r) => r !== prefer)] : ORDER;
  for (const realm of order) {
    if (await CHECKS[realm]()) return realm;
  }
  return null;
}

/**
 * login / signup / forgot зэрэг "зочны" хуудсанд: аль нэг realm-д аль хэдийн
 * нэвтэрсэн бол тухайн realm-ийн нүүр (эсвэл `next` — realm-ийнхээ дотор бол)
 * рүү шилжүүлнэ. Нэвтрээгүй бол юу ч хийхгүй.
 *
 * `redirect()` нь exception шиддэг тул try/catch дотор бүү дууд.
 */
export async function redirectIfSignedIn(
  opts: { prefer?: Realm; next?: string | string[] | null } = {},
): Promise<void> {
  const realm = await getSignedInRealm(opts.prefer);
  if (!realm) return;
  const home = REALM_HOME[realm];
  const raw = Array.isArray(opts.next) ? opts.next[0] : opts.next;
  redirect(safeNextWithin(raw, home, home));
}
