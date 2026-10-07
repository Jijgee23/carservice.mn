import { CashListPage, type CashListSearchParams } from "../cash-list";

export const metadata = {
  title: "Кассын зарлага",
};

export default function CashExpensePage({ searchParams }: { searchParams: Promise<CashListSearchParams> }) {
  return <CashListPage direction="EXPENSE" searchParams={searchParams} />;
}
