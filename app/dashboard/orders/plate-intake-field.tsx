"use client";

// Шинэ засварын хуудас: «Улсын дугаар бичээд л болно».
//  - Энэ газарт бүртгэлтэй → цомхон карт, үйлчлүүлэгч/машин автоматаар сонгогдоно.
//  - Бүртгэлгүй (HUR/глобалд байгаа) → машины карт + үйлчлүүлэгчийн утас.
//  - Олдсонгүй → утас + марк + загвар.
// Утсаар үйлчлүүлэгч, машин, tenant холбоосыг createOrderAction нэг дор
// бүртгэнэ (lib/orders/plate-intake-server.ts).

import { useEffect, useState } from "react";
import { lookupPlateForOrderAction } from "@/app/_actions/orders";
import { Field } from "@/app/_components/auth-shell";
import type { PlateLookupResult, TenantPlateMatch } from "@/lib/orders/plate-intake";
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

export type PlateMatchSelection = {
  customerId: string;
  vehicleId: string;
  isPostpaid: boolean;
} | null;

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
  /** Бүртгэлтэй машин сонгогдсон (эсвэл null — шинээр бүртгэнэ/хоосон). */
  onSelect: (sel: PlateMatchSelection) => void;
  /** Lookup явж байх үед илгээхийг түр хориглоно. */
  onBusyChange: (busy: boolean) => void;
  onSwitchToList: () => void;
  onClearError: (...keys: string[]) => void;
}) {
  const [plateInput, setPlateInput] = useState("");
  const plate = normalizePlate(plateInput);
  const standard = isStandardPlate(plate);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PlateLookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [matchIdx, setMatchIdx] = useState(0);
  // Бүртгэлтэй дугаар ч өөр хүн авчирсан → утсаар шинэ эзэмшигч бүртгэнэ.
  const [otherPerson, setOtherPerson] = useState(false);

  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");

  // Дугаар өөрчлөгдвөл өмнөх үр дүнг хаяна (render-ийн үеийн нөхцөлт setState).
  const [prevPlate, setPrevPlate] = useState(plate);
  if (prevPlate !== plate) {
    setPrevPlate(plate);
    setResult(null);
    setLookupError(null);
    setMatchIdx(0);
    setOtherPerson(false);
  }

  useEffect(() => {
    if (!standard) return;
    // Дугаар өөрчлөгдвөл хуучин хариуг хаяна.
    let cancelled = false;
    // Debounce-ийн хугацаанд ч илгээхийг хориглоно — эс бөгөөс lookup-аас өмнө
    // илгээгдэж «утас оруулна уу» гэсэн хуурамч алдаа гарна.
    onBusyChange(true);
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await lookupPlateForOrderAction(plate);
        if (cancelled) return;
        if (res.ok) {
          setResult(res.result);
          if (res.result.kind !== "tenant") {
            setMake(res.result.kind === "known" ? res.result.vehicle.make : "");
            setModel(res.result.kind === "known" ? res.result.vehicle.model : "");
          }
        } else {
          setLookupError(res.message);
        }
      } catch {
        if (!cancelled) setLookupError("Дугаараар хайхад алдаа гарлаа.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          onBusyChange(false);
        }
      }
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      // Хүлээгдэж буй хариуг хүчингүй болгоно — busy-г ч суллана.
      cancelled = true;
      clearTimeout(timer);
      setLoading(false);
      onBusyChange(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plate, standard]);

  const matches = result?.kind === "tenant" ? result.matches : [];
  const selected: TenantPlateMatch | null =
    matches.length > 0 && !otherPerson ? matches[Math.min(matchIdx, matches.length - 1)] : null;

  // Сонголтыг эцэг маягтад мэдэгдэнэ (customerId/vehicleId + төлбөрийн нөхцөл).
  const selectedKey = selected ? `${selected.customerId}:${selected.vehicleId}` : "";
  useEffect(() => {
    onSelect(
      selected
        ? { customerId: selected.customerId, vehicleId: selected.vehicleId, isPostpaid: selected.isPostpaid }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  // Шинээр бүртгэх хэрэгтэй эсэх, машины мэдээлэл аль эх сурвалжаас.
  const needsNewEntry =
    plate.length > 0 &&
    !loading &&
    !selected &&
    (otherPerson || result?.kind === "known" || result?.kind === "notFound" || !standard || Boolean(lookupError));
  const lookupVehicle =
    otherPerson && matches.length > 0
      ? matches[Math.min(matchIdx, matches.length - 1)].vehicle
      : result?.kind === "known"
        ? result.vehicle
        : null;
  // Lookup-аас марк/загвар бүрэн ирсэн бол гараар асуухгүй.
  const vehicleFromLookup = Boolean(lookupVehicle?.make && lookupVehicle.model);

  const canonPhone = normalizePhone(phone);
  const phoneCustomer = canonPhone ? customers.find((c) => c.phone === canonPhone) : undefined;

  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label="Улсын дугаар"
          required
          htmlFor="plate"
          error={errors.plate ?? errors.vehicleId ?? errors.customerId}
          hint={
            loading
              ? "Хайж байна…"
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
        <p className="text-xs text-[var(--oc-warn)]">{lookupError} Мэдээллийг гараар оруулна уу.</p>
      ) : null}

      {matches.length > 0 && !otherPerson ? (
        <div className="flex flex-col gap-1.5">
          {matches.map((m, i) => {
            const active = selected?.vehicleId === m.vehicleId && selected.customerId === m.customerId;
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
                <span className="font-plex-mono font-semibold text-[var(--oc-ink)]">{result?.plate}</span>
                <span className="text-[var(--oc-ink2)]">
                  {[m.vehicle.make, m.vehicle.model, m.vehicle.year].filter(Boolean).join(" ")}
                </span>
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
            onClick={() => setOtherPerson(true)}
            className="self-start text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
          >
            Өөр хүн авчирсан →
          </button>
        </div>
      ) : null}

      {needsNewEntry ? (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] p-3">
          {lookupVehicle && vehicleFromLookup ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-plex-mono font-semibold text-[var(--oc-ink)]">{plate}</span>
              <span className="text-[var(--oc-ink2)]">
                {[lookupVehicle.make, lookupVehicle.model, lookupVehicle.year].filter(Boolean).join(" ")}
              </span>
              <Badge>
                {otherPerson ? "Шинэ эзэмшигч" : result?.kind === "known" && result.source === "hur" ? "HUR" : "Системд бүртгэлгүй"}
              </Badge>
            </div>
          ) : (
            <p className="text-xs text-[var(--oc-muted3)]">
              {result?.kind === "notFound" && result.reason === "rate_limited"
                ? "Хэт олон хайлт хийлээ — машины мэдээллийг гараар оруулна уу."
                : "Машины мэдээлэл олдсонгүй — гараар оруулна уу."}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Үйлчлүүлэгчийн утас"
              required
              htmlFor="phone"
              error={errors.phone}
              hint={phoneCustomer ? `Бүртгэлтэй: ${phoneCustomer.orgName || phoneCustomer.fullName || phoneCustomer.phone}` : undefined}
            >
              <input
                id="phone"
                name="phone"
                inputMode="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  onClearError("phone");
                }}
                placeholder="99112233"
                className="auth-input font-plex-mono"
              />
            </Field>
            {phoneCustomer ? null : (
              <Field label="Нэр" htmlFor="fullName" hint="заавал биш" error={errors.fullName}>
                <input
                  id="fullName"
                  name="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="auth-input"
                />
              </Field>
            )}
            {vehicleFromLookup ? null : (
              <>
                <Field label="Марк" required htmlFor="make" error={errors.make}>
                  <input
                    id="make"
                    name="make"
                    value={make}
                    onChange={(e) => {
                      setMake(e.target.value);
                      onClearError("make");
                    }}
                    placeholder="Toyota"
                    className="auth-input"
                  />
                </Field>
                <Field label="Загвар" required htmlFor="model" error={errors.model}>
                  <input
                    id="model"
                    name="model"
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value);
                      onClearError("model");
                    }}
                    placeholder="Prius"
                    className="auth-input"
                  />
                </Field>
              </>
            )}
          </div>

          {vehicleFromLookup && lookupVehicle ? (
            <>
              <input type="hidden" name="make" value={lookupVehicle.make} />
              <input type="hidden" name="model" value={lookupVehicle.model} />
              <input type="hidden" name="year" value={lookupVehicle.year ?? ""} />
              <input type="hidden" name="vin" value={lookupVehicle.vin ?? ""} />
              <input type="hidden" name="fuelType" value={lookupVehicle.fuelType ?? ""} />
              <input type="hidden" name="wheelPosition" value={lookupVehicle.wheelPosition ?? ""} />
              <input type="hidden" name="fromLookup" value="1" />
            </>
          ) : null}

          {otherPerson ? (
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
