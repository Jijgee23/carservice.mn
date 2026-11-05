import { ButtonGhost, ButtonPrimary, Container } from "./landing-ops-ui";

export function CtaBanner() {
  return (
    <Container className="pt-24">
      <div className="relative overflow-hidden rounded-xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-8 sm:p-14">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_300px_at_85%_20%,rgba(231,76,60,0.08),transparent_70%)]" />
        <div className="relative flex flex-wrap items-center justify-between gap-10 sm:gap-12">
          <div>
            <h2 className="text-2xl sm:text-3xl lg:text-[36px] font-semibold tracking-[-0.03em] text-[var(--oc-ink)] text-balance">
              Сервисээ дараагийн түвшинд гарга
            </h2>
            <p className="mt-3.5 max-w-[560px] text-[16px] leading-relaxed text-[var(--oc-muted)]">
              Үндсэн багцаар үнэгүй эхлээрэй. Карт хэрэггүй, өсөхөөрөө багцаа ахиулна.
            </p>
          </div>
          <div className="flex flex-wrap shrink-0 gap-3">
            <ButtonPrimary href="/page/signup">Үнэгүй эхлүүлэх</ButtonPrimary>
            <ButtonGhost href="/page/guide">Гарын авлага үзэх</ButtonGhost>
            <ButtonGhost href="mailto:contact@infosystems.mn">Борлуулалттай ярих</ButtonGhost>
          </div>
        </div>
      </div>
    </Container>
  );
}
