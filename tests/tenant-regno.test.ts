import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPersonAdminErrors, normalizeRegno, regnoKind, splitPersonName } from "../lib/tenant-regno";

test("7 оронтой тоо = байгууллага", () => {
  assert.equal(regnoKind("1234567"), "org");
  assert.equal(regnoKind(" 123 4567 "), "org");
});

test("2 кирилл үсэг + 8 цифр = хувь хүн (жижиг үсгийг томруулна)", () => {
  assert.equal(regnoKind("ҮҮ99993333"), "person");
  assert.equal(regnoKind("өө12345678"), "person");
  assert.equal(normalizeRegno("уу 99993333"), "УУ99993333");
});

test("бусад хэлбэр татгалзана", () => {
  for (const v of ["", "123456", "12345678", "UU99993333", "Ү99993333", "ҮҮ9999333", "ҮҮҮ99993333"]) {
    assert.equal(regnoKind(v), null, v);
  }
});

test("хувь хүний нэрийг овог/нэр болгон хуваана", () => {
  assert.deepEqual(splitPersonName("Бат Дорж"), { lastName: "Бат", firstName: "Дорж" });
  assert.deepEqual(splitPersonName("Б.Дорж"), { lastName: "Б", firstName: "Дорж" });
  assert.deepEqual(splitPersonName("  Дорж "), { lastName: "", firstName: "Дорж" });
});

test("хувь хүний админы алдааг 1-р алхмын талбар руу шилжүүлнэ", () => {
  assert.deepEqual(
    mapPersonAdminErrors({ adminPhone: "утас", adminEmail: "имэйл", password: "нууц" }),
    { phone1: "утас", orgEmail: "имэйл", password: "нууц" },
  );
});
