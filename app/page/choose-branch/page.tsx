import { redirect } from "next/navigation";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { EmptyState } from "@/app/_components/empty-state";
import { TenantAuthShellWide } from "@/app/_components/tenant-auth-shell";
import { requireUser } from "@/lib/auth";
import { canChooseAllBranches, eligibleBranchIds } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { ChooseBranchForm } from "./choose-branch-form";

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
  title: "Ажиллах салбар сонгох",
  // Хувийн/нэвтрэлтийн хуудас — хайлтад оруулахгүй (app/robots.ts).
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Нэвтэрсний дараа (owner, эсвэл 2 ба түүнээс дээш салбарт ажилладаг ажилтан)
// ажиллах салбараа сонгуулах хуудас. proxy.ts-ийн middleware workingBranchId
// байхгүй session-г эндрүү чиглүүлдэг; сонгосны дараа /dashboard-д харагдах
// "ажиллаж байна" баннер, жагсаалт/тайлангийн scope, шинэ захиалга/цагийн
// анхны салбар бүгд энд сонгосон утгаас хамаарна (харах:
// lib/auth/roles.ts workingBranchScopeId, app/_actions/auth.ts
// chooseBranchAction).
export default async function ChooseBranchPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await requireUser();
  // Аль хэдийн сонгосон бол энэ (нэвтрэх үеийн) хуудсыг дахин үзүүлэхгүй.
  // Өөр салбар руу шилжихийг dashboard дотроосоо, гарч нэвтрэхгүйгээр хийнэ
  // (харах: app/dashboard/branch-switcher.tsx).
  if (user.workingBranchId) redirect("/dashboard");

  const { next: nextRaw } = await searchParams;
  const next = nextRaw && nextRaw.startsWith("/") ? nextRaw : "/dashboard";

  // Owner эсвэл тогтмол салбаргүй ч нэмэлт сонголтгүй ("Бүх салбар"-аар
  // хамрагдсан) ажилтанд тенантын БҮХ идэвхтэй салбарыг харуулна. 2+
  // салбарт ажилладаг ажилтанд зөвхөн ӨӨРИЙН eligible жагсаалтыг харуулна
  // (харах: lib/auth/roles.ts eligibleBranchIds, chooseBranchAction).
  const allowAllBranches = canChooseAllBranches(user);
  const eligible = eligibleBranchIds(user);
  const restrictToEligible = !user.isOwner && eligible.length > 0;

  const branches = await prisma.branch.findMany({
    where: {
      tenantId: user.tenantId,
      isActive: true,
      ...(restrictToEligible ? { id: { in: eligible } } : {}),
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      city: true,
      district: true,
      address: true,
      openTime: true,
      closeTime: true,
    },
  });

  return (
    <div className={`${plexSans.variable} ${plexMono.variable}`}>
      <TenantAuthShellWide
        title="Ажиллах салбараа сонгоно уу"
        subtitle="Өнөөдөр аль салбарт ажиллахаа сонгоно уу — захиалга, цаг захиалга, тайлан цаашид энэ салбараар харагдана. Дараа нь dashboard-ийн баннераас өөр салбар руу шилжиж болно."
      >
        {branches.length === 0 && !allowAllBranches ? (
          <EmptyState padding="p-6">
            Идэвхтэй салбар алга. Эхлээд салбараа бүртгүүлнэ үү.
          </EmptyState>
        ) : (
          <ChooseBranchForm
            branches={branches}
            allowAllBranches={allowAllBranches}
            next={next}
          />
        )}
      </TenantAuthShellWide>
    </div>
  );
}
