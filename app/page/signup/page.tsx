import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { redirect } from "next/navigation";
import { hasActiveUserSession } from "@/lib/auth";
import { TenantAuthShellWide } from "@/app/_components/tenant-auth-shell";
import { getAddressData } from "@/lib/address";
import { setBypassContext } from "@/lib/tenant-context";
import { SignUpForm } from "./signup-form";

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
  title: "Бүртгүүлэх",
};

export default async function SignUpPage() {
  // Аль хэдийн байгууллагад нэвтэрсэн бол консол руу.
  if (await hasActiveUserSession()) redirect("/dashboard");
  // Нэвтрээгүй, public хуудас — session/tenant байхгүй.
  setBypassContext();
  const addressData = await getAddressData();

  return (
    <div className={`${plexSans.variable} ${plexMono.variable}`}>
      <TenantAuthShellWide
        title="Байгууллагаа бүртгүүлэх"
        subtitle="2 минутын дотор carservice дээр салбараа үүсгээрэй."
        footer={
          <>
            Бүртгэлтэй юу?{" "}
            <Link
              href="/page/login"
              className="font-semibold text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
            >
              Нэвтрэх
            </Link>
          </>
        }
      >
        <SignUpForm
          addressData={addressData}
          mapApiKey={process.env.GOOGLE_MAP_API_KEY ?? ""}
          mapId={process.env.GOOGLE_MAP_ID ?? ""}
        />
      </TenantAuthShellWide>
    </div>
  );
}
