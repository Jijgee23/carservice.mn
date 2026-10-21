import Link from "next/link";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { redirect } from "next/navigation";
import { hasActiveUserSession } from "@/lib/auth";
import { TenantAuthShell } from "@/app/_components/tenant-auth-shell";
import { LoginForm } from "./login-form";

// Ops Console дизайны фонт — зөвхөн энэ хуудсанд scoped (root layout-ийн
// Geist-г хөндөхгүй), landing/page.tsx-тэй ижил механизм.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata = {
  title: "Нэвтрэх",
  // Хувийн/нэвтрэлтийн хуудас — хайлтад оруулахгүй (app/robots.ts).
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  // Аль хэдийн нэвтэрсэн бол консол руу (салбар сонгоогүй бол proxy
  // choose-branch руу шилжүүлнэ).
  if (await hasActiveUserSession()) redirect("/dashboard");

  return (
    <div className={`${plexSans.variable} ${plexMono.variable}`}>
      <TenantAuthShell
        title="Ажлын консолд нэвтрэх"
        subtitle="Байгууллагын имэйл хаяг эсвэл утасны дугаараа оруулна уу. Дараагийн алхамд нууц үг эсвэл нэг удаагийн кодоор баталгаажуулна."
        notice={
          <>
            <span className="font-plex-mono text-[11px] uppercase tracking-[0.1em] text-[var(--oc-muted3)] block mb-2">
              Шинэ байгууллага
            </span>
            Засварын газраа системд холбохыг хүсвэл{" "}
            <Link
              href="/page/signup"
              className="font-semibold text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
            >
              бүртгүүлэх хүсэлт
            </Link>{" "}
            илгээнэ үү.
          </>
        }
      >
        <LoginForm />
      </TenantAuthShell>
    </div>
  );
}
