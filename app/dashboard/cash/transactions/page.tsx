import { CashListPage, type CashListSearchParams } from "../cash-list";

export const metadata = {
  title: "Орлого, зарлага",
};

export default function CashTransactionsPage({ searchParams }: { searchParams: Promise<CashListSearchParams> }) {
  return <CashListPage searchParams={searchParams} />;
}
