import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth/session";
import {
  SYSTEM_COOKIE_NAME,
  verifySystemSession,
} from "@/lib/auth/system-session";
import {
  ACCOUNT_COOKIE_NAME,
  verifyAccountSession,
} from "@/lib/auth/account-session";
import { REALM_HOME, type Realm } from "@/lib/auth/realm";

const TENANT_PROTECTED_PREFIXES = ["/dashboard"];
const SYSTEM_PROTECTED_PREFIX = "/system";
const ACCOUNT_PROTECTED_PREFIX = "/account";

function startsWithSegment(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

async function hasRealmSession(req: NextRequest, realm: Realm): Promise<boolean> {
  if (realm === "system") {
    const token = req.cookies.get(SYSTEM_COOKIE_NAME)?.value;
    return Boolean(token && (await verifySystemSession(token)));
  }
  if (realm === "tenant") {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    return Boolean(token && (await verifySession(token)));
  }
  const token = req.cookies.get(ACCOUNT_COOKIE_NAME)?.value;
  return Boolean(token && (await verifyAccountSession(token)));
}

/**
 * Тухайн хэсгийн (realm) session байхгүй ч browser өөр realm-д нэвтэрсэн
 * хэвээр бол (ж: ажилтан URL-аар /system эсвэл /account руу орох) login
 * хуудас биш, өөрийнхөө нүүр рүү чиглүүлнэ. Зөвхөн JWT шалгана — DB-ээр
 * хүчингүй болсон session бол очсон нүүр хуудас нь өөрийн login руу
 * буцаах бөгөөд login хуудсууд DB-ээр бүрэн шалгадаг тул loop үүсэхгүй.
 */
async function otherRealmHome(
  req: NextRequest,
  current: Realm,
): Promise<string | null> {
  const order: Realm[] = ["tenant", "system", "account"];
  for (const realm of order) {
    if (realm === current) continue;
    if (await hasRealmSession(req, realm)) return REALM_HOME[realm];
  }
  return null;
}

function redirectTo(req: NextRequest, pathname: string, next?: string) {
  const url = req.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  if (next) url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // --- /system хамгаалалт ---
  if (startsWithSegment(pathname, SYSTEM_PROTECTED_PREFIX)) {
    if (pathname === "/system/login") return NextResponse.next();
    const token = req.cookies.get(SYSTEM_COOKIE_NAME)?.value;
    const session = token ? await verifySystemSession(token) : null;
    if (!session) {
      const home = await otherRealmHome(req, "system");
      return redirectTo(req, home ?? "/system/login");
    }
    return NextResponse.next();
  }

  // --- /account хамгаалалт (эцсийн хэрэглэгч) ---
  if (startsWithSegment(pathname, ACCOUNT_PROTECTED_PREFIX)) {
    // Өөрийн session-тэй бол хуудас өөрөө (requireAccount) DB-ээр шалгана.
    if (await hasRealmSession(req, "account")) return NextResponse.next();
    const home = await otherRealmHome(req, "account");
    if (home) return redirectTo(req, home);
    // Хэн ч нэвтрээгүй — хуучин урсгал (requireAccount → /login).
    return NextResponse.next();
  }

  // --- /dashboard хамгаалалт ---
  if (TENANT_PROTECTED_PREFIXES.some((p) => startsWithSegment(pathname, p))) {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = token ? await verifySession(token) : null;
    if (!session) {
      const home = await otherRealmHome(req, "tenant");
      if (home) return redirectTo(req, home);
      return redirectTo(req, "/page/login", pathname);
    }
    // Тухайн нэвтрэлтэд ажиллах салбараа хараахан сонгоогүй бол (owner /
    // тогтмол салбаргүй ажилтан) — сонгуулах хуудас руу. `page.tsx`-ийг л
    // хамгаалдаг layout-аас ялгаатай, энд route.ts (export г.м.) ч хамрагдана.
    if (!session.workingBranchId) {
      return redirectTo(req, "/page/choose-branch", pathname);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/system/:path*", "/account/:path*"],
};
