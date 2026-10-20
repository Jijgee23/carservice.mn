import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// Хайлтын системд нээлттэй: нүүр, discover, байгууллага/салбарын хуудас,
// гарын авлага, нөхцөл. Хаалттай: нэвтрэлт шаарддаг/хувийн бүх хэсэг.
// (Disallow нь зөвхөн мөлхөхийг хориглоно — эдгээр хуудсууд өөрсдөө
// `robots: noindex` metadata-тай.)
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/dashboard",
        "/system",
        "/account",
        "/api",
        "/login",
        "/page/login",
        "/page/forgot",
        "/page/activate",
        "/page/choose-branch",
        "/page/api-docs",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
