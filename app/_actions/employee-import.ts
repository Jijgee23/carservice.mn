"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { canCreate } from "@/lib/auth/roles";
import {
  MAX_IMPORT_BYTES,
  parseImportRowsPayload,
  type ImportEmployeesResult,
  type ParsedSheet,
} from "@/lib/employees/import";
import { checkEmployeeImportTaken, runEmployeeImport } from "@/lib/employees/import-service";
import { ImportParseError, parseEmployeeWorkbook } from "@/lib/employees/import-server";
import type { EmployeeActor } from "@/lib/employees/types";
import { assertActiveSubscription } from "@/lib/subscription-server";

// «Excel-ээс ажилтан оруулах» (/dashboard/employees/import). Гурван алхам:
// parse (файл → гарчиг + мөр), check (тенант дотор давхцал), import (үүсгэх).
// Бүгд ажилтан нэмэх эрх + идэвхтэй багц шаардана. Логик нь lib/employees/import-service.ts-д
// (мобайл POST /api/v1/employees/import[/preview]-тэй нэг).

async function authorizeImport(): Promise<EmployeeActor> {
  const user = await requireUser();
  if (!canCreate(user, "employees")) {
    throw new Error("Танд ажилтан нэмэх эрх байхгүй.");
  }
  await assertActiveSubscription(user.tenantId);
  return user;
}

export type ParseEmployeeImportResult =
  | ({ ok: true; fileName: string } & ParsedSheet)
  | { ok: false; message: string };

export async function parseEmployeeImportAction(formData: FormData): Promise<ParseEmployeeImportResult> {
  try {
    await authorizeImport();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Excel файлаа сонгоно уу." };
  }
  if (!/\.xlsx$/i.test(file.name)) {
    return { ok: false, message: "Зөвхөн .xlsx файл оруулна. Excel-ээс «Save As → Excel Workbook (.xlsx)» сонгоно уу." };
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, message: "Файл 2MB-аас хэтэрсэн байна." };
  }

  try {
    const sheet = await parseEmployeeWorkbook(await file.arrayBuffer());
    return { ok: true, fileName: file.name, ...sheet };
  } catch (e) {
    if (e instanceof ImportParseError) return { ok: false, message: e.message };
    console.error("[employee-import] parse failed:", e);
    return { ok: false, message: "Файлыг уншиж чадсангүй." };
  }
}

/** Утас/имэйл тенантын бусад ажилтанд бүртгэлтэй эсэх (урьдчилан харах хүснэгтэд). */
export async function checkEmployeeImportDuplicatesAction(
  entries: unknown,
): Promise<{ ok: true; taken: Record<string, { phone?: boolean; email?: boolean }> } | { ok: false; message: string }> {
  let user: EmployeeActor;
  try {
    user = await authorizeImport();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }
  const rows = parseImportRowsPayload(entries);
  if (!rows) return { ok: false, message: "Буруу хүсэлт." };
  return { ok: true, taken: await checkEmployeeImportTaken(user.tenantId, rows) };
}

export async function importEmployeesAction(payload: unknown): Promise<ImportEmployeesResult> {
  let user: EmployeeActor;
  try {
    user = await authorizeImport();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }
  const rows = parseImportRowsPayload(payload);
  if (!rows) return { ok: false, message: "Оруулах мөр алга эсвэл хүсэлт буруу." };

  const result = await runEmployeeImport(user, rows);
  if (result.succeeded > 0) {
    revalidatePath("/dashboard/employees");
    revalidatePath("/dashboard");
  }
  return result;
}
