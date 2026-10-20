import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import {
  AdminSidebar,
  MobileTopbar,
} from "@/app/_components/admin-sidebar";
import { SubscriptionBanner } from "@/app/_components/subscription-banner";
import { SubscriptionGuard } from "@/app/_components/subscription-guard";
import { ToastProvider } from "@/app/_components/toast";
import { WebPushToggle } from "@/app/_components/web-push";
import { BranchRosterSync } from "./branch-roster-sync";
import { BranchSwitcher } from "./branch-switcher";
import { requireUser } from "@/lib/auth";
import { canChooseAllBranches, eligibleBranchIds } from "@/lib/auth/roles";
import { ALL_BRANCHES } from "@/lib/auth/session";
import { resolveTodayLockedBranch } from "@/lib/employee-branch-lock";
import { getAppStoreLinks } from "@/lib/platform-settings";
import { prisma } from "@/lib/prisma";
import { getSubscriptionState } from "@/lib/subscription-server";
import { setTenantContext } from "@/lib/tenant-context";

// Ops Console дизайны фонт — landing/auth хуудсуудтай ижил механизм, зөвхөн
// dashboard route-д scoped (бусад апп — account/system — Geist хэвээр).
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


// Хувийн хэсэг — хайлтын системд индекслэхгүй (app/robots.ts-ийн Disallow-тай хамт).
export const metadata = { robots: { index: false, follow: false } };

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  // requireUser() нь cache()-тэй бөгөөд context-оо өөрийн async frame дотор тавьдаг — layout нь page-тэй зэрэгцэн
  // render хийгддэг тул тэр context энд үргэлж дамждаггүй байсан (прод: «Tenant context тохируулагдаагүй
  // (Notification.count)», /dashboard-ийн ~20% нь 500). Тиймээс layout өөрөө, query-үүдийнхээ өмнө тавина
  // ((app)/layout.tsx-ийн setBypassContext()-тэй ижил зарчим).
  setTenantContext(user.tenantId);
  const initials =
    (user.firstName[0] ?? "") + (user.lastName[0] ?? "");
  const userName = `${user.firstName} ${user.lastName}`.trim();

  // Ажиллах салбар солих сонголтод зориулж (харах: ./branch-switcher.tsx) —
  // /page/choose-branch/page.tsx-ийн адил eligible-аар хязгаарлана.
  const allowAllBranches = canChooseAllBranches(user);
  const eligible = eligibleBranchIds(user);
  const restrictToEligible = !user.isOwner && eligible.length > 0;

  const [subState, unreadNotifications, switchableBranches, lockedBranch, appLinks] = await Promise.all([
    getSubscriptionState(user.tenantId),
    prisma.notification.count({
      where: { userId: user.id, readAt: null },
    }),
    prisma.branch.findMany({
      where: {
        tenantId: user.tenantId,
        isActive: true,
        ...(restrictToEligible ? { id: { in: eligible } } : {}),
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      select: { id: true, name: true },
    }),
    // Өнөөдрийн ажлын хувиараар тодорхой салбар "түгжигдсэн" эсэх — байвал
    // switcher-ийг унтраагаад, session хуучирсан бол автоматаар шинэчилнэ
    // (харах: ./branch-roster-sync.tsx, lib/employee-branch-lock.ts).
    resolveTodayLockedBranch(user),
    // Засварын газрын аппын store холбоос — tenant context-ыг өөрчлөхгүй уншина.
    getAppStoreLinks().then((l) => l.business),
  ]);

  return (
    <ToastProvider>
      <div
        className={`${plexSans.variable} ${plexMono.variable} landing-ops min-h-screen bg-[var(--oc-carbon)] flex`}
      >
        <AdminSidebar
          userName={userName}
          userEmail={user.email}
          initials={initials.toUpperCase()}
          tenantName={user.tenant.name}
          tenantLogoUrl={user.tenant.logoUrl}
          isOwner={user.isOwner}
          permissions={user.role?.permissions ?? []}
          notificationUnread={unreadNotifications}
          appLinks={appLinks}
        />
        <div className="app-content-offset flex-1 min-w-0 min-h-screen flex flex-col relative isolate">
          <MobileTopbar
            userName={userName}
            userEmail={user.email}
            tenantName={user.tenant.name}
            tenantLogoUrl={user.tenant.logoUrl}
            initials={initials.toUpperCase()}
            isOwner={user.isOwner}
            permissions={user.role?.permissions ?? []}
            notificationUnread={unreadNotifications}
          appLinks={appLinks}
          />
          <SubscriptionGuard locked={subState.locked} isOwner={user.isOwner} />
          <div className="px-4 sm:px-6 lg:px-8 pt-3">
            <div className="flex flex-col sm:flex-row items-stretch gap-3">
              {user.workingBranchId === ALL_BRANCHES || user.workingBranch ? (
                <BranchSwitcher
                  firstName={user.firstName}
                  currentBranch={user.workingBranch}
                  currentIsAll={user.workingBranchId === ALL_BRANCHES}
                  branches={switchableBranches}
                  allowAllBranches={allowAllBranches}
                  locked={Boolean(lockedBranch)}
                />
              ) : null}
              <BranchRosterSync
                lockedBranchId={lockedBranch?.branchId ?? null}
                currentBranchId={
                  user.workingBranchId && user.workingBranchId !== ALL_BRANCHES
                    ? user.workingBranchId
                    : null
                }
              />
              <SubscriptionBanner
                locked={subState.locked}
                isTrial={subState.active?.isTrial ?? false}
                daysLeft={subState.active?.daysLeft ?? 0}
                expiresAt={subState.active?.expiresAt ?? null}
                expiringSoon={subState.expiringSoon}
                hasPendingPayment={subState.hasPendingPayment}
                isOwner={user.isOwner}
                className="flex-1 min-w-0"
              />
            </div>
          </div>
          <div className="px-4 sm:px-6 lg:px-8 pt-3">
            <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--oc-ink2)]">Мэдэгдэл</div>
                <div className="text-xs text-[var(--oc-muted3)]">
                  Засварын хуудас, цаг захиалгын мэдэгдлийг энэ төхөөрөмж дээр авах.
                </div>
              </div>
              <WebPushToggle target="user" />
            </section>
          </div>
          <main className="flex-1 flex flex-col min-w-0">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
