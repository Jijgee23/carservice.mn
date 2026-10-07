"use client";

import { useEffect, useRef, useState } from "react";
import { lookupOrgNameAction } from "@/app/_actions/customers";
import { Field } from "@/app/_components/auth-shell";
import { shouldAutofillOrgName } from "@/lib/customers/org-autofill";

export type OrgCustomerValue = {
  isOrg: boolean;
  orgRegnum: string;
  orgName: string;
  orgEmail: string;
};

/**
 * "Байгууллага" checkbox + регистр/нэр/имэйл талбарууд. Бүтэн маягт
 * (customer-form.tsx) болон түргэн modal (create-customer-modal.tsx) хоёулаа
 * ашиглана. Input-ууд `name`-тэй тул FormData-р ч, controlled state-ээр ч
 * илгээж болно. 7 оронтой регистр бөглөгдөхөд eBarimt-аас нэрийг debounce-тэй
 * татна; амжилтгүй бол хадгалахыг блоклохгүй, гараар бичсэн нэрийг дарахгүй.
 */
export function OrgCustomerFields({
  idPrefix = "",
  value,
  onChange,
  errors,
  initialRegnum = "",
  gridClassName = "mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
}: {
  idPrefix?: string;
  value: OrgCustomerValue;
  onChange: (patch: Partial<OrgCustomerValue>) => void;
  errors: Record<string, string | undefined>;
  initialRegnum?: string;
  gridClassName?: string;
}) {
  const { isOrg, orgRegnum, orgName, orgEmail } = value;
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const savedRegnum = useRef(initialRegnum);
  const lastAutofill = useRef<string | null>(null);
  const orgNameRef = useRef(orgName);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    orgNameRef.current = orgName;
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!isOrg || !/^\d{7}$/.test(orgRegnum)) return;
    // Хадгалагдсан регистр өөрчлөгдөөгүй бол хадгалсан нэрийг дарахгүй.
    if (orgRegnum === savedRegnum.current) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await lookupOrgNameAction(orgRegnum);
        if (cancelled) return;
        if (r.ok) {
          if (shouldAutofillOrgName(orgNameRef.current, lastAutofill.current)) {
            lastAutofill.current = r.name;
            onChangeRef.current({ orgName: r.name });
          }
          setLookupNote(null);
        } else if (r.code === "ORG_NOT_FOUND") {
          setLookupNote("Регистрээр олдсонгүй - нэрийг гараар оруулна уу.");
        } else {
          setLookupNote("Автоматаар татаж чадсангүй - нэрийг гараар оруулна уу.");
        }
      } catch {
        if (!cancelled) setLookupNote("Автоматаар татаж чадсангүй - нэрийг гараар оруулна уу.");
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isOrg, orgRegnum]);

  const id = (name: string) => `${idPrefix}${name}`;

  return (
    <>
      <label className="mb-4 flex items-center gap-2 text-sm text-[var(--oc-ink)]">
        <input
          type="checkbox"
          name="isOrganization"
          checked={isOrg}
          onChange={(e) => onChange({ isOrg: e.target.checked })}
        />
        Байгууллага
      </label>
      {isOrg ? (
        <div className={gridClassName}>
          <Field label="Регистрийн дугаар" required htmlFor={id("orgRegnum")} error={errors.orgRegnum}>
            <input
              id={id("orgRegnum")}
              name="orgRegnum"
              type="text"
              inputMode="numeric"
              maxLength={7}
              value={orgRegnum}
              onChange={(e) => onChange({ orgRegnum: e.target.value.replace(/\D+/g, "") })}
              className={`auth-input font-plex-mono ${errors.orgRegnum ? "border-red-500/50" : ""}`}
              placeholder="1234567"
            />
          </Field>
          <Field
            label="Байгууллагын нэр"
            required
            htmlFor={id("orgName")}
            hint={/^\d{7}$/.test(orgRegnum) ? (lookupNote ?? undefined) : undefined}
            error={errors.orgName}
          >
            <input
              id={id("orgName")}
              name="orgName"
              type="text"
              maxLength={200}
              value={orgName}
              onChange={(e) => onChange({ orgName: e.target.value })}
              className={`auth-input ${errors.orgName ? "border-red-500/50" : ""}`}
            />
          </Field>
          <Field label="Байгууллагын имэйл" htmlFor={id("orgEmail")} hint="заавал биш" error={errors.orgEmail}>
            <input
              id={id("orgEmail")}
              name="orgEmail"
              type="email"
              value={orgEmail}
              onChange={(e) => onChange({ orgEmail: e.target.value })}
              className={`auth-input ${errors.orgEmail ? "border-red-500/50" : ""}`}
            />
          </Field>
        </div>
      ) : null}
    </>
  );
}
