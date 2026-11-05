"use client";

import { usePathname } from "next/navigation";
import { TabLink } from "@/app/_components/landing-ops-ui";
import { DASHBOARD_MODULE_PATHS, modulesForPath } from "@/lib/plan-modules";

const tabs = [
  { href: "/dashboard/services/labor", label: "Ажил" },
  { href: "/dashboard/services/diagnostics", label: "Оношилгоо" },
  { href: "/dashboard/services/goods", label: "Сэлбэг / Бараа" },
  { href: "/dashboard/services/stock-counts", label: "Тооллого" },
];

/** `lockedModules` — багцад ороогүй модулиуд; тэдгээрийн таб харагдахгүй. */
export function ServicesTabs({ lockedModules = [] }: { lockedModules?: string[] }) {
  const pathname = usePathname();
  const visible = tabs.filter(
    (t) => !modulesForPath(t.href, DASHBOARD_MODULE_PATHS).some((m) => lockedModules.includes(m)),
  );
  return (
    <div className="px-6 sm:px-8 pt-6 sm:pt-8">
      <nav className="inline-flex items-center gap-1.5">
        {visible.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <TabLink key={tab.href} href={tab.href} active={active}>
              {tab.label}
            </TabLink>
          );
        })}
      </nav>
    </div>
  );
}
