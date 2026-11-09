"use client";

import dynamic from "next/dynamic";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  type BranchActionState,
  createBranchAction,
  updateBranchAction,
} from "@/app/_actions/branches";
import { Field, FormError } from "@/app/_components/auth-shell";
import { Btn, BtnLink } from "@/app/_components/landing-ops-ui";
import { Select } from "@/app/_components/select";
import { useToast } from "@/app/_components/toast";
import { DEFAULT_OPEN_DAYS, WEEK_DAYS, type Weekday } from "@/lib/branches";
import {
  type AddressData,
  type AddressValue,
  AddressSelect,
  resolveAddressFromGeocode,
} from "./address-select";
import { ScheduleImpactPreview } from "./_components/schedule-impact-preview";

// Ажиллах цагийн сонголт — 30 минутын алхамтай, 24 цагийн формат (00:00–23:30).
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const v = `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"}`;
  return { value: v, label: v };
});

// Leaflet/Google Maps нь window-д шууд хандах учир SSR хийгдэхгүйгээр lazy load
const LocationPicker = dynamic(
  () => import("./location-picker").then((m) => m.LocationPicker),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 w-full rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] flex items-center justify-center text-sm text-[var(--oc-muted3)]">
        Газрын зураг ачаалж байна...
      </div>
    ),
  },
);

export const BRANCH_FORM_ID = "branch-form";

type Initial = {
  id?: string;
  name: string;
  phone: string | null;
  city: string | null;
  district: string | null;
  khoroo: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  openTime: string | null;
  closeTime: string | null;
  slotMinutes?: number | null;
  slotCapacity?: number | null;
  openDays: Weekday[];
  daySchedules?: Record<Weekday, { isOpen: boolean; openTime: string | null; closeTime: string | null }>;
  isPrimary: boolean;
  tagIds?: string[];
};

export type BranchTagOption = { id: string; name: string };

type DaySchedule = { isOpen: boolean; openTime: string; closeTime: string };

function SectionPanel({
  index,
  total,
  title,
  children,
}: {
  index: number;
  total: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-semibold text-[var(--oc-ink)]">{title}</h2>
        <span className="font-plex-mono text-[11px] text-[var(--oc-muted3)]">
          {String(index).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </div>
      {children}
    </section>
  );
}

export function BranchForm({
  initial,
  addressData,
  mapApiKey,
  mapId,
  tagOptions = [],
  hideBranches = false,
}: {
  initial?: Initial;
  addressData: AddressData;
  mapApiKey: string;
  mapId: string;
  tagOptions?: BranchTagOption[];
  /** Энгийн багц (ганц салбар): салбарын нэр, «үндсэн салбар» талбарыг нууна. */
  hideBranches?: boolean;
}) {
  const isEdit = Boolean(initial?.id);
  const action = isEdit
    ? updateBranchAction.bind(null, initial!.id!)
    : createBranchAction;

  const [state, formAction, pending] = useActionState<
    BranchActionState,
    FormData
  >(action, null);

  const toast = useToast();
  // Хуваарь хадгалахад blocked (erased impact) эсвэл бусад алдаа гарвал
  // toast-аар тодруулна — `FormError`-ийн статик текст анзаарагдахгүй өнгөрч
  // болзошгүй тул (харах: schedule-manager-ийн адил зарчим одоохоор энд
  // байгаагүй). `needsConfirm` үед inline ScheduleImpactPreview + чекбокс аль
  // хэдийн харагдаж байгаа тул давхар toast үзүүлэхгүй.
  const handledState = useRef<BranchActionState>(null);
  useEffect(() => {
    if (!state || state === handledState.current) return;
    handledState.current = state;
    if (!state.ok && !state.needsConfirm) {
      toast.error(state.message ?? "Хуваарь хадгалахад алдаа гарлаа.");
    }
  }, [state, toast]);

  const fe = state?.fieldErrors ?? {};
  const initialDays = initial?.openDays?.length
    ? initial.openDays
    : DEFAULT_OPEN_DAYS;
  const [daySchedules, setDaySchedules] = useState<Record<Weekday, DaySchedule>>(
    () =>
      Object.fromEntries(
        WEEK_DAYS.map((d) => {
          const saved = initial?.daySchedules?.[d.value];
          return [
            d.value,
            {
              isOpen: saved?.isOpen ?? initialDays.includes(d.value),
              openTime: saved?.openTime ?? initial?.openTime ?? "",
              closeTime: saved?.closeTime ?? initial?.closeTime ?? "",
            },
          ];
        }),
      ) as Record<Weekday, DaySchedule>,
  );
  const [lat, setLat] = useState<number | null>(initial?.latitude ?? null);
  const [lng, setLng] = useState<number | null>(initial?.longitude ?? null);
  const [dirty, setDirty] = useState(false);

  // Controlled — action амжилтгүй болсон үед утгууд цэвэрлэгдэхгүй
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [addr, setAddr] = useState<AddressValue>({
    // Шинэ салбарт Улаанбаатар анхдагч; засварлахад хадгалсан утга.
    city: initial?.city ?? (isEdit ? "" : "Улаанбаатар"),
    district: initial?.district ?? "",
    khoroo: initial?.khoroo ?? "",
  });
  const [openTime, setOpenTime] = useState(initial?.openTime ?? "");
  const [closeTime, setCloseTime] = useState(initial?.closeTime ?? "");
  const [slotMinutes, setSlotMinutes] = useState(
    initial?.slotMinutes != null ? String(initial.slotMinutes) : "",
  );
  const [slotCapacity, setSlotCapacity] = useState(
    initial?.slotCapacity != null ? String(initial.slotCapacity) : "",
  );
  const [isPrimary, setIsPrimary] = useState(initial?.isPrimary ?? false);
  const [tagIds, setTagIds] = useState<string[]>(initial?.tagIds ?? []);
  function toggleTag(id: string) {
    setDirty(true);
    setTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  }
  // S13 Phase 4: clipped (non-destructive) schedule impact requires an
  // explicit confirm before resubmitting — same confirmed=true convention as
  // app/_actions/orders.ts's postpone/reschedule flows. Erased impact has no
  // checkbox at all: it is always a hard block.
  const [impactConfirmed, setImpactConfirmed] = useState(false);

  function onMapPick(coords: { lat: number; lng: number } | null) {
    setDirty(true);
    if (!coords) {
      setLat(null);
      setLng(null);
      return;
    }
    // 6 оронгийн нарийвчлал ~10см — илүү бичих нь утгагүй
    setLat(Number(coords.lat.toFixed(6)));
    setLng(Number(coords.lng.toFixed(6)));
  }

  function onLatChange(v: string) {
    const t = v.trim().replace(",", ".");
    if (!t) return setLat(null);
    const n = Number.parseFloat(t);
    setLat(Number.isFinite(n) ? n : null);
  }
  function onLngChange(v: string) {
    const t = v.trim().replace(",", ".");
    if (!t) return setLng(null);
    const n = Number.parseFloat(t);
    setLng(Number.isFinite(n) ? n : null);
  }

  function updateDay(value: Weekday, patch: Partial<DaySchedule>) {
    setDirty(true);
    setDaySchedules((prev) => ({ ...prev, [value]: { ...prev[value], ...patch } }));
  }

  return (
    <form
      id={BRANCH_FORM_ID}
      action={formAction}
      onChange={() => setDirty(true)}
      className="flex flex-col gap-5"
      noValidate
    >
      <FormError message={state?.message} />

      {state?.impact ? (
        <div className="space-y-2">
          <ScheduleImpactPreview impact={state.impact} />
          {state.needsConfirm ? (
            <label className="flex items-center gap-2 text-sm text-[var(--oc-ink2)]">
              <input
                type="checkbox"
                checked={impactConfirmed}
                onChange={(e) => setImpactConfirmed(e.target.checked)}
                className="accent-[var(--oc-accent)]"
              />
              Дээрх богиносгол(ууд)-ыг хүлээн зөвшөөрч үргэлжлүүлэх
            </label>
          ) : null}
        </div>
      ) : null}
      <input type="hidden" name="confirmed" value={impactConfirmed ? "true" : "false"} />

      <SectionPanel index={1} total={3} title="Үндсэн мэдээлэл">
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Энгийн багц (ганц салбар): нэрийг харуулахгүй ч сервер шаарддаг тул hidden-ээр илгээнэ. */}
          {hideBranches ? (
            <input type="hidden" name="name" value={name} />
          ) : (
            <Field label="Салбарын нэр" htmlFor="name" error={fe.name}>
              <input
                id="name"
                name="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`auth-input ${fe.name ? "border-red-500/50" : ""}`}
                placeholder="Жишээ: Зүүн салбар"
              />
            </Field>
          )}

          <Field label="Утас" htmlFor="phone" error={fe.phone}>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="numeric"
              maxLength={8}
              pattern="[0-9]{8}"
              value={phone ?? ""}
              onChange={(e) => setPhone(e.target.value.replace(/\D+/g, ""))}
              className="auth-input"
              placeholder="99000000"
            />
          </Field>
        </div>

        {/* Энгийн багц (ганц салбар): «үндсэн салбар» сонголтыг нууж, одоогийн утгыг хадгална. */}
        {hideBranches ? (
          isPrimary ? <input type="hidden" name="isPrimary" value="on" /> : null
        ) : (
          <label className="mt-4 flex items-start gap-3 p-3.5 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel2)] cursor-pointer hover:border-[var(--oc-line2)]">
            <input
              type="checkbox"
              name="isPrimary"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              className="mt-0.5 accent-[var(--oc-accent)]"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-[var(--oc-ink2)]">
                Үндсэн салбар
              </div>
              <div className="text-xs text-[var(--oc-muted3)] mt-0.5">
                Засварын хуудас анхдагчаар энэ салбарт хуваарилагдана.
              </div>
            </div>
          </label>
        )}

        {tagOptions.length > 0 ? (
          <div className="mt-4">
            <label className="text-sm font-medium text-[var(--oc-ink2)] mb-2 block">
              Бизнесийн төрлүүд{isEdit ? "" : " *"}
            </label>
            <div className="flex flex-wrap gap-2">
              {tagOptions.map((tag) => {
                const checked = tagIds.includes(tag.id);
                return (
                  <label
                    key={tag.id}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm cursor-pointer transition-colors ${
                      checked
                        ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/10 text-[var(--oc-accent-hi)]"
                        : "border-[var(--oc-line)] text-[var(--oc-muted2)] hover:border-[var(--oc-line2)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="tagIds"
                      value={tag.id}
                      checked={checked}
                      onChange={() => toggleTag(tag.id)}
                      className="sr-only"
                    />
                    {tag.name}
                  </label>
                );
              })}
            </div>
            {fe.tagIds ? (
              <p className="text-xs text-red-400 light:text-red-600 mt-1.5">{fe.tagIds}</p>
            ) : null}
          </div>
        ) : null}
      </SectionPanel>

      <SectionPanel index={2} total={3} title="Хаяг ба байршил">
        <div className="relative z-30 grid gap-4 sm:grid-cols-2">
          <AddressSelect data={addressData} value={addr} onChange={(v) => { setDirty(true); setAddr(v); }} />
          <Field
            label="Дэлгэрэнгүй хаяг"
            htmlFor="address"
            hint="Гудамж, тоот"
            error={fe.address}
          >
            <input
              id="address"
              name="address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="auth-input"
              placeholder="Энхтайвны өргөн 25, AAA байр"
            />
          </Field>
        </div>

        <div className="flex flex-col gap-2 mt-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-[var(--oc-ink2)]">
              Газрын зураг дээрх байршил
            </label>
            <span className="text-xs text-[var(--oc-muted3)]">
              Зураг дээр дарж тэмдэглэнэ
            </span>
          </div>
          <LocationPicker
            latitude={lat}
            longitude={lng}
            onChange={onMapPick}
            onGeocode={(parts) => {
              const resolved = resolveAddressFromGeocode(addressData, parts);
              // Хот тогтоогдсон тохиолдолд л автоматаар бөглөнө.
              if (resolved.city) setAddr(resolved);
            }}
            apiKey={mapApiKey}
            mapId={mapId}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          <Field label="Latitude" htmlFor="latitude" error={fe.latitude}>
            <input
              id="latitude"
              name="latitude"
              type="text"
              inputMode="decimal"
              value={lat ?? ""}
              onChange={(e) => onLatChange(e.target.value)}
              className={`auth-input font-plex-mono ${fe.latitude ? "border-red-500/50" : ""}`}
              placeholder="47.918873"
            />
          </Field>
          <Field label="Longitude" htmlFor="longitude" error={fe.longitude}>
            <input
              id="longitude"
              name="longitude"
              type="text"
              inputMode="decimal"
              value={lng ?? ""}
              onChange={(e) => onLngChange(e.target.value)}
              className={`auth-input font-plex-mono ${fe.longitude ? "border-red-500/50" : ""}`}
              placeholder="106.917698"
            />
          </Field>
        </div>
      </SectionPanel>

      <SectionPanel index={3} total={3} title="Ажиллах хуваарь">
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Field label="Эхлэх цаг" htmlFor="openTime" error={fe.openTime}>
            <Select
              id="openTime"
              name="openTime"
              value={openTime}
              onChange={(v) => { setDirty(true); setOpenTime(v); }}
              error={fe.openTime}
              placeholder="—"
              options={TIME_OPTIONS}
            />
          </Field>
          <Field label="Дуусах цаг" htmlFor="closeTime" error={fe.closeTime}>
            <Select
              id="closeTime"
              name="closeTime"
              value={closeTime}
              onChange={(v) => { setDirty(true); setCloseTime(v); }}
              error={fe.closeTime}
              placeholder="—"
              options={TIME_OPTIONS}
            />
          </Field>
          <Field
            label="Цагийн алхам"
            htmlFor="slotMinutes"
            hint="минут"
            error={fe.slotMinutes}
          >
            <input
              id="slotMinutes"
              name="slotMinutes"
              type="number"
              min={5}
              max={480}
              value={slotMinutes}
              onChange={(e) => setSlotMinutes(e.target.value)}
              className={`auth-input font-plex-mono ${fe.slotMinutes ? "border-red-500/50" : ""}`}
              placeholder="30"
            />
          </Field>
          <Field
            label="Зэрэг авах тоо"
            htmlFor="slotCapacity"
            hint="талбай"
            error={fe.slotCapacity}
          >
            <input
              id="slotCapacity"
              name="slotCapacity"
              type="number"
              min={1}
              max={100}
              value={slotCapacity}
              onChange={(e) => setSlotCapacity(e.target.value)}
              className={`auth-input font-plex-mono ${fe.slotCapacity ? "border-red-500/50" : ""}`}
              placeholder="1"
            />
          </Field>
        </div>

        <div className="mt-5">
          <label className="text-sm font-medium text-[var(--oc-ink2)] mb-2 block">
            Өдөр тус бүрийн цаг
          </label>
          <div className="rounded-[10px] border border-[var(--oc-line)] overflow-hidden">
            {WEEK_DAYS.map((d) => {
              const value = daySchedules[d.value];
              const openError = fe[`schedule_${d.value}_openTime`];
              const closeError = fe[`schedule_${d.value}_closeTime`];
              return (
                <div key={d.value} className="grid gap-3 sm:grid-cols-[120px_1fr_1fr] items-center px-3 py-3 border-b last:border-b-0 border-[var(--oc-line)] bg-[var(--oc-panel2)]">
                  <label className="flex items-center gap-2 text-sm font-medium text-[var(--oc-ink2)]">
                    <input
                      type="checkbox"
                      name={`schedule_${d.value}_isOpen`}
                      checked={value.isOpen}
                      onChange={(e) => updateDay(d.value, { isOpen: e.target.checked })}
                      className="accent-[var(--oc-accent)]"
                    />
                    {d.long}
                  </label>
                  <Field label="Нээх" htmlFor={`schedule_${d.value}_openTime`} error={openError}>
                    <Select
                      id={`schedule_${d.value}_openTime`}
                      name={`schedule_${d.value}_openTime`}
                      value={value.openTime}
                      onChange={(v) => updateDay(d.value, { openTime: v })}
                      error={openError}
                      placeholder="—"
                      options={TIME_OPTIONS}
                    />
                  </Field>
                  <Field label="Хаах" htmlFor={`schedule_${d.value}_closeTime`} error={closeError}>
                    <Select
                      id={`schedule_${d.value}_closeTime`}
                      name={`schedule_${d.value}_closeTime`}
                      value={value.closeTime}
                      onChange={(v) => updateDay(d.value, { closeTime: v })}
                      error={closeError}
                      placeholder="—"
                      options={TIME_OPTIONS}
                    />
                  </Field>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-[var(--oc-muted3)] mt-2">
            Нээлттэй өдөр бүрийн нээх, хаах цагийг тусад нь тохируулна. Дээрх
            ерөнхий цаг нь шинэ өдөр нэмэгдэхэд ашиглах fallback хэвээр байна.
          </p>
        </div>
      </SectionPanel>

      {/* Sticky action bar — урт форм scroll хийхэд ч Хадгалах үргэлж харагдана */}
      <div className="sticky bottom-0 z-10 flex items-center gap-3 pt-3 pb-3 -mb-1 border-t border-[var(--oc-line2)] bg-[var(--oc-carbon)]/95 backdrop-blur-md">
        <span className="text-xs text-[var(--oc-muted3)] flex-1">
          {dirty ? "Хадгалагдаагүй өөрчлөлт байна" : ""}
        </span>
        <BtnLink href="/dashboard/branches" variant="ghost">
          Болих
        </BtnLink>
        <Btn type="submit" disabled={pending || Boolean(state?.needsConfirm && !impactConfirmed)}>
          {pending ? "..." : isEdit ? "Хадгалах" : "Үүсгэх"}
        </Btn>
      </div>
    </form>
  );
}
