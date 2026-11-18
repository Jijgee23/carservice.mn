"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { canCreate } from "@/lib/auth/roles";
import { MAX_IMPORT_BYTES, type ParsedSheet } from "@/lib/import/mapping";
import { ImportParseError, parseImportWorkbook } from "@/lib/import/xlsx-server";
import { parseServiceImportPayload, type ServiceImportResult } from "@/lib/services/import";
import { existingServiceCodes, isImportServiceKind, runServiceImportForActor } from "@/lib/services/import-service";
import { assertActiveSubscription } from "@/lib/subscription-server";

// «Excel-ээс ажил / сэлбэг оруулах» (/dashboard/services/import?type=labor|goods).
// parse (файл → гарчиг + мөр), checkCodes (бүртгэлтэй код), import (үүсгэх).
// Бүгд «Үйлчилгээ — Үүсгэх» эрх + идэвхтэй багц шаардана. Логик нь lib/services/import-service.ts-д
// (мобайл POST /api/v1/services/import[/preview]-тэй нэг).

async function authorizeImport() {
  const user = await requireUser();
  if (!canCreate(user, "services")) throw new Error("Танд ажил/сэлбэг нэмэх эрх байхгүй.");
  await assertActiveSubscription(user.tenantId);
  return user;
}

export type ParseServiceImportResult = ({ ok: true; fileName: string } & ParsedSheet) | { ok: false; message: string };

export async function parseServiceImportAction(formData: FormData): Promise<ParseServiceImportResult> {
  try {
    await authorizeImport();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Excel файлаа сонгоно уу." };
  if (!/\.xlsx$/i.test(file.name)) {
    return { ok: false, message: "Зөвхөн .xlsx файл оруулна. Excel-ээс «Save As → Excel Workbook (.xlsx)» сонгоно уу." };
  }
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, message: "Файл 2MB-аас хэтэрсэн байна." };
  try {
    const sheet = await parseImportWorkbook(await file.arrayBuffer());
    return { ok: true, fileName: file.name, ...sheet };
  } catch (e) {
    if (e instanceof ImportParseError) return { ok: false, message: e.message };
    console.error("[service-import] parse failed:", e);
    return { ok: false, message: "Файлыг уншиж чадсангүй." };
  }
}

/** Тухайн төрөлд аль хэдийн бүртгэлтэй кодууд (урьдчилан харах хүснэгтэд). */
export async function checkServiceImportCodesAction(
  type: unknown,
  codes: unknown,
): Promise<{ ok: true; taken: string[] } | { ok: false; message: string }> {
  let user;
  try {
    user = await authorizeImport();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }
  if (!isImportServiceKind(type) || !Array.isArray(codes) || codes.length > 1000 || codes.some((c) => typeof c !== "string")) {
    return { ok: false, message: "Буруу хүсэлт." };
  }
  const taken = await existingServiceCodes(user.tenantId, type, codes as string[]);
  return { ok: true, taken: [...taken] };
}

export async function importServicesAction(type: unknown, payload: unknown): Promise<ServiceImportResult> {
  let user;
  try {
    user = await authorizeImport();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }
  const rows = parseServiceImportPayload(payload);
  if (!isImportServiceKind(type) || !rows) return { ok: false, message: "Оруулах мөр алга эсвэл хүсэлт буруу." };

  const result = await runServiceImportForActor(user, type, rows);
  if (result.succeeded > 0) revalidatePath("/dashboard/services", "layout");
  return result;
}
