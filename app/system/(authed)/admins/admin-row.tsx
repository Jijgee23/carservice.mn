import { ConfirmForm } from "@/app/_components/confirm-form";
import { setSuperAdminActiveAction } from "@/app/_actions/system-admins";
import { StaffPasswordForm } from "./staff-password-form";

type AdminRowData = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  kind: "ROOT" | "STAFF";
  createdAt: Date;
  createdBy: { firstName: string; lastName: string } | null;
};

function fmt(d: Date): string {
  return d.toLocaleDateString("mn-MN");
}

export function AdminRow({
  admin,
  isSelf,
  canDeactivate,
}: {
  admin: AdminRowData;
  isSelf: boolean;
  canDeactivate: boolean;
}) {
  const blockDeactivate = isSelf || !canDeactivate;

  return (
    <tr className="border-b border-[var(--oc-line2)] last:border-0 hover:bg-white/[0.02] transition-colors">
      <td className="px-5 py-3 text-[var(--oc-ink2)]">
        {admin.lastName} {admin.firstName}
        {isSelf ? (
          <span className="ml-1.5 text-[10px] text-[var(--oc-muted3)]">(та)</span>
        ) : null}
        <span
          className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full border ${
            admin.kind === "STAFF"
              ? "border-[var(--oc-line)] text-[var(--oc-muted3)]"
              : "border-[var(--oc-accent)]/40 text-[var(--oc-accent)]"
          }`}
        >
          {admin.kind === "STAFF" ? "Ажилтан" : "Admin"}
        </span>
        {admin.kind === "STAFF" ? <StaffPasswordForm adminId={admin.id} /> : null}
      </td>
      <td className="px-5 py-3 text-[var(--oc-muted)]">{admin.email}</td>
      <td className="px-5 py-3 text-xs text-[var(--oc-muted3)]">
        {admin.createdBy
          ? `${admin.createdBy.lastName} ${admin.createdBy.firstName}`
          : "—"}
      </td>
      <td className="px-5 py-3 text-xs text-[var(--oc-muted3)]">
        {fmt(admin.createdAt)}
      </td>
      <td className="px-5 py-3">
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            admin.isActive
              ? "bg-[var(--oc-ok)]/15 text-[var(--oc-ok)]"
              : "bg-[var(--oc-panel2)] text-[var(--oc-muted3)] border border-[var(--oc-line)]"
          }`}
        >
          {admin.isActive ? "Идэвхтэй" : "Идэвхгүй"}
        </span>
      </td>
      <td className="px-5 py-3 text-right">
        {admin.isActive ? (
          blockDeactivate ? (
            <span
              className="text-xs text-[var(--oc-muted4)]"
              title={
                isSelf
                  ? "Өөрийгөө идэвхгүй болгож болохгүй"
                  : "Хамгийн сүүлийн идэвхтэй admin-ыг идэвхгүй болгож болохгүй"
              }
            >
              —
            </span>
          ) : (
            <ConfirmForm
              action={setSuperAdminActiveAction}
              message={`${admin.lastName} ${admin.firstName}-г идэвхгүй болгох уу? Нэвтрэх боломжгүй болно.`}
            >
              <input type="hidden" name="id" value={admin.id} />
              <input type="hidden" name="active" value="0" />
              <button
                type="submit"
                className="text-xs text-red-400 hover:text-red-300 light:text-red-600 light:hover:text-red-700 px-2 py-1 rounded-md hover:bg-red-500/10 transition-colors"
              >
                Идэвхгүй болгох
              </button>
            </ConfirmForm>
          )
        ) : (
          <ConfirmForm enabled={false} message="" action={setSuperAdminActiveAction}>
            <input type="hidden" name="id" value={admin.id} />
            <input type="hidden" name="active" value="1" />
            <button
              type="submit"
              className="text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] px-2 py-1 rounded-md hover:bg-[var(--oc-accent)]/10 transition-colors"
            >
              Идэвхжүүлэх
            </button>
          </ConfirmForm>
        )}
      </td>
    </tr>
  );
}
