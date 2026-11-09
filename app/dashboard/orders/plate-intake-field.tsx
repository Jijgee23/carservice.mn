"use client";

// Шинэ засварын хуудас: «Улсын дугаар бичээд л болно».
//  1. Дугаар → мэдээлэл татна (tenant → глобал → HUR).
//     - Энэ газарт эзэмшигчтэй бүртгэлтэй → цомхон карт, автоматаар сонгогдоно.
//     - Бүртгэлгүй → машиныг эзэмшигчгүйгээр ШУУД бүртгэнэ (HUR-д ч олдохгүй
//       бол марк/загвар оруулаад «Машин бүртгэх»).
//  2. Үйлчлүүлэгчийн утас → «Холбох» (эсвэл шууд хуудас үүсгэхэд) үйлчлүүлэгч
//     үүсч машинд эзэмшигчээр холбогдоно.
// Сервер: lib/orders/plate-intake-server.ts.

import { useEffect, useState } from "react";
import {
  linkPlateCustomerAction,
  lookupPlateForOrderAction,
  registerPlateVehicleAction,
} from "@/app/_actions/orders";
import { Field } from "@/app/_components/auth-shell";
import type {
  PlateLookupResult,
  PlateLookupVehicle,
  TenantPlateMatch,
  UnownedPlateVehicle,
} from "@/lib/orders/plate-intake";
import { normalizePhone } from "@/lib/phone";
import { isStandardPlate, normalizePlate } from "@/lib/vehicle-plate";

const LOOKUP_DEBOUNCE_MS = 400;

type Customer = {
  id: string;
  fullName: string;
  phone: string;
  isOrganization?: boolean;
  orgName?: string | null;
};

/** customerId хоосон = машин бүртгэгдсэн, эзэмшигч хараахан холбогдоогүй. */
export type PlateMatchSelection = {
  customerId: string;
  vehicleId: string;
  isPostpaid: boolean;
} | null;

function vehicleTitle(v: PlateLookupVehicle): string {
  return [v.make, v.model, v.year].filter(Boolean).join(" ");
}

export function PlateIntakeField({
  customers,
  errors,
  onSelect,
  onBusyChange,
  onSwitchToList,
  onClearError,
}: {
  customers: Customer[];
  errors: Record<string, string | undefined>;
  onSelect: (sel: PlateMatchSelection) => void;
  /** Lookup/бүртгэл явж байх үед илгээхийг түр хориглоно. */
  onBusyChange: (busy: boolean) => void;
  onSwitchToList: () => void;
  onClearError: (...keys: string[]) => void;
}) {
  const [plateInput, setPlateInput] = useState("");
  const plate = normalizePlate(plateInput);
  const standard = isStandardPlate(plate);

  const [result, setResult] = useState<PlateLookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [matchIdx, setMatchIdx] = useState(0);
  // Бүртгэлтэй дугаар ч өөр хүн авчирсан → шинэ эзэмшигч холбоно.
  const [otherPerson, setOtherPerson] = useState(false);

  // 1-р алхам: эзэмшигчгүй бүртгэгдсэн машин.
  const [registered, setRegistered] = useState<UnownedPlateVehicle | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  // 2-р алхам: холбогдсон эзэмшигч.
  const [linked, setLinked] = useState<TenantPlateMatch | null>(null);
  const [linking, setLinking] = useState(false);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");

  // Дугаар өөрчлөгдвөл бүх алхмыг шинээр эхлүүлнэ (render-ийн үеийн нөхцөлт setState).
  const [prevPlate, setPrevPlate] = useState(plate);
  if (prevPlate !== plate) {
    setPrevPlate(plate);
    setResult(null);
    setLookupError(null);
    setMatchIdx(0);
    setOtherPerson(false);
    setRegistered(null);
    setRegisterError(null);
    setLinked(null);
    setLocalErrors({});
  }

  useEffect(() => {
    if (!standard) return;
    // Дугаар өөрчлөгдвөл хуучин хариуг хаяна.
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await lookupPlateForOrderAction(plate);
        if (cancelled) return;
        if (res.ok) {
          setResult(res.result);
          if (res.result.kind === "known") {
            const v = res.result.vehicle;
            setMake(v.make);
            setModel(v.model);
            // Бүртгэлгүй, мэдээлэл бүрэн → машиныг эзэмшигчгүйгээр шууд бүртгэнэ.
            if (v.make && v.model) {
              setRegistering(true);
              try {
                const reg = await registerPlateVehicleAction({ plate, vehicle: v, fromLookup: true });
                if (cancelled) return;
                if (reg.ok) setRegistered(reg.value);
                else {
                  setRegisterError(reg.message);
                  setLocalErrors(reg.fieldErrors ?? {});
                }
              } finally {
                if (!cancelled) setRegistering(false);
              }
            }
          } else if (res.result.kind === "notFound") {
            setMake("");
            setModel("");
          }
        } else {
          setLookupError(res.message);
        }
      } catch {
        if (!cancelled) setLookupError("Дугаараар хайхад алдаа гарлаа.");
      }
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setRegistering(false);
    };
  }, [plate, standard]);

  // Эзэмшигчтэй бүртгэлүүд (+ дөнгөж холбосон нь эхэнд).
  const tenantMatches = result?.kind === "tenant" ? result.matches : [];
  const matches = linked
    ? [linked, ...tenantMatches.filter((m) => !(m.vehicleId === linked.vehicleId && m.customerId === linked.customerId))]
    : tenantMatches;
  const selected: TenantPlateMatch | null =
    matches.length > 0 && (!otherPerson || linked) ? matches[Math.min(matchIdx, matches.length - 1)] : null;

  // Эзэмшигчгүй бүртгэл: дөнгөж бүртгэсэн эсвэл өмнө нь эзэнгүй бүртгэгдсэн.
  const unowned = registered ?? (result?.kind === "tenant" ? result.unowned : null);
  const showOwnerStep = !selected && Boolean(unowned) && (matches.length === 0 || otherPerson);

  // Машины мэдээллийн эх сурвалж: HUR/глобал мэдээлэл, эсвэл «өөр хүн» үед
  // бүртгэлтэй машины мэдээлэл (шинэ эзэмшигчид шинэ мөр — per-owner загвар).
  const autoSource: PlateLookupVehicle | null = unowned || selected
    ? null
    : otherPerson && tenantMatches.length > 0
      ? tenantMatches[Math.min(matchIdx, tenantMatches.length - 1)].vehicle
      : result?.kind === "known"
        ? result.vehicle
        : null;
  const autoComplete = Boolean(autoSource?.make && autoSource.model);

  async function register(vehicle: PlateLookupVehicle, fromLookup: boolean) {
    setRegistering(true);
    setRegisterError(null);
    try {
      const res = await registerPlateVehicleAction({ plate, vehicle, fromLookup });
      if (res.ok) {
        setRegistered(res.value);
        setLocalErrors({});
      } else {
        setRegisterError(res.message);
        setLocalErrors(res.fieldErrors ?? {});
      }
    } catch {
      setRegisterError("Машин бүртгэхэд алдаа гарлаа.");
    } finally {
      setRegistering(false);
    }
  }

  // Гараар бүртгэх: HUR-д олдоогүй, стандарт бус дугаар, алдаа, дутуу мэдээлэл.
  const showManualVehicle =
    plate.length > 0 &&
    !selected &&
    !unowned &&
    !registering &&
    (!standard ||
      Boolean(lookupError) ||
      Boolean(registerError) ||
      result?.kind === "notFound" ||
      (Boolean(autoSource) && !autoComplete));

  async function link() {
    if (!unowned) return;
    const canon = normalizePhone(phone);
    if (!canon) {
      setLocalErrors({ phone: phone ? "Утасны дугаар 8 оронтой тоо байх ёстой." : "Үйлчлүүлэгчийн утсыг оруулна уу." });
      return;
    }
    setLinking(true);
    setLocalErrors({});
    try {
      const res = await linkPlateCustomerAction({ vehicleId: unowned.vehicleId, phone: canon, fullName });
      if (res.ok) {
        setLinked(res.value);
        setMatchIdx(0);
        setOtherPerson(false);
        setRegistered(null);
      } else {
        setLocalErrors(res.fieldErrors ?? { phone: res.message });
      }
    } catch {
      setLocalErrors({ phone: "Үйлчлүүлэгч холбоход алдаа гарлаа." });
    } finally {
      setLinking(false);
    }
  }

  // Сонголтыг эцэг маягтад мэдэгдэнэ (customerId/vehicleId + төлбөрийн нөхцөл).
  const selection: PlateMatchSelection = selected
    ? { customerId: selected.customerId, vehicleId: selected.vehicleId, isPostpaid: selected.isPostpaid }
    : showOwnerStep && unowned
      ? { customerId: "", vehicleId: unowned.vehicleId, isPostpaid: unowned.isPostpaid }
      : null;
  const selectionKey = selection ? `${selection.customerId}:${selection.vehicleId}` : "";
  useEffect(() => {
    onSelect(selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  const lookupPending = standard && !result && !lookupError;
  const busy = lookupPending || registering || linking;
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  const err = (key: string) => localErrors[key] ?? errors[key];
  const canonPhone = normalizePhone(phone);
  const phoneCustomer = canonPhone ? customers.find((c) => c.phone === canonPhone) : undefined;

  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label="Улсын дугаар"
          required
          htmlFor="plate"
          error={err("plate") ?? errors.vehicleId}
          hint={
            lookupPending
              ? "Хайж байна…"
              : registering
                ? "Машин бүртгэж байна…"
                : plate && !standard
                  ? "Стандарт бус дугаар — машины мэдээллийг гараар оруулна."
                  : undefined
          }
          className="w-full max-w-xs"
        >
          <input
            id="plate"
            name="plate"
            value={plateInput}
            onChange={(e) => {
              setPlateInput(e.target.value);
              onClearError("plate", "vehicleId", "customerId");
            }}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="1234УБА"
            className="auth-input font-plex-mono text-lg uppercase tracking-wider"
          />
        </Field>
        <button
          type="button"
          onClick={onSwitchToList}
          className="mb-2 text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
        >
          Дугааргүй / жагсаалтаас сонгох
        </button>
      </div>
      <input type="hidden" name="intakeMode" value="plate" />

      {lookupError ? (
        <p className="text-xs text-[var(--oc-warn)]">{lookupError} Машины мэдээллийг гараар оруулна уу.</p>
      ) : null}

      {/* Эзэмшигчтэй бүртгэлүүд */}
      {selected ? (
        <div className="flex flex-col gap-1.5">
          {matches.map((m, i) => {
            const active = selected.vehicleId === m.vehicleId && selected.customerId === m.customerId;
            return (
              <button
                key={`${m.vehicleId}:${m.customerId}`}
                type="button"
                onClick={() => setMatchIdx(i)}
                aria-pressed={active}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/[0.08]"
                    : "border-[var(--oc-line)] hover:border-[var(--oc-line2)]"
                }`}
              >
                <span className="font-plex-mono font-semibold text-[var(--oc-ink)]">{plate}</span>
                <span className="text-[var(--oc-ink2)]">{vehicleTitle(m.vehicle)}</span>
                <span className="text-[var(--oc-muted3)]">·</span>
                <span className="text-[var(--oc-ink2)]">{m.customerName}</span>
                <span className="font-plex-mono text-xs text-[var(--oc-muted3)]">{m.customerPhone}</span>
                {m.ownerIsOrganization ? <Badge>Байгууллага</Badge> : null}
                {m.isPostpaid ? <Badge>Дараа төлбөрт</Badge> : null}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setOtherPerson(true);
              setLinked(null);
              // Эзэнгүй бүртгэл байхгүй бол шинэ эзэмшигчид машиныг шууд бүртгэнэ.
              const unownedExisting = result?.kind === "tenant" ? result.unowned : null;
              if (!unownedExisting && !registered && selected.vehicle.make && selected.vehicle.model) {
                void register(selected.vehicle, true);
              }
            }}
            className="self-start text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
          >
            Өөр хүн авчирсан →
          </button>
        </div>
      ) : null}

      {/* 1-р алхам (гараар): машины мэдээлэл олдоогүй */}
      {showManualVehicle ? (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] p-3">
          <p className="text-xs text-[var(--oc-muted3)]">
            {registerError
              ? registerError
              : result?.kind === "notFound" && result.reason === "rate_limited"
                ? "Хэт олон хайлт хийлээ — машины мэдээллийг гараар оруулна уу."
                : "Машины мэдээлэл олдсонгүй — гараар оруулаад бүртгэнэ үү."}
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Марк" required htmlFor="make" error={err("make")}>
              <input
                id="make"
                value={make}
                onChange={(e) => {
                  setMake(e.target.value);
                  setLocalErrors({});
                }}
                placeholder="Toyota"
                className="auth-input"
              />
            </Field>
            <Field label="Загвар" required htmlFor="model" error={err("model")}>
              <input
                id="model"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setLocalErrors({});
                }}
                placeholder="Prius"
                className="auth-input"
              />
            </Field>
            <button
              type="button"
              disabled={registering}
              onClick={() => {
                if (!make.trim() || !model.trim()) {
                  setLocalErrors({
                    ...(make.trim() ? {} : { make: "Маркаа оруулна уу." }),
                    ...(model.trim() ? {} : { model: "Загвараа оруулна уу." }),
                  });
                  return;
                }
                void register(
                  {
                    make: make.trim(),
                    model: model.trim(),
                    year: autoSource?.year ?? null,
                    vin: autoSource?.vin ?? null,
                    fuelType: autoSource?.fuelType ?? null,
                    wheelPosition: autoSource?.wheelPosition ?? null,
                  },
                  Boolean(autoSource),
                );
              }}
              className="mb-px rounded-lg border border-[var(--oc-accent)] px-3 py-2 text-sm font-medium text-[var(--oc-accent)] hover:bg-[var(--oc-accent)]/[0.08] disabled:opacity-50"
            >
              {registering ? "…" : "Машин бүртгэх"}
            </button>
          </div>
        </div>
      ) : null}

      {/* 2-р алхам: машин бүртгэгдсэн — үйлчлүүлэгчийн утсаар эзэмшигч холбоно */}
      {showOwnerStep && unowned ? (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-emerald-400 light:text-emerald-700">✓</span>
            <span className="font-plex-mono font-semibold text-[var(--oc-ink)]">{plate}</span>
            <span className="text-[var(--oc-ink2)]">{vehicleTitle(unowned.vehicle)}</span>
            <Badge>Машин бүртгэгдсэн</Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field
              label="Үйлчлүүлэгчийн утас"
              required
              htmlFor="phone"
              error={err("phone")}
              hint={phoneCustomer ? `Бүртгэлтэй: ${phoneCustomer.orgName || phoneCustomer.fullName || phoneCustomer.phone}` : undefined}
            >
              <input
                id="phone"
                name="phone"
                inputMode="tel"
                autoFocus
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setLocalErrors({});
                  onClearError("phone");
                }}
                placeholder="99112233"
                className="auth-input font-plex-mono"
              />
            </Field>
            {phoneCustomer ? (
              <div />
            ) : (
              <Field label="Нэр" htmlFor="fullName" hint="заавал биш" error={err("fullName")}>
                <input
                  id="fullName"
                  name="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="auth-input"
                />
              </Field>
            )}
            <button
              type="button"
              disabled={linking}
              onClick={() => void link()}
              className="mb-px rounded-lg border border-[var(--oc-accent)] px-3 py-2 text-sm font-medium text-[var(--oc-accent)] hover:bg-[var(--oc-accent)]/[0.08] disabled:opacity-50"
            >
              {linking ? "…" : phoneCustomer ? "Холбох" : "Үйлчлүүлэгч үүсгэх"}
            </button>
          </div>
          {otherPerson && tenantMatches.length > 0 ? (
            <button
              type="button"
              onClick={() => setOtherPerson(false)}
              className="self-start text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
            >
              ← Бүртгэлтэй эзэмшигч рүү буцах
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--oc-line)] px-2 py-0.5 text-[11px] text-[var(--oc-muted2)]">
      {children}
    </span>
  );
}
