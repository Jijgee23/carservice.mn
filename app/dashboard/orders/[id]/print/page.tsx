import { notFound, redirect } from "next/navigation";
import { OrderPrint } from "@/app/_components/print/print-document";
import { PrintToolbar } from "@/app/_components/print/print-toolbar";
import { requireUser } from "@/lib/auth";
import { getBranchVisibility } from "@/lib/branch-visibility";
import { canView, workingBranchScopeId } from "@/lib/auth/roles";
import { loadOrderDocument } from "@/lib/print/document-loaders";
import { parsePrintFormat } from "@/lib/print/documents";

export const metadata = {
  title: "Захиалгын хуудас хэвлэх",
};

export default async function OrderPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ format?: string }>;
}) {
  const user = await requireUser();
  if (!canView(user, "orders")) redirect("/dashboard");
  // Энгийн багц (ганц салбар): хэвлэхэд салбарын нэрийг нууна (хаяг үлдэнэ).
  const { hideBranches } = await getBranchVisibility(user);
  const [{ id }, { format: rawFormat }] = await Promise.all([params, searchParams]);

  // Мобайл PDF endpoint-той ИЖИЛ loader (lib/print/document-loaders.ts): эрх, салбарын хүрээ, талбар зөрөхгүй.
  const loaded = await loadOrderDocument({
    user,
    orderId: id,
    scopeBranchId: workingBranchScopeId(user),
    hideBranches,
  });
  if (!loaded.ok) {
    if (loaded.reason === "forbidden") redirect("/dashboard/orders");
    notFound();
  }
  // URL-д format байхгүй бол tenant-ийн анхдагч хэмжээ.
  const format = parsePrintFormat(rawFormat, loaded.defaultFormat);

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <PrintToolbar
        backHref={`/dashboard/orders/${loaded.order.id}`}
        backLabel={`Засварын хуудас #${loaded.order.number}`}
        format={format}
        basePath={`/dashboard/orders/${loaded.order.id}/print`}
      />
      <OrderPrint doc={loaded.doc} format={format} />
    </div>
  );
}
