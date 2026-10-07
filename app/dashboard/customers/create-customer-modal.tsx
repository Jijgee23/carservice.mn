"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { quickCreateCustomerAction } from "@/app/_actions/quick-create";
import { Field, FormError } from "@/app/_components/auth-shell";
import { Btn, PlusIcon } from "@/app/_components/landing-ops-ui";
import { Modal } from "@/app/_components/modal";
import { OrgCustomerFields, type OrgCustomerValue } from "./org-customer-fields";

export type CreatedCustomer = {
  id: string;
  fullName: string;
  phone: string;
  isOrganization?: boolean;
  orgName?: string | null;
  orgRegnum?: string | null;
};

/**
 * Жагсаалтын хуудсанд шинэ хуудас руу шилжихгүйгээр үйлчлүүлэгч үүсгэх —
 * non-redirecting quickCreateCustomerAction ашиглана (createCustomerAction нь
 * амжилттай бол redirect хийдэг тул modal-д тохирохгүй). order-form.tsx,
 * appointment-form.tsx зэрэг бусад маягтад ч энэ modal-ыг адилхан ашиглана
 * (харах: CreateCustomerModal).
 */
export function CreateCustomerButton({ label }: { label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Btn type="button" onClick={() => setOpen(true)}>
        <PlusIcon />
        {label}
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="Шинэ үйлчлүүлэгч">
        <CreateCustomerForm
          onCreated={() => {
            router.refresh();
            setOpen(false);
          }}
        />
      </Modal>
    </>
  );
}

/**
 * Өөр modal-ийн дотор (жишээ нь машин бүртгэх modal дахь "Эзэмшигч бүртгэх")
 * shell-гүйгээр ашиглах хувилбар — өөрийн trigger товчгүй, зөвхөн Modal +
 * form-ийг өгсөн `open`/`onClose`-оор удирдана.
 */
export function CreateCustomerModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (customer: CreatedCustomer) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Шинэ үйлчлүүлэгч">
      <CreateCustomerForm onCreated={onCreated} />
    </Modal>
  );
}

export function CreateCustomerForm({
  onCreated,
}: {
  onCreated: (customer: CreatedCustomer) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [org, setOrg] = useState<OrgCustomerValue>({ isOrg: false, orgRegnum: "", orgName: "", orgEmail: "" });
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // `Modal`-ийн portal-аар document.body-руу гардаг ч React-ийн synthetic
    // event нь DOM биш REACT-ийн мод дагаж bubble хийдэг тул (жишээ нь энэ
    // form машин бүртгэх modal доторх form-ийн React-хүү болж орсон бол)
    // энд зогсоохгүй бол эцэг form-ыг ч мөн дуудчих эрсдэлтэй.
    e.stopPropagation();
    setPending(true);
    setMessage(null);
    setFieldErrors({});
    try {
      const res = await quickCreateCustomerAction({
        fullName,
        phone,
        email: email || null,
        note: note || null,
        isOrganization: org.isOrg,
        orgRegnum: org.isOrg ? org.orgRegnum : null,
        orgName: org.isOrg ? org.orgName : null,
        orgEmail: org.isOrg && org.orgEmail ? org.orgEmail : null,
      });
      if (res.ok && res.customer) {
        onCreated(res.customer);
        return;
      }
      setFieldErrors(res.fieldErrors ?? {});
      setMessage(res.message ?? null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Алдаа гарлаа.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormError message={message ?? undefined} />

      <div>
        <OrgCustomerFields
          idPrefix="cc-"
          value={org}
          onChange={(patch) => setOrg((prev) => ({ ...prev, ...patch }))}
          errors={fieldErrors}
          gridClassName="grid gap-4 sm:grid-cols-2"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={org.isOrg ? "Холбогдох хүний нэр" : "Овог нэр"} htmlFor="cc-fullName" hint="заавал биш" error={fieldErrors.fullName}>
          <input
            id="cc-fullName"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={`auth-input ${fieldErrors.fullName ? "border-red-500/50" : ""}`}
            placeholder="Жишээ: Батын Болд"
          />
        </Field>
        <Field label="Утас" htmlFor="cc-phone" error={fieldErrors.phone}>
          <input
            id="cc-phone"
            type="tel"
            inputMode="numeric"
            maxLength={8}
            pattern="[0-9]{8}"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D+/g, ""))}
            className={`auth-input font-plex-mono ${fieldErrors.phone ? "border-red-500/50" : ""}`}
            placeholder="99000000"
          />
        </Field>
      </div>

      <Field label="Имэйл" htmlFor="cc-email" hint="заавал биш" error={fieldErrors.email}>
        <input
          id="cc-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`auth-input ${fieldErrors.email ? "border-red-500/50" : ""}`}
          placeholder="bold@gmail.com"
        />
      </Field>

      <Field label="Тэмдэглэл" htmlFor="cc-note" hint="заавал биш">
        <textarea
          id="cc-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="auth-input resize-y"
          placeholder="Үйлчлүүлэгчийн талаар тэмдэглэх зүйл..."
        />
      </Field>

      <div className="flex justify-end">
        <Btn type="submit" disabled={pending}>
          {pending ? "Үүсгэж..." : "Үүсгэх"}
        </Btn>
      </div>
    </form>
  );
}
