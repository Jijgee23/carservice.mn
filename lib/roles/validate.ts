// Framework-free validation for the role form — moved verbatim from
// `app/_actions/roles.ts` so error messages/behaviour stay byte-identical.

import { isValidPermissionCode } from "@/lib/auth/permissions";
import type { ValidatedRole } from "./types";

export function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function getCheckedPermissions(fd: FormData, field = "permissions"): string[] {
  const all = fd.getAll(field);
  const out: string[] = [];
  for (const v of all) {
    if (typeof v === "string" && isValidPermissionCode(v) && !out.includes(v)) {
      out.push(v);
    }
  }
  return out;
}

export function validateOrderScopes(permissions: string[], errors: Record<string, string>) {
  const view = permissions.includes("orders.view") || permissions.includes("orders.viewOwn");
  const edit = permissions.includes("orders.edit") || permissions.includes("orders.editOwn");
  if (edit && !view) {
    errors.orderScopes = "Засах эрх олгохын өмнө засварын хуудсыг харах хүрээг сонгоно уу.";
  }
  if (permissions.includes("orders.edit") && !permissions.includes("orders.view")) {
    errors.orderScopes = "Салбарын засах эрхэд Салбарын харах эрх шаардлагатай.";
  }
}

export function validate(fd: FormData): {
  data: ValidatedRole;
  errors: Record<string, string>;
} {
  const name = s(fd, "name");
  const description = s(fd, "description");
  const isActive = fd.get("isActive") !== "off";
  const permissions = getCheckedPermissions(fd);
  // Байгууллага өөрчилж болох эрхүүд (форм дахь «Байгууллагад өөрчлөх эрх» хэсэг).
  const tenantEditablePermissions = getCheckedPermissions(fd, "tenantEditable");

  const errors: Record<string, string> = {};
  if (!name) errors.name = "Үүргийн нэрээ оруулна уу.";
  if (name.length > 60) errors.name = "Нэр 60 тэмдэгтээс хэтрэхгүй.";
  if (permissions.length === 0) {
    errors.permissions = "Хамгийн багадаа нэг эрх сонгоно уу.";
  }
  validateOrderScopes(permissions, errors);

  return {
    data: {
      name,
      description: description || null,
      permissions,
      tenantEditablePermissions,
      isActive,
    },
    errors,
  };
}
