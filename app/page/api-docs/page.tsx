import Link from "next/link";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Suspense } from "react";
import { Brand } from "@/app/_components/brand";
import { Footer } from "@/app/_components/footer";
import { ApiDocsTabs } from "./tabs";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata = {
  title: "Мобайл API — Баримтжуулалт",
  robots: { index: false, follow: false },
};

export const revalidate = false;

export default function ApiDocsPage() {
  return (
    <div className={`${plexSans.variable} ${plexMono.variable} landing-ops min-h-screen flex flex-col`}>
      <header className="border-b border-[var(--oc-line2)]">
        <div className="mx-auto max-w-5xl px-4 h-16 flex items-center justify-between">
          <Link href="/">
            <Brand />
          </Link>
          <Link
            href="/"
            className="text-sm text-[var(--oc-muted2)] hover:text-[var(--oc-accent-hi)] transition-colors"
          >
            ← Нүүр
          </Link>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-bold text-[var(--oc-ink)]">Мобайл API</h1>

        <Suspense fallback={null}>
          <ApiDocsTabs />
        </Suspense>
      </main>

      <Footer />
    </div>
  );
}
