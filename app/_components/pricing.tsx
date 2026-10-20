import Link from "next/link";
import { formatTugrik } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";
import { Container, Eyebrow } from "./landing-ops-ui";

type PlanKey = "FREE" | "BUSINESS" | "ENTERPRISE";

const PLAN_ORDER: PlanKey[] = ["FREE", "BUSINESS", "ENTERPRISE"];

// Маркетингийн текст (нэр, тайлбар, CTA) код дотор. Үнэ + боломжийн жагсаалт нь
// backend-аас (PlanPrice / PlanFeature) ирнэ. DB-д тухайн багцын боломж байхгүй
// бол доорх fallback-ийг харуулна.
const PLAN_META: Record<
  PlanKey,
  {
    name: string;
    desc: string;
    cta: string;
    href: string;
    highlighted: boolean;
    fallbackPrice: string;
    fallbackFeatures: string[];
  }
> = {
  FREE: {
    name: "Эхлэл",
    desc: "Жижиг сервис, дөнгөж эхэлж буй багуудад.",
    cta: "Үнэгүй бүртгүүлэх",
    href: "/page/signup",
    highlighted: false,
    fallbackPrice: "Үнэгүй",
    fallbackFeatures: [
      "1 салбар",
      "3 хүртэлх хэрэглэгч",
      "Засварын хуудас & машины түүх",
      "Үндсэн тайлан",
    ],
  },
  BUSINESS: {
    name: "Бизнес",
    desc: "Олон мастертай, өсөн нэмэгдэж буй сервисүүдэд.",
    cta: "14 хоног үнэгүй",
    href: "/page/signup?plan=business",
    highlighted: true,
    fallbackPrice: "Захиалгат",
    fallbackFeatures: [
      "5 хүртэл салбар",
      "30 хүртэлх хэрэглэгч",
      "SMS сануулга",
      "Дэвшилтэт тайлан & экспорт",
      "API хандалт",
    ],
  },
  ENTERPRISE: {
    name: "Энтерпрайз",
    desc: "Сүлжээ, олон салбартай байгууллагуудад.",
    cta: "Холбоо барих",
    href: "/contact",
    highlighted: false,
    fallbackPrice: "Захиалгат",
    fallbackFeatures: [
      "Хязгааргүй салбар & хэрэглэгч",
      "SSO & SLA",
      "Зориулсан тохиргоо",
      "Тусгай интеграц",
    ],
  },
};

function isAbsent(v: string): boolean {
  const s = v.trim().toLowerCase();
  return ["", "—", "-", "үгүй", "байхгүй", "no", "false", "x"].includes(s);
}
function isYes(v: string): boolean {
  const s = v.trim().toLowerCase();
  return ["тийм", "бий", "байгаа", "yes", "true", "✓"].includes(s);
}
function featureText(label: string, value: string): string | null {
  if (isAbsent(value)) return null;
  if (isYes(value)) return label;
  return `${label}: ${value}`;
}

export async function Pricing() {
  // Нийтэд нээлттэй landing хуудасны бүрэлдэхүүн хэсэг — session/tenant байхгүй.
  setBypassContext();
  const [prices, features] = await Promise.all([
    prisma.planPrice.findMany({
      where: { isActive: true, period: "MONTH" },
      select: { plan: true, amount: true },
    }),
    prisma.planFeature.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { plan: true, label: true, value: true },
    }),
  ]);

  const priceByPlan = new Map(prices.map((p) => [p.plan, p.amount]));

  const plans = PLAN_ORDER.map((plan) => {
    const meta = PLAN_META[plan];
    const amount = priceByPlan.get(plan);
    const hasPaidPrice = amount != null && Number(amount.toString()) > 0;

    let price: string;
    let period: string;
    if (hasPaidPrice) {
      price = formatTugrik(amount.toString());
      period = "/сар";
    } else if (plan === "FREE") {
      price = "Үнэгүй";
      period = "үргэлж";
    } else {
      price = meta.fallbackPrice;
      period = "";
    }

    const dbFeatures = features
      .filter((f) => f.plan === plan)
      .map((f) => featureText(f.label, f.value))
      .filter((t): t is string => t !== null);
    const featureList =
      dbFeatures.length > 0 ? dbFeatures : meta.fallbackFeatures;

    return {
      key: plan,
      name: meta.name,
      desc: meta.desc,
      cta: meta.cta,
      href: meta.href,
      highlighted: meta.highlighted,
      price,
      period,
      features: featureList,
    };
  });

  return (
    <Container className="pt-24">
      <div id="price" className="scroll-mt-24">
        <Eyebrow>Үнэ</Eyebrow>
        <h2 className="mb-2 mt-4 text-3xl sm:text-4xl lg:text-[40px] font-semibold tracking-[-0.03em] text-[var(--oc-ink)]">
          Жижиг сервисээс эхлээд сүлжээ хүртэл
        </h2>
        <p className="mb-10 text-[15.5px] text-[var(--oc-muted2)]">
          Хэдхэн машинаар эхэлж, бизнесийнхээ хэмжээгээр өс. Үнэ ил тод, нуугдмал төлбөргүй.
        </p>
        <div className="grid items-start gap-6 lg:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.key}
              className={
                p.highlighted
                  ? "rounded-[10px] border border-[var(--oc-accent)] bg-[var(--oc-panel2)] px-8 py-[30px] shadow-[0_24px_60px_-30px_rgba(34,211,238,0.35)]"
                  : "rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-8 py-[30px]"
              }
            >
              <div className="flex items-center justify-between">
                <div className="text-[18px] font-semibold text-[var(--oc-ink2)]">{p.name}</div>
                {p.highlighted ? (
                  <span className="rounded bg-[var(--oc-accent)] px-2.5 py-1 font-plex-mono text-[11.5px] tracking-[0.06em] text-[var(--oc-on-accent)]">
                    ХАМГИЙН ТОХИРОМЖТОЙ
                  </span>
                ) : null}
              </div>
              <div className="mt-1.5 text-[14px] text-[var(--oc-muted2)]">{p.desc}</div>
              <div className="mt-[22px] font-plex-mono text-[32px] font-semibold text-[var(--oc-ink)]">
                {p.price}
                <span className="text-[15px] font-normal text-[var(--oc-muted3)]"> {p.period}</span>
              </div>

              <Link
                href={p.href}
                className={
                  p.highlighted
                    ? "mt-[26px] block rounded-lg bg-[var(--oc-accent)] py-3 text-center text-[14.5px] font-semibold text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)]"
                    : "mt-[26px] block rounded-lg border border-[var(--oc-line)] py-3 text-center text-[14.5px] font-semibold text-[var(--oc-ink2)] hover:border-[var(--oc-muted4)] hover:bg-[var(--oc-panel2)]"
                }
              >
                {p.cta}
              </Link>

              <ul className="mt-[22px] flex flex-col gap-2.5 text-[14.5px]">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[var(--oc-muted)]">
                    <span className="mt-0.5 text-[var(--oc-accent)]">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </Container>
  );
}
