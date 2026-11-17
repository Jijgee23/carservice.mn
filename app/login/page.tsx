import { Geist, Geist_Mono } from "next/font/google";
import { ConsumerAuthShell } from "@/app/_components/consumer-auth-shell";
import { redirectIfSignedIn } from "@/lib/auth/guest-redirect";
import { AccountLoginForm } from "./login-form";
import { safeConsumerNext } from "@/lib/safe-redirect";

const plexSans = Geist({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
});
const plexMono = Geist_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata = {
  title: "Нэвтрэх",
  // Хувийн/нэвтрэлтийн хуудас — хайлтад оруулахгүй (app/robots.ts).
  robots: { index: false, follow: false },
};

export default async function AccountLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  // Аль ч realm-д нэвтэрсэн бол өөрийнх нь нүүр рүү (account бол миний цаг).
  const { next } = await searchParams;
  await redirectIfSignedIn({ prefer: "account", next });
  const rawNext = Array.isArray(next) ? next[0] : next;
  // Зөвхөн хэрэглэгчийн хэсгийн зам (захиалгын урсгал) — бусдыг алгасна.
  const consumerNext = rawNext && safeConsumerNext(rawNext) !== "/account" ? safeConsumerNext(rawNext) : "";

  return (
    <div className={`${plexSans.variable} ${plexMono.variable}`}>
      <ConsumerAuthShell
        title="Нэвтрэх / Бүртгүүлэх"
        subtitle="Утасны дугаараа оруулаад, ирэх 6 оронтой кодоор нэвтэрнэ."
      >
        <AccountLoginForm next={consumerNext} />
      </ConsumerAuthShell>
    </div>
  );
}
