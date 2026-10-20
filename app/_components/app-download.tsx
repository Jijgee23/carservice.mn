import { hasStoreLinks } from "@/lib/app-store-links";
import { getAppStoreLinks } from "@/lib/platform-settings";
import { StoreBadges } from "./app-store-badges";
import { Container, Eyebrow } from "./landing-ops-ui";

// Нүүр хуудасны «Апп татах» хэсэг — super admin хадгалсан store холбоостой
// апп л харагдана; аль нь ч холбоосгүй бол хэсэг бүхэлдээ нуугдана.
export async function AppDownload() {
  const links = await getAppStoreLinks();
  const apps = [
    {
      key: "customer",
      title: "Хэрэглэгчийн апп",
      body: "Ойролцоох засварын газар хайх, цаг захиалах, машиныхаа засварын түүх, мэдэгдлээ утаснаасаа.",
      links: links.customer,
    },
    {
      key: "business",
      title: "Засварын газрын апп",
      body: "Ажилтнууд засварын хуудас, цаг захиалга, төлбөр, мэдэгдлээ гар утаснаас удирдана.",
      links: links.business,
    },
  ].filter((a) => hasStoreLinks(a.links));
  if (apps.length === 0) return null;

  return (
    <Container className="pt-24">
      <div id="apps" className="scroll-mt-24">
        <Eyebrow>Мобайл апп</Eyebrow>
        <h2 className="mt-4 text-2xl sm:text-3xl lg:text-[34px] font-semibold tracking-[-0.03em] text-[var(--oc-ink)]">
          Аппаа татаж аваарай
        </h2>
        <div className={`mt-8 grid gap-4 ${apps.length > 1 ? "md:grid-cols-2" : "max-w-xl"}`}>
          {apps.map((a) => (
            <div key={a.key} className="rounded-[14px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6 flex flex-col gap-4">
              <div>
                <div className="text-[17px] font-semibold text-[var(--oc-ink)]">{a.title}</div>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--oc-muted2)]">{a.body}</p>
              </div>
              <StoreBadges links={a.links} appName={`carservice ${a.title.toLowerCase()}`} />
            </div>
          ))}
        </div>
      </div>
    </Container>
  );
}
