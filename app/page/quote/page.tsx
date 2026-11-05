import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { Brand } from "@/app/_components/brand";
import { Footer } from "@/app/_components/footer";
import { QuoteRequestForm } from "@/app/_components/quote-request-form";

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

export const metadata = {
  title: "Энтерпрайз — үнийн санал авах",
  description:
    "Сүлжээ, олон салбартай автосервисүүдэд: хэрэгтэй модулиудаа сонгоод Энтерпрайз багцын үнийн санал аваарай.",
};

export default function QuotePage() {
  return (
    <div className={`${plexSans.variable} ${plexMono.variable} landing-ops min-h-screen flex flex-col`}>
      <header className="border-b border-[var(--oc-line2)]">
        <div className="mx-auto max-w-5xl px-4 h-16 flex items-center justify-between">
          <Link href="/">
            <Brand />
          </Link>
          <Link
            href="/#price"
            className="text-sm text-[var(--oc-muted2)] hover:text-[var(--oc-accent-hi)] transition-colors"
          >
            ← Үнэ
          </Link>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold text-[var(--oc-ink)]">Энтерпрайз — үнийн санал авах</h1>
        <p className="mt-2 mb-8 text-sm text-[var(--oc-muted3)]">
          Хэрэгтэй модулиудаа сонгоод мэдээллээ үлдээгээрэй. Танд тохирсон үнийн саналыг бэлтгээд удахгүй
          холбогдоно.
        </p>
        <QuoteRequestForm source="public" />
      </main>

      <Footer />
    </div>
  );
}
