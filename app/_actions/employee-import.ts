"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { canCreate } from "@/lib/auth/roles";
import { importEmployees } from "@/lib/employees/core";
import {
  duplicateKeys,
  MAX_IMPORT_BYTES,
  parseImportRowsPayload,
  type ImportEmployeesResult,
  type ParsedSheet,
} from "@/lib/employees/import";
import { ImportParseError, parseEmployeeWorkbook } from "@/lib/employees/import-server";
import type { EmployeeActor } from "@/lib/employees/types";
import { PLAN_LIMIT_CODES, PLAN_LIMIT_META } from "@/lib/plan-limits";
import { enforceCountLimit } from "@/lib/plan-limits-server";
import { prisma } from "@/lib/prisma";
import { assertActiveSubscription } from "@/lib/subscription-server";

// «Excel-ээс ажилтан оруулах» (/dashboard/employees/import). Гурван алхам:
// parse (файл → гарчиг + мөр), check (тенант дотор давхцал), import (үүсгэх).
// Бүгд ажилтан нэмэх эрх + идэвхтэй багц шаардана.

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

/**
 * Утас/имэйл тенантын бусад ажилтанд бүртгэлтэй эсэх (урьдчилан харах
 * хүснэгтэд). RLS-ээр зөвхөн өөрийн тенант харагдана — өөр тенантын
 * давхцлыг санаатайгаар илрүүлэхгүй (500 мөрөөр бусдын утас/имэйл шалгах
 * oracle болохгүйн тулд); тийм мөр импорт хийхэд P2002-оор алдаа буцна.
 */
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

  const keyed = rows.map((r) => ({ key: r.key, ...duplicateKeys(r) }));
  const phones = [...new Set(keyed.map((r) => r.phone).filter(Boolean))];
  const emails = [...new Set(keyed.map((r) => r.email).filter(Boolean))];
  if (phones.length === 0 && emails.length === 0) return { ok: true, taken: {} };

  const existing = await prisma.user.findMany({
    where: {
      tenantId: user.tenantId,
      OR: [{ phone: { in: phones } }, { email: { in: emails } }],
    },
    select: { phone: true, email: true },
  });
  const takenPhones = new Set(existing.map((u) => u.phone));
  const takenEmails = new Set(existing.map((u) => u.email));

  const taken: Record<string, { phone?: boolean; email?: boolean }> = {};
  for (const r of keyed) {
    const hit = {
      ...(r.phone && takenPhones.has(r.phone) ? { phone: true } : {}),
      ...(r.email && takenEmails.has(r.email) ? { email: true } : {}),
    };
    if (hit.phone || hit.email) taken[r.key] = hit;
  }
  return { ok: true, taken };
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

  // Багцын хязгаар: max_users — ганцаар үүсгэхтэй адил тоолно, гэхдээ
  // үлдсэн эрхээс хэтэрсэн мөрүүдийг тус тусад нь алдаатай буцаана.
  const limit = await enforceCountLimit(
    user.tenantId,
    PLAN_LIMIT_CODES.MAX_USERS,
    () => prisma.user.count({ where: { tenantId: user.tenantId, deletedAt: null } }),
  );
  const remaining = limit.limit === null ? null : Math.max(0, limit.limit - limit.current);
  const limitMessage =
    limit.message ??
    `${PLAN_LIMIT_META[PLAN_LIMIT_CODES.MAX_USERS].label}: багцын хязгаар (${limit.limit}) хүрсэн. Багцаа сайжруулна уу.`;

  const result = await importEmployees(prisma, user, rows, {
    remaining,
    limitMessage,
    onCreated: (created) =>
      logAudit({
        tenantId: user.tenantId,
        userId: user.id,
        entity: "User",
        entityId: created.id,
        action: "CREATE",
        summary: `${created.summary} · Excel-ээс`,
        after: created.after as Prisma.InputJsonValue,
      }),
  });

  if (result.succeeded > 0) {
    revalidatePath("/dashboard/employees");
    revalidatePath("/dashboard");
  }
  return { ok: true, ...result };
}
