"use client";

import { Field } from "@/app/_components/auth-shell";
import { Select } from "@/app/_components/select";

export type CityOpt = { id: number; name: string };
export type DistrictOpt = { id: number; name: string; cityId: number | null };
export type KhorooOpt = {
  id: number;
  name: string;
  cityId: number | null;
  districtId: number | null;
};

export type AddressData = {
  cities: CityOpt[];
  districts: DistrictOpt[];
  khoroos: KhorooOpt[];
};

export type AddressValue = { city: string; district: string; khoroo: string };

// Google reverse geocoding-аас гарсан нэрийг seed-ийн нэртэй тааруулахад
// угтвар/дагавар (аймаг, дүүрэг, сум...) болон зайг хасаж жишнэ.
function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/(аймаг|дүүрэг|сум|хороо|хот|баг|province|district|aimag|city|sum)/g, "")
    .trim();
}

function matchOne<T extends { name: string }>(
  options: T[],
  candidates: (string | null | undefined)[],
): T | null {
  const norms = candidates.map(norm).filter(Boolean);
  if (norms.length === 0) return null;
  // Эхлээд яг тэнцэх, дараа нь агуулагдах байдлаар.
  for (const cand of norms) {
    const exact = options.find((o) => norm(o.name) === cand);
    if (exact) return exact;
  }
  for (const cand of norms) {
    const part = options.find((o) => {
      const n = norm(o.name);
      return n.length >= 2 && (cand.includes(n) || n.includes(cand));
    });
    if (part) return part;
  }
  return null;
}

export type GeocodeParts = {
  adminLevel1?: string;
  adminLevel2?: string;
  adminLevel3?: string;
  locality?: string;
  sublocality?: string;
  /** Google-ийн бүтэн хаяг (formatted_address) — бүртгэлд гараар бичих хаягийн оронд. */
  formatted?: string;
};

/**
 * Reverse geocoding-ийн үр дүнг seed хийсэн City/District/Khoroo-той тааруулж
 * хаягийн утга буцаана. Олдоогүй талбарыг хоосон орхино.
 */
export function resolveAddressFromGeocode(
  data: AddressData,
  parts: GeocodeParts,
): AddressValue {
  const city = matchOne(data.cities, [parts.adminLevel1, parts.locality]);
  const districtPool = city
    ? data.districts.filter((d) => d.cityId === city.id)
    : data.districts;
  const district = matchOne(districtPool, [
    parts.adminLevel2,
    parts.sublocality,
    parts.locality,
  ]);
  const khorooPool = district
    ? data.khoroos.filter((k) => k.districtId === district.id)
    : [];
  const khoroo = matchOne(khorooPool, [parts.adminLevel3, parts.sublocality]);

  return {
    city: city?.name ?? "",
    district: district?.name ?? "",
    khoroo: khoroo?.name ?? "",
  };
}

/**
 * Каскад хаягийн сонголт: Аймаг/Хот → Сум/Дүүрэг → Хороо/Баг. Controlled —
 * утгыг `value`/`onChange`-ээр удирдана. Сонгосон НЭРийг `city`/`district`/
 * `khoroo` нэртэй hidden input-аар илгээнэ (Branch-ийн string талбартай нийцнэ).
 */
export function AddressSelect({
  data,
  value,
  onChange,
  fieldClassName,
  errors,
}: {
  data: AddressData;
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  fieldClassName?: string;
  errors?: { city?: string; district?: string; khoroo?: string };
}) {
  const { city: cityName, district: districtName, khoroo: khorooName } = value;

  const city = data.cities.find((c) => c.name === cityName) ?? null;
  const district =
    data.districts.find(
      (d) => d.name === districtName && (!city || d.cityId === city.id),
    ) ?? null;
  const khoroo =
    data.khoroos.find(
      (k) => k.name === khorooName && (!district || k.districtId === district.id),
    ) ?? null;

  const districtOptions = city
    ? data.districts.filter((d) => d.cityId === city.id)
    : [];
  const khorooOptions = district
    ? data.khoroos.filter((k) => k.districtId === district.id)
    : [];

  return (
    <>
      {/* Branch action-д очих НЭР утгууд */}
      <input type="hidden" name="city" value={cityName} />
      <input type="hidden" name="district" value={districtName} />
      <input type="hidden" name="khoroo" value={khorooName} />

      <Field
        label="Хот / Аймаг"
        htmlFor="addr-city"
        className={fieldClassName}
        error={errors?.city}
      >
        <Select
          id="addr-city"
          name="_cityId"
          value={city ? String(city.id) : ""}
          placeholder="— Сонгох —"
          onChange={(idStr) => {
            const c = data.cities.find((x) => String(x.id) === idStr);
            onChange({ city: c?.name ?? "", district: "", khoroo: "" });
          }}
          options={data.cities.map((c) => ({
            value: String(c.id),
            label: c.name,
          }))}
        />
      </Field>

      <Field
        label="Дүүрэг / Сум"
        htmlFor="addr-district"
        className={fieldClassName}
        error={errors?.district}
      >
        <Select
          id="addr-district"
          name="_districtId"
          value={district ? String(district.id) : ""}
          disabled={!city}
          placeholder={city ? "— Сонгох —" : "Эхлээд хот сонгоно уу"}
          onChange={(idStr) => {
            const d = districtOptions.find((x) => String(x.id) === idStr);
            onChange({ ...value, district: d?.name ?? "", khoroo: "" });
          }}
          options={districtOptions.map((d) => ({
            value: String(d.id),
            label: d.name ?? "—",
          }))}
        />
      </Field>

      <Field
        label="Хороо / Баг"
        htmlFor="addr-khoroo"
        className={fieldClassName}
        error={errors?.khoroo}
      >
        <Select
          id="addr-khoroo"
          name="_khorooId"
          value={khoroo ? String(khoroo.id) : ""}
          disabled={!district || khorooOptions.length === 0}
          placeholder={
            !district
              ? "Эхлээд дүүрэг сонгоно уу"
              : khorooOptions.length === 0
                ? "Хороо бүртгэлгүй"
                : "— Сонгох —"
          }
          onChange={(idStr) => {
            const k = khorooOptions.find((x) => String(x.id) === idStr);
            onChange({ ...value, khoroo: k?.name ?? "" });
          }}
          options={khorooOptions.map((k) => ({
            value: String(k.id),
            label: k.name ?? "—",
          }))}
        />
      </Field>
    </>
  );
}
