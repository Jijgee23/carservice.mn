import { jsonLdString } from "@/lib/seo";

// schema.org бүтэцлэгдсэн өгөгдөл (Google rich result / local SEO). Server
// component дотор render хийгдэх тул client-д script ажиллуулахгүй.
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
