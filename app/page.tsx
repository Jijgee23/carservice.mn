import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { AppDownload } from "./_components/app-download";
import { CtaBanner } from "./_components/cta-banner";
import { Faq } from "./_components/faq";
import { Features } from "./_components/features";
import { Footer } from "./_components/footer";
import { Hero } from "./_components/hero";
import { HowItWorks } from "./_components/how-it-works";
import { Nav } from "./_components/nav";
import { Personas } from "./_components/personas";
import { Pricing } from "./_components/pricing";
import { RoleLoginBar } from "./_components/role-login-bar";
import { Stats } from "./_components/stats";

// "Ops Console" landing дизайны фонт — зөвхөн энэ хуудсанд scoped (root
// layout-ийн Geist-г хөндөхгүй), .landing-ops wrapper-т variable-аар холбогдоно.
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

// Нүүр хуудас «/» дээр шууд (өмнө нь /page/landing руу 307 redirect хийдэг
// байсан — Google нүүр хуудсыг сул үнэлж, хайлтад /page/landing гардаг байв).
export const metadata = {
  title: { absolute: "carservice.mn — Авто засвар, үйлчилгээний цаг онлайнаар захиалах" },
  alternates: { canonical: "/" },
};

// Үнэ (PlanPrice/PlanFeature) backend-аас ирдэг тул цаг тутам сэргээнэ (ISR).
export const revalidate = 3600;

export default function LandingPage() {
  return (
    <div
      className={`${plexSans.variable} ${plexMono.variable} landing-ops relative flex flex-col min-h-screen overflow-x-clip`}
    >
      <RoleLoginBar />
      <Nav />
      <main className="flex-1">
        <Hero />
        <Stats />
        <Personas />
        <Features />
        <HowItWorks />
        <Pricing />
        <AppDownload />
        <Faq />
        <CtaBanner />
      </main>
      <Footer />
    </div>
  );
}
