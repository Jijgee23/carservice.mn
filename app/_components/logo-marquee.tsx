import { PUBLIC_TENANT_WHERE } from "@/lib/tenant-visibility";
import type { CSSProperties } from "react";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";

/* Бүртгэлтэй (идэвхтэй) байгууллагуудын лого — footer-т copyright-ийн дээр
   урсдаг тууз. Лого оруулаагүй бол эхний үсэгтэй placeholder.
   Server component тул landing-ийн ISR-ээр кэшлэгдэнэ. Footer нь зөвхөн
   нийтэд нээлттэй хуудсанд (landing/contact/terms/privacy) ашиглагддаг тул
   энд bypass тавина. */
export async function LogoMarquee() {
  setBypassContext();
  const tenants = await prisma.tenant.findMany({
    where: PUBLIC_TENANT_WHERE,
    select: { id: true, name: true, logoUrl: true },
    orderBy: { createdAt: "asc" },
  });
  if (tenants.length === 0) return null;

  // Тууз дэлгэцээс богино байвал давталт цоорхойтой харагдана — багадаа 10 болтол давтана.
  let row = tenants;
  while (row.length < 10) row = row.concat(tenants);

  return (
    <div className="max-w-7xl mx-auto my-10 pt-8 border-t border-white/[0.04]">
      <div className="text-center text-[11px] uppercase tracking-widest text-white/25 mb-5">
        Бүртгэлтэй байгууллагууд
      </div>
      <div className="logo-marquee">
        <div
          className="logo-marquee-track flex"
          style={{ "--marquee-duration": `${row.length * 4}s` } as CSSProperties}
        >
          {[0, 1].map((half) => (
            <div
              key={half}
              aria-hidden={half === 1}
              className="flex items-center gap-10 pr-10 shrink-0"
            >
              {row.map((t, i) => (
                <div
                  key={`${t.id}-${i}`}
                  title={t.name}
                  className="flex items-center gap-2.5 shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                >
                  {t.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.logoUrl}
                      alt={t.name}
                      loading="lazy"
                      className="h-9 w-9 rounded-lg object-contain bg-white/[0.04] border border-white/[0.06]"
                    />
                  ) : (
                    <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500/30 to-blue-500/30 border border-white/[0.06] flex items-center justify-center text-sm font-bold text-white/70">
                      {t.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm text-white/50 whitespace-nowrap">
                    {t.name}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
