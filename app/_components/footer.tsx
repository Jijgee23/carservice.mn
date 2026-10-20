import Link from "next/link";
import { CONTACT } from "@/lib/contact";
import { hasStoreLinks } from "@/lib/app-store-links";
import { contactPhonesOrDefault, getPlatformSettings } from "@/lib/platform-settings";
import { StoreBadges } from "./app-store-badges";
import { Brand } from "./brand";
import { LogoMarquee } from "./logo-marquee";

export async function Footer() {
  const { facebookUrl, youtubeUrl, appLinks, contactPhones } = await getPlatformSettings();
  const phones = contactPhonesOrDefault(contactPhones);
  const apps = [
    { key: "customer", label: "Хэрэглэгчийн апп", links: appLinks.customer },
    { key: "business", label: "Засварын газрын апп", links: appLinks.business },
  ].filter((a) => hasStoreLinks(a.links));
  const hasSocial = Boolean(facebookUrl || youtubeUrl);

  return (
    <footer className="mt-[88px] border-t border-[var(--oc-line2)] bg-[var(--oc-panel)]">
      <div className="max-w-[1240px] mx-auto grid gap-10 px-4 sm:px-6 lg:px-8 py-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        {/* Брэнд + сошиал */}
        <div>
          <Link href="/">
            <Brand size="sm" />
          </Link>
          <p className="mt-3.5 max-w-[300px] text-[13.5px] leading-relaxed text-[var(--oc-muted3)]">
            {CONTACT.org} — авто үйлчилгээний ухаалаг платформ.
          </p>
          {hasSocial ? (
            <div className="flex items-center gap-2 mt-4">
              {facebookUrl ? (
                <a
                  href={facebookUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Facebook"
                  className="w-8 h-8 rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] flex items-center justify-center text-[var(--oc-muted2)] hover:text-[var(--oc-ink)] transition-colors"
                >
                  <FacebookIcon />
                </a>
              ) : null}
              {youtubeUrl ? (
                <a
                  href={youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="YouTube"
                  className="w-8 h-8 rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] flex items-center justify-center text-[var(--oc-muted2)] hover:text-[var(--oc-ink)] transition-colors"
                >
                  <YoutubeIcon />
                </a>
              ) : null}
            </div>
          ) : null}
          {apps.length > 0 ? (
            <div className="mt-5 flex flex-col gap-3">
              {apps.map((a) => (
                <div key={a.key} className="flex flex-col gap-1.5">
                  <span className="font-plex-mono text-[11px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
                    {a.label}
                  </span>
                  <StoreBadges links={a.links} size="sm" appName={`carservice ${a.label.toLowerCase()}`} />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Холбоос */}
        <nav className="flex flex-col gap-2.5 text-[13.5px]">
          <span className="font-plex-mono text-[11.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
            Холбоос
          </span>
          <a href="#boloms" className="text-[var(--oc-muted)] hover:text-[var(--oc-accent-hi)] transition-colors">
            Боломжууд
          </a>
          <a href="#price" className="text-[var(--oc-muted)] hover:text-[var(--oc-accent-hi)] transition-colors">
            Үнэ
          </a>
          <Link href="/terms" className="text-[var(--oc-muted)] hover:text-[var(--oc-accent-hi)] transition-colors">
            Үйлчилгээний нөхцөл
          </Link>
          <Link href="/privacy" className="text-[var(--oc-muted)] hover:text-[var(--oc-accent-hi)] transition-colors">
            Нууцлалын бодлого
          </Link>
          <Link href="/account-deletion" className="text-[var(--oc-muted)] hover:text-[var(--oc-accent-hi)] transition-colors">
            Бүртгэл устгах
          </Link>
          <Link href="/contact" className="text-[var(--oc-muted)] hover:text-[var(--oc-accent-hi)] transition-colors">
            Холбоо барих
          </Link>
        </nav>

        {/* Холбоо барих */}
        <div className="flex flex-col gap-1.5 text-[13.5px] lg:col-span-2">
          <span className="font-plex-mono text-[11.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
            Холбоо барих
          </span>
          <div className="text-[var(--oc-ink2)] font-medium">{CONTACT.org}</div>
          <a
            href={`mailto:${CONTACT.email}`}
            className="text-[var(--oc-muted)] hover:text-[var(--oc-accent-hi)] transition-colors"
          >
            {CONTACT.email}
          </a>
          <div className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums text-[var(--oc-muted)]">
            {phones.map((p) => (
              <a
                key={p}
                href={`tel:${p}`}
                className="hover:text-[var(--oc-accent-hi)] transition-colors"
              >
                {p}
              </a>
            ))}
          </div>
          <div className="text-[var(--oc-muted3)] text-xs mt-0.5">{CONTACT.address}</div>
        </div>
      </div>

      <LogoMarquee />

      <div className="border-t border-[var(--oc-line2)]">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 py-[18px] font-plex-mono text-[12px] text-[var(--oc-muted4)] text-center">
          {CONTACT.copyright} Developed by{" "}
          <a
            href={CONTACT.developerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--oc-accent)] underline underline-offset-2"
          >
            {CONTACT.developerName}
          </a>
        </div>
      </div>
    </footer>
  );
}

function FacebookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z" />
    </svg>
  );
}

function YoutubeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z" />
    </svg>
  );
}
