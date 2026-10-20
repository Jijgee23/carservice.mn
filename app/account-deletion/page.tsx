import Link from "next/link";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Brand } from "@/app/_components/brand";
import { Footer } from "@/app/_components/footer";
import { DeletionForm } from "./deletion-form";

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
  title: "Бүртгэл устгах · CarCare",
  description: "CarCare бүртгэлээ аппгүйгээр устгах",
};

export default function AccountDeletionPage() {
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
        <h1 className="text-3xl font-bold">Бүртгэл устгах</h1>

        <div className="mt-6 text-sm text-[var(--oc-muted)] leading-relaxed space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--oc-ink)] mb-2">
              Юу устгагдана:
            </h2>
            <p>
              Нэр, утас, имэйл, нууц үг, бүртгэлтэй машин, мэдэгдэл, төхөөрөмжийн
              бүртгэл шууд устгагдана.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-[var(--oc-ink)] mb-2">
              Юу хадгалагдана:
            </h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Үйлчилгээ авсан байгууллагын өөрийн харилцагчийн бүртгэл (нэр,
                утас) болон үйлчилгээний түүх, төлбөрийн бүртгэл хуулийн дагуу
                хадгалагдана — таны бүртгэлтэй холбоогүйгээр.
              </li>
              <li>
                Байгууллагын түүхэнд таны хийсэн ажил &quot;Устгагдсан
                ажилтан&quot; нэрээр, аудитын бүртгэлд нэр тань хадгалагдана.
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-[var(--oc-ink)] mb-2">
              Аппаас:
            </h2>
            <p>
              Аппын Профайл → Бүртгэл хаах хэсгээс мөн устгах, эсвэл түр
              Идэвхгүй болгох боломжтой.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-[var(--oc-ink)] mb-2">
              Анхааруулга:
            </h2>
            <p>Устгалтыг буцаах боломжгүй.</p>
          </div>
        </div>

        <div className="mt-8">
          <DeletionForm />
        </div>
      </main>

      <Footer />
    </div>
  );
}
