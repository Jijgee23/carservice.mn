import { planFeatureLines } from "@/lib/plan-modules";
import { getEnabledModules } from "@/lib/plan-modules-server";
import { setBypassContext } from "@/lib/tenant-context";
import { Container, Eyebrow } from "./landing-ops-ui";
import { PricingCards, type PlanCardData } from "./pricing_card";

type PlanKey = "FREE" | "BUSINESS" | "ENTERPRISE";

const PLAN_ORDER: PlanKey[] = ["FREE", "BUSINESS", "ENTERPRISE"];

const PLAN_META: Record<
  PlanKey,
  {
    name: string;
    desc: string;
    cta: string;
    href: string;
    highlighted: boolean;
    fallbackPrice: string;
  }
> = {
  FREE: {
    name: "Энгийн",
    desc: "Жижиг сервис, дөнгөж эхэлж буй багуудад.",
    cta: "Үнэгүй бүртгүүлэх",
    href: "/page/signup",
    highlighted: false,
    fallbackPrice: "Үнэгүй",
  },
  BUSINESS: {
    name: "Бизнес",
    desc: "Олон мастертай, өсөн нэмэгдэж буй сервисүүдэд.",
    cta: "Үнийн санал авах",
    href: "/page/quote?plan=business",
    highlighted: true,
    fallbackPrice: "Захиалгат",
  },
  ENTERPRISE: {
    name: "Энтерпрайз",
    desc: "Сүлжээ, олон салбартай байгууллагуудад.",
    cta: "Үнийн санал авах",
    href: "/page/quote",
    highlighted: false,
    fallbackPrice: "Захиалгат",
  },
};

export async function Pricing() {
  setBypassContext();
  const planModules = await Promise.all(PLAN_ORDER.map((p) => getEnabledModules(p)));
  const modulesByPlan = new Map(PLAN_ORDER.map((p, i) => [p, planModules[i]]));

  const plans: PlanCardData[] = PLAN_ORDER.map((plan) => {
    const meta = PLAN_META[plan];

    // Төлбөртэй багцын үнийг нийтэд харуулахгүй — «Захиалгат» + үнийн санал авах.
    // (Бодит үнэ PlanPrice-д хэвээр; нэвтэрсэн тенант өөрийн хуудсанд харна.)
    const price = plan === "FREE" ? "Үнэгүй" : meta.fallbackPrice;
    const period = "";

    const featureList = planFeatureLines(modulesByPlan.get(plan) ?? new Set());

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
          Хэдхэн машинаар үнэгүй эхэлж, бизнесийнхээ хэмжээгээр өс. Бизнес, Энтерпрайз багцад танай хэрэгцээнд тааруулсан үнийн санал өгнө.
        </p>

        <PricingCards plans={plans} />
      </div>
    </Container>
  );
}