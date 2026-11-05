"use client";

import { useActionState, useRef, useState } from "react";
import type { CreatedAccountVehicle } from "@/app/_actions/account-vehicles";
import {
  type AppointmentActionState,
  createAppointment,
} from "@/app/_actions/appointments";
import { Field, FormError } from "@/app/_components/auth-shell";
import {
  BranchTimePicker,
  type BranchTimePickerHandle,
} from "@/app/_components/branch-time-picker";
import { Select } from "@/app/_components/select";
import type { Weekday } from "@/lib/branches";
import type { ScheduleException, ScheduleSeason, ScheduleRule } from "@/lib/branch-effective-schedule";
import { formatDuration } from "@/lib/category-duration";
import { InlineAccountVehicleForm } from "@/app/(app)/account/inline-account-vehicle-form";

type Category = { id: string; name: string; durationMinutes: number };
type Branch = {
  id: string;
  name: string;
  openWeekdays: Weekday[];
  schedule: {
    openTime: string | null;
    closeTime: string | null;
    schedules: ScheduleRule[];
    scheduleExceptions?: ScheduleException[];
    scheduleSeasons?: ScheduleSeason[];
  };
  categories: Category[];
};
// id нь global Vehicle id (AccountVehicle link биш).
type Vehicle = { id: string; plate: string; make: string; model: string };

export function BookingForm({
  branches,
  vehicles: initialVehicles,
  initialBranchId = "",
  initialCategoryIds,
  lockCategories = false,
}: {
  branches: Branch[];
  vehicles: Vehicle[];
  initialBranchId?: string;
  /** Урьдчилан сонгосон ангилалууд (жишээ нь `/book`-ийн олон-tenant
   * category-first урсгалаас ирсэн). `lockCategories` үнэн үед л энэ хэрэг
   * болно — эс бөгөөс хэрэглэгч эндээс дахин чөлөөтэй сонгоно. */
  initialCategoryIds?: string[];
  /** Ангилалыг `/book`-д аль хэдийн сонгосон тул энд дахин харуулж,
   * өөрчлүүлэхгүй — `initialCategoryIds`-ийг тогтмол ашиглана. */
  lockCategories?: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    AppointmentActionState,
    FormData
  >(createAppointment, null);
  const fe = state?.fieldErrors ?? {};

  // Booking v2 — category-first: эхлээд үйлчилгээгээ сонгоно (заавал биш),
  // дараа нь тэдгээрийг БҮГДийг нь санал болгодог салбарууд л сонгогдоно.
  // Аль замаар ирсэн ч (discover-с тодорхой салбар сонгож орж ирсэн) энэ
  // салбар шууд идэвхтэй хэвээр — ангилал сонгох нь блоклохгүй, зөвхөн
  // БУСАД салбарыг харьцуулах/шүүх зорилготой (mobile-тай адил шийдвэр).
  const [branchId, setBranchId] = useState(
    initialBranchId || (branches.length === 1 ? branches[0].id : ""),
  );
  const [categoryIds, setCategoryIds] = useState<string[]>(
    initialCategoryIds ?? [],
  );
  const [vehicles, setVehicles] = useState<Vehicle[]>(initialVehicles);
  const [vehicleId, setVehicleId] = useState(
    initialVehicles.length === 1 ? initialVehicles[0].id : "",
  );
  const [showVehForm, setShowVehForm] = useState(false);
  const [selectedIso, setSelectedIso] = useState("");
  const timePickerRef = useRef<BranchTimePickerHandle>(null);

  const selectedBranch = branches.find((b) => b.id === branchId);

  // Хэрэглэгч discover-ээс ТОДОРХОЙ салбар сонгож ирсэн бол (`?branch=`)
  // зөвхөн ТУХАЙН салбарын ангиллыг харуулна — эс бөгөөс байгууллагын өөр
  // салбарт байгаа (энэ салбараас аль хэдийн хассан ч) ангилал энд гарч,
  // сонговол `toggleCategory`-гийн auto-switch логик чимээгүйгээр өөр
  // салбар руу шилжүүлдэг байсан (хэрэглэгчийн шууд сонгосон салбарыг
  // зөрчиж). Тодорхой салбаргүйгээр ирсэн бол (category-first урсгал,
  // mobile-тай ижил шийдвэр) байгууллагын БҮХ салбарын ангилалын нэгдлийг
  // хэвээр үлдээнэ — энэ тохиолдолд салбар хараахан сонгогдоогүй байна.
  const allCategories = (() => {
    if (initialBranchId) {
      const branch = branches.find((b) => b.id === initialBranchId);
      return [...(branch?.categories ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    }
    const byId = new Map<string, Category>();
    for (const b of branches) for (const c of b.categories) byId.set(c.id, c);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();

  // Сонгосон ангилал БҮГДийг санал болгодог салбарууд (АНД) — ангилал огт
  // сонгоогүй бол БҮХ салбар (`every` хоосон массив дээр үнэн).
  const compatibleBranches = branches.filter((b) =>
    categoryIds.every((id) => b.categories.some((c) => c.id === id)),
  );

  const selectedDurationMinutes = (selectedBranch?.categories ?? [])
    .filter((c) => categoryIds.includes(c.id))
    .reduce((sum, c) => sum + c.durationMinutes, 0);

  function toggleCategory(id: string, checked: boolean) {
    const next = checked
      ? [...categoryIds, id]
      : categoryIds.filter((x) => x !== id);
    setCategoryIds(next);
    // Идэвхтэй салбар цаашид тохирохгүй бол — ганц тохирох салбар үлдсэн бол
    // автоматаар түүнийг сонгоно, эс бөгөөс дахин сонгуулахаар хоослоно.
    const compatible = branches.filter((b) =>
      next.every((cid) => b.categories.some((c) => c.id === cid)),
    );
    if (!compatible.some((b) => b.id === branchId)) {
      // Салбар өөрчлөгдөнө (эсвэл хоослогдоно) — `key={branchId}`-ээр
      // remount хийгдэж дотоод төлөв (огноо гэх мэт) аль хэдийн цэвэрлэгдэнэ,
      // тул reload дуудах шаардлагагүй (хуучин instance дээр дуудвал
      // unmount-ийн дараах setState анхааруулга үүсгэнэ).
      setBranchId(compatible.length === 1 ? compatible[0].id : "");
      // Хуучин салбарын цаг шинэ салбарт хүчингүй.
      setSelectedIso("");
    } else {
      timePickerRef.current?.reload(next);
    }
  }

  function onBranchChange(v: string) {
    setBranchId(v);
    setSelectedIso("");
  }

  function onVehCreated(v: CreatedAccountVehicle) {
    setVehicles((prev) => [
      { id: v.vehicleId, plate: v.plate, make: v.make, model: v.model },
      ...prev,
    ]);
    setVehicleId(v.vehicleId);
    setShowVehForm(false);
  }

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormError message={state?.message && !state.ok ? state.message : undefined} />
      <input type="hidden" name="requestedAt" value={selectedIso} />
      {categoryIds.map((id) => (
        <input key={id} type="hidden" name="categoryIds" value={id} />
      ))}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 items-start">
        {/* Зүүн багана: ангилал, салбар, машин, тэмдэглэл */}
        <div className="flex flex-col gap-4">
          {lockCategories ? (
            allCategories.length > 0 ? (
              <Field label="Үйлчилгээ">
                <div className="flex flex-wrap gap-2">
                  {allCategories
                    .filter((c) => categoryIds.includes(c.id))
                    .map((c) => (
                      <span
                        key={c.id}
                        className="px-3 py-1.5 rounded-full border border-[var(--oc-accent)] bg-[var(--oc-accent)]/10 text-[var(--oc-accent)] text-sm font-medium"
                      >
                        {c.name}
                      </span>
                    ))}
                </div>
                {categoryIds.length > 0 ? (
                  <p className="text-xs text-[var(--oc-muted3)] mt-2">
                    Нийт ойролцоогоор {formatDuration(selectedDurationMinutes)}
                  </p>
                ) : null}
              </Field>
            ) : null
          ) : allCategories.length > 0 ? (
            <Field label="Үйлчилгээ" htmlFor="category-0" hint="заавал биш">
              <div className="flex flex-col gap-2">
                {categoryIds.length > 0 ? (
                  <p className="text-xs text-[var(--oc-muted3)]">
                    Нийт ойролцоогоор {formatDuration(selectedDurationMinutes)}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {allCategories.map((c, i) => {
                    const checked = categoryIds.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        htmlFor={`category-${i}`}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full border text-sm cursor-pointer transition-colors select-none ${
                          checked
                            ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/10 text-[var(--oc-accent)] font-medium"
                            : "border-[var(--oc-line)] bg-[var(--oc-panel)] text-[var(--oc-ink2)] hover:border-[var(--oc-muted4)]"
                        }`}
                      >
                        <input
                          id={`category-${i}`}
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={(e) => toggleCategory(c.id, e.target.checked)}
                        />
                        {checked ? <span aria-hidden>✓</span> : null}
                        {c.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            </Field>
          ) : null}

          {/* Дэвийн шийдвэрээр: ангилал сонгогдоогүй бол салбар сонгох
              хэсгийг нуана — эхлээд орж ирсэн салбар (initialBranchId эсвэл
              цорын ганц салбар) хэвээрээ идэвхтэй хэрэглэгдэнэ. */}
          {/* Салбар хараахан сонгогдоогүй бол (олон салбартай, ангилалгүй
              байгууллага гэх мэт) сонгуулахгүй бол илгээх боломжгүй болно. */}
          {branches.length > 1 && (categoryIds.length > 0 || !branchId) ? (
            <Field label="Салбар" htmlFor="branchId" error={fe.branchId}>
              {compatibleBranches.length === 0 ? (
                <p className="text-xs text-red-400 light:text-red-600">
                  Сонгосон бүх үйлчилгээг нэгэн зэрэг санал болгодог салбар
                  алга байна. Үйлчилгээнийхээ сонголтоо өөрчилнө үү.
                </p>
              ) : (
                <Select
                  id="branchId"
                  name="branchId"
                  required
                  value={branchId}
                  onChange={onBranchChange}
                  error={fe.branchId}
                  placeholder="— Сонгох —"
                  options={compatibleBranches.map((b) => ({
                    value: b.id,
                    label: b.name,
                  }))}
                />
              )}
            </Field>
          ) : (
            <input type="hidden" name="branchId" value={branchId} />
          )}

          <Field
            label="Машин"
            htmlFor="vehicleId"
            hint="заавал биш"
            error={fe.vehicleId}
          >
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <Select
                  id="vehicleId"
                  name="vehicleId"
                  value={vehicleId}
                  onChange={setVehicleId}
                  error={fe.vehicleId}
                  placeholder={
                    vehicles.length === 0 ? "— Машингүй —" : "— Сонгох —"
                  }
                  options={vehicles.map((v) => ({
                    value: v.id,
                    label: v.plate,
                    hint: `${v.make} ${v.model}`,
                  }))}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowVehForm((v) => !v)}
                className="shrink-0 w-10 rounded-lg border border-[var(--oc-accent)]/30 bg-[var(--oc-accent)]/10 hover:bg-[var(--oc-accent)]/20 text-[var(--oc-accent)] text-base font-semibold transition-colors"
                title="Шинэ машин нэмэх"
              >
                {showVehForm ? "✕" : "+"}
              </button>
            </div>
          </Field>

          {showVehForm ? (
            <InlineAccountVehicleForm
              onCreated={onVehCreated}
              onCancel={() => setShowVehForm(false)}
            />
          ) : null}

          <Field label="Тэмдэглэл" htmlFor="note" hint="заавал биш">
            <textarea
              id="note"
              name="note"
              rows={2}
              className="compact-input resize-y"
              placeholder="Ямар үйлчилгээ авах, гомдол..."
            />
          </Field>
        </div>

        {/* Дунд + баруун багана: календар | боломжит цаг */}
        <BranchTimePicker
          key={branchId || "none"}
          branchId={branchId}
          categoryIds={categoryIds}
          openWeekdays={selectedBranch?.openWeekdays}
          schedule={selectedBranch?.schedule}
          value={selectedIso}
          onChange={setSelectedIso}
          error={fe.requestedAt}
        />
      </div>

      <button
        type="submit"
        disabled={pending || !selectedIso || !branchId}
        className="w-full sm:w-auto sm:self-end inline-flex items-center justify-center gap-2 bg-[var(--oc-accent)] text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors px-8 py-3 rounded-xl font-semibold text-sm shadow-sm"
      >
        {pending ? "Илгээж байна..." : !selectedIso ? "Өдөр, цагаа сонгоно уу" : <>Цаг захиалах <span aria-hidden>→</span></>}
      </button>
    </form>
  );
}
