import { redirect } from "next/navigation";
import { CASH_TRANSACTIONS_PATH, type CashListSearchParams } from "../cash-list";

// Орлого нь «Орлого, зарлага» хуудсанд нэгдсэн. Хуучин холбоос/bookmark: шүүлтүүрийг хадгалж нэгдсэн хуудас руу чиглүүлнэ.
export default async function LegacyCashIncomePage({ searchParams }: { searchParams: Promise<CashListSearchParams> }) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string" && v) qs.set(k, v);
  qs.set("direction", "INCOME");
  redirect(`${CASH_TRANSACTIONS_PATH}?${qs.toString()}`);
}
