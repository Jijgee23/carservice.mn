"use client";

import { Field } from "@/app/_components/auth-shell";
import { Select } from "@/app/_components/select";
import type { AddressData, AddressValue } from "@/lib/address-match";

// Төрлүүд ба geocode тааруулалт lib/address-match.ts-д (мобайл бүртгэлийн
// API сервер дээр мөн ашигладаг) — хуучин импортууд эндээс хэвээр ажиллана.
export type {
  AddressData,
  AddressValue,
  CityOpt,
  DistrictOpt,
  GeocodeParts,
  KhorooOpt,
} from "@/lib/address-match";
export { resolveAddressFromGeocode } from "@/lib/address-match";

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
