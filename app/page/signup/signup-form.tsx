"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { signUpAction, type ActionState } from "@/app/_actions/auth";
import {
  Field,
  FormError,
  SubmitButton,
} from "@/app/_components/landing-ops-ui";
import { Select } from "@/app/_components/select";
import {
  type AddressData,
  type AddressValue,
  AddressSelect,
  resolveAddressFromGeocode,
} from "@/app/dashboard/branches/address-select";
import { DEFAULT_OPEN_DAYS, WEEK_DAYS, type Weekday } from "@/lib/branches";
import { normalizeRegno, regnoKind, splitPersonName } from "@/lib/tenant-regno";

const REGNO_FETCH_DEBOUNCE_MS = 400;

// Leaflet/Google Maps нь window-д шууд хандах учир SSR хийгдэхгүйгээр lazy load
const LocationPicker = dynamic(
  () =>
    import("@/app/dashboard/branches/location-picker").then(
      (m) => m.LocationPicker,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 w-full rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] flex items-center justify-center text-sm text-[var(--oc-muted3)]">
        Газрын зураг ачаалж байна...
      </div>
    ),
  },
);

// Ажиллах цагийн сонголт — 30 минутын алхамтай, 24 цагийн формат.
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const v = `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"}`;
  return { value: v, label: v };
});

/* Серверээс ирсэн талбарын алдааг алхамд нь буцаахад ашиглана. */
const STEP1_FIELDS = [
  "registerNumber",
  "orgName",
  "orgEmail",
  "phone1",
  "phone2",
  "logo",
];
const BRANCH_FIELDS = [
  "city",
  "district",
  "khoroo",
  "address",
  "latitude",
  "longitude",
  "openTime",
  "closeTime",
];

export function SignUpForm({
  addressData,
  mapApiKey,
  mapId,
}: {
  addressData: AddressData;
  mapApiKey: string;
  mapId: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    signUpAction,
    null,
  );

  const fe = state?.fieldErrors ?? {};
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoName, setLogoName] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const awaitingOtp = Boolean(state?.awaitingOtp);

  /* 3 алхамт форм: 1) Байгууллага 2) Үндсэн салбар 3) Админ. Өмнөх алхмуудын
     талбарууд дараагийн алхамд DOM-д хэвээр (hidden) байдаг тул submit үед
     бүгд хамт илгээгдэнэ. */
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // --- Алхам 2: Үндсэн салбар ---
  const [addr, setAddr] = useState<AddressValue>({
    city: "Улаанбаатар",
    district: "",
    khoroo: "",
  });
  const [branchAddress, setBranchAddress] = useState("");
  const [showMap, setShowMap] = useState(false);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [openTime, setOpenTime] = useState("09:00");
  const [closeTime, setCloseTime] = useState("18:00");
  const [workDays, setWorkDays] = useState<Set<Weekday>>(
    new Set(DEFAULT_OPEN_DAYS),
  );

  function onMapPick(coords: { lat: number; lng: number } | null) {
    if (!coords) {
      setLat(null);
      setLng(null);
      return;
    }
    setLat(Number(coords.lat.toFixed(6)));
    setLng(Number(coords.lng.toFixed(6)));
  }

  function toggleWorkDay(value: Weekday) {
    setWorkDays((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  // Нууц үгийг controlled — render-бүрт state-д хадгалагдана. Server-руу values
  // дотор буцаахгүй (аюулгүй байдлын үүднээс), client дотроо л хадгална.
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const passwordsMatch =
    password.length >= 8 && password === passwordConfirm;

  // Регистр / Байгууллагын нэр — controlled (lookup-аар бөглөж болохын тулд)
  const [registerNumber, setRegisterNumber] = useState(
    state?.values?.registerNumber ?? "",
  );
  const [orgName, setOrgName] = useState(state?.values?.orgName ?? "");
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [regFound, setRegFound] = useState(false);
  // Регистрийн хэлбэрээс: 7 оронтой тоо = байгууллага, ҮҮ99993333 = хувь хүн
  const regKind = regnoKind(registerNumber);
  const isPerson = regKind === "person";
  // Хувь хүний админыг 1-р алхмын утас/имэйлээр үүсгэнэ — алхам 3-т харуулахад.
  const [personContact, setPersonContact] = useState({ phone: "", email: "" });
  // Хэрэглэгч нэрийг гараар өөрчилсөн бол дахин дарж бичихгүй
  const userEditedNameRef = useRef(false);
  const lastFetchedRegnoRef = useRef<string | null>(null);

  // Server-ээс буцаасан values-ийг controlled талбарт сэргээх
  // (form submit → алдаа → state өөрчлөгдөн дахин render үед).
  const lastValuesRef = useRef(state?.values);
  useEffect(() => {
    if (state?.values && state.values !== lastValuesRef.current) {
      lastValuesRef.current = state.values;
      setRegisterNumber(state.values.registerNumber);
      setOrgName(state.values.orgName);
      // Сэргээгдсэн нэрийг хэрэглэгч засаагүй гэж тооцох уу гэдэг асуудал —
      // нэр сонгогдсон бол lookup-аар дарагдахгүйн тулд userEdited гэж тэмдэглэе.
      if (state.values.orgName) {
        userEditedNameRef.current = true;
      }
    }
  }, [state]);

  // Серверийн хариу алхмыг тодорхойлно: алдаатай талбар харгалзах алхамд
  // буцааж, OTP хүлээж байвал (эсвэл өөр алдаагүй) алхам 3 дээр байлгана.
  useEffect(() => {
    if (!state) return;
    const errKeys = Object.keys(state.fieldErrors ?? {});
    if (errKeys.some((k) => STEP1_FIELDS.includes(k))) setStep(1);
    else if (errKeys.some((k) => BRANCH_FIELDS.includes(k))) setStep(2);
    else if (state.awaitingOtp || errKeys.length > 0) setStep(3);
  }, [state]);

  useEffect(() => {
    const cleanRegno = normalizeRegno(registerNumber);
    if (!regnoKind(cleanRegno)) {
      setRegFound(false);
      setRegError(null);
      return;
    }
    if (lastFetchedRegnoRef.current === cleanRegno) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      lastFetchedRegnoRef.current = cleanRegno;
      setRegLoading(true);
      setRegError(null);
      setRegFound(false);
      try {
        const res = await fetch(
          `/api/ebarimt/lookup?regno=${encodeURIComponent(cleanRegno)}`,
          { signal: controller.signal },
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error ?? "Регистр шалгаж чадсангүй.");
        }
        const org = data.org as {
          found: boolean;
          name: string | null;
        } | null;
        if (org?.found && org.name) {
          setRegFound(true);
          if (!userEditedNameRef.current) {
            setOrgName(org.name);
          }
        } else {
          setRegFound(false);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setRegError(e instanceof Error ? e.message : "Алдаа гарлаа.");
        lastFetchedRegnoRef.current = null;
      } finally {
        if (!controller.signal.aborted) setRegLoading(false);
      }
    }, REGNO_FETCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [registerNumber]);

  function onLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setLogoPreview(null);
      setLogoName(null);
      return;
    }
    setLogoPreview(URL.createObjectURL(file));
    setLogoName(file.name);
  }

  /* Алхам 1 → 2: гол талбаруудыг client дээр шалгана (форм noValidate тул). */
  function goNext() {
    const f = formRef.current;
    const val = (n: string) =>
      (f?.elements.namedItem(n) as HTMLInputElement | null)?.value.trim() ?? "";
    const missing: string[] = [];
    if (!regKind) missing.push("регистр (7 орон эсвэл ҮҮ99993333)");
    if (!orgName.trim()) missing.push(isPerson ? "овог нэр" : "байгууллагын нэр");
    if (!/^\S+@\S+\.\S+$/.test(val("orgEmail"))) missing.push("имэйл");
    if (!/^\d{8}$/.test(val("phone1"))) missing.push("утас 1");
    if (missing.length) {
      setStepError(`Дараах талбарыг зөв бөглөнө үү: ${missing.join(", ")}.`);
      return;
    }
    setStepError(null);
    setPersonContact({ phone: val("phone1"), email: val("orgEmail") });
    setStep(2);
  }

  /* Алхам 2 → 3: үндсэн салбарын заавал талбарууд бөглөгдсөн эсэхийг шалгана. */
  function goToAdminStep() {
    const missing: string[] = [];
    if (!addr.city) missing.push("хот / аймаг");
    if (!addr.district) missing.push("дүүрэг / сум");
    if (!branchAddress.trim()) missing.push("дэлгэрэнгүй хаяг");
    if (missing.length) {
      setStepError(`Дараах талбарыг бөглөнө үү: ${missing.join(", ")}.`);
      return;
    }
    setStepError(null);
    setStep(3);
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-6" noValidate>
      {/* Алхамын заагч */}
      <div className="flex items-center gap-2 sm:gap-3" aria-label={`Алхам ${step}/3`}>
        <StepLabel
          num={1}
          label="Байгууллага"
          active={step === 1}
          done={step > 1}
          onClick={step > 1 && !awaitingOtp ? () => setStep(1) : undefined}
        />
        <div
          className={`h-px flex-1 ${step > 1 ? "bg-[var(--oc-accent)]/50" : "bg-[var(--oc-line)]"}`}
        />
        <StepLabel
          num={2}
          label="Салбар"
          active={step === 2}
          done={step > 2}
          onClick={step > 2 && !awaitingOtp ? () => setStep(2) : undefined}
        />
        <div
          className={`h-px flex-1 ${step > 2 ? "bg-[var(--oc-accent)]/50" : "bg-[var(--oc-line)]"}`}
        />
        <StepLabel
          num={3}
          label={isPerson ? "Нууц үг" : "Админ хэрэглэгч"}
          active={step === 3}
        />
      </div>

      {awaitingOtp && state?.message ? (
        <div className="bg-[var(--oc-accent)]/10 border border-[var(--oc-accent)]/25 rounded-[10px] px-4 py-3 text-sm text-[var(--oc-ink2)]">
          {state.message}
        </div>
      ) : (
        <FormError message={state?.message} />
      )}

      {/* --- Алхам 1: Байгууллагын мэдээлэл (алхам 2-т hidden, DOM-д хэвээр) --- */}
      <section className={step === 1 ? "flex flex-col gap-5" : "hidden"}>
        <div>
          <h2 className="font-semibold text-[var(--oc-ink)]">{isPerson ? "Хувь хүний мэдээлэл" : "Байгууллагын мэдээлэл"}</h2>
          <p className="mt-1 text-xs text-[var(--oc-muted3)]">
            carservice-д бүртгүүлэх үндсэн мэдээлэл. Байгууллага болон хувь хүн бүртгүүлж болно.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Регистрийн дугаар"
            htmlFor="registerNumber"
            hint={
              regLoading
                ? "Шалгаж байна..."
                : regFound
                  ? `Олдсон (${isPerson ? "хувь хүн" : "байгууллага"}) · нэр автоматаар бөглөгдсөн`
                  : "Байгууллага: 7 оронтой тоо · Хувь хүн: ҮҮ99993333"
            }
            error={fe.registerNumber ?? regError ?? undefined}
          >
            <div className="relative">
              <input
                id="registerNumber"
                name="registerNumber"
                type="text"
                maxLength={10}
                required
                autoComplete="off"
                value={registerNumber}
                onChange={(e) =>
                  setRegisterNumber(normalizeRegno(e.target.value))
                }
                className={`auth-input pr-9 ${
                  fe.registerNumber
                    ? "border-red-500/50"
                    : regFound
                      ? "border-[var(--oc-ok)]/40"
                      : ""
                }`}
                placeholder="1234567 эсвэл ҮҮ99993333"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                {regLoading ? (
                  <svg
                    className="w-4 h-4 animate-spin text-[var(--oc-accent)]"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8z"
                    />
                  </svg>
                ) : regFound ? (
                  <CheckIcon />
                ) : null}
              </div>
            </div>
          </Field>

          <Field
            label={isPerson ? "Овог нэр" : "Байгууллагын нэр"}
            htmlFor="orgName"
            error={fe.orgName}
          >
            <input
              id="orgName"
              name="orgName"
              type="text"
              required
              value={orgName}
              onChange={(e) => {
                userEditedNameRef.current = true;
                setOrgName(e.target.value);
              }}
              className={`auth-input ${fe.orgName ? "border-red-500/50" : ""}`}
              placeholder={isPerson ? "Жишээ: Бат Дорж" : "Жишээ: Гранд Гараж ХХК"}
            />
          </Field>

          <Field
            label={isPerson ? "Имэйл" : "Байгууллагын имэйл"}
            htmlFor="orgEmail"
            error={fe.orgEmail}
          >
            <input
              key={`orgEmail-${state?.values?.orgEmail ?? ""}`}
              id="orgEmail"
              name="orgEmail"
              type="email"
              required
              defaultValue={state?.values?.orgEmail ?? ""}
              className={`auth-input ${fe.orgEmail ? "border-red-500/50" : ""}`}
              placeholder="garage@gmail.com"
            />
          </Field>

          <div className="grid gap-5 grid-cols-2">
            <Field label="Утас 1" htmlFor="phone1" error={fe.phone1}>
              <input
                key={`phone1-${state?.values?.phone1 ?? ""}`}
                id="phone1"
                name="phone1"
                type="tel"
                inputMode="numeric"
                maxLength={8}
                pattern="[0-9]{8}"
                required
                defaultValue={state?.values?.phone1 ?? ""}
                className={`auth-input ${fe.phone1 ? "border-red-500/50" : ""}`}
                placeholder="99000000"
              />
            </Field>
            <Field
              label="Утас 2"
              htmlFor="phone2"
              hint="заавал биш"
              error={fe.phone2}
            >
              <input
                key={`phone2-${state?.values?.phone2 ?? ""}`}
                id="phone2"
                name="phone2"
                type="tel"
                inputMode="numeric"
                maxLength={8}
                pattern="[0-9]{8}"
                defaultValue={state?.values?.phone2 ?? ""}
                className="auth-input"
                placeholder="88000000"
              />
            </Field>
          </div>
        </div>

        <Field
          label="Лого"
          htmlFor="logo"
          hint="PNG, JPG, WEBP · хамгийн ихдээ 2MB · заавал биш"
          error={fe.logo}
        >
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 shrink-0 rounded-[10px] overflow-hidden flex items-center justify-center border border-[var(--oc-line)] bg-[var(--oc-panel)]">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoPreview}
                  alt="Лого preview"
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="text-[10px] text-[var(--oc-muted3)]">Урьдчилан</span>
              )}
            </div>
            <div className="min-w-0">
              {/* Native file input-ийг нууж, custom товчоор сонгуулна */}
              <input
                id="logo"
                name="logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onLogoChange}
                className="sr-only"
              />
              <label
                htmlFor="logo"
                className="inline-flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel)] hover:bg-[var(--oc-panel2)] px-4 py-2.5 text-sm font-medium text-[var(--oc-ink2)] transition-colors"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Зураг сонгох
              </label>
              <div className="mt-1.5 text-xs text-[var(--oc-muted3)] truncate">
                {logoName ?? "Файл сонгоогүй"}
              </div>
            </div>
          </div>
        </Field>

        {stepError ? (
          <p className="text-sm text-red-400 light:text-red-600">{stepError}</p>
        ) : null}

        <button
          type="button"
          onClick={goNext}
          className="mt-1 w-full bg-[var(--oc-accent)] hover:bg-[var(--oc-accent-hi)] transition-colors py-3 rounded-lg font-semibold text-sm text-[var(--oc-on-accent)]"
        >
          Үргэлжлүүлэх →
        </button>
      </section>

      {/* --- Алхам 2: Үндсэн салбар (алхам 1/3-т hidden, DOM-д хэвээр) --- */}
      <section className={step === 2 ? "flex flex-col gap-5" : "hidden"}>
        <div>
          <h2 className="font-semibold text-[var(--oc-ink)]">Үндсэн салбарын мэдээлэл</h2>
          <p className="mt-1 text-xs text-[var(--oc-muted3)]">
            Үйлчлүүлэгчид харагдах хаяг, ажиллах цаг. Дараа нь Тохиргоо
            хэсгээс нэмж салбар үүсгэж, засварлаж болно.
          </p>
        </div>

        <div className="relative z-30 grid gap-5 sm:grid-cols-3">
          <AddressSelect
            data={addressData}
            value={addr}
            onChange={setAddr}
            errors={{ city: fe.city, district: fe.district, khoroo: fe.khoroo }}
          />
        </div>

        <Field
          label="Дэлгэрэнгүй хаяг"
          htmlFor="address"
          hint="Гудамж, тоот, байрны нэр"
          error={fe.address}
        >
          <input
            id="address"
            name="address"
            type="text"
            required
            value={branchAddress}
            onChange={(e) => setBranchAddress(e.target.value)}
            className={`auth-input ${fe.address ? "border-red-500/50" : ""}`}
            placeholder="Энхтайвны өргөн чөлөө 25, AAA байр"
          />
        </Field>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowMap((v) => !v)}
            className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
          >
            📍{" "}
            {showMap
              ? "Газрын зураг нуух"
              : "Газрын зураг дээр байршил тэмдэглэх (заавал биш)"}
          </button>
          {showMap ? (
            <LocationPicker
              latitude={lat}
              longitude={lng}
              onChange={onMapPick}
              onGeocode={(parts) => {
                const resolved = resolveAddressFromGeocode(addressData, parts);
                if (resolved.city) setAddr(resolved);
              }}
              apiKey={mapApiKey}
              mapId={mapId}
            />
          ) : null}
          <input type="hidden" name="latitude" value={lat ?? ""} />
          <input type="hidden" name="longitude" value={lng ?? ""} />
        </div>

        <div className="pt-4 border-t border-[var(--oc-line)]">
          <h3 className="font-plex-mono text-[11px] font-medium text-[var(--oc-muted3)] uppercase tracking-[0.1em] mb-3">
            Ажиллах цаг
          </h3>
          <div className="grid gap-5 grid-cols-2 sm:max-w-xs">
            <Field label="Эхлэх цаг" htmlFor="openTime" error={fe.openTime}>
              <Select
                id="openTime"
                name="openTime"
                value={openTime}
                onChange={setOpenTime}
                error={fe.openTime}
                options={TIME_OPTIONS}
              />
            </Field>
            <Field label="Дуусах цаг" htmlFor="closeTime" error={fe.closeTime}>
              <Select
                id="closeTime"
                name="closeTime"
                value={closeTime}
                onChange={setCloseTime}
                error={fe.closeTime}
                options={TIME_OPTIONS}
              />
            </Field>
          </div>

          <div className="mt-4">
            <label className="text-sm font-medium text-[var(--oc-ink2)] mb-2 block">
              Ажиллах өдрүүд
            </label>
            <div className="flex flex-wrap gap-2">
              {WEEK_DAYS.map((d) => {
                const active = workDays.has(d.value);
                return (
                  <label
                    key={d.value}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-colors text-sm ${
                      active
                        ? "bg-[var(--oc-accent)]/15 text-[var(--oc-ink2)] border-[var(--oc-accent)]/40"
                        : "bg-[var(--oc-panel)] text-[var(--oc-muted)] border-[var(--oc-line)] hover:bg-[var(--oc-panel2)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="workDays"
                      value={d.value}
                      checked={active}
                      onChange={() => toggleWorkDay(d.value)}
                      className="sr-only"
                    />
                    {d.long}
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-[var(--oc-muted3)] mt-2">
              Юу ч сонгохгүй бол анхдагч Даваа–Баасан ашиглагдана.
            </p>
          </div>
        </div>

        {stepError ? (
          <p className="text-sm text-red-400 light:text-red-600">{stepError}</p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStep(1)}
            className="flex-1 bg-[var(--oc-panel)] hover:bg-[var(--oc-panel2)] border border-[var(--oc-line)] transition-colors py-3 rounded-lg font-medium text-sm text-[var(--oc-ink2)]"
          >
            ← Буцах
          </button>
          <button
            type="button"
            onClick={goToAdminStep}
            className="flex-[2] bg-[var(--oc-accent)] hover:bg-[var(--oc-accent-hi)] transition-colors py-3 rounded-lg font-semibold text-sm text-[var(--oc-on-accent)]"
          >
            Үргэлжлүүлэх →
          </button>
        </div>
      </section>

      {/* --- Алхам 3: Админ хэрэглэгч --- */}
      <section className={step === 3 ? "flex flex-col gap-5" : "hidden"}>
        <div>
          <h2 className="font-semibold text-[var(--oc-ink)]">Админ хэрэглэгч</h2>
          <p className="mt-1 text-xs text-[var(--oc-muted3)]">
            {isPerson
              ? "Таны мэдээллээр админ (OWNER) хэрэглэгч үүснэ — зөвхөн нууц үгээ тохируулна уу."
              : "Системийн анхны админ (OWNER) хэрэглэгч."}
          </p>
        </div>

        {isPerson ? (
          <PersonAdminSummary
            name={splitPersonName(orgName)}
            phone={personContact.phone || state?.values?.phone1 || ""}
            email={personContact.email || state?.values?.orgEmail || ""}
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Овог" htmlFor="lastName" error={fe.lastName}>
              <input
                key={`lastName-${state?.values?.lastName ?? ""}`}
                id="lastName"
                name="lastName"
                type="text"
                required
                defaultValue={state?.values?.lastName ?? ""}
                className={`auth-input ${fe.lastName ? "border-red-500/50" : ""}`}
                placeholder="Батын"
              />
            </Field>
            <Field label="Нэр" htmlFor="firstName" error={fe.firstName}>
              <input
                key={`firstName-${state?.values?.firstName ?? ""}`}
                id="firstName"
                name="firstName"
                type="text"
                required
                defaultValue={state?.values?.firstName ?? ""}
                className={`auth-input ${fe.firstName ? "border-red-500/50" : ""}`}
                placeholder="Болд"
              />
            </Field>
            <Field label="Утас" htmlFor="adminPhone" error={fe.adminPhone}>
              <input
                key={`adminPhone-${state?.values?.adminPhone ?? ""}`}
                id="adminPhone"
                name="adminPhone"
                type="tel"
                inputMode="numeric"
                maxLength={8}
                pattern="[0-9]{8}"
                required
                defaultValue={state?.values?.adminPhone ?? ""}
                className={`auth-input ${fe.adminPhone ? "border-red-500/50" : ""}`}
                placeholder="99000000"
              />
            </Field>
            <Field label="Имэйл" htmlFor="adminEmail" error={fe.adminEmail}>
              <input
                key={`adminEmail-${state?.values?.adminEmail ?? ""}`}
                id="adminEmail"
                name="adminEmail"
                type="email"
                required
                defaultValue={state?.values?.adminEmail ?? ""}
                className={`auth-input ${fe.adminEmail ? "border-red-500/50" : ""}`}
                placeholder="bold@gmail.com"
              />
            </Field>
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Нууц үг"
            htmlFor="password"
            hint="8+ тэмдэгт"
            error={fe.password}
          >
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`auth-input pr-14 ${fe.password ? "border-red-500/50" : ""}`}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--oc-muted3)] hover:text-[var(--oc-muted)] transition-colors text-xs"
              >
                {showPassword ? "Нуух" : "Харах"}
              </button>
            </div>
          </Field>
          <Field
            label="Нууц үг давтан"
            htmlFor="passwordConfirm"
            hint={
              passwordConfirm.length > 0 && !passwordsMatch
                ? "Таарахгүй байна"
                : undefined
            }
            error={fe.passwordConfirm}
          >
            <div className="relative">
              <input
                id="passwordConfirm"
                name="passwordConfirm"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                className={`auth-input pr-9 ${
                  fe.passwordConfirm
                    ? "border-red-500/50"
                    : passwordsMatch
                      ? "border-[var(--oc-ok)]/40"
                      : ""
                }`}
                placeholder="••••••••"
              />
              {passwordsMatch ? (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <CheckIcon />
                </div>
              ) : null}
            </div>
          </Field>
        </div>

        {awaitingOtp ? (
          <div className="flex flex-col gap-3 pt-5 border-t border-[var(--oc-line)]">
            <div>
              <h2 className="font-semibold text-[var(--oc-ink)]">Баталгаажуулалт</h2>
              <p className="mt-1 text-xs text-[var(--oc-muted3)]">
                Утсанд илгээсэн 6 оронтой кодыг доорх нүдэнд оруулна уу.
              </p>
            </div>
            <Field label="Баталгаажуулах код" htmlFor="otpCode" error={fe.otpCode}>
              <input
                id="otpCode"
                name="otpCode"
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete="one-time-code"
                required
                autoFocus
                className={`auth-input font-plex-mono tracking-[0.5em] text-center ${fe.otpCode ? "border-red-500/50" : ""}`}
                placeholder="••••••"
              />
            </Field>
            <p className="text-[11px] text-[var(--oc-muted3)]">
              Код ирээгүй юу? Кодны талбарыг хоосон үлдээгээд "Бүртгүүлэх"-ыг
              дарвал шинэ код илгээнэ.
            </p>
          </div>
        ) : null}

        <SubmitButton pending={pending}>
          {awaitingOtp ? "Бүртгэл баталгаажуулах →" : "Бүртгүүлэх →"}
        </SubmitButton>

        {!awaitingOtp ? (
          <button
            type="button"
            onClick={() => setStep(2)}
            className="text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-accent-hi)] transition-colors"
          >
            ← Салбарын мэдээлэл рүү буцах
          </button>
        ) : null}

        <p className="text-xs text-[var(--oc-muted3)] leading-relaxed">
          Бүртгүүлснээр манай{" "}
          <a className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]" href="/terms">
            Үйлчилгээний нөхцөл
          </a>{" "}
          болон{" "}
          <a className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]" href="/privacy">
            Нууцлалын бодлого
          </a>
          -г хүлээн зөвшөөрнө.
        </p>
      </section>
    </form>
  );
}

function StepLabel({
  num,
  label,
  active,
  done,
  onClick,
}: {
  num: number;
  label: string;
  active: boolean;
  done?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <span className="inline-flex items-center gap-2">
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
          active
            ? "bg-[var(--oc-accent)] text-[var(--oc-on-accent)]"
            : done
              ? "bg-[var(--oc-accent)]/20 text-[var(--oc-accent)]"
              : "bg-white/[0.06] text-[var(--oc-muted3)]"
        }`}
      >
        {done ? "✓" : num}
      </span>
      <span
        className={`text-xs font-medium ${active ? "text-[var(--oc-ink)]" : "text-[var(--oc-muted3)]"}`}
      >
        {label}
      </span>
    </span>
  );
  if (onClick && (done || !active)) {
    return (
      <button type="button" onClick={onClick} className="cursor-pointer">
        {content}
      </button>
    );
  }
  return content;
}

/* Хувь хүн: админ хэрэглэгч 1-р алхмын мэдээллээр үүснэ — зөвхөн харуулна. */
function PersonAdminSummary({
  name,
  phone,
  email,
}: {
  name: { lastName: string; firstName: string };
  phone: string;
  email: string;
}) {
  const rows: [string, string][] = [
    ["Овог", name.lastName || "—"],
    ["Нэр", name.firstName || "—"],
    ["Утас", phone || "—"],
    ["Имэйл", email || "—"],
  ];
  return (
    <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-4 py-3 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5 min-w-0">
          <dt className="text-xs text-[var(--oc-muted3)]">{k}</dt>
          <dd className="text-[var(--oc-ink)] truncate">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CheckIcon() {
  return (
    <svg
      className="w-4 h-4 text-[var(--oc-ok)]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
