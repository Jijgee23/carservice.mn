"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { canCreate } from "@/lib/auth/roles";
import { MAX_IMPORT_BYTES, type ParsedSheet } from "@/lib/import/mapping";
import { ImportParseError, parseImportWorkbook } from "@/lib/import/xlsx-server";
import { PLAN_LIMIT_CODES, PLAN_LIMIT_META } from "@/lib/plan-limits";
import { enforceCountLimit } from "@/lib/plan-limits-server";
import { prisma } from "@/lib/prisma";
import {
  parseServiceImportPayload,
  type ImportServiceKind,
  type ServiceImportResult,
} from "@/lib/services/import";
import { createServiceCommand, loadServiceRefs } from "@/lib/services/service-create";
import { runServiceImport } from "@/lib/services/service-import-run";
import { assertActiveSubscription } from "@/lib/subscription-server";

// «Excel-ээс ажил / сэлбэг оруулах» (/dashboard/services/import?type=labor|goods).
// parse (файл → гарчиг + мөр), checkCodes (бүртгэлтэй код), import (үүсгэх).
// Бүгд «Үйлчилгээ — Үүсгэх» эрх + идэвхтэй багц шаардана.

async function authorizeImport() {
  const user = await requireUser();
  if (!canCreate(user, "services")) throw new Error("Танд ажил/сэлбэг нэмэх эрх байхгүй.");
  await assertActiveSubscription(user.tenantId);
  return user;
}

function kindOf(v: unknown): ImportServiceKind | null {
  return v === "LABOR" || v === "GOODS" ? v : null;
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
  const kind = kindOf(type);
  if (!kind || !Array.isArray(codes) || codes.length > 1000 || codes.some((c) => typeof c !== "string")) {
    return { ok: false, message: "Буруу хүсэлт." };
  }
  const list = [...new Set((codes as string[]).map((c) => c.trim().toUpperCase().slice(0, 300)).filter(Boolean))];
  if (list.length === 0) return { ok: true, taken: [] };
  const existing = await prisma.service.findMany({
    where: { tenantId: user.tenantId, type: kind, code: { in: list } },
    select: { code: true },
  });
  return { ok: true, taken: existing.map((s) => s.code!).filter(Boolean) };
}

export async function importServicesAction(type: unknown, payload: unknown): Promise<ServiceImportResult> {
  let user;
  try {
    user = await authorizeImport();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }
  const kind = kindOf(type);
  const rows = parseServiceImportPayload(payload);
  if (!kind || !rows) return { ok: false, message: "Оруулах мөр алга эсвэл хүсэлт буруу." };

  const codes = [...new Set(rows.map((r) => r.code.trim().toUpperCase()).filter(Boolean))];
  const [refs, existing, limit] = await Promise.all([
    loadServiceRefs(user.tenantId, kind),
    codes.length
      ? prisma.service.findMany({ where: { tenantId: user.tenantId, type: kind, code: { in: codes } }, select: { code: true } })
      : Promise.resolve([] as { code: string | null }[]),
    enforceCountLimit(user.tenantId, PLAN_LIMIT_CODES.MAX_SERVICES, () =>
      prisma.service.count({ where: { tenantId: user.tenantId } }),
    ),
  ]);
  const remaining = limit.limit === null ? null : Math.max(0, limit.limit - limit.current);
  const limitMessage =
    limit.message ??
    `${PLAN_LIMIT_META[PLAN_LIMIT_CODES.MAX_SERVICES].label}: багцын хязгаар (${limit.limit}) хүрсэн. Багцаа сайжруулна уу.`;

  const result = await runServiceImport({
    type: kind,
    rows,
    refs,
    existingCodes: new Set(existing.map((e) => (e.code ?? "").toUpperCase()).filter(Boolean)),
    remaining,
    limitMessage,
    create: (values) => createServiceCommand(user, values, { auditSuffix: " · Excel-ээс" }),
  });

  if (result.succeeded > 0) revalidatePath("/dashboard/services", "layout");
  return { ok: true, ...result };
}
