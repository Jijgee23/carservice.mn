import { CashListPage, type CashListSearchParams } from "../cash-list";

export const metadata = {
  title: "Кассын орлого",
};

export default function CashIncomePage({ searchParams }: { searchParams: Promise<CashListSearchParams> }) {
  return <CashListPage direction="INCOME" searchParams={searchParams} />;
}
