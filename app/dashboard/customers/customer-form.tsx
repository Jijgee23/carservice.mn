"use client";

import { useActionState, useState } from "react";
import {
  type CustomerActionState,
  createCustomerAction,
  updateCustomerAction,
} from "@/app/_actions/customers";
import { Field, FormError } from "@/app/_components/auth-shell";
import { Btn, BtnLink } from "@/app/_components/landing-ops-ui";
import { OrgCustomerFields, type OrgCustomerValue } from "./org-customer-fields";

export const CUSTOMER_FORM_ID = "customer-form";

type Initial = {
  id?: string;
  fullName: string;
  phone: string;
  email: string | null;
  note: string | null;
  isOrganization?: boolean;
  orgRegnum?: string | null;
  orgName?: string | null;
  orgEmail?: string | null;
};

function SectionPanel({
  index,
  total,
  title,
  children,
}: {
  index: number;
  total: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-semibold text-[var(--oc-ink)]">{title}</h2>
        <span className="font-plex-mono text-[11px] text-[var(--oc-muted3)]">
          {String(index).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </div>
      {children}
    </section>
  );
}

export function CustomerForm({ initial }: { initial?: Initial }) {
  const isEdit = Boolean(initial?.id);
  const action = isEdit
    ? updateCustomerAction.bind(null, initial!.id!)
    : createCustomerAction;

  const [state, formAction, pending] = useActionState<
    CustomerActionState,
    FormData
  >(action, null);

  const [dirty, setDirty] = useState(false);
  // Controlled — action амжилтгүй болсон үед утгууд цэвэрлэгдэхгүй
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [org, setOrg] = useState<OrgCustomerValue>({
    isOrg: initial?.isOrganization ?? false,
    orgRegnum: initial?.orgRegnum ?? "",
    orgName: initial?.orgName ?? "",
    orgEmail: initial?.orgEmail ?? "",
  });
  const isOrg = org.isOrg;

  const fe = state?.fieldErrors ?? {};

  return (
    <form
      id={CUSTOMER_FORM_ID}
      action={formAction}
      onChange={() => setDirty(true)}
      className="flex flex-col gap-5"
      noValidate
    >
      <FormError message={state?.message} />

      <SectionPanel index={1} total={1} title="Харилцагчийн мэдээлэл">
        <OrgCustomerFields
          value={org}
          onChange={(patch) => setOrg((prev) => ({ ...prev, ...patch }))}
          errors={fe}
          initialRegnum={initial?.orgRegnum ?? ""}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={isOrg ? "Холбогдох хүний нэр" : "Овог нэр"} htmlFor="fullName" hint="заавал биш" error={fe.fullName}>
            <input
              id="fullName"
              name="fullName"
              type="text"
              // Хуучин урт нэртэй хэрэглэгчийн утгыг хэзээ ч таслахгүй.
              maxLength={(initial?.fullName ?? "").length > 100 ? undefined : 100}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={`auth-input ${fe.fullName ? "border-red-500/50" : ""}`}
              placeholder="Жишээ: Батын Болд"
            />
          </Field>
          <Field label="Утас" required htmlFor="phone" error={fe.phone}>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="numeric"
              maxLength={8}
              pattern="[0-9]{8}"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D+/g, ""))}
              className={`auth-input font-plex-mono ${fe.phone ? "border-red-500/50" : ""}`}
              placeholder="99000000"
            />
          </Field>
          <Field label="Имэйл" htmlFor="email" hint="заавал биш" error={fe.email}>
            <input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`auth-input ${fe.email ? "border-red-500/50" : ""}`}
              placeholder="bold@gmail.com"
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Тэмдэглэл" htmlFor="note" hint="заавал биш" error={fe.note}>
            <textarea
              id="note"
              name="note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="auth-input resize-y"
              placeholder="Үйлчлүүлэгчийн талаар тэмдэглэх зүйл..."
            />
          </Field>
        </div>
      </SectionPanel>

      {/* Sticky action bar — урт форм scroll хийхэд ч Хадгалах үргэлж харагдана */}
      <div className="sticky bottom-0 z-10 flex items-center gap-3 pt-3 pb-3 -mb-1 border-t border-[var(--oc-line2)] bg-[var(--oc-carbon)]/95 backdrop-blur-md">
        <span className="text-xs text-[var(--oc-muted3)] flex-1">
          {dirty ? "Хадгалагдаагүй өөрчлөлт байна" : ""}
        </span>
        <BtnLink href="/dashboard/customers" variant="ghost">
          Болих
        </BtnLink>
        <Btn type="submit" disabled={pending}>
          {pending ? "..." : isEdit ? "Хадгалах" : "Үүсгэх"}
        </Btn>
      </div>
    </form>
  );
}
