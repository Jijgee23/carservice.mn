import Link from "next/link";
import { redirect } from "next/navigation";
import { Btn, BtnLink } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { canCreate } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import {
  TEMPLATE_EDITOR_FORM_ID,
  TemplateEditor,
} from "../../../diagnostics/templates/template-editor";

export const metadata = {
  title: "Шинэ оношилгоо",
};

export default async function NewDiagnosticTemplatePage() {
  const user = await requireUser();
  if (!canCreate(user, "diagnostics")) redirect("/dashboard/services/diagnostics");

  const categories = await prisma.category.findMany({
    // Оношилгооны загварт — «Оношилгоо» эсвэл «Бүх төрөлд» ангилал.
    where: { tenantId: user.tenantId, OR: [{ kind: "DIAGNOSTIC" }, { kind: null }] },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: { id: true, name: true, isActive: true },
  });

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/services/diagnostics" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Оношилгоо
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">Шинэ оношилгоо</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Шинэ оношилгоо</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            Үнэ, хугацаа, асуултуудаа тохируулж оношилгооны үйлчилгээгээ үүсгэнэ үү
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BtnLink href="/dashboard/services/diagnostics" variant="ghost">
            ← Буцах
          </BtnLink>
          <Btn type="submit" form={TEMPLATE_EDITOR_FORM_ID}>
            Үүсгэх
          </Btn>
        </div>
      </div>

      <TemplateEditor categories={categories} />
    </div>
  );
}
