"use client";

import { useState } from "react";
import { CONTACT } from "@/lib/contact";
import { Container, Eyebrow } from "./landing-ops-ui";

type FaqItem = { q: string; a: string };

// Харилцагчийн (цаг захиалагч) асуултууд — хариулт бүр одоогийн ажиллагаатай
// таарна (account-auth, appointment-commands, appointment-payments, feedback).
// Ажиллагаа өөрчлөгдвөл энд ч шинэчилнэ.
function customerItems(phones: readonly string[]): FaqItem[] {
  return [
  {
    q: "Хэрхэн бүртгүүлж, нэвтрэх вэ?",
    a: "Утасны дугаараа оруулаад SMS-ээр ирсэн 6 оронтой кодоор нэвтэрнэ. Анх нэвтрэхэд бүртгэл автоматаар үүсдэг тул тусдаа бүртгүүлэх шаардлагагүй. Хүсвэл «Нууц үг» хэсэгт нууц үг тохируулаад дараа нь утас, нууц үгээрээ нэвтэрч болно.",
  },
  {
    q: "Нууц үгээ мартсан бол яах вэ?",
    a: "Нэвтрэх хуудаснаас SMS кодоор нэвтэрнэ. Дараа нь «Нууц үг» хэсэгт SMS кодоор баталгаажуулж шинэ нууц үгээ тохируулна.",
  },
  {
    q: "Захиалга яаж баталгаажих вэ?",
    a: "Цаг захиалсны дараа захиалга «Хүлээгдэж буй» төлөвтэй байна. Захиалгын хураамжтай бол эхлээд QPay-ээр төлнө. Засварын газрын ажилтан цагийг шалгаж баталгаажуулмагц танд мэдэгдэл ирнэ. Товлосон цаг хүртэл баталгаажаагүй захиалга автоматаар цуцлагдана. Баталгаажсан захиалгын сануулгыг цагаас өмнө илгээнэ.",
  },
  {
    q: "Захиалгаа цуцлах эсвэл цагаа өөрчлөх боломжтой юу?",
    a: "Тийм. «Миний захиалгууд» хэсгээс хүлээгдэж буй болон баталгаажсан захиалгаа цуцлах, өөр цаг руу шилжүүлэх боломжтой. Засварын газар таны машинд засварын хуудас нээсэн бол цуцлах боломжгүй. Төлсөн захиалгын хураамжийг шалгаад буцаан олгоно.",
  },
  {
    q: "Захиалгын төлбөрөө хэрхэн төлөх вэ?",
    a: "Онлайн захиалгын хураамжийг (хэрэв байгаа бол) захиалах үедээ QPay-ээр төлнө. Засвар, үйлчилгээний төлбөрийг засварын газарт өөрт нь бэлэн, карт, дансаар эсвэл QPay-ээр төлнө. Төлбөрийн төлөвөө «Үйлчилгээний түүх» хэсгээс харж болно.",
  },
  {
    q: "Машин, засварын түүхээ хаанаас харах вэ?",
    a: "«Миний машинууд» хэсэгт машинаа бүртгэж, «Үйлчилгээний түүх», «Оношилгооны түүх» хэсгээс тухайн машинд хийгдсэн засвар, оношилгооны тайлангаа харна.",
  },
  {
    q: "Санал, сэтгэгдэл, гомдлоо хэрхэн мэдээлэх вэ?",
    a: `Нэвтэрсний дараа цэсний «Санал хүсэлт» товчоор алдаа, санал хүсэлтээ илгээнэ — хариуг мэдэгдлээр авна. Мөн ${CONTACT.email} хаяг эсвэл ${phones.join(", ")} утсаар холбогдож болно.`,
  },
  {
    q: "Бүртгэлээ устгах боломжтой юу?",
    a: "Тийм. «Бүртгэл устгах» хуудаснаас SMS кодоор баталгаажуулж бүртгэлээ устгана. Хадгалсан машин, төхөөрөмж, мэдэгдлүүд хамт устна.",
  },
  ];
}

// Засварын газарт (бизнес) зориулсан асуултууд.
const BUSINESS_ITEMS: FaqItem[] = [
  {
    q: "Хэдэн салбартай байж болох вэ?",
    a: "Эхлэл багц 1 салбар, Бизнес багц 5 салбар хүртэл. Энтерпрайз багцанд салбарын тоо хязгааргүй.",
  },
  {
    q: "Өгөгдлийн нууцлал хэр найдвартай вэ?",
    a: "Сервер дээрх өгөгдөл шифрлэгдсэн, өдөр тутмын backup автоматаар хийгдэнэ. Салбар бүрийн өгөгдөл бие даан тусгаарлагдсан (multi-tenant).",
  },
  {
    q: "Гар утсаар ашиглах боломжтой юу?",
    a: "carservice нь mobile-first зарчмаар хийгдсэн. iOS, Android-ийн ямар ч хөтчөөс асуудалгүй ажиллана.",
  },
  {
    q: "Хуучин Excel/1C-н өгөгдлөө шилжүүлж болох уу?",
    a: "Тийм. CSV, Excel импорт боломжтой. Том багуудад манай баг тусгайлсан шилжилт хийж өгнө.",
  },
  {
    q: "Дэмжлэг хэрхэн авах вэ?",
    a: "Чат, имэйл, утсаар Mongolia дотроос дэмжлэг үзүүлдэг. Бизнес ба Энтерпрайз багцанд тэргүүн ээлжид хариулна.",
  },
  {
    q: "Гэрээт интеграц хийж болох уу?",
    a: "Манай REST API ба webhook системээр касс, банк, нягтлан бодох системтэй холбогдоно.",
  },
];

const TABS = [
  { key: "customer", label: "Харилцагч" },
  { key: "business", label: "Засварын газар" },
] as const;

/** `phones` — super admin-ийн тохируулсан холбоо барих утаснууд (server-ээс). */
export function Faq({ phones }: { phones: readonly string[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("customer");
  const items = tab === "customer" ? customerItems(phones) : BUSINESS_ITEMS;

  return (
    <Container className="pt-24">
      <div id="faq" className="scroll-mt-24 grid gap-10 lg:gap-14 lg:grid-cols-[340px_1fr]">
        <div>
          <Eyebrow>Асуулт хариулт</Eyebrow>
          <h2 className="mt-4 text-2xl sm:text-3xl lg:text-[34px] font-semibold tracking-[-0.03em] text-[var(--oc-ink)]">
            Түгээмэл асуултууд
          </h2>
          <p className="mt-4 text-[14.5px] leading-relaxed text-[var(--oc-muted2)]">
            Хариулт олдсонгүй юу?{" "}
            <a href={`mailto:${CONTACT.email}`} className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]">
              {CONTACT.email}
            </a>
          </p>
          <div role="tablist" aria-label="Асуултын төрөл" className="mt-6 inline-flex rounded-lg border border-[var(--oc-line)] p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`px-3.5 py-1.5 text-sm rounded-md transition-colors ${
                  tab === t.key
                    ? "bg-[var(--oc-accent)] text-[var(--oc-on-accent)] font-medium"
                    : "text-[var(--oc-muted2)] hover:text-[var(--oc-ink2)]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col" role="tabpanel">
          {/* Асуулт бүр анхнаасаа хаалттай, дарахад нээгдэнэ. Native <details> —
              гар/screen reader-т ажиллана, JS шаардахгүй, хариулт DOM-д байх тул
              хайлтын системд индекслэгдэнэ. */}
          {items.map((it, i) => (
            <details
              key={`${tab}:${it.q}`}
              className={`group border-t border-[var(--oc-line)] ${i === items.length - 1 ? "border-b" : ""}`}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-[20px] text-[16.5px] font-semibold text-[var(--oc-ink2)] hover:text-[var(--oc-accent)] transition-colors [&::-webkit-details-marker]:hidden">
                <span>{it.q}</span>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="shrink-0 text-[var(--oc-muted3)] transition-transform duration-200 group-open:rotate-180"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <div className="pb-[22px] -mt-1 max-w-[700px] text-[14.5px] leading-relaxed text-[var(--oc-muted2)]">
                {it.a}
              </div>
            </details>
          ))}
        </div>
      </div>
    </Container>
  );
}
