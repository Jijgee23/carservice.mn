import { ButtonGhost, ButtonPrimary, Container, StatusPill } from "./landing-ops-ui";

type Job = {
  car: string;
  meta: string;
  status: "Дууссан" | "Явцтай" | "Товлосон";
  progress?: { step: string; percent: number };
};

const jobs: Job[] = [
  {
    car: "Toyota Prius 30",
    meta: "1234 УБА · Тосны солилт",
    status: "Дууссан",
    progress: { step: "4/4 шат", percent: 100 },
  },
  {
    car: "Hyundai Sonata",
    meta: "5678 УНМ · Тормосны наклад",
    status: "Явцтай",
    progress: { step: "2/4 шат", percent: 52 },
  },
  { car: "Lexus RX 350", meta: "9012 УВД · Оношилгоо · 14:30", status: "Товлосон" },
];

const statusStyle: Record<Job["status"], string> = {
  Дууссан: "bg-[var(--oc-ok)]/10 text-[var(--oc-ok)]",
  Явцтай: "bg-[var(--oc-accent)]/15 text-[var(--oc-accent)]",
  Товлосон: "bg-white/[0.06] text-[var(--oc-muted)]",
};
const progressColor: Record<string, string> = {
  Дууссан: "bg-[var(--oc-ok)]",
  Явцтай: "bg-[var(--oc-accent)]",
};

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-oc-grid">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_520px_at_20%_0%,rgba(34,211,238,0.12),transparent_70%)]" />
      <Container className="relative grid items-center gap-12 lg:gap-[72px] py-20 lg:py-24 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <StatusPill>100+ сервис төв carservice дээр ажиллаж байна</StatusPill>
          <h1 className="mt-7 text-4xl sm:text-5xl lg:text-[60px] font-semibold leading-[1.08] lg:leading-[1.04] tracking-[-0.03em] text-[var(--oc-ink)] text-balance">
            Автозасвар, автосервисийн ажлыг <span className="text-[var(--oc-accent)]">нэг урсгал</span> болгоно.
          </h1>
          <p className="mt-6 max-w-[520px] text-lg leading-relaxed text-[var(--oc-muted)] text-pretty">
            carservice нь автозасвар, автосервисийн газруудад засварын хуудас, ажлын хуваарь, нөөц, тайланг;
            жолоочид ойролцоох автозасварт цаг захиалах, засварын түүхээ харахыг нэг платформ дээр нэгтгэдэг.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-3">
            <ButtonPrimary href="/page/signup">Үнэгүй эхлүүлэх</ButtonPrimary>
            <ButtonGhost href="#hows">Хэрхэн ажилладаг</ButtonGhost>
          </div>
          <div className="mt-7 text-[13px] text-[var(--oc-muted3)]">
            14 хоног үнэгүй · карт шаардахгүй · 1 хоногт нэвтрүүлнэ
          </div>
        </div>

        <div className="overflow-hidden rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)]">
          <div className="flex items-center justify-between border-b border-[var(--oc-line)] px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-[var(--oc-accent)]" />
              <span className="text-[14px] font-semibold text-[var(--oc-ink2)]">Ажлын урсгал</span>
            </div>
            <span className="font-plex-mono text-[12px] text-[var(--oc-muted3)]">
              live
            </span>
          </div>
          <div className="flex flex-col gap-3 p-5">
            {jobs.map((job) => (
              <div
                key={job.car}
                className="rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-[18px] py-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[15px] font-semibold text-[var(--oc-ink2)]">{job.car}</div>
                    <div className="mt-1 font-plex-mono text-[13px] text-[var(--oc-muted2)]">
                      {job.meta}
                    </div>
                  </div>
                  <span
                    className={`rounded px-2.5 py-1 font-plex-mono text-[12px] ${statusStyle[job.status]}`}
                  >
                    {job.status}
                  </span>
                </div>
                {job.progress ? (
                  <>
                    <div className="mt-4 flex items-center justify-between font-plex-mono text-[12px] text-[var(--oc-muted3)]">
                      <span>Ажлын явц</span>
                      <span>{job.progress.step}</span>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className={`h-full ${progressColor[job.status]}`}
                        style={{ width: `${job.progress.percent}%` }}
                      />
                    </div>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
