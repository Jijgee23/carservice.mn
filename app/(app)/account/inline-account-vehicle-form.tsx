"use client";

import { useEffect, useRef, useState } from "react";
import {
  type CreatedAccountVehicle,
  quickCreateAccountVehicle,
} from "@/app/_actions/account-vehicles";
import { Btn, Field, FormError } from "@/app/_components/landing-ops-ui";
import { Select } from "@/app/_components/select";
import { type PublicHurVehicle, normalizeWheelPosition } from "@/lib/hur_service";
import { PLATE_PATTERN } from "@/lib/vehicle-plate";

const PLATE_FETCH_DEBOUNCE_MS = 400;

export function InlineAccountVehicleForm({
  onCreated,
  onCancel,
}: {
  onCreated: (v: CreatedAccountVehicle) => void;
  onCancel?: () => void;
}) {
  const [plate, setPlate] = useState("");
  const [vin, setVin] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [fuelType, setFuelType] = useState("");
  const [wheelPosition, setWheelPosition] = useState("");
  const [colorName, setColorName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [purpose, setPurpose] = useState("");
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const [hurLoading, setHurLoading] = useState(false);
  const [hurError, setHurError] = useState<string | null>(null);
  const [hurInfo, setHurInfo] = useState<PublicHurVehicle | null>(null);
  const [hurSource, setHurSource] = useState<"global" | "hur">("hur");
  // Хэрэглэгчийн гаражид аль хэдийн байгаа — давхар нэмэхээс сэргийлж анхааруулна.
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const lastFetchedRef = useRef<string | null>(null);

  const trimmedPlate = plate.trim().toUpperCase();
  const isValidPlate = PLATE_PATTERN.test(trimmedPlate);

  // HUR-аас ирсэн мэдээллийг талбаруудад тавина (admin-тай ижил).
  function applyHur(v: PublicHurVehicle) {
    setHurInfo(v);
    if (v.plate) setPlate(v.plate);
    if (v.make) setMake(v.make);
    if (v.model) setModel(v.model);
    if (v.year) setYear(String(v.year));
    if (v.vin) setVin(v.vin);
    if (v.fuelType) setFuelType(v.fuelType);
    const w = normalizeWheelPosition(v.wheelPosition);
    if (w) setWheelPosition(w);
    if (v.color) setColorName(v.color);
    if (v.capacity) setCapacity(String(v.capacity));
    if (v.purpose) setPurpose(v.purpose);
  }

  // Гар аргаар (товчоор) HUR-аас дахин татах — debounce/guard-гүй.
  async function refreshFromHur() {
    const p = plate.trim().toUpperCase();
    if (!PLATE_PATTERN.test(p)) {
      setHurError("Дугаар буруу хэлбэртэй.");
      return;
    }
    setHurLoading(true);
    setHurError(null);
    setHurInfo(null);
    try {
      const res = await fetch(
        `/api/account/hur/lookup?plate=${encodeURIComponent(p)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "HUR-аас мэдээлэл татаж чадсангүй.");
      }
      applyHur(data.vehicle as PublicHurVehicle);
      setHurSource(data.source === "global" ? "global" : "hur");
      setAlreadyRegistered(Boolean(data.registered));
      lastFetchedRef.current = p;
    } catch (e) {
      setHurError(e instanceof Error ? e.message : "Алдаа гарлаа.");
    } finally {
      setHurLoading(false);
    }
  }

  // Дугаар хүчинтэй болмогц HUR-аас (admin-тай ижил) мэдээллийг автоматаар татна.
  useEffect(() => {
    if (!isValidPlate) return;
    if (lastFetchedRef.current === trimmedPlate) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      lastFetchedRef.current = trimmedPlate;
      setHurLoading(true);
      setHurError(null);
      setHurInfo(null);
      try {
        const res = await fetch(
          `/api/account/hur/lookup?plate=${encodeURIComponent(trimmedPlate)}`,
          { signal: controller.signal },
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error ?? "HUR-аас мэдээлэл татаж чадсангүй.");
        }
        applyHur(data.vehicle as PublicHurVehicle);
        setHurSource(data.source === "global" ? "global" : "hur");
        setAlreadyRegistered(Boolean(data.registered));
      } catch (e) {
        if (controller.signal.aborted) return;
        setHurError(e instanceof Error ? e.message : "Алдаа гарлаа.");
        lastFetchedRef.current = null;
      } finally {
        if (!controller.signal.aborted) setHurLoading(false);
      }
    }, PLATE_FETCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedPlate, isValidPlate]);

  async function onSubmit() {
    setPending(true);
    setMessage(null);
    setFieldErrors({});
    try {
      const res = await quickCreateAccountVehicle({
        plate,
        make,
        model,
        year,
        vin: vin || null,
        fuelType: fuelType || null,
        wheelPosition: wheelPosition || null,
        colorName: colorName || null,
        capacity: capacity || null,
        purpose: purpose || null,
      });
      if (res.ok && res.vehicle) {
        onCreated(res.vehicle);
        setPlate("");
        setVin("");
        setMake("");
        setModel("");
        setYear("");
        setFuelType("");
        setWheelPosition("");
        setColorName("");
        setCapacity("");
        setPurpose("");
        return;
      }
      setFieldErrors(res.fieldErrors ?? {});
      setMessage(res.message ?? null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Алдаа гарлаа.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--oc-ink)]">Шинэ машин</h3>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-[var(--oc-muted)] hover:text-[var(--oc-ink2)] transition-colors"
          >
            ✕ Болих
          </button>
        ) : null}
      </div>

      <FormError message={message ?? undefined} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Улсын дугаар"
          htmlFor="av-plate"
          hint={
            hurLoading
              ? "HUR-аас татаж байна..."
              : "Жишээ: 1234УБА (4 цифр + 3 үсэг)"
          }
          error={fieldErrors.plate ?? hurError ?? undefined}
        >
          <input
            id="av-plate"
            type="text"
            maxLength={7}
            value={plate}
            onChange={(e) => setPlate(e.target.value.toUpperCase())}
            className={`compact-input uppercase ${fieldErrors.plate ? "border-red-500/50" : isValidPlate ? "border-emerald-500/40" : ""}`}
            placeholder="1234УБА"
          />
        </Field>
        <Field label="VIN" htmlFor="av-vin" hint="заавал биш" error={fieldErrors.vin}>
          <input
            id="av-vin"
            type="text"
            maxLength={17}
            value={vin}
            onChange={(e) => setVin(e.target.value.toUpperCase())}
            className="compact-input uppercase"
          />
        </Field>
      </div>

      {alreadyRegistered ? (
        <p className="text-xs text-[var(--oc-warn)]">
          Энэ дугаартай машин таны бүртгэлд аль хэдийн байна.
        </p>
      ) : null}

      <div className="flex items-center gap-3 flex-wrap">
        <Btn
          variant="ghost"
          size="sm"
          type="button"
          onClick={refreshFromHur}
          disabled={hurLoading || !isValidPlate}
        >
          {hurLoading ? "Татаж байна..." : "↻ HUR-аас шинэчлэх"}
        </Btn>
        {hurInfo ? (
          <span className="text-xs text-[var(--oc-muted2)]">
            {hurSource === "global" ? "Бүртгэлээс олдлоо" : "HUR-аас татав"}
            {hurInfo.color ? ` · ${hurInfo.color}` : ""}
            {hurInfo.capacity ? ` · ${hurInfo.capacity} см³` : ""}
            {hurInfo.fuelType ? ` · ${hurInfo.fuelType}` : ""}
            {hurInfo.purpose ? ` · ${hurInfo.purpose}` : ""}
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Марк" htmlFor="av-make" error={fieldErrors.make}>
          <input
            id="av-make"
            value={make}
            onChange={(e) => setMake(e.target.value)}
            className={`compact-input ${fieldErrors.make ? "border-red-500/50" : ""}`}
            placeholder="Toyota"
          />
        </Field>
        <Field label="Загвар" htmlFor="av-model" error={fieldErrors.model}>
          <input
            id="av-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className={`compact-input ${fieldErrors.model ? "border-red-500/50" : ""}`}
            placeholder="Prius 30"
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Үйлдвэрлэсэн он" htmlFor="av-year" hint="заавал биш" error={fieldErrors.year}>
          <input
            id="av-year"
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
            className={`compact-input ${fieldErrors.year ? "border-red-500/50" : ""}`}
            placeholder="2018"
          />
        </Field>
        <Field label="Шатахуун" htmlFor="av-fuel" hint="заавал биш">
          <input
            id="av-fuel"
            type="text"
            list="av-fuel-types"
            value={fuelType}
            onChange={(e) => setFuelType(e.target.value)}
            className="compact-input"
            placeholder="Бензин"
          />
          <datalist id="av-fuel-types">
            <option value="Бензин" />
            <option value="Дизель" />
            <option value="Хийн" />
            <option value="Цахилгаан" />
            <option value="Эрлийз" />
          </datalist>
        </Field>
        <Field label="Жолооны хүрд" htmlFor="av-wheel">
          <Select
            id="av-wheel"
            name="wheelPosition"
            value={wheelPosition}
            onChange={setWheelPosition}
            options={[
              { value: "Зүүн", label: "Зүүн талдаа" },
              { value: "Баруун", label: "Баруун талдаа" },
            ]}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Өнгө" htmlFor="av-color" hint="заавал биш">
          <input
            id="av-color"
            type="text"
            value={colorName}
            onChange={(e) => setColorName(e.target.value)}
            className="compact-input"
            placeholder="Цагаан"
          />
        </Field>
        <Field label="Моторын хэмжээ (см³)" htmlFor="av-capacity" hint="заавал биш">
          <input
            id="av-capacity"
            inputMode="numeric"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ""))}
            className="compact-input"
            placeholder="1496"
          />
        </Field>
        <Field label="Зориулалт" htmlFor="av-purpose" hint="заавал биш">
          <input
            id="av-purpose"
            type="text"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className="compact-input"
            placeholder="Суудал"
          />
        </Field>
      </div>

      <div className="flex justify-end">
        <Btn variant="primary" type="button" disabled={pending} onClick={onSubmit}>
          {pending ? "Нэмж..." : "Машин нэмэх"}
        </Btn>
      </div>
    </div>
  );
}
