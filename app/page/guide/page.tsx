import Link from "next/link";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Brand } from "@/app/_components/brand";
import { Footer } from "@/app/_components/footer";
import { CONTACT } from "@/lib/contact";

// Privacy/terms хуудастай ижил "Ops Console" shell — `.landing-ops` дор
// `--oc-*` token-ууд dark/light хоёуланд зөв харагдана.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata = {
  title: "Гарын авлага",
};

export const revalidate = 3600;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-7">
      <h2 className="text-lg font-semibold text-[var(--oc-ink)] mb-2">{title}</h2>
      <div className="text-sm text-[var(--oc-muted)] leading-relaxed space-y-2">
        {children}
      </div>
    </section>
  );
}

export default function GuidePage() {
  return (
    <div
      className={`${plexSans.variable} ${plexMono.variable} landing-ops min-h-screen flex flex-col bg-[var(--oc-carbon)] text-[var(--oc-ink)]`}
    >
      <header className="border-b border-[var(--oc-line2)]">
        <div className="mx-auto max-w-5xl px-4 h-16 flex items-center justify-between">
          <Link href="/">
            <Brand />
          </Link>
          <Link
            href="/"
            className="text-sm text-[var(--oc-muted2)] hover:text-[var(--oc-accent-hi)] transition-colors"
          >
            ← Нүүр
          </Link>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold">Гарын авлага</h1>
        <p className="text-[var(--oc-muted3)] text-sm mt-2">
          carservice.mn платформыг хэрхэн ашиглах талаарх заавар
        </p>

        <Section title="Платформын тухай">
          <p>
            carservice.mn нь авто засвар, үйлчилгээний байгууллага болон
            тэдгээрийн үйлчлүүлэгчдийг холбосон онлайн цаг захиалгын платформ
            юм. Доор харилцагч болон засварын газрын талд зориулсан үндсэн
            боломжуудыг товч танилцуулав.
          </p>
        </Section>

        <Section title="Тээврийн хэрэгслийн эзэд, харилцагчдад зориулсан">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <span className="text-[var(--oc-ink2)] font-medium">Нэвтрэх:</span> утасны
              дугаараа оруулж, ирсэн SMS кодоор баталгаажуулж нэвтэрнэ (нууц
              үг шаардлагагүй).
            </li>
            <li>
              <span className="text-[var(--oc-ink2)] font-medium">Автосервис хайх:</span>{" "}
              байршил, ажиллах цагаар нь автосервисүүдийг харьцуулж сонгоно.
            </li>
            <li>
              <span className="text-[var(--oc-ink2)] font-medium">Цаг захиалах:</span> сонгосон
              автосервисээс онлайнаар цаг товлоно.
            </li>
            <li>
              <span className="text-[var(--oc-ink2)] font-medium">Миний захиалгууд:</span> захиалсан
              цагаа хянах, түүний төлөвийг шалгах.
            </li>
            <li>
              <span className="text-[var(--oc-ink2)] font-medium">Миний машинууд:</span>{" "}
              машинаа бүртгэж, дараагийн захиалгад хурдан ашиглах.
            </li>
            <li>
              <span className="text-[var(--oc-ink2)] font-medium">Үйлчилгээний түүх:</span>{" "}
              өмнөх засвар, сольсон сэлбэгийн түүхээ харах.
            </li>
            <li>
              <span className="text-[var(--oc-ink2)] font-medium">Мэдэгдэл:</span> захиалгын
              статус, сануулгыг мэдэгдлээр хүлээн авах.
            </li>
          </ul>
        </Section>

        <Section title="Засварын газар, ажилтнуудад зориулсан">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <span className="text-[var(--oc-ink2)] font-medium">Бүртгүүлэх:</span> 14 хоног
              үнэгүй туршилтаар эхлэх боломжтой, карт шаардлагагүй.
            </li>
            <li>
              <span className="text-[var(--oc-ink2)] font-medium">Багаа урих:</span> менежер,
              мастер, кассч зэрэг ажилтнуудыг үүрэгтэйгээр урьж, хандалтыг
              хязгаарлах.
            </li>
            <li>
              <span className="text-[var(--oc-ink2)] font-medium">Засварын хуудас удирдах:</span> бүх
              засварын хуудас, дараа төлбөрт засварын хуудсыг нэг дороос харах, удирдах.
            </li>
            <li>
              <span className="text-[var(--oc-ink2)] font-medium">Цаг захиалга удирдах:</span>{" "}
              онлайнаар ирсэн захиалгуудыг баталгаажуулах, хуваарилах.
            </li>
            <li>
              <span className="text-[var(--oc-ink2)] font-medium">
                Үйлчлүүлэгч ба машин бүртгэл:
              </span>{" "}
              үйлчлүүлэгчид, тэдний машин, түүхийг нэг дороос хөтлөх.
            </li>
            <li>
              <span className="text-[var(--oc-ink2)] font-medium">Үйлчилгээ тохируулах:</span>{" "}
              ажил, оношилгоо, сэлбэг/бараа, ангиллаар үнэ, боломжит
              үйлчилгээгээ тохируулах.
            </li>
            <li>
              <span className="text-[var(--oc-ink2)] font-medium">Нөөц ба сэлбэг:</span> барааны
              үлдэгдэлд хяналт тавих.
            </li>
            <li>
              <span className="text-[var(--oc-ink2)] font-medium">Тайлан:</span> орлого,
              ачаалал, гүйцэтгэлийн бодит цагийн тайлан харах.
            </li>
            <li>
              <span className="text-[var(--oc-ink2)] font-medium">Тохиргоо:</span> байгууллагын
              мэдээлэл, салбарууд, QPay холболт, багц (subscription) удирдах.
            </li>
          </ul>
        </Section>

        <Section title="Асуулт байвал">
          <p>
            Түгээмэл асуултын хариултыг{" "}
            <Link
              href="/#faq"
              className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
            >
              нүүр хуудасны Асуулт хариулт
            </Link>{" "}
            хэсгээс үзнэ үү. Нэмэлт тусламж хэрэгтэй бол бидэнтэй{" "}
            <a
              href={`mailto:${CONTACT.email}`}
              className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
            >
              {CONTACT.email}
            </a>{" "}
            хаягаар эсвэл{" "}
            <Link
              href="/contact"
              className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
            >
              Холбоо барих
            </Link>{" "}
            хуудаснаас холбогдоорой.
          </p>
        </Section>
      </main>

      <Footer />
    </div>
  );
}
