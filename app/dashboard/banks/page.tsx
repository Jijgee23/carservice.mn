import { redirect } from "next/navigation";

// «Төлбөрийн аргууд» хуудас /dashboard/payment_methods руу шилжсэн. Хуучин холбоос/bookmark-д зориулсан чиглүүлэлт.
export default function LegacyBanksPage() {
  redirect("/dashboard/payment_methods");
}
