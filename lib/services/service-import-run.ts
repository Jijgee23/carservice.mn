// Excel импортын мөрүүдийг үүсгэх цөм (server) — мөр бүр тусдаа (all-or-nothing
// БИШ). Системд бүртгэлтэй кодтой мөрийг алгасна (хэрэглэгчийн шийдвэр),
// багцын үлдсэн эрхээс хэтэрсэнийг «багцын хязгаар» болгоно. `create`-ийг
// inject хийдэг тул fake-ээр тестлэнэ.

import {
  SERVICE_CODE_EXISTS_MESSAGE,
  serviceRowToRaw,
  type ImportServiceKind,
  type ServiceImportRow,
  type ServiceImportRowResult,
} from "./import";
import { validateServiceCreate, type ServiceCreateValues, type ServiceRefs } from "./service-create-rules";
import type { CreateServiceResult } from "./service-create";

export async function runServiceImport(input: {
  type: ImportServiceKind;
  rows: readonly ServiceImportRow[];
  refs: NonNullable<ServiceRefs>;
  /** Тенант + төрөлд аль хэдийн бүртгэлтэй кодууд (UPPER). */
  existingCodes: ReadonlySet<string>;
  remaining: number | null;
  limitMessage: string;
  create: (values: ServiceCreateValues) => Promise<CreateServiceResult>;
}): Promise<{ succeeded: number; failed: number; results: ServiceImportRowResult[] }> {
  const results: ServiceImportRowResult[] = [];
  const codesThisRun = new Set<string>();
  let succeeded = 0;
  for (const row of input.rows) {
    const code = row.code.trim().toUpperCase();
    if (code && (input.existingCodes.has(code) || codesThisRun.has(code))) {
      results.push({ key: row.key, ok: false, error: SERVICE_CODE_EXISTS_MESSAGE, fieldErrors: { code: SERVICE_CODE_EXISTS_MESSAGE } });
      continue;
    }
    const { values, errors } = validateServiceCreate(serviceRowToRaw(input.type, row), input.refs);
    if (!values) {
      results.push({ key: row.key, ok: false, error: "Оруулсан мэдээлэл буруу.", fieldErrors: errors });
      continue;
    }
    if (input.remaining !== null && succeeded >= input.remaining) {
      results.push({ key: row.key, ok: false, error: input.limitMessage });
      continue;
    }
    const created = await input.create(values);
    if (!created.ok) {
      results.push({ key: row.key, ok: false, error: created.message ?? "Оруулсан мэдээлэл буруу.", fieldErrors: created.fieldErrors });
      continue;
    }
    if (code) codesThisRun.add(code);
    succeeded++;
    results.push({ key: row.key, ok: true });
  }
  return { succeeded, failed: input.rows.length - succeeded, results };
}
