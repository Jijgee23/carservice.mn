import { PageHeader } from "@/app/_components/page-header";
import { getPlatformSettings } from "@/lib/platform-settings";
import { getCreditSettings } from "@/lib/credit-score-server";
import { CreditSettingsForm } from "./credit-settings-form";
import { SettingsForm } from "./settings-form";
import { TrialSettingsForm } from "./trial-settings-form";
import { getTrialSettingsForAdmin } from "@/lib/plan-trials-server";

export const metadata = {
  title: "Тохиргоо",
};

export const dynamic = "force-dynamic";

export default async function SystemSettingsPage() {
  const [settings, credit, trial] = await Promise.all([
    getPlatformSettings(),
    getCreditSettings(),
    getTrialSettingsForAdmin(),
  ]);

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
      <div className="max-w-2xl mt-6">
        <TrialSettingsForm initial={trial} />
      </div>
      <div className="max-w-2xl mt-6">
        <CreditSettingsForm initial={credit} />
      </div>
    </div>
  );
}
