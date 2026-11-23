import { Container, Eyebrow } from "./landing-ops-ui";

const STEPS = [
  {
    kicker: "1 / Бүртгүүлэх",
    title: "Салбараа үүсгэж тохируулна",
    desc: "Имэйлээрээ 2 минутын дотор салбараа үүсгэж тохируулна.",
    active: true,
  },
  {
    kicker: "2 / Багаа урих",
    title: "Ажилтнуудаа урина",
    desc: "Менежер, мастер, кассчдаа үүрэгтэйгээр урина — хандалт хязгаарлагдсан.",
    active: false,
  },
  {
    kicker: "3 / Ажиллагаа",
    title: "Удирдлагаа эхлүүлэх",
    desc: "Засварын хуудас үүсгэж, машины түүх хөтлөж, тайлангаа шууд харна.",
    active: false,
  },
];

export function HowItWorks() {
  return (
    <Container className="pt-24">
      <div id="hows" className="scroll-mt-24">
        <Eyebrow>Хэрхэн ажилладаг</Eyebrow>
        <h2 className="mb-10 mt-4 text-3xl sm:text-4xl lg:text-[40px] font-semibold tracking-[-0.03em] text-[var(--oc-ink)]">
          3 алхамд үйлчилгээгээ онлайн болго
        </h2>
        <div className="grid gap-6 md:grid-cols-3">
          {STEPS.map((step) => (
            <div
              key={step.kicker}
              className={`border-t-2 pt-[22px] ${
                step.active ? "border-[var(--oc-accent)]" : "border-[var(--oc-line)]"
              }`}
            >
              <div className="font-plex-mono text-[13px] text-[var(--oc-muted3)]">
                {step.kicker}
              </div>
              <div className="mt-3 text-[19px] font-semibold text-[var(--oc-ink2)]">{step.title}</div>
              <div className="mt-2.5 text-[14.5px] leading-relaxed text-[var(--oc-muted2)]">
                {step.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Container>
  );
}
