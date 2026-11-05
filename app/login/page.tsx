import { Geist, Geist_Mono } from "next/font/google";
import { redirect } from "next/navigation";
import { ConsumerAuthShell } from "@/app/_components/consumer-auth-shell";
import { getAccount } from "@/lib/auth/account";
import { AccountLoginForm } from "./login-form";

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

export default async function AccountLoginPage() {
  // Нэвтэрсэн бол шууд миний цаг руу.
  const account = await getAccount();
  if (account) redirect("/account");

  return (
    <div className={`${plexSans.variable} ${plexMono.variable}`}>
      <ConsumerAuthShell
        title="Нэвтрэх / Бүртгүүлэх"
        subtitle="Утасны дугаараа оруулаад, ирэх 6 оронтой кодоор нэвтэрнэ."
      >
        <AccountLoginForm />
      </ConsumerAuthShell>
    </div>
  );
}
