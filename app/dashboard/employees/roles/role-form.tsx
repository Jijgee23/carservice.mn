"use client";

import { useActionState, useMemo, useState } from "react";
import {
  type RoleActionState,
  createRoleAction,
  updateRoleAction,
} from "@/app/_actions/roles";
import { Field, FormError } from "@/app/_components/auth-shell";
import { Btn, BtnLink } from "@/app/_components/landing-ops-ui";
import type { OrderAccessScope } from "@/lib/auth/order-access";

export const ROLE_FORM_ID = "role-form";

type ResourceRow = {
  key: string;
  label: string;
  group: string;
};

type ActionCol = {
  key: string;
  label: string;
};

type StandaloneItem = {
  code: string;
  label: string;
  description: string;
};

type Initial = {
  id?: string;
  name: string;
  description: string | null;
  permissions: string[];
  isActive: boolean;
};

function SectionPanel({
  index,
  total,
  title,
  description,
  children,
}: {
  index: number;
  total: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="font-semibold text-[var(--oc-ink)]">{title}</h2>
          {description ? (
            <p className="text-xs text-[var(--oc-muted3)] mt-0.5">{description}</p>
          ) : null}
        </div>
        <span className="font-plex-mono text-[11px] text-[var(--oc-muted3)] shrink-0">
          {String(index).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </div>
      {children}
    </section>
  );
}

export function RoleForm({
  initial,
  resources: allResources,
  actions,
  standalonePermissions,
  hideBranches = false,
}: {
  initial?: Initial;
  resources: ResourceRow[];
  actions: ActionCol[];
  standalonePermissions: StandaloneItem[];
  /** Энгийн багц (ганц салбар): «Салбар» нөөцийн мөрийг нууна. */
  hideBranches?: boolean;
}) {
  // Нуусан мөрийн хадгалагдсан эрх (branches.*) `selected`-д хэвээр үлдэж,
  // hidden input-аар илгээгдэнэ — багана/бүгд сонгох товч түүнд хүрэхгүй.
  const resources = useMemo(
    () => (hideBranches ? allResources.filter((r) => r.key !== "branches") : allResources),
    [allResources, hideBranches],
  );
  const isEdit = Boolean(initial?.id);
  const action = isEdit
    ? updateRoleAction.bind(null, initial!.id!)
    : createRoleAction;

  const [state, formAction, pending] = useActionState<RoleActionState, FormData>(
    action,
    null,
  );

  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initial?.permissions ?? []),
  );
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  function toggle(code: string) {
    setDirty(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleResourceRow(resourceKey: string, allOn: boolean) {
    setDirty(true);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const a of actions.filter((a) => resourceKey !== "orders" || a.key === "create" || a.key === "delete")) {
        const code = `${resourceKey}.${a.key}`;
        if (allOn) next.delete(code);
        else next.add(code);
      }
      return next;
    });
  }

  function toggleActionColumn(actionKey: string, allOn: boolean) {
    setDirty(true);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of resources) {
        if (r.key === "orders" && (actionKey === "view" || actionKey === "edit")) continue;
        const code = `${r.key}.${actionKey}`;
        if (allOn) next.delete(code);
        else next.add(code);
      }
      return next;
    });
  }

  function toggleAllCrud(allOn: boolean) {
    setDirty(true);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of resources) {
        for (const a of actions) {
          if (r.key === "orders" && (a.key === "view" || a.key === "edit")) continue;
          const code = `${r.key}.${a.key}`;
          if (allOn) next.delete(code);
          else next.add(code);
        }
      }
      return next;
    });
  }

  function setOrderScope(kind: "view" | "edit", scope: OrderAccessScope) {
    setDirty(true);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const code of kind === "view"
        ? ["orders.view", "orders.viewOwn"]
        : ["orders.edit", "orders.editOwn"]) next.delete(code);
      if (scope !== "none") {
        next.add(`orders.${kind}${scope === "own" ? "Own" : ""}`);
      }
      return next;
    });
  }

  function selectedOrderScope(kind: "view" | "edit"): OrderAccessScope {
    if (selected.has(`orders.${kind}`)) return "branch";
    if (selected.has(`orders.${kind}Own`)) return "own";
    return "none";
  }

  // Group resources by their group label (Удирдлага / Үндсэн / ...)
  const grouped = useMemo(() => {
    const map = new Map<string, ResourceRow[]>();
    for (const r of resources) {
      const arr = map.get(r.group) ?? [];
      arr.push(r);
      map.set(r.group, arr);
    }
    return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
  }, [resources]);

  const fe = state?.fieldErrors ?? {};

  // Statistics for action-column toggle indicators
  const columnSelectedCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of actions) {
      counts[a.key] = resources.reduce(
        (acc, r) => acc + (selected.has(`${r.key}.${a.key}`) ? 1 : 0),
        0,
      );
    }
    return counts;
  }, [selected, resources, actions]);

  const totalCrud = resources.length * actions.length;
  const totalCrudSelected = useMemo(() => {
    let c = 0;
    for (const r of resources) {
      for (const a of actions) {
        if (selected.has(`${r.key}.${a.key}`)) c++;
      }
    }
    return c;
  }, [selected, resources, actions]);
  const allCrudOn = totalCrudSelected === totalCrud;

  return (
    <form
      id={ROLE_FORM_ID}
      action={formAction}
      onChange={() => setDirty(true)}
      className="flex flex-col gap-5"
      noValidate
    >
      <FormError message={state?.message} />

      {/* Submit-ийн үед selected төлөв-ийг hidden input-аар илгээнэ */}
      {Array.from(selected).map((code) => (
        <input key={code} type="hidden" name="permissions" value={code} />
      ))}

      <SectionPanel index={1} total={2} title="Үндсэн мэдээлэл">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Үүргийн нэр" htmlFor="name" error={fe.name}>
            <input
              id="name"
              name="name"
              type="text"
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`auth-input ${fe.name ? "border-red-500/50" : ""}`}
              placeholder="ж: Менежер, Кассчин, Засварчин"
            />
          </Field>
          <Field
            label="Тайлбар"
            htmlFor="description"
            hint="Энэ үүрэг юу хийдгийг богино тайлбарлана уу."
          >
            <input
              id="description"
              name="description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="auth-input"
              placeholder="Хоосон үлдэж болно"
            />
          </Field>
        </div>

        <label
          className={`mt-4 flex items-start gap-3 p-3.5 rounded-[10px] border cursor-pointer transition-colors max-w-md ${
            isActive
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
              Идэвхгүй үүргийг шинэ ажилтанд сонгох боломжгүй.
            </div>
          </div>
        </label>
        {!isActive ? <input type="hidden" name="isActive" value="off" /> : null}
      </SectionPanel>

      <SectionPanel
        index={2}
        total={2}
        title="Эрхийн тохиргоо"
        description="Нөөц бүрд харах, үүсгэх, засах, устгах эрхийг тус тусдаа сонгоно."
      >
        {fe.permissions ? (
          <p className="text-red-400 light:text-red-600 text-xs mb-3">{fe.permissions}</p>
        ) : null}
        {fe.orderScopes ? (
          <p className="text-red-400 light:text-red-600 text-xs mb-3">{fe.orderScopes}</p>
        ) : null}

        <div className="mb-4 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel2)] p-4">
          <div className="font-medium text-sm text-[var(--oc-ink2)] mb-1">Засварын хуудасны хандалт</div>
          <p className="text-xs text-[var(--oc-muted3)] mb-3">Харах болон засах хүрээг тусад нь сонгоно. Засах хүрээ харах хүрээнээс хэтрэхгүй.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["view", "edit"] as const).map((kind) => (
              <fieldset key={kind} className="rounded-lg border border-[var(--oc-line)] p-3">
                <legend className="px-1 text-xs font-medium text-[var(--oc-ink2)]">{kind === "view" ? "Харах" : "Засах"}</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(["none", "own", "branch"] as const).map((scope) => {
                    const checked = selectedOrderScope(kind) === scope;
                    return <label key={scope} className={`cursor-pointer rounded-md border px-2.5 py-1.5 text-xs ${checked ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/[0.08] text-[var(--oc-accent)]" : "border-[var(--oc-line)] text-[var(--oc-muted2)]"}`}>
                      <input type="radio" name={`order-${kind}-scope`} checked={checked} onChange={() => setOrderScope(kind, scope)} className="sr-only" />
                      {scope === "none" ? "Эрхгүй" : scope === "own" ? "Өөрийн" : hideBranches ? "Бүгд" : "Салбар"}
                    </label>;
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </div>

        {/* CRUD matrix */}
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel2)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-[var(--oc-line)]">
                  <th className="text-left font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-4 py-2.5">
                    Нөөц
                  </th>
                  {actions.map((a) => {
                    const count = columnSelectedCount[a.key] ?? 0;
                    const allOn = count === resources.length;
                    return (
                      <th
                        key={a.key}
                        className="text-center text-xs font-medium px-3 py-2.5"
                      >
                        <button
                          type="button"
                          onClick={() => toggleActionColumn(a.key, allOn)}
                          className={`inline-flex flex-col items-center gap-0.5 transition-colors ${
                            allOn
                              ? "text-[var(--oc-accent)]"
                              : "text-[var(--oc-muted2)] hover:text-[var(--oc-ink2)]"
                          }`}
                          title={
                            allOn
                              ? `Бүх "${a.label}" эрхийг хасах`
                              : `Бүх нөөцөд "${a.label}" эрх олгох`
                          }
                        >
                          <span>{a.label}</span>
                          <span className="font-plex-mono text-[10px] text-[var(--oc-muted3)]">
                            {count}/{resources.length}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                  <th className="text-center text-xs text-[var(--oc-muted3)] font-medium px-3 py-2.5 w-24">
                    <button
                      type="button"
                      onClick={() => toggleAllCrud(allCrudOn)}
                      className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
                      title={allCrudOn ? "Бүгдийг хасах" : "Бүгдийг сонгох"}
                    >
                      {allCrudOn ? "Бүгдийг хасах" : "Бүгдийг сонгох"}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g) => (
                  <RowGroup
                    key={g.group}
                    group={g.group}
                    resources={g.items}
                    actions={actions}
                    selected={selected}
                    onToggle={toggle}
                    onToggleRow={toggleResourceRow}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Standalone permissions */}
        {standalonePermissions.length > 0 ? (
          <div className="mt-4 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel2)] p-4">
            <div className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)] font-medium mb-3">
              Тусгай эрхүүд
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {standalonePermissions.map((p) => {
                const checked = selected.has(p.code);
                return (
                  <label
                    key={p.code}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      checked
                        ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/[0.08]"
                        : "border-[var(--oc-line)] bg-[var(--oc-panel)] hover:border-[var(--oc-line2)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p.code)}
                      className="mt-0.5 accent-[var(--oc-accent)]"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--oc-ink2)]">
                        {p.label}
                      </div>
                      <div className="text-xs text-[var(--oc-muted3)] mt-0.5">
                        {p.description}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}
      </SectionPanel>

      {/* Sticky action bar — урт форм scroll хийхэд ч Хадгалах үргэлж харагдана */}
      <div className="sticky bottom-0 z-10 flex items-center gap-3 pt-3 pb-3 -mb-1 border-t border-[var(--oc-line2)] bg-[var(--oc-carbon)]/95 backdrop-blur-md">
        <span className="text-xs text-[var(--oc-muted3)] flex-1">
          {dirty ? "Хадгалагдаагүй өөрчлөлт байна" : ""}
        </span>
        <BtnLink href="/dashboard/employees/roles" variant="ghost">
          Болих
        </BtnLink>
        <Btn type="submit" disabled={pending}>
          {pending ? "..." : isEdit ? "Хадгалах" : "Үүсгэх"}
        </Btn>
      </div>
    </form>
  );
}

function RowGroup({
  group,
  resources,
  actions,
  selected,
  onToggle,
  onToggleRow,
}: {
  group: string;
  resources: ResourceRow[];
  actions: ActionCol[];
  selected: Set<string>;
  onToggle: (code: string) => void;
  onToggleRow: (resourceKey: string, allOn: boolean) => void;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={actions.length + 2}
          className="px-4 pt-3 pb-1 font-plex-mono text-[10px] uppercase tracking-[0.08em] text-[var(--oc-muted4)] font-medium border-t border-[var(--oc-line)]"
        >
          {group}
        </td>
      </tr>
      {resources.map((r) => {
        const rowActions = r.key === "orders"
          ? actions.filter((a) => a.key === "create" || a.key === "delete")
          : actions;
        const rowCount = rowActions.reduce(
          (acc, a) => acc + (selected.has(`${r.key}.${a.key}`) ? 1 : 0),
          0,
        );
        const allOn = rowCount === rowActions.length;
        return (
          <tr
            key={r.key}
            className="border-t border-[var(--oc-line)] hover:bg-white/[0.02]"
          >
            <td className="px-4 py-2.5">
              <span className="text-sm text-[var(--oc-ink2)]">{r.label}</span>
            </td>
            {actions.map((a) => {
              const code = `${r.key}.${a.key}`;
              const checked = selected.has(code);
              const scoped = r.key === "orders" && (a.key === "view" || a.key === "edit");
              return (
                <td key={a.key} className="px-3 py-2.5 text-center">
                  {scoped ? <span className="text-[var(--oc-muted4)]" aria-label="Хүрээгээр тохируулна">—</span> : <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(code)}
                      className="accent-[var(--oc-accent)] w-4 h-4 cursor-pointer"
                      aria-label={`${r.label} — ${a.label}`}
                    />}
                </td>
              );
            })}
            <td className="px-3 py-2.5 text-center">
              <button
                type="button"
                onClick={() => onToggleRow(r.key, allOn)}
                className={`text-xs transition-colors ${
                  allOn
                    ? "text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
                    : "text-[var(--oc-muted3)] hover:text-[var(--oc-ink2)]"
                }`}
              >
                {allOn ? "Хасах" : "Бүгд"}
              </button>
            </td>
          </tr>
        );
      })}
    </>
  );
}
