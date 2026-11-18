import { notFound, redirect } from "next/navigation";
import { SettlementPrint } from "@/app/_components/print/print-document";
import { PrintToolbar } from "@/app/_components/print/print-toolbar";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/roles";
import { loadSettlementDocument } from "@/lib/print/document-loaders";
import { parsePrintFormat } from "@/lib/print/documents";

export const metadata = {
  title: "Тооцооны нэхэмжлэх хэвлэх",
};

export default async function SettlementPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ format?: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "cash.manage")) redirect("/dashboard");
  const [{ id }, { format: rawFormat }] = await Promise.all([params, searchParams]);
  const format = parsePrintFormat(rawFormat);

  // getSettlement enforces cash.manage + branch scope (404 outside it), like the detail page.
  // Мобайл PDF endpoint-той ИЖИЛ loader (lib/print/document-loaders.ts).
  const loaded = await loadSettlementDocument({ actor: user, settlementId: id });
  if (!loaded.ok) notFound();

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <PrintToolbar
        backHref={`/dashboard/cash/settlements/${loaded.settlement.id}`}
        backLabel="Тооцоо нийлэлт"
        format={format}
        basePath={`/dashboard/cash/settlements/${loaded.settlement.id}/print`}
      />
      <SettlementPrint doc={loaded.doc} format={format} />
    </div>
  );
}
