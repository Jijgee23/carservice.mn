"use client";

import { useActionState, useState } from "react";
import {
  type EmployeeActionState,
  createEmployeeAction,
  updateEmployeeAction,
} from "@/app/_actions/employees";
import { Field, FormError } from "@/app/_components/auth-shell";
import { DatePicker } from "@/app/_components/date-picker";
import { Btn, BtnLink } from "@/app/_components/landing-ops-ui";
import { Select } from "@/app/_components/select";

export const EMPLOYEE_FORM_ID = "employee-form";

type Initial = {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  roleId: string | null;
  branchId: string | null;
  assignableBranchIds?: string[];
  isActive: boolean;
  activeUntil: Date | null;
};

type Branch = { id: string; name: string; district?: string | null; slotCapacity?: number | null };
type Role = { id: string; name: string };

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

export function EmployeeForm({
  initial,
  branches,
  roles,
  accessInfo,
  canGrantOwner,
  hideBranches = false,
  singleBranchId = null,
}: {
  initial?: Initial;
  branches: Branch[];
  roles: Role[];
  /** Энгийн багц (ганц салбар): салбар сонгох талбарыг нууж, hidden input-аар илгээнэ. */
  hideBranches?: boolean;
  /** Нуусан үед шинэ ажилтанд оноох цорын ганц салбар. */
  singleBranchId?: string | null;
  /** Хандалтын зөвхөн-унших мэдээлэл (сүүлд нэвтэрсэн г.м) — зөвхөн засах үед. */
  accessInfo?: {
    lastSeenAt: string | null;
    createdBy: string;
  };
  /** Одоогийн нэвтэрсэн хэрэглэгч isOwner эсэх — зөвхөн тэр шинэ админ (isOwner) үүсгэж болно. */
  canGrantOwner?: boolean;
}) {
  const isEdit = Boolean(initial?.id);
  const action = isEdit
    ? updateEmployeeAction.bind(null, initial!.id!)
    : createEmployeeAction;

  const [state, formAction, pending] = useActionState<
    EmployeeActionState,
    FormData
  >(action, null);

  const [dirty, setDirty] = useState(false);
  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [lastName, setLastName] = useState(initial?.lastName ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [roleId, setRoleId] = useState(initial?.roleId ?? "");
  const [wantsOwner, setWantsOwner] = useState(false);
  const canShowOwnerToggle = Boolean(canGrantOwner) && !isEdit;
  const [branchId, setBranchId] = useState(initial?.branchId ?? "");
  const [assignableBranchIds, setAssignableBranchIds] = useState<string[]>(
    initial?.assignableBranchIds ?? [],
  );
  function toggleAssignableBranch(id: string) {
    setDirty(true);
    setAssignableBranchIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [activeUntil, setActiveUntil] = useState(
    initial?.activeUntil
      ? new Date(initial.activeUntil.getTime() - initial.activeUntil.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10)
      : "",
  );

  const fe = state?.fieldErrors ?? {};

  return (
    <form
      id={EMPLOYEE_FORM_ID}
      action={formAction}
      onChange={() => setDirty(true)}
      className="flex flex-col gap-5"
      noValidate
    >
      <FormError message={state?.message} />

      <SectionPanel index={1} total={3} title="Хувийн мэдээлэл">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Овог" htmlFor="lastName" error={fe.lastName}>
            <input
              id="lastName"
              name="lastName"
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={`auth-input ${fe.lastName ? "border-red-500/50" : ""}`}
              placeholder="Батын"
            />
          </Field>
          <Field label="Нэр" htmlFor="firstName" error={fe.firstName}>
            <input
              id="firstName"
              name="firstName"
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={`auth-input ${fe.firstName ? "border-red-500/50" : ""}`}
              placeholder="Болд"
            />
          </Field>
          <Field label="Имэйл" htmlFor="email" error={fe.email}>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`auth-input ${fe.email ? "border-red-500/50" : ""}`}
              placeholder="bold@gmail.com"
            />
          </Field>
          <Field label="Утас" htmlFor="phone" error={fe.phone}>
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
        </div>
      </SectionPanel>

      <SectionPanel index={2} total={3} title={hideBranches ? "Үүрэг" : "Үүрэг ба салбар"}>
        {canShowOwnerToggle ? (
          <label
            className={`mb-4 flex items-start gap-3 p-3.5 rounded-[10px] border cursor-pointer transition-colors ${wantsOwner
                ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/[0.08]"
                : "border-[var(--oc-line)] bg-[var(--oc-panel2)] hover:border-[var(--oc-line2)]"
              }`}
          >
            <input
              type="checkbox"
              name="isOwner"
              checked={wantsOwner}
              onChange={(e) => {
                setDirty(true);
                setWantsOwner(e.target.checked);
                if (e.target.checked) setRoleId("");
              }}
              className="mt-0.5 accent-[var(--oc-accent)]"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-[var(--oc-ink2)]">
                Админ эрхтэй болгох
              </div>
              <div className="text-xs text-[var(--oc-muted3)] mt-0.5">
                Танайтай адил бүх эрхтэй болно (тусад нь үүрэг сонгох
                шаардлагагүй). Админыг дараа нь идэвхгүй болгох, устгах, эсвэл
                үүргийг нь солихдоо сүүлийн идэвхтэй админыг үлдээх ёстой.
              </div>
            </div>
          </label>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {!wantsOwner ? (
            <Field
              label="Үүрэг"
              htmlFor="roleId"
              error={fe.roleId}
              hint={
                roles.length === 0
                  ? "Үүрэг үүсээгүй. Эхлээд үүрэг үүсгэнэ үү."
                  : undefined
              }
            >
              <Select
                id="roleId"
                name="roleId"
                required
                value={roleId}
                onChange={(v) => { setDirty(true); setRoleId(v); }}
                error={fe.roleId}
                placeholder="— Үүрэг сонгох —"
                options={roles.map((r) => ({ value: r.id, label: r.name }))}
              />
            </Field>
          ) : null}
          {hideBranches ? (
            // Энгийн багц (ганц салбар): засахад одоогийн салбарыг хадгална
            // (хоосон илгээвэл серверт null болж арилна), үүсгэхэд ганц салбарыг онооно.
            <input
              type="hidden"
              name="branchId"
              value={isEdit ? (initial?.branchId ?? "") : (singleBranchId ?? "")}
            />
          ) : (
            <Field
              label="Үндсэн салбар"
              htmlFor="branchId"
              hint="Хоосон орхивол бүх салбарт хандах эрхтэй (жишээ: ерөнхий менежер/админ) болно."
              error={fe.branchId}
            >
              <Select
                id="branchId"
                name="branchId"
                value={branchId}
                onChange={(v) => { setDirty(true); setBranchId(v); }}
                placeholder="— Салбар —"
                error={fe.branchId}
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
              />
            </Field>
          )}
          <Field
            label="Ажиллаж хугацаа дуусах огноо"
            htmlFor="activeUntil"
            hint="Түр ажилтан бол огноо. Хоосон бол байнгын."
            error={fe.activeUntil}
          >
            <DatePicker
              id="activeUntil"
              name="activeUntil"
              value={activeUntil}
              onChange={(v) => { setDirty(true); setActiveUntil(v); }}
              error={Boolean(fe.activeUntil)}
            />
          </Field>
        </div>

        {hideBranches ? (
          // Нуусан үед хадгалагдсан нэмэлт салбаруудыг хэвээр нь илгээнэ.
          assignableBranchIds.map((id) => (
            <input key={id} type="hidden" name="assignableBranchIds" value={id} />
          ))
        ) : branches.length > 1 ? (
          <div className="mt-5">
            <div className="text-sm font-medium text-[var(--oc-ink2)]">
              Нэмэлт ажиллах салбарууд
            </div>
            <p className="mt-0.5 text-xs text-[var(--oc-muted3)]">
              Үндсэн салбараас гадна энэ ажилтныг засварын хуудсанд &quot;Хариуцах
              мастер&quot;-аар сонгож болох салбарууд — олон салбарт дамжиж
              ажилладаг бол. 2 ба түүнээс дээш салбар сонговол, ажилтан
              нэвтрэх бүрдээ өнөөдөр аль салбартаа ажиллахаа сонгох болно.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {branches
                .filter((b) => b.id !== branchId)
                .map((b) => {
                  const checked = assignableBranchIds.includes(b.id);
                  return (
                    <label
                      key={b.id}
                      className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${checked
                          ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/[0.08]"
                          : "border-[var(--oc-line)] bg-[var(--oc-panel2)] hover:border-[var(--oc-line2)]"
                        }`}
                    >
                      <input
                        type="checkbox"
                        name="assignableBranchIds"
                        value={b.id}
                        checked={checked}
                        onChange={() => toggleAssignableBranch(b.id)}
                        className="accent-[var(--oc-accent)] shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--oc-ink2)] truncate">
                          {b.name}
                        </div>
                        {b.district ? (
                          <div className="text-xs text-[var(--oc-muted3)] truncate">
                            {b.district}
                            {b.slotCapacity != null ? ` · ${b.slotCapacity} талбай` : ""}
                          </div>
                        ) : null}
                      </div>
                    </label>
                  );
                })}
            </div>
          </div>
        ) : null}

        {!isEdit ? (
          <div className="mt-5 text-xs text-[var(--oc-muted2)] rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-3.5 py-3 leading-relaxed">
            Нууц үгийг та тавихгүй. Ажилтан анх удаа нэвтрэхдээ нэвтрэх
            хуудасны «Анх удаа нэвтрэх» хэсгээр имэйлээ оруулж, утсандаа ирэх
            кодоор баталгаажуулан өөрийн нууц үгээ үүсгэнэ.
          </div>
        ) : null}
      </SectionPanel>

      <SectionPanel index={3} total={3} title="Хандалт">
        <label
          className={`flex items-start gap-3 p-3.5 rounded-[10px] border cursor-pointer transition-colors ${isActive
              ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/[0.08]"
              : "border-[var(--oc-line)] bg-[var(--oc-panel2)] hover:border-[var(--oc-line2)]"
            }`}
        >
          <input
            type="checkbox"
            name="isActive"
            checked={isActive}
            onChange={(e) => { setDirty(true); setIsActive(e.target.checked); }}
            value="on"
            className="mt-0.5 accent-[var(--oc-accent)]"
          />
          <div className="flex-1">
            <div className="text-sm font-medium text-[var(--oc-ink2)]">Идэвхтэй</div>
            <div className="text-xs text-[var(--oc-muted3)] mt-0.5">
              Идэвхгүй ажилтан нэвтэрч чадахгүй. Бичлэг нь хадгалагдана.
            </div>
          </div>
        </label>
        {!isActive ? <input type="hidden" name="isActive" value="off" /> : null}

        {accessInfo ? (
          <div className="mt-4 grid gap-px overflow-hidden rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-line)] sm:grid-cols-3">
            <div className="bg-[var(--oc-panel2)] p-3.5">
              <div className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
                Сүүлд нэвтэрсэн
              </div>
              <div className="mt-1 text-sm text-[var(--oc-ink2)]">
                {accessInfo.lastSeenAt ?? "Хэзээ ч нэвтрээгүй"}
              </div>
            </div>
            <div className="bg-[var(--oc-panel2)] p-3.5">
              <div className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
                Нэвтрэх хэлбэр
              </div>
              <div className="mt-1 text-sm text-[var(--oc-ink2)]">Имэйл + нууц үг</div>
            </div>
            <div className="bg-[var(--oc-panel2)] p-3.5">
              <div className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
                Бүртгэсэн
              </div>
              <div className="mt-1 text-sm text-[var(--oc-ink2)]">{accessInfo.createdBy}</div>
            </div>
          </div>
        ) : null}
      </SectionPanel>

      {/* Sticky action bar — урт форм scroll хийхэд ч Хадгалах үргэлж харагдана */}
      <div className="sticky bottom-0 z-10 flex items-center gap-3 pt-3 pb-3 -mb-1 border-t border-[var(--oc-line2)] bg-[var(--oc-carbon)]/95 backdrop-blur-md">
        <span className="text-xs text-[var(--oc-muted3)] flex-1">
          {dirty ? "Хадгалагдаагүй өөрчлөлт байна" : ""}
        </span>
        <BtnLink href="/dashboard/employees" variant="ghost">
          Болих
        </BtnLink>
        <Btn type="submit" disabled={pending}>
          {pending ? "..." : isEdit ? "Хадгалах" : "Үүсгэх"}
        </Btn>
      </div>
    </form>
  );
}
