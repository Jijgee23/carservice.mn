import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getEnabledModules } from "@/lib/plan-modules-server";
import { canCreate } from "@/lib/auth/roles";
import { notFound, redirect } from "next/navigation";
import { Btn, BtnLink } from "@/app/_components/landing-ops-ui";
import { BranchForm, BRANCH_FORM_ID } from "../branch-form";
import { getAddressData } from "@/lib/address";
import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Шинэ салбар",
};

export default async function NewBranchPage() {
  const user = await requireUser();
  // «Олон салбар» модуль багцад ороогүй бол хоёр дахь салбар нэмэх хуудас байхгүй.
  if (
    !(await getEnabledModules(user.tenant.plan)).has("enable_multi_branch") &&
    (await prisma.branch.count({ where: { tenantId: user.tenantId } })) > 0
  ) {
    notFound();
  }
  if (!canCreate(user, "branches")) redirect("/dashboard/branches");

  const [addressData, tagOptions] = await Promise.all([
    getAddressData(),
    prisma.branchTag.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/branches" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Салбарууд
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">Шинэ салбар</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Шинэ салбар</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            Шинэ салбарын мэдээллийг оруулна уу.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BtnLink href="/dashboard/branches" variant="ghost">
            ← Буцах
          </BtnLink>
          <Btn type="submit" form={BRANCH_FORM_ID}>
            Үүсгэх
          </Btn>
        </div>
      </div>

      <BranchForm
        addressData={addressData}
        mapApiKey={process.env.GOOGLE_MAP_API_KEY ?? ""}
        mapId={process.env.GOOGLE_MAP_ID ?? ""}
        tagOptions={tagOptions}
      />
    </div>
  );
}
