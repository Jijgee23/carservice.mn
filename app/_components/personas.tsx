import Link from "next/link";
import { Container, Eyebrow } from "./landing-ops-ui";

const PERSONAS = [
  {
    role: "Сервисийн эзэн",
    title: "Олон салбараа нэг дороос удирд",
    desc: "Орлого, ачаалал, нөөц, ажилчдын гүйцэтгэлийг бодит цагт хяна. Шийдвэрээ өгөгдөл дээр тулгуурлан гарга.",
  },
  {
    role: "Менежер / Мастер",
    title: "Өдрийн ажлын явц гартаа",
    desc: "Засварын хуудас, машины түүх, ашиглах сэлбэг — гар утаснаасаа л шууд харна. Урт жагсаалт хэвлэхээ боль.",
  },
  {
    role: "Үйлчлүүлэгч",
    title: "Машиныхаа эрүүл мэндийг мэдэх",
    desc: "Өмнөх засваруудын түүх, дараагийн ТО-ны хугацаа, үнийн саналыг утсан дээрээ.",
    links: [
      { href: "/discover", label: "Засварын газар хайж цаг захиалах" },
      { href: "/login", label: "Утасны дугаараа оруулж нэвтрэх" },
    ],
  },
];

export function Personas() {
  return (
    <Container className="pt-24">
      <Eyebrow>Хэнд зориулсан</Eyebrow>
      <h2 className="mt-4 mb-10 text-3xl sm:text-4xl lg:text-[40px] font-semibold tracking-[-0.03em] text-[var(--oc-ink)]">
        Сервистэй холбоотой хүн бүхэнд
      </h2>

      <div className="grid gap-6 lg:grid-cols-3">
        {PERSONAS.map((p) => (
          <div
            key={p.role}
            className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-9 py-[34px]"
          >
            <div className="font-plex-mono text-[12px] uppercase tracking-[0.14em] text-[var(--oc-accent)]">
              {p.role}
            </div>
            <h3 className="mt-4 text-[22px] font-semibold tracking-[-0.02em] text-[var(--oc-ink)]">
              {p.title}
            </h3>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--oc-muted)]">{p.desc}</p>
            {p.links ? (
              <div className="mt-6 flex flex-col items-start gap-2.5">
                {p.links.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
                  >
                    <span className="font-plex-mono">→</span>
                    {l.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Container>
  );
}
