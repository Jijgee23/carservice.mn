import Link from "next/link";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Brand } from "@/app/_components/brand";
import { Footer } from "@/app/_components/footer";
import { CONTACT } from "@/lib/contact";

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
  title: "Нууцлалын бодлого",
  description:
    "Carservice вэб болон гар утасны аппликейшн таны хувийн мэдээллийг хэрхэн цуглуулж, ашиглаж, хамгаалдаг талаар.",
};

export const revalidate = 3600;

// App Store / Google Play: бодлогын агуулга өөрчлөгдөх бүрд огноог шинэчилнэ.
const EFFECTIVE_DATE = "2026 оны 9-р сарын 30";

const linkCls =
  "text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors";

function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-8 scroll-mt-20">
      <h2 className="text-lg font-semibold text-[var(--oc-ink)] mb-2">{title}</h2>
      <div className="text-sm text-[var(--oc-muted)] leading-relaxed space-y-2">
        {children}
      </div>
    </section>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <p className="font-medium text-[var(--oc-ink2)] pt-1">{children}</p>;
}

const DATA_ROWS: { type: string; items: string; purpose: string }[] = [
  {
    type: "Холбоо барих мэдээлэл",
    items: "Нэр, утасны дугаар, имэйл (заавал биш), профайл зураг (заавал биш)",
    purpose: "Бүртгэл, нэвтрэлт, баталгаажуулалт, цаг захиалгын холбоо",
  },
  {
    type: "Тээврийн хэрэгсэл",
    items: "Улсын дугаар, арлын дугаар (VIN), марк, загвар, он, өнгө, гүйлт",
    purpose: "Цаг захиалга, үйлчилгээний түүх, сануулга",
  },
  {
    type: "Үйлчилгээний мэдээлэл",
    items:
      "Цаг захиалга, засварын хуудас, оношилгооны тайлан ба зураг, санал хүсэлт",
    purpose: "Үйлчилгээ үзүүлэх, түүх харуулах, дэмжлэг",
  },
  {
    type: "Төлбөрийн мэдээлэл",
    items: "Нэхэмжлэлийн дугаар, дүн, төлөв, огноо",
    purpose: "Цаг захиалгын хураамж, үйлчилгээний төлбөр баталгаажуулах",
  },
  {
    type: "Байршил",
    items: "Ойролцоо байршил — зөвхөн та \"Ойролцоох\" хайлт ашиглах үед",
    purpose: "Танд ойр үйлчилгээний газрыг харуулах",
  },
  {
    type: "Төхөөрөмж ба нэвтрэлт",
    items:
      "Суулгалтын ID, төхөөрөмжийн загвар, үйлдлийн систем, push token, IP хаяг, нэвтэрсэн цаг",
    purpose: "Push мэдэгдэл, нэвтрэлтийн аюулгүй байдал, төхөөрөмж удирдах",
  },
];

const PROCESSORS: { name: string; role: string }[] = [
  {
    name: "Google Firebase Cloud Messaging",
    role: "Push мэдэгдэл хүргэх (push token, мэдэгдлийн агуулга)",
  },
  {
    name: "sendsms.mn / CallPro (messagepro.mn)",
    role: "SMS баталгаажуулах код, сануулга илгээх (утасны дугаар)",
  },
  {
    name: "QPay",
    role: "Төлбөр хүлээн авах (нэхэмжлэл, дүн). Картын мэдээллийг бид харахгүй, хадгалахгүй.",
  },
  {
    name: "МАК-ын тээврийн хэрэгслийн бүртгэлийн систем (HUR)",
    role: "Улсын дугаараар машины мэдээлэл татах (улсын дугаар)",
  },
  {
    name: "Google Maps",
    role: "Газрын зураг, байршил харуулах (IP хаяг, ойролцоо байршил)",
  },
  {
    name: "ebarimt.mn",
    role: "Байгууллага бүртгүүлэхэд регистрийн дугаараар нэр шалгах (зөвхөн байгууллагад)",
  },
];

export default function PrivacyPage() {
  return (
    <div
      className={`${plexSans.variable} ${plexMono.variable} landing-ops min-h-screen flex flex-col`}
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
        <h1 className="text-3xl font-bold">Нууцлалын бодлого</h1>
        <p className="text-[var(--oc-muted3)] text-sm mt-2">
          Хүчин төгөлдөр болсон: {EFFECTIVE_DATE}
        </p>

        <Section title="1. Бидний тухай">
          <p>
            Энэхүү бодлого нь Carservice вэб сайт (carservice.mn) болон iOS,
            Android гар утасны аппликейшнд (цаашид &quot;Үйлчилгээ&quot;)
            хамаарна. Үйлчилгээг {CONTACT.org} ХХК ({CONTACT.developerName},{" "}
            {CONTACT.website}) хөгжүүлж, ажиллуулдаг бөгөөд таны хувийн
            мэдээллийг хариуцагч нь мөн болно.
          </p>
          <p>
            Үйлчилгээ нь хоёр төрлийн хэрэглэгчтэй: машинаа үйлчилгээнд
            бүртгүүлдэг <b>хэрэглэгч</b>, мөн авто үйлчилгээний газрын{" "}
            <b>ажилтан</b>. Энэ бодлого хоёуланд нь хамаарна.
          </p>
        </Section>

        <Section title="2. Бидний цуглуулдаг мэдээлэл">
          <p>
            Бид Үйлчилгээ ажиллуулахад шаардлагатай мэдээллийг л цуглуулна.
            Ихэнхийг нь та өөрөө оруулна; заримыг нь таныг Үйлчилгээ ашиглах
            үед автоматаар бүртгэнэ.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm border-collapse mt-2">
              <thead>
                <tr className="border-b border-[var(--oc-line2)] text-[var(--oc-ink2)]">
                  <th className="py-2 pr-3 font-medium">Төрөл</th>
                  <th className="py-2 pr-3 font-medium">Жишээ</th>
                  <th className="py-2 font-medium">Зорилго</th>
                </tr>
              </thead>
              <tbody>
                {DATA_ROWS.map((r) => (
                  <tr
                    key={r.type}
                    className="border-b border-[var(--oc-line2)] align-top"
                  >
                    <td className="py-2 pr-3 text-[var(--oc-ink2)]">{r.type}</td>
                    <td className="py-2 pr-3">{r.items}</td>
                    <td className="py-2">{r.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Ажилтны хувьд дээрхээс гадна ажлын эрх, салбар, ажлын хуваарь,
            хийсэн ажлын бүртгэл хадгалагдана. Нууц үгийг зөвхөн нэг талын hash
            хэлбэрээр хадгалдаг тул бид харах боломжгүй.
          </p>
          <p>
            Бид таны харилцагчдын жагсаалт, мессеж, эрүүл мэндийн мэдээлэл,
            картын дугаарыг цуглуулахгүй.
          </p>
        </Section>

        <Section title="3. Төхөөрөмжийн зөвшөөрөл">
          <p>
            Аппликейшн дараах зөвшөөрлийг зөвхөн тухайн боломжийг ашиглах үед
            асууна. Та татгалзсан ч бусад хэсэг хэвийн ажиллана. Мөн утасныхаа
            тохиргооноос хүссэн үедээ цуцалж болно.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <b>Байршил</b> — ойролцоох үйлчилгээний газар хайх. Зөвхөн хайлт
              хийх үед ашиглагдана. Арын горимд (background) байршил
              цуглуулахгүй, таны профайлд хадгалахгүй.
            </li>
            <li>
              <b>Камер ба зургийн сан</b> — профайл зураг, оношилгооны зураг,
              санал хүсэлтийн дэлгэцийн зураг хавсаргах. Зөвхөн таны сонгосон
              зургийг илгээнэ.
            </li>
            <li>
              <b>Мэдэгдэл</b> — цаг захиалгын баталгаажуулалт, сануулга,
              засварын явц.
            </li>
          </ul>
        </Section>

        <Section title="4. Мэдээллийг ашиглах зорилго">
          <ul className="list-disc pl-5 space-y-1">
            <li>Бүртгэл үүсгэх, нэвтрүүлэх, утас/имэйлээ баталгаажуулах.</li>
            <li>
              Цаг захиалгыг сонгосон үйлчилгээний газарт дамжуулах,
              баталгаажуулах, төлбөр боловсруулах.
            </li>
            <li>Үйлчилгээний түүх, оношилгооны тайланг танд харуулах.</li>
            <li>SMS болон push мэдэгдэл илгээх (баталгаажуулалт, сануулга).</li>
            <li>
              Аюулгүй байдлыг хангах, залилан болон зүй бус хэрэглээнээс
              сэргийлэх, алдаа засах.
            </li>
            <li>
              Хуулиар хүлээсэн үүргээ биелүүлэх (нягтлан бодох бүртгэл г.м.).
            </li>
          </ul>
          <p>
            Бид таны мэдээллийг зар сурталчилгаанд ашиглахгүй, бусад компанийн
            апп болон вэб дээр таныг <b>мөрдөхгүй (tracking хийхгүй)</b>,
            гуравдагч этгээдэд <b>зарахгүй</b>. Үйлчилгээнд зар сурталчилгааны
            болон аналитикийн гуравдагч SDK байхгүй.
          </p>
        </Section>

        <Section title="5. Мэдээлэл хуваалцах">
          <Sub>Үйлчилгээний газар</Sub>
          <p>
            Та цаг захиалах эсвэл үйлчилгээ авахад таны нэр, утас, машины
            мэдээлэл, захиалгын дэлгэрэнгүй тухайн авто үйлчилгээний газарт
            очно. Тэд энэ мэдээллийг өөрийн харилцагчийн бүртгэлд хадгалж,
            үйлчилгээ үзүүлэхэд ашиглана.
          </p>
          <Sub>Үйлчилгээ үзүүлэгч түншүүд</Sub>
          <p>
            Дараах түншүүд бидний өмнөөс, зөвхөн дурдсан зорилгоор мэдээлэл
            боловсруулна:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            {PROCESSORS.map((p) => (
              <li key={p.name}>
                <span className="text-[var(--oc-ink2)]">{p.name}</span> —{" "}
                {p.role}
              </li>
            ))}
          </ul>
          <Sub>Хууль ёсны шаардлага</Sub>
          <p>
            Монгол Улсын хууль тогтоомжийн дагуу эрх бүхий байгууллагын албан
            ёсны шаардлагаар мэдээлэл өгч болно.
          </p>
        </Section>

        <Section title="6. Хадгалах хугацаа">
          <ul className="list-disc pl-5 space-y-1">
            <li>Бүртгэлийн мэдээлэл — таныг бүртгэлээ устгах хүртэл.</li>
            <li>Нэг удаагийн баталгаажуулах код — хэдхэн минут.</li>
            <li>Уншсан мэдэгдэл — 90 хоног.</li>
            <li>
              Төлбөр, үйлчилгээний баримт — нягтлан бодох бүртгэлийн хуульд
              заасан хугацаанд.
            </li>
            <li>
              Нэвтрэлт, аудитын бүртгэл — аюулгүй байдлын зорилгоор
              хязгаарлагдмал хугацаанд.
            </li>
          </ul>
        </Section>

        <Section title="7. Аюулгүй байдал">
          <p>
            Мэдээллийг HTTPS шифрлэлтээр дамжуулж, хандалтын хяналттай серверт
            хадгална. Байгууллага бүрийн өгөгдөл өгөгдлийн сангийн түвшинд
            тусгаарлагдсан, нууц үг hash хэлбэрээр хадгалагдана. Та нэвтэрсэн
            төхөөрөмжүүдээ харж, хүссэнээсээ гарах боломжтой. Интернэтээр
            дамжуулах ямар ч арга 100% аюулгүй биш тул эрсдэлийг бүрэн
            арилгана гэж баталж чадахгүй.
          </p>
        </Section>

        <Section title="8. Таны эрх ба сонголт">
          <ul className="list-disc pl-5 space-y-1">
            <li>Профайлаасаа мэдээллээ харах, засах.</li>
            <li>
              Push мэдэгдлийг утасны тохиргооноос унтраах, байршил болон
              камерын зөвшөөрлийг цуцлах.
            </li>
            <li>Бүртгэлээ түр идэвхгүй болгох эсвэл бүрмөсөн устгах (доор).</li>
            <li>
              Мэдээллийнхээ хуулбарыг авах, ашиглалтыг хязгаарлах хүсэлтээ{" "}
              <a href={`mailto:${CONTACT.email}`} className={linkCls}>
                {CONTACT.email}
              </a>{" "}
              хаягаар илгээх. Бид 30 хоногийн дотор хариулна.
            </li>
          </ul>
        </Section>

        <Section id="account-deletion" title="9. Бүртгэл устгах">
          <p>Бүртгэлээ хоёр аргаар устгаж болно:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <b>Аппликейшнээс:</b> Профайл → Бүртгэл хаах → Бүртгэл устгах.
            </li>
            <li>
              <b>Апп суулгаагүй бол:</b>{" "}
              <Link href="/account-deletion" className={linkCls}>
                carservice.mn/account-deletion
              </Link>{" "}
              хуудсанд утасны дугаараа баталгаажуулж устгана.
            </li>
          </ul>
          <Sub>Шууд устгагдах мэдээлэл</Sub>
          <p>
            Нэр, утас, имэйл, профайл зураг, нууц үг, &quot;Миний машин&quot;
            жагсаалт, мэдэгдэл, бүртгэлтэй төхөөрөмж, push token.
          </p>
          <Sub>Хадгалагдах мэдээлэл</Sub>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Таны үйлчилгээ авсан газрын өөрийн харилцагчийн бүртгэл, засварын
              түүх, төлбөрийн баримт — хуулийн дагуу, таны бүртгэлтэй
              холбоогүйгээр.
            </li>
            <li>
              Ажилтны хувьд байгууллагын түүхэнд хийсэн ажил нь
              &quot;Устгагдсан ажилтан&quot; нэрээр, аудитын бүртгэлд нэр нь
              хадгалагдана.
            </li>
          </ul>
          <p>
            Устгасан бүртгэлийг сэргээх боломжгүй. Түр идэвхгүй болгох нь
            устгахаас өөр — дахин нэвтэрснээр бүртгэл сэргэнэ.
          </p>
        </Section>

        <Section title="10. Хүүхдийн нууцлал">
          <p>
            Үйлчилгээ нь 16-аас доош насны хүүхдэд зориулагдаагүй бөгөөд бид
            тэднээс санаатайгаар мэдээлэл цуглуулахгүй. Хүүхэд мэдээлэл өгсөн
            нь мэдэгдвэл бидэнтэй холбогдоно уу — бид устгана.
          </p>
        </Section>

        <Section title="11. Cookie">
          <p>
            Вэб сайт зөвхөн нэвтрэлтийг хадгалах, хамгаалахад зайлшгүй
            шаардлагатай cookie ашиглана. Зар сурталчилгааны болон мөрдөх
            cookie ашиглахгүй.
          </p>
        </Section>

        <Section title="12. Бодлогын өөрчлөлт">
          <p>
            Энэхүү бодлогыг шинэчлэх бол энэ хуудасны огноог өөрчилнө. Чухал
            өөрчлөлтийг апп эсвэл SMS-ээр урьдчилан мэдэгдэнэ.
          </p>
        </Section>

        <Section title="13. Холбоо барих">
          <p>Нууцлалтай холбоотой асуулт, хүсэлтээ дараах хаягаар илгээнэ үү:</p>
          <ul className="space-y-1">
            <li>{CONTACT.org} ХХК</li>
            <li>
              Имэйл:{" "}
              <a href={`mailto:${CONTACT.email}`} className={linkCls}>
                {CONTACT.email}
              </a>
            </li>
            <li>Утас: {CONTACT.phones.join(", ")}</li>
            <li>Хаяг: {CONTACT.address}</li>
          </ul>
        </Section>
      </main>

      <Footer />
    </div>
  );
}
