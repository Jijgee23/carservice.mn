import { PageHeader } from "@/app/_components/page-header";
import { getPlatformSettings } from "@/lib/platform-settings";
import { SettingsForm } from "./settings-form";

export const metadata = {
  title: "Тохиргоо",
};

export const dynamic = "force-dynamic";

export default async function SystemSettingsPage() {
  const settings = await getPlatformSettings();

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <PageHeader
        title="Тохиргоо"
        description="Платформын сошиал холбоос, цаг захиалгын хураамж, мобайл аппын store холбоос."
      />
      {/* 2 багана: зүүн — сошиал + хураамж, баруун — мобайл апп холбоос (нэг форм, нэг Хадгалах). */}
      <div className="max-w-6xl">
        <SettingsForm initial={settings} />
      </div>
    </div>
  );
}
