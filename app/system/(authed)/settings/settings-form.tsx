"use client";

import { useActionState, useState } from "react";
import {
  type SettingsActionState,
  updatePlatformSettings,
} from "@/app/_actions/system-settings";
import { Field, FormError } from "@/app/_components/landing-ops-ui";
import type { AppStoreLinks } from "@/lib/app-store-links";
import { CONTACT } from "@/lib/contact";

export function SettingsForm({
  initial,
}: {
  initial: {
    facebookUrl: string | null;
    youtubeUrl: string | null;
    contactPhones: string[];
    appointmentFeeEnabled: boolean;
    appointmentFeeAmount: number;
    appLinks: AppStoreLinks;
  };
}) {
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(
    updatePlatformSettings,
    null,
  );
  const fe = state?.fieldErrors ?? {};
  const [feeEnabled, setFeeEnabled] = useState(initial.appointmentFeeEnabled);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state?.ok && state.message ? (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 text-sm text-emerald-300 light:bg-emerald-100 light:border-emerald-300 light:text-emerald-700">
          {state.message}
        </div>
      ) : null}
      <FormError message={state?.message && !state.ok ? state.message : undefined} />

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <section className="rounded-xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-5 flex flex-col gap-4">
          <div className="text-sm font-medium text-[var(--oc-ink2)]">Холбоо барих, сошиал</div>
          <Field
            label="Холбоо барих утас"
            htmlFor="contactPhones"
            hint={`Таслалаар тусгаарлана (6 хүртэл). Нүүр хуудас, footer, «Холбоо барих», нөхцөл/нууцлалын хуудсанд харагдана. Хоосон бол: ${CONTACT.phones.join(", ")}`}
            error={fe.contactPhones}
          >
            <input
              id="contactPhones"
              name="contactPhones"
              type="text"
              inputMode="tel"
              defaultValue={initial.contactPhones.join(", ")}
              className={`compact-input font-plex-mono ${fe.contactPhones ? "border-red-500/50" : ""}`}
              placeholder={CONTACT.phones.join(", ")}
            />
          </Field>
          <Field
            label="Facebook URL"
            htmlFor="facebookUrl"
            hint="заавал биш — хоосон бол footer-т харагдахгүй"
            error={fe.facebookUrl}
          >
            <input
              id="facebookUrl"
              name="facebookUrl"
              type="url"
              defaultValue={initial.facebookUrl ?? ""}
              className={`compact-input ${fe.facebookUrl ? "border-red-500/50" : ""}`}
              placeholder="https://facebook.com/infosystems"
            />
          </Field>

          <Field
            label="YouTube URL"
            htmlFor="youtubeUrl"
            hint="заавал биш — хоосон бол footer-т харагдахгүй"
            error={fe.youtubeUrl}
          >
            <input
              id="youtubeUrl"
              name="youtubeUrl"
              type="url"
              defaultValue={initial.youtubeUrl ?? ""}
              className={`compact-input ${fe.youtubeUrl ? "border-red-500/50" : ""}`}
              placeholder="https://youtube.com/@infosystems"
            />
          </Field>

          <div className="border-t border-[var(--oc-line)] pt-4 flex flex-col gap-4">
            <div>
              <div className="text-sm font-medium text-[var(--oc-ink2)]">
                Цаг захиалгын хураамж
              </div>
              <div className="text-xs text-[var(--oc-muted3)] mt-0.5">
                Хэрэглэгч онлайн цаг захиалахдаа QPay-ээр төлөх хураамж —
                орлого платформ дээр ирнэ.
              </div>
            </div>

            <label className="flex items-start gap-3 p-3.5 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel2)] cursor-pointer hover:border-[var(--oc-line2)] max-w-md">
              <input
                type="checkbox"
                name="appointmentFeeEnabled"
                checked={feeEnabled}
                onChange={(e) => setFeeEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--oc-accent)]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-[var(--oc-ink2)]">
                  Хураамж авах
                </span>
                <span className="text-xs text-[var(--oc-muted3)]">
                  Идэвхгүй болговол цаг захиалга үнэгүй болно — хэрэглэгчээс
                  төлбөр авахгүй, invoice үүсэхгүй.
                </span>
              </span>
            </label>

            <Field
              label="Дүн (₮)"
              htmlFor="appointmentFeeAmount"
              hint={feeEnabled ? undefined : "Хураамж идэвхгүй үед хэрэглэгдэхгүй"}
              error={fe.appointmentFeeAmount}
            >
              <input
                id="appointmentFeeAmount"
                name="appointmentFeeAmount"
                type="number"
                min="1"
                step="1"
                defaultValue={initial.appointmentFeeAmount}
                className={`compact-input font-plex-mono max-w-[160px] ${
                  fe.appointmentFeeAmount ? "border-red-500/50" : ""
                }`}
              />
            </Field>
          </div>

        </section>

        <section className="rounded-xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-5 flex flex-col gap-4">
          <div>
            <div className="text-sm font-medium text-[var(--oc-ink2)]">Мобайл апп холбоос</div>
            <div className="text-xs text-[var(--oc-muted3)] mt-0.5">
              Хадгалсан холбоостой store-ийн товч л харагдана — нүүр хуудас, footer, хэрэглэгчийн
              (discover, бүртгэл) болон ажилтны цэс. Хоосон үлдээвэл нуугдана.
            </div>
          </div>
          {(
            [
              ["customerAppStoreUrl", "Хэрэглэгчийн апп — App Store", initial.appLinks.customer.appStore, "https://apps.apple.com/mn/app/…/id0000000000"],
              ["customerPlayStoreUrl", "Хэрэглэгчийн апп — Google Play", initial.appLinks.customer.playStore, "https://play.google.com/store/apps/details?id=mn.infosystems.carservice"],
              ["businessAppStoreUrl", "Засварын газрын апп — App Store", initial.appLinks.business.appStore, "https://apps.apple.com/mn/app/…/id0000000000"],
              ["businessPlayStoreUrl", "Засварын газрын апп — Google Play", initial.appLinks.business.playStore, "https://play.google.com/store/apps/details?id=mn.infosystems.carservice_business"],
            ] as const
          ).map(([name, label, value, placeholder]) => (
            <Field key={name} label={label} htmlFor={name} hint="заавал биш" error={fe[name]}>
              <input
                id={name}
                name={name}
                type="url"
                defaultValue={value ?? ""}
                className={`compact-input ${fe[name] ? "border-red-500/50" : ""}`}
                placeholder={placeholder}
              />
            </Field>
          ))}
        </section>

      </div>

      <div className="flex pt-2">
        <button
          type="submit"
          disabled={pending}
          className="bg-[var(--oc-accent)] hover:bg-[var(--oc-accent-hi)] disabled:opacity-60 transition-all px-6 py-2 rounded-lg font-medium text-sm text-[var(--oc-on-accent)]"
        >
          {pending ? "..." : "Хадгалах"}
        </button>
      </div>
    </form>
  );
}
