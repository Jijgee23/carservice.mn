import { getBookingBranchResults } from "@/app/_actions/book";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";
import { BookingFlow } from "./booking-flow";

export const metadata = {
  title: "Цаг захиалах — ямар ажил хийлгэх вэ?",
};

// Нийтэд нээлттэй (нэвтрэхгүйгээр үзнэ), олон tenant дээгүүрх систем каталог.
export const dynamic = "force-dynamic";

/**
 * Захиалгын эхлэл. Ажлын төрөл сонгох, тэдгээрийг гүйцэтгэдэг салбарын
 * жагсаалт НЭГ хуудсан дээр (`BookingFlow`, клиент тал) харагдана — энэ
 * server component нь эхний render-ийн өгөгдлийг л (`?keys`-ээр урьдчилан
 * бөглөсөн бол түүнд тохирсон жагсаалтыг, эсвэл шүүлтгүй бүх салбарыг)
 * бэлдэж дамжуулна. Сонголт хожим өөрчлөгдөхөд `BookingFlow` өөрөө
 * `getBookingBranchResults`-ыг дахин дуудна — хуудас дахин ачаалахгүй.
 */
export default async function BookStartPage({
  searchParams,
}: {
  searchParams: Promise<{ keys?: string }>;
}) {
  setBypassContext();
  const { keys: keysParam } = await searchParams;
  // Системийн бүх идэвхтэй ажлын төрөл. Сонгоход тухайн ажлыг хийдэг БҮХ газар
  // гарна — онлайн захиалга авдагт «Цаг авах», бусдад «Дэлгэрэнгүй» + утас
  // (app/_actions/book.ts). Байгууллагууд үйлчилгээгээ dashboard-д сонгодог.
  const serviceKeys = await prisma.systemServiceKey.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const validIds = new Set(serviceKeys.map((k) => k.id));
  const selectedIds = (keysParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((id) => validIds.has(id));

  const initialResults = await getBookingBranchResults(selectedIds);

  return (
    <BookingFlow
      serviceKeys={serviceKeys}
      initialSelectedIds={selectedIds}
      initialResults={initialResults}
    />
  );
}
