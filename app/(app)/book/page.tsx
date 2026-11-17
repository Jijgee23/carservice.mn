import { getBookingBranchResults } from "@/app/_actions/book";
import { bookableServiceKeyWhere } from "@/lib/bookable-service-keys";
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
  // Онлайн захиалга авдаг газарт байхгүй түлхүүрийг ШҮҮНЭ ГАРГАНА — сонговол
  // баталгаатай хоосон салбарын жагсаалт буцаах сонголтыг цэсэнд харуулахгүй
  // (харах: app/(app)/discover/page.tsx-ийн ижил шийдвэр).
  const serviceKeys = await prisma.systemServiceKey.findMany({
    where: await bookableServiceKeyWhere(),
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
