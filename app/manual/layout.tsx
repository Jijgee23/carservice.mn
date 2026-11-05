import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { ThemeToggle } from "@/app/_components/theme-toggle";
import { requireUser } from "@/lib/auth";
import {
  allManualArticlesFlat,
  TENANT_MANUAL_SECTIONS,
} from "@/lib/manual/content/tenant";
import { ManualSearch } from "./_components/manual-search";
import { ManualSidebar } from "./_components/manual-sidebar";

// Ops Console дизайны фонт — dashboard-той ижил механизм. Гарын авлага нь
// /dashboard-ийн доторх зам биш (тусдаа бүрэн хуудасны shell — TimeTry-ийн
// гарын авлага загварыг дуурайж, ердийн AdminSidebar-гүй, өөрийн TOC+хайлттай).
const plexSans = Geist({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
});
const plexMono = Geist_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export default async function ManualLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser(); // тенант ажилтны нэвтрэлт шаардана — /dashboard-тай адил

  return (
    <div
      className={`${plexSans.variable} ${plexMono.variable} landing-ops min-h-screen bg-[var(--oc-carbon)] flex`}
    >
      <ManualSidebar
        sections={TENANT_MANUAL_SECTIONS}
        basePath="/manual"
        title="Ажилтны гарын авлага"
      />
      <div className="flex-1 min-w-0 min-h-screen flex flex-col">
        <header className="sticky top-0 z-30 bg-[var(--oc-panel)]/95 backdrop-blur border-b border-[var(--oc-line2)] flex items-center gap-3 px-4 sm:px-6 h-14 shrink-0">
          <Link
            href="/dashboard"
            className="text-sm text-[var(--oc-muted)] hover:text-[var(--oc-ink)] transition-colors shrink-0"
          >
            ← Самбар
          </Link>
          <span className="text-[var(--oc-line)] shrink-0">/</span>
          <Link
            href="/manual"
            className="text-sm font-medium text-[var(--oc-ink)] shrink-0"
          >
            Гарын авлага
          </Link>
          <div className="flex-1" />
          <ManualSearch articles={allManualArticlesFlat()} basePath="/manual" />
          <ThemeToggle variant="icon" />
        </header>
        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
