import type { ReactNode } from "react";

// Хэрэглэгчийн хувийн бүртгэлийн хэсэг — хайлтын системд индекслэхгүй.
export const metadata = { robots: { index: false, follow: false } };

export default function AccountLayout({ children }: { children: ReactNode }) {
  return children;
}
