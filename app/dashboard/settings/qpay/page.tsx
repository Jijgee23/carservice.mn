import { redirect } from "next/navigation";

// QPay тохиргоо «Төлбөрийн аргууд» хуудасны QPay мөр рүү шилжсэн. Хуучин холбоос/bookmark-д зориулсан чиглүүлэлт.
export default function TenantQPayPage() {
  redirect("/dashboard/payment_methods");
}
