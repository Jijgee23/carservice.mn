import { Geist, Geist_Mono } from "next/font/google";
import {
  SystemMobileTopbar,
  SystemSidebar,
} from "@/app/_components/system-sidebar";
import { ToastProvider } from "@/app/_components/toast";
import { WebPushBar } from "@/app/_components/web-push";
import { requireSuperAdmin } from "@/lib/auth/system";

// Ops Console дизайны фонт — dashboard/account-той ижил механизм, зөвхөн
// /system route бүлэгт scoped.
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


// Хувийн хэсэг — хайлтын системд индекслэхгүй (app/robots.ts-ийн Disallow-тай хамт).
export const metadata = { robots: { index: false, follow: false } };

export default async function SystemAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireSuperAdmin();
  const initials =
    ((admin.firstName[0] ?? "") + (admin.lastName[0] ?? "")).toUpperCase();
  const adminName = `${admin.lastName} ${admin.firstName}`.trim();

  return (
    <ToastProvider>
      <div
        className={`${plexSans.variable} ${plexMono.variable} landing-ops min-h-screen bg-[var(--oc-carbon)] flex`}
      >
        <SystemSidebar
          adminName={adminName}
          adminEmail={admin.email}
          initials={initials}
        />
        <div className="app-content-offset flex-1 min-w-0 min-h-screen flex flex-col relative isolate">
          <SystemMobileTopbar adminName={adminName} initials={initials} />
          <WebPushBar
            target="system-admin"
            description="шинэ байгууллага бүртгүүлэх зэрэг мэдэгдэл"
            className="px-4 sm:px-6 lg:px-8 pt-3"
          />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
