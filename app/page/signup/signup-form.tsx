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
import {
  type AddressData,
  type AddressValue,
  resolveAddressFromGeocode,
} from "@/app/dashboard/branches/address-select";
import { normalizeRegno, regnoKind } from "@/lib/tenant-regno";

const REGNO_FETCH_DEBOUNCE_MS = 400;

// Google Maps нь window-д шууд хандах учир SSR хийгдэхгүйгээр lazy load
const LocationPicker = dynamic(
  () =>
    import("@/app/dashboard/branches/location-picker").then(
      (m) => m.LocationPicker,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 w-full rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] flex items-center justify-center text-sm text-[var(--oc-muted3)]">
        Газрын зураг ачаалж байна...
      </div>
    ),
  },
);

/* Серверээс ирсэн талбарын алдааг алхамд нь буцаахад ашиглана. */
const STEP1_FIELDS = [
  "registerNumber",
  "orgName",
  "orgEmail",
  "phone1",
  "ownerName",
  "password",
  "passwordConfirm",
];

const EMPTY_ADDR: AddressValue = { city: "", district: "", khoroo: "" };

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
  const [showPassword, setShowPassword] = useState(false);
  const awaitingOtp = Boolean(state?.awaitingOtp);

  /* 2 алхамт форм: 1) Мэдээлэл (байгууллага/хувь хүн + нэвтрэх) 2) Байршил +
     баталгаажуулалт. 1-р алхмын талбарууд 2-т DOM-д хэвээр (hidden) байдаг тул
     submit үед бүгд хамт илгээгдэнэ. Лого, 2-р утас, ажлын цагийг бүртгэлд
     асуухгүй — Тохиргооноос дараа нь засна. */
  const [step, setStep] = useState<1 | 2>(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // --- Алхам 2: Байршил (заавал) — хаягийг цэгийн reverse geocode-оос авна ---
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [addr, setAddr] = useState<AddressValue>(EMPTY_ADDR);
  const [formattedAddress, setFormattedAddress] = useState("");

  function onMapPick(coords: { lat: number; lng: number } | null) {
    // Шинэ цэгийн хаяг geocode-оор дахин ирнэ — хуучныг үлдээхгүй.
    setAddr(EMPTY_ADDR);
    setFormattedAddress("");
    if (!coords) {
      setLat(null);
      setLng(null);
      return;
    }
    setStepError(null);
    setLat(Number(coords.lat.toFixed(6)));
    setLng(Number(coords.lng.toFixed(6)));
  }

  // Нууц үгийг controlled — render-бүрт state-д хадгалагдана. Server-руу values
  // дотор буцаахгүй (аюулгүй байдлын үүднээс), client дотроо л хадгална.
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const passwordsMatch =
    password.length >= 8 && password === passwordConfirm;

  // Регистр / Засварын нэр — controlled (lookup-аар бөглөж болохын тулд)
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
      // Сэргээгдсэн нэрийг lookup-аар дарагдахгүйн тулд userEdited гэж тэмдэглэнэ.
      if (state.values.orgName) {
        userEditedNameRef.current = true;
      }
    }
  }, [state]);

  // Серверийн хариу алхмыг тодорхойлно: 1-р алхмын талбарт алдаа байвал тийш
  // буцааж, бусад үед (байршил, OTP) алхам 2 дээр байлгана.
  useEffect(() => {
    if (!state) return;
    const errKeys = Object.keys(state.fieldErrors ?? {});
    if (errKeys.some((k) => STEP1_FIELDS.includes(k))) setStep(1);
    else if (state.awaitingOtp || errKeys.length > 0) setStep(2);
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

  /* Алхам 1 → 2: талбаруудыг client дээр шалгана (форм noValidate тул). */
  function goNext() {
    const f = formRef.current;
    const val = (n: string) =>
      (f?.elements.namedItem(n) as HTMLInputElement | null)?.value.trim() ?? "";
    const missing: string[] = [];
    if (!regKind) missing.push("регистр (7 орон эсвэл ҮҮ99993333)");
    if (!orgName.trim()) missing.push(isPerson ? "овог нэр" : "засварын нэр");
    const email = val("orgEmail");
    if (email && !/^\S+@\S+\.\S+$/.test(email)) missing.push("имэйл (буруу хэлбэр)");
    if (!/^\d{8}$/.test(val("phone1"))) missing.push("утас (8 орон)");
    if (!isPerson) {
      if (!val("ownerName")) missing.push("эзний овог нэр");
    }
    if (password.length < 8) missing.push("нууц үг (8+ тэмдэгт)");
    else if (password !== passwordConfirm) missing.push("нууц үг давтан (таарахгүй байна)");
    if (missing.length) {
      setStepError(`Дараах талбарыг зөв бөглөнө үү: ${missing.join(", ")}.`);
      return;
    }
    setStepError(null);
    setStep(2);
  }

  /* Enter дарахад: 1-р алхамд дараагийн алхам руу, 2-р алхамд байршилгүй бол
     илгээхгүй. */
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (step === 1) {
      e.preventDefault();
      goNext();
      return;
    }
    if (lat == null || lng == null) {
      e.preventDefault();
      setStepError("Газрын зураг дээр байршлаа тэмдэглэнэ үү.");
    }
  }

  const locationError = stepError ?? fe.latitude ?? fe.longitude;

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={onSubmit}
      // Талбар засахад хуучин алхмын алдааг арилгана.
      onChange={() => stepError && setStepError(null)}
      className="flex flex-col gap-6"
      noValidate
    >
      {/* Алхамын заагч */}
      <div className="flex items-center gap-2 sm:gap-3" aria-label={`Алхам ${step}/2`}>
        <StepLabel
          num={1}
          label="Мэдээлэл"
          active={step === 1}
          done={step > 1}
          onClick={step > 1 && !awaitingOtp ? () => setStep(1) : undefined}
        />
        <div
          className={`h-px flex-1 ${step > 1 ? "bg-[var(--oc-accent)]/50" : "bg-[var(--oc-line)]"}`}
        />
        <StepLabel num={2} label="Байршил" active={step === 2} />
      </div>

      {awaitingOtp && state?.message ? (
        <div className="bg-[var(--oc-accent)]/10 border border-[var(--oc-accent)]/25 rounded-[10px] px-4 py-3 text-sm text-[var(--oc-ink2)]">
          {state.message}
        </div>
      ) : (
        <FormError message={state?.message} />
      )}

      {/* --- Алхам 1: Мэдээлэл (алхам 2-т hidden, DOM-д хэвээр) --- */}
      <section className={step === 1 ? "flex flex-col gap-5" : "hidden"}>
        <div>
          <h2 className="font-semibold text-[var(--oc-ink)]">{isPerson ? "Хувь хүний мэдээлэл" : "Байгууллагын мэдээлэл"}</h2>
          <p className="mt-1 text-xs text-[var(--oc-muted3)]">
            Байгууллага болон хувь хүн бүртгүүлж болно. Утасны дугаараараа (имэйл оруулбал имэйлээр ч) нэвтэрнэ.
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
            label={isPerson ? "Овог нэр" : "Засварын нэр"}
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

          {!isPerson ? (
            <Field
              label="Эзний овог нэр"
              htmlFor="ownerName"
              error={fe.ownerName}
              className="sm:col-span-2"
            >
              <input
                key={`ownerName-${state?.values?.ownerName ?? ""}`}
                id="ownerName"
                name="ownerName"
                type="text"
                required
                autoComplete="name"
                defaultValue={state?.values?.ownerName ?? ""}
                className={`auth-input ${fe.ownerName ? "border-red-500/50" : ""}`}
                placeholder="Жишээ: Батын Болд"
              />
            </Field>
          ) : null}

          <Field label="Имэйл" htmlFor="orgEmail" hint="Заавал биш" error={fe.orgEmail}>
            <input
              key={`orgEmail-${state?.values?.orgEmail ?? ""}`}
              id="orgEmail"
              name="orgEmail"
              type="email"
              autoComplete="email"
              defaultValue={state?.values?.orgEmail ?? ""}
              className={`auth-input ${fe.orgEmail ? "border-red-500/50" : ""}`}
              placeholder="garage@gmail.com"
            />
          </Field>

          <Field
            label="Утас"
            htmlFor="phone1"
            hint="Баталгаажуулах код энэ дугаарт ирнэ"
            error={fe.phone1}
          >
            <input
              key={`phone1-${state?.values?.phone1 ?? ""}`}
              id="phone1"
              name="phone1"
              type="tel"
              inputMode="numeric"
              maxLength={8}
              pattern="[0-9]{8}"
              required
              autoComplete="tel"
              defaultValue={state?.values?.phone1 ?? ""}
              className={`auth-input ${fe.phone1 ? "border-red-500/50" : ""}`}
              placeholder="99000000"
            />
          </Field>

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

        {step === 1 && stepError ? (
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

      {/* --- Алхам 2: Байршил + баталгаажуулалт --- */}
      <section className={step === 2 ? "flex flex-col gap-5" : "hidden"}>
        <div>
          <h2 className="font-semibold text-[var(--oc-ink)]">Байршил</h2>
          <p className="mt-1 text-xs text-[var(--oc-muted3)]">
            {isPerson ? "Үйлчилгээ үзүүлэх байршлаа" : "Засварын газраа"} газрын
            зураг дээр товшиж тэмдэглэнэ үү. Үйлчлүүлэгчид эндээс таныг олно.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          {step === 2 ? (
            <LocationPicker
              latitude={lat}
              longitude={lng}
              onChange={onMapPick}
              onGeocode={(parts) => {
                setAddr(resolveAddressFromGeocode(addressData, parts));
                setFormattedAddress(parts.formatted ?? "");
              }}
              apiKey={mapApiKey}
              mapId={mapId}
            />
          ) : null}
          <input type="hidden" name="latitude" value={lat ?? ""} />
          <input type="hidden" name="longitude" value={lng ?? ""} />
          <input type="hidden" name="city" value={addr.city} />
          <input type="hidden" name="district" value={addr.district} />
          <input type="hidden" name="khoroo" value={addr.khoroo} />
          <input type="hidden" name="address" value={formattedAddress} />
          {locationError ? (
            <p className="text-sm text-red-400 light:text-red-600">{locationError}</p>
          ) : lat != null && (formattedAddress || addr.city) ? (
            <p className="text-xs text-[var(--oc-muted3)]">
              <span className="text-[var(--oc-ok)]">✓</span>{" "}
              {formattedAddress ||
                [addr.city, addr.district, addr.khoroo].filter(Boolean).join(", ")}
            </p>
          ) : null}
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
            onClick={() => setStep(1)}
            className="text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-accent-hi)] transition-colors"
          >
            ← Мэдээлэл рүү буцах
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
          -г хүлээн зөвшөөрнө. Лого, ажлын цаг зэргийг дараа нь Тохиргооноос
          оруулна.
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
