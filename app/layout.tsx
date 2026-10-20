import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

// Анхдагч theme нь light (`<html>`-д серверээс `light` class — анивчихгүй);
// хэрэглэгч бараан горим сонгосон (localStorage theme=dark) бол энэ богино script
// class-ыг авна. Хумигдсан sidebar-ийн өргөнийг ч мөн тавина. Өөрчлөгдвөл src (data: URL) өөрчлөгдөж React
// шинэ resource гэж үзнэ.
const THEME_INIT_CODE =
  "(function(){try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.remove('light');if(localStorage.getItem('carcare:sidebar:collapsed')==='1')document.documentElement.style.setProperty('--sidebar-w','4.5rem')}catch(e){}})()";
const THEME_INIT_SRC = `data:text/javascript,${encodeURIComponent(THEME_INIT_CODE)}`;

export const metadata: Metadata = {
  metadataBase: new URL("https://carservice.mn"),
  title: {
    default: "carservice.mn — Автозасвар, автосервисийн цаг онлайнаар захиалах",
    template: "%s · carservice.mn",
  },
  // Хэрэглэгч (цаг захиалагч) болон засварын газар хоёуланд — хайлтын
  // үгстэй («авто засвар», «цаг захиалах», «автосервис») таарахаар.
  description:
    "Ойролцоох автозасвар, автосервис, оношилгооны газрыг олж онлайнаар цаг захиалаарай. Автозасварын газруудад — засварын хуудас, цаг захиалга, касс, нөөц, тайлан нэг дороос.",
  keywords: [
    "carservice",
    "carservice.mn",
    "авто засвар",
    "авто оношилгоо",
    "автозасвар",
    "автосервис",
    "авто сервис",
    "авто угаалга",
    "дугуй засвар",
    "сервис менежмент",
    "OBD",
    "Mongolia",
  ],
  // Icon-уудыг файлын конвенцоор (app/favicon.ico, app/icon.png,
  // app/apple-icon.png) Next автоматаар <head>-д нэмнэ.
  openGraph: {
    title: "carservice.mn — Автозасвар, автосервисийн цаг онлайнаар захиалах",
    description:
      "Автозасвар, автосервисийн цагийг онлайнаар захиалах платформ. Автозасварын газруудад зориулсан бүрэн удирдлагын систем.",
    url: "https://carservice.mn",
    siteName: "carservice.mn",
    locale: "mn_MN",
    type: "website",
    // icon: [
    //   { url: "/favicon.ico", type: "image/x-icon" },
    //   { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
    //   { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
    // ],
    // Зураг: app/opengraph-image.png (файлын конвенц — бүх хуудсанд анхдагч).
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  // Анхдагч theme light (app/layout <html class="light">); dark сонгосон үед бараан.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="mn"
      className={`${geist.variable} light h-full antialiased`}
      suppressHydrationWarning
    >
      <body
        className="min-h-full flex flex-col bg-[var(--bg-primary)] text-white"
        suppressHydrationWarning
      >
        {/* Theme болон sidebar-ийн хумигдсан төлөвийг paint-аас өмнө тогтооно —
            дараа нь "flash" (буруу өнгө/өргөнөөс гэнэт шилжих) гарахгүй.

            Яагаад `async` + `data:` URL вэ? React 19 нь `<script async src>`-ийг
            "hoistable resource" гэж үзнэ: SSR-д <head>-д хойшлуулж бичдэг, client
            дээр root layout дахин mount хийгдсэн ч (top-level redirect boundary,
            hydration recovery) DOM-д байгаа тег-ийг src-ээр олж дахин ашигладаг.
            Харин inline `<script>` (мөн next/script-ийн beforeInteractive — тэр ч
            бас түүхий <script> тег гаргадаг) client mount бүрт React-ийн
            "Encountered a script tag while rendering React component"
            анхааруулгыг өгдөг. data: URL нь сүлжээний хүсэлтгүй тул шууд
            бэлэн болж, ердийн inline script-тэй адил CSS ачаалахаас өмнө ажиллана. */}
        <script async src={THEME_INIT_SRC} />
        {children}
      </body>
    </html>
  );
}
