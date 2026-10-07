import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { workingBranchScopeId } from "@/lib/auth/roles";
import {
  type DiagnosticType,
  type TemplateSchema,
  emptySchema,
  tenantVisibleTemplateWhere,
} from "@/lib/diagnostics";
import { prisma } from "@/lib/prisma";
import { StandaloneDiagnosticForm } from "./standalone-form";

export const metadata = {
  title: "Шинэ оношилгоо",
};

export default async function NewDiagnosticPage() {
  const user = await requireUser();
  const scopeBranchId = workingBranchScopeId(user);

  const [branches, customers, vehicles, templates] = await Promise.all([
    prisma.branch.findMany({
      where: {
        tenantId: user.tenantId,
        isActive: true,
        ...(scopeBranchId ? { id: scopeBranchId } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.customer.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, phone: true, isOrganization: true, orgRegnum: true },
    }),
    prisma.tenantVehicle
      .findMany({
        where: { tenantId: user.tenantId, isActive: true },
        orderBy: { vehicle: { plate: "asc" } },
        select: {
          customerId: true,
          vehicle: {
            select: { id: true, plate: true, make: true, model: true },
          },
        },
      })
      .then((rows) =>
        rows.map((r) => ({ ...r.vehicle, customerId: r.customerId })),
      ),
    prisma.diagnosticTemplate.findMany({
      where: { ...tenantVisibleTemplateWhere(user.tenantId), isActive: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, name: true, type: true, schema: true },
    }),
  ]);

  const templatesPrepared = templates.map((t) => {
    let schema: TemplateSchema;
    try {
      schema = t.schema as unknown as TemplateSchema;
      if (!schema.sections) schema = emptySchema();
    } catch {
      schema = emptySchema();
    }
    return {
      id: t.id,
      name: t.name,
      type: t.type as DiagnosticType,
      schema,
    };
  });

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/diagnostics/reports" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Оношилгооны тайлангууд
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">Шинэ оношилгоо</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Шинэ оношилгоо</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          Машин, үйлчлүүлэгч, загвараа сонгож оношилгоо бөглөнө үү
        </p>
      </div>

      <StandaloneDiagnosticForm
        branches={branches}
        customers={customers}
        vehicles={vehicles}
        templates={templatesPrepared}
        defaultBranchId={scopeBranchId}
      />
    </div>
  );
}
