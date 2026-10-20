// App Store / Google Play татах товч — server болон client компонентод
// (sidebar) хоёуланд ашиглагдана (hook/серверийн импортгүй). Холбоосгүй store-ийн
// товч render хийгдэхгүй; хоёулаа хоосон бол юу ч гарахгүй.

import type { StoreLinks } from "@/lib/app-store-links";

function AppleIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

function PlayIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.018 13.298l-3.919 2.218-3.515-3.493 3.543-3.521 3.891 2.202a1.49 1.49 0 0 1 0 2.594zM1.337.924a1.486 1.486 0 0 0-.112.568v21.017c0 .217.045.419.124.6l11.155-11.087L1.337.924zm12.207 10.065l3.258-3.238L3.45.195a1.466 1.466 0 0 0-.946-.179l11.04 10.973zm0 2.067l-11 10.933c.298.036.612-.016.906-.183l13.324-7.54-3.23-3.21z" />
    </svg>
  );
}

const STORES = [
  { key: "appStore", small: "App Store-оос", big: "App Store", Icon: AppleIcon },
  { key: "playStore", small: "Google Play-ээс", big: "Google Play", Icon: PlayIcon },
] as const;

/**
 * `md` — нүүр хуудасны том badge (жижиг «…-оос татах» + store нэр).
 * `sm` — sidebar/footer-ийн нягт товч.
 */
export function StoreBadges({
  links,
  size = "md",
  appName,
}: {
  links: StoreLinks;
  size?: "md" | "sm";
  /** aria-label-д: «Carservice апп-ыг App Store-оос татах». */
  appName: string;
}) {
  const items = STORES.filter((s) => links[s.key]);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map(({ key, small, big, Icon }) => (
        <a
          key={key}
          href={links[key]!}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${appName} татах — ${big}`}
          className={
            size === "md"
              ? "inline-flex items-center gap-2.5 rounded-xl border border-[var(--oc-line)] bg-[var(--oc-ink)] text-[var(--oc-carbon)] px-3.5 py-2 hover:opacity-90 transition-opacity"
              : "inline-flex items-center gap-1.5 rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] text-[var(--oc-ink2)] px-2.5 py-1.5 text-xs font-medium hover:border-[var(--oc-accent)] hover:text-[var(--oc-accent)] transition-colors"
          }
        >
          <Icon size={size === "md" ? 22 : 14} />
          {size === "md" ? (
            <span className="flex flex-col leading-tight text-left">
              <span className="text-[10px] opacity-80">{small} татах</span>
              <span className="text-sm font-semibold">{big}</span>
            </span>
          ) : (
            <span>{big}</span>
          )}
        </a>
      ))}
    </div>
  );
}

/** Sidebar-ийн доод хэсгийн «Апп татах» мөр — хумигдсан үед болон холбоосгүй бол нуугдана. */
export function SidebarAppLinks({
  links,
  title,
  appName,
  collapsed = false,
}: {
  links: StoreLinks | null | undefined;
  title: string;
  appName: string;
  collapsed?: boolean;
}) {
  if (collapsed || !links || (!links.appStore && !links.playStore)) return null;
  return (
    <div className="px-4 pb-3 flex flex-col gap-1.5">
      <span className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">{title}</span>
      <StoreBadges links={links} size="sm" appName={appName} />
    </div>
  );
}
