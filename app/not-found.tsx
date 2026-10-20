import Link from "next/link";
import { IBM_Plex_Sans } from "next/font/google";
import { BtnLink } from "@/app/_components/landing-ops-ui";

// Root 404 — нүүр («/») доторх route-уудад тохирохгүй бүх URL-д
// харагдана (app/layout.tsx-ийн доторх, app/page.tsx redirect хийдэг тул
// логик "нүүр" нь «/»).
const plexSans = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
});

export default function NotFound() {
  return (
    <div
      className={`${plexSans.variable} landing-ops min-h-screen flex items-center justify-center bg-[var(--oc-carbon)] px-4`}
    >
      <div className="max-w-md w-full text-center rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-10">
        <div className="text-sm font-semibold text-[var(--oc-accent)] mb-2">404</div>
        <h1 className="text-xl font-bold text-[var(--oc-ink)] mb-2">
          Хуудас олдсонгүй
        </h1>
        <p className="text-sm text-[var(--oc-muted3)] mb-6">
          Хайж буй хуудас олдсонгүй эсвэл устгагдсан байж болзошгүй.
        </p>
        <BtnLink href="/" variant="primary" size="md">
          Нүүр хуудас руу
        </BtnLink>
        <p className="mt-4 text-xs text-[var(--oc-muted4)]">
          эсвэл <Link href="/" className="underline hover:text-[var(--oc-ink2)]">carservice.mn</Link>
        </p>
      </div>
    </div>
  );
}
