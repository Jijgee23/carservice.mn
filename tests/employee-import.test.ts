// «Excel-ээс ажилтан оруулах» — pure mapping/validation helpers and the
// server-side .xlsx parser (lib/employees/import*.ts).

import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import {
  buildImportRows,
  findInFileDuplicates,
  guessMapping,
  matchByName,
  normalizeDateCell,
  parseImportRowsPayload,
  validateImportRow,
  type ImportRow,
} from "../lib/employees/import";
import { ImportParseError, parseEmployeeWorkbook } from "../lib/employees/import-server";

const roles = [
  { id: "r-master", name: "Мастер" },
  { id: "r-cashier", name: "Кассир" },
];
const branches = [{ id: "b-main", name: "Төв салбар" }];

function row(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    key: "r2",
    excelRow: 2,
    lastName: "Бат",
    firstName: "Болд",
    phone: "99112233",
    email: "bold@example.com",
    roleId: "r-master",
    branchId: "",
    activeUntil: "",
    roleRaw: "",
    branchRaw: "",
    ...overrides,
  };
}

test("guessMapping maps Mongolian/English headers, exact match beats contains", () => {
  const m = guessMapping(["Овог", "Нэр", "Утасны дугаар", "E-mail", "Албан тушаал", "Салбар", "Хугацаа", "Тэмдэглэл"]);
  assert.deepEqual(m, { lastName: 0, firstName: 1, phone: 2, email: 3, role: 4, branch: 5, activeUntil: 6 });
});

test("guessMapping leaves unknown fields unmapped and never reuses a column", () => {
  const m = guessMapping(["name", "phone"]);
  assert.equal(m.firstName, 0);
  assert.equal(m.phone, 1);
  assert.equal(m.lastName, null);
  assert.equal(m.email, null);
});

test("matchByName ignores case and extra spaces", () => {
  assert.equal(matchByName(roles, "  мастер "), "r-master");
  assert.equal(matchByName(branches, "төв   салбар"), "b-main");
  assert.equal(matchByName(roles, "Угаагч"), "");
  assert.equal(matchByName(roles, ""), "");
});

test("normalizeDateCell accepts common separators and rejects impossible dates", () => {
  assert.equal(normalizeDateCell("2026.12.31"), "2026-12-31");
  assert.equal(normalizeDateCell("2026/1/5"), "2026-01-05");
  assert.equal(normalizeDateCell("2026-02-31"), "2026-02-31"); // left as-is → flagged
  assert.equal(normalizeDateCell("маргааш"), "маргааш");
  assert.equal(normalizeDateCell(""), "");
});

test("buildImportRows applies the mapping and auto-matches role/branch by name", () => {
  const rows = buildImportRows(
    {
      headers: ["Нэр", "Овог", "Утас", "Имэйл", "Үүрэг", "Салбар"],
      rows: [
        { excelRow: 2, cells: ["Болд", "Бат", "9911-2233", "Bold@Example.com", "мастер", "Төв салбар"] },
        { excelRow: 3, cells: ["Сараа", "Дорж", "88112233", "s@x.mn", "Угаагч", ""] },
      ],
    },
    { firstName: 0, lastName: 1, phone: 2, email: 3, role: 4, branch: 5, activeUntil: null },
    roles,
    branches,
  );
  assert.equal(rows[0]!.roleId, "r-master");
  assert.equal(rows[0]!.branchId, "b-main");
  assert.equal(rows[0]!.key, "r2");
  assert.equal(rows[1]!.roleId, "");
  assert.equal(rows[1]!.roleRaw, "Угаагч");
});

test("validateImportRow reuses the employee form rules and explains unmatched names", () => {
  assert.deepEqual(validateImportRow(row()), {});
  const bad = validateImportRow(row({ email: "nope", phone: "123", roleId: "", roleRaw: "Угаагч", branchRaw: "Хойд" }));
  assert.equal(bad.email, "Имэйл хаяг буруу.");
  assert.equal(bad.phone, "Утасны дугаар 8 оронтой тоо байх ёстой.");
  assert.match(bad.roleId!, /«Угаагч» үүрэг олдсонгүй/);
  assert.match(bad.branchId!, /«Хойд» салбар олдсонгүй/);
  assert.equal(validateImportRow(row({ roleId: "" })).roleId, "Үүрэг сонгоно уу.");
  assert.equal(validateImportRow(row({ activeUntil: "маргааш" })).activeUntil, "Огноо буруу.");
  assert.equal(validateImportRow(row({ activeUntil: "2026-02-30" })).activeUntil, "Огноо буруу.");
  assert.equal(validateImportRow(row({ activeUntil: "2026-12-31" })).activeUntil, undefined);
});

test("findInFileDuplicates compares canonical phone and lowercased email", () => {
  const dups = findInFileDuplicates([
    row({ key: "r2", excelRow: 2 }),
    row({ key: "r3", excelRow: 3, phone: "+976 9911 2233", email: "other@example.com" }),
    row({ key: "r4", excelRow: 4, phone: "88001122", email: "BOLD@example.com" }),
  ]);
  assert.equal(dups.has("r2"), false);
  assert.deepEqual(dups.get("r3"), { phone: 2 });
  assert.deepEqual(dups.get("r4"), { email: 2 });
});

test("parseImportRowsPayload rejects non-string fields, empty and oversized payloads", () => {
  assert.equal(parseImportRowsPayload([]), null);
  assert.equal(parseImportRowsPayload("x"), null);
  assert.equal(parseImportRowsPayload([{ ...row(), roleId: { not: "" } }]), null);
  assert.equal(parseImportRowsPayload([{ ...row(), excelRow: 0 }]), null);
  assert.equal(parseImportRowsPayload(Array.from({ length: 501 }, () => row())), null);
  const parsed = parseImportRowsPayload([{ ...row(), extra: "dropped", lastName: "x".repeat(500) }]);
  assert.equal(parsed?.[0]?.lastName.length, 200);
  assert.equal((parsed?.[0] as Record<string, unknown>).extra, undefined);
});

async function workbookBuffer(build: (sheet: ExcelJS.Worksheet) => void): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  build(wb.addWorksheet("Ажилтнууд"));
  const buf = await wb.xlsx.writeBuffer();
  return buf instanceof ArrayBuffer ? buf : new Uint8Array(buf as ArrayLike<number>).buffer;
}

test("parseEmployeeWorkbook: header on first non-empty row, cells become strings, empty rows skipped", async () => {
  const buffer = await workbookBuffer((sheet) => {
    sheet.addRow([]);
    sheet.addRow(["Овог", "Нэр", "Утас", "Имэйл", "Хугацаа"]);
    sheet.addRow(["Бат", "Болд", 99112233, { text: "bold@x.mn", hyperlink: "mailto:bold@x.mn" }, new Date(Date.UTC(2026, 11, 31))]);
    sheet.addRow([]);
    sheet.addRow([{ richText: [{ text: "Дор" }, { text: "ж" }] }, "Сараа", "8811-2233", "s@x.mn"]);
  });
  const parsed = await parseEmployeeWorkbook(buffer);
  assert.deepEqual(parsed.headers, ["Овог", "Нэр", "Утас", "Имэйл", "Хугацаа"]);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0], { excelRow: 3, cells: ["Бат", "Болд", "99112233", "bold@x.mn", "2026-12-31"] });
  assert.deepEqual(parsed.rows[1], { excelRow: 5, cells: ["Дорж", "Сараа", "8811-2233", "s@x.mn", ""] });
});

test("parseEmployeeWorkbook rejects garbage, header-only and too-large files", async () => {
  await assert.rejects(parseEmployeeWorkbook(new TextEncoder().encode("not a zip").buffer as ArrayBuffer), ImportParseError);
  await assert.rejects(
    parseEmployeeWorkbook(await workbookBuffer((s) => s.addRow(["Овог", "Нэр"]))),
    /Гарчгийн доор өгөгдөлтэй мөр алга/,
  );
  await assert.rejects(
    parseEmployeeWorkbook(
      await workbookBuffer((s) => {
        s.addRow(["Овог"]);
        for (let i = 0; i < 501; i++) s.addRow([`О${i}`]);
      }),
    ),
    /хамгийн ихдээ 500 мөр/,
  );
});
