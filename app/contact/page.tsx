import Link from "next/link";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Brand } from "@/app/_components/brand";
import { Footer } from "@/app/_components/footer";
import { CONTACT } from "@/lib/contact";
import { getContactPhones } from "@/lib/platform-settings";

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
  title: "Холбоо барих",
};

export const revalidate = 3600;

export default async function ContactPage() {
  // Утаснууд super admin-ийн тохиргооноос (/system/settings), хоосон бол phones.
  const phones = await getContactPhones();
  return (
    <div
      className={`${plexSans.variable} ${plexMono.variable} landing-ops min-h-screen flex flex-col`}
    >
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

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold">Холбоо барих</h1>
        <p className="text-[var(--oc-muted3)] text-sm mt-2">
          {CONTACT.org}-тэй холбогдох мэдээлэл.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Card title="Байгууллага">
            <div className="text-[var(--oc-ink2)] font-medium">{CONTACT.org}</div>
            <a
              href={`https://${CONTACT.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors text-sm"
            >
              {CONTACT.website}
            </a>
          </Card>

          <Card title="Имэйл">
            <a
              href={`mailto:${CONTACT.email}`}
              className="text-[var(--oc-ink2)] hover:text-[var(--oc-accent-hi)] transition-colors"
            >
              {CONTACT.email}
            </a>
          </Card>

          <Card title="Утас">
            <div className="flex flex-col gap-1 tabular-nums">
              {phones.map((p) => (
                <a
                  key={p}
                  href={`tel:${p}`}
                  className="text-[var(--oc-ink2)] hover:text-[var(--oc-accent-hi)] transition-colors"
                >
                  {p}
                </a>
              ))}
            </div>
          </Card>

          <Card title="Хаяг">
            <div className="text-[var(--oc-ink2)]">{CONTACT.address}</div>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
      <div className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)] mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}
