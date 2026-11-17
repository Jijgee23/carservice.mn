# carcare.mn — Prisma Schema засвар, сайжруулалтын ажлын төлөвлөгөө

Эх сурвалж: `prisma/schema.prisma` анализын дараа илэрсэн 12 олдвор. Энд тэдгээрийг **эрсдэл/өртгийн дарааллаар** 5 үе шаттай ажлын жагсаалт болгож задаллаа. Үе шат бүр өмнөхөөсөө хамааралтай тул дараалал хадгалахыг зөвлөж байна.

---

## Ажиллах зарчим

1. **Production дээр шууд `prisma migrate dev` хийхгүй** — эхлээд staging/copy DB дээр турших.
2. Unique constraint нэмэхээс өмнө үргэлж **давхардал шалгах query** ажиллуулж, дараа нь цэвэрлэгээ хийх (`merge_duplicate_vehicles` migration-той адил загвар аль хэдийн ашигласан туршлагатай байгаа тул үүнийг давтана).
3. CHECK constraint нэмэх migration бичихдээ Prisma-гийн auto-generate хийсэн SQL-г **гараар засварлаж** (Notification-ийн `notification_owner_xor` жишээг дагаж) constraint мөрийг нэмнэ — Prisma schema дотор check constraint-ийг өөрөө declare хийх боломж хязгаарлагдмал тул ихэвчлэн migration SQL-д гараар нэмдэг.
4. Хэрэглэгчид нөлөөлөх `onDelete` өөрчлөлт (Cascade→Restrict) хийхийн өмнө тухайн урсгалыг код дотор хэн ашиглаж байгааг (`prisma.tenant.delete`) хайж олох.

---

## Үе шат 0 — Даруй засах (эрсдэлгүй, дата цэвэрлэгээ шаардахгүй)

Хамгийн бага орчил, найдвартай, дараагийн deploy-д шууд орж болно.

### 0.1 Device моделд XOR CHECK constraint нэмэх (**хамгийн чухал**)
- **Асуудал**: Comment-д "Notification шиг яг нэг эзэнтэй" гэсэн ч, migration SQL-д `notification_owner_xor`-той адил constraint байхгүй.
- **Хийх**: Шинэ migration үүсгэж дараах мөрийг нэмэх:
  ```sql
  ALTER TABLE "Device" ADD CONSTRAINT "device_owner_xor"
    CHECK ((("userId" IS NOT NULL)::int + ("accountId" IS NOT NULL)::int) = 1);
  ```
- **Өмнө нь шалгах**: `SELECT id FROM "Device" WHERE ("userId" IS NULL AND "accountId" IS NULL) OR ("userId" IS NOT NULL AND "accountId" IS NOT NULL);` — хэрэв одоо байгаа мөр зөрчиж байвал constraint нэмэхээс өмнө засах (эсвэл устгах) хэрэгтэй.
- **Effort**: Жижиг (1 migration).

### 0.2 `Appointment.respondedById` → User рүү бодит relation нэмэх
- **Асуудал**: Одоо plain `String?`, FK/relation байхгүй тул "хэн хариулсан" гэдгийг найдвартай join хийж авах боломжгүй.
- **Хийх**:
  ```prisma
  respondedById String?
  respondedBy   User?   @relation("AppointmentRespondedBy", fields: [respondedById], references: [id], onDelete: SetNull)
  ```
  User моделд эсрэг талын `appointmentsResponded Appointment[] @relation("AppointmentRespondedBy")` талбар нэмэх.
- **Анхаарах**: Одоо байгаа өгөгдөлд алдаатай/устсан userId байвал migration бүтэлгүйтнэ — эхлээд baseline шалгах.
- **Effort**: Жижиг.

### 0.3 `RefreshToken.replacedById` → өөрийгөө ишлэсэн relation нэмэх
- **Асуудал**: Rotation chain-ийг зөвхөн string-ээр хадгалдаг, FK-гүй.
- **Хийх**:
  ```prisma
  replacedById String?
  replacedBy   RefreshToken? @relation("TokenRotation", fields: [replacedById], references: [id], onDelete: SetNull)
  replacedFrom RefreshToken? @relation("TokenRotation")
  ```
- **Анхаарах**: Хэрэв хуучин revoked/expired token-уудыг тогтмол cron-оор hard-delete хийдэг бол, `onDelete: SetNull` байгаа эсэхийг баталгаажуулах (`Cascade` биш) — эс тэгвэл хэлхээ бутарна. Энэ талбарыг хэрэгжүүлэхийн өмнө `lib/`-д token цэвэрлэх cron байгаа эсэхийг олж, логикийг хамт нягтлах хэрэгтэй.
- **Effort**: Жижиг-дунд (нягталгаа шаардлагатай тул).

---

## Үе шат 1 — Өгөгдлийн бүрэн бүтэн байдал (цэвэрлэгээ шаардлагатай)

### 1.1 `Customer` — tenant дотор `phone` unique болгох
- **Асуудал**: `@@index([tenantId, phone])` байгаа ч unique биш — давхар харилцагч үүсэх нээлттэй.
- **Алхам**:
  1. Query: `SELECT tenantId, phone, COUNT(*) FROM "Customer" GROUP BY tenantId, phone HAVING COUNT(*) > 1;`
  2. Давхардсан мөрүүдийг `merge_duplicate_vehicles` migration-д ашигласан загвараар нэгтгэх (хамгийн эртний/хамгийн олон холбоотой мөрийг үлдээж, бусдын `ServiceOrder`/`DiagnosticReport`/`Appointment`/`TenantVehicle`-г шилжүүлээд, илүүдэл Customer-г устгах).
  3. Дараа нь schema-д `@@unique([tenantId, phone])` нэмж migration үүсгэх.
- **Анхаарах**: Хэрэглэгчийн код дотор "нэг утасны дугаараар шинэ Customer үүсгэдэг" урсгал байгаа эсэхийг олж, unique constraint зөрчихөд graceful error буцаадаг болгох (upsert логик руу шилжүүлэх шаардлагатай байж магадгүй).
- **Effort**: Дунд-том (дата цэвэрлэгээ + код өөрчлөлт).

### 1.2 Санхүү/аудит өгөгдлийг Tenant hard-delete-ээс хамгаалах
- **Асуудал**: `AuditLog`, `OrderPayment`, `SubscriptionPayment` (мөн бусад) Tenant устахад `Cascade`-ээр устдаг.
- **Алхам**:
  1. Кодоос `prisma.tenant.delete(` хайж, tenant-ийг хэзээ ч хаана ч hard-delete хийдэг эсэхийг баталгаажуулах (`suspended` boolean байгаа тул soft-delete л хэрэглэгддэг байх магадлалтай).
  2. Хэрэв hard-delete хэрэгцээгүй бол, дор хаяж **санхүү/аудитын** холбоосуудыг (`AuditLog`, `OrderPayment`, `SubscriptionPayment`) `onDelete: Restrict` болгож migration бичих — ингэснээр tenant-ийг эхлээд бүх санхүүгийн түүхийг архивласны дараа л устгах боломжтой болно.
  3. Бусад (User, Branch, Customer гэх мэт) tenant-ийн Cascade-г хэвээр үлдээж болно — эдгээр нь дахин үүсгэгдэх боломжтой "тохиргооны" өгөгдөл.
- **Effort**: Дунд (schema өөрчлөлт бага, гэхдээ кодын аудит хэрэгтэй).

---

## Үе шат 2 — Архитектурын том сайжруулалт (төлөвлөгөөтэй хийх)

### 2.1 Multi-tenant тусгаарлалтын хамгаалалт нэмэх (хамгийн өндөр үнэ цэнэтэй, хамгийн том ажил)
- **Асуудал**: Бүх query-д гар аргаар `where: { tenantId }` найдвал cross-tenant leak-ийн эрсдэлтэй.
- **Санал болгож буй хоёр арга** (аль нэгийг сонгох шаардлагатай — доор AskUser хэсэгт тавьсан):
  - **A. Prisma Client Extension**: `lib/prisma.ts` дотор бүх tenant-scoped модел дээр автоматаар `tenantId` шүүлт нэмдэг extension бичих (жишээ нь `$extends` ашиглан `findMany`/`update`/`delete` args-д tenantId inject хийх). Хэрэгжүүлэхэд хамгийн хурдан, гэхдээ Prisma extension-ий хязгаарлалт (raw query-г хамгаалахгүй) байдаг.
  - **B. Postgres Row-Level Security (RLS)**: Session variable (`app.tenant_id`)-аар policy бичиж, DB түвшинд хамгаална — хамгийн найдвартай ч хэрэгжүүлэхэд илүү цаг зарцуулна (session variable-г connection pool-той зохицуулах ёстой, ялангуяа PgBouncer ашиглаж байгаа бол).
- **Алхам**: Эхлээд spike (1-2 хоног) хийж аль арга хэрэгжих боломжтойг тодорхойлох → дараа нь бүрэн хэрэгжүүлэлт.
- **Effort**: Том.

### 2.2 `Branch.isActive` талбар нэмэх
- **Асуудал**: Бусад бүх reference model (Customer, Service, Category, Unit) isActive-тай атал Branch байхгүй тул ажиллахаа больсон салбарыг "нуух" боломжгүй (устгах нь Restrict-оор хаалттай).
- **Хийх**: `isActive Boolean @default(true)` нэмэх migration, дараа нь UI/API query-үүдэд идэвхтэй салбар шүүлт нэмэх.
- **Effort**: Жижиг-дунд (schema бага, гэхдээ UI/API талд хэрэглээ нэмэх ажил бий).

### 2.3 `assignableBranchIds` — FK-гүй массивын эрсдэл багасгах
- **Сонголт 1 (жижиг)**: Одоогийн `String[]` хэвээр үлдээгээд, ашиглах бүрдээ (order assignment) app-level дээр идэвхтэй Branch id-тэй intersect хийдэг helper function-г нэг газар төвлөрүүлэх (`lib/branches.ts`-д аль хэдийн байгаа эсэхийг шалгаад нэмэх).
- **Сонголт 2 (том, зөв бүтэц)**: Join table (`UserAssignableBranch { userId, branchId }`) болгож хувиргах — FK бүрэн бүтэн, Branch устахад Cascade-аар цэвэрлэгдэнэ. Гэхдээ энэ бол breaking change, код дахин бичих шаардлагатай.
- **Зөвлөмж**: Одоохондоо Сонголт 1 (хурдан), дараа нь цаг гарвал Сонголт 2 руу шилжих.
- **Effort**: Жижиг (Сонголт 1) / Том (Сонголт 2).

---

## Үе шат 3 — Бизнес логик тууштай байдал

### 3.1 `Tenant.name` global unique — бизнесийн шийдвэр шаардана
- **Асуудал**: Хоёр өөр компани адилхан нэртэй байх нь бодит боломжтой, бүртгэл хаагдах эрсдэлтэй.
- **Санал**: Constraint-ийг бүрэн авахгүй, харин UX сайжруулах — бүртгэлийн үед нэр давхцвал frontend дээр "танай нэр аль хэдийн бүртгэлтэй байна, өөр нэр сонгоно уу / бидэнтэй холбогдоно уу" гэсэн тодорхой мессеж өгөх, эсвэл slug-т суффикс автоматаар нэмэх боломж олгох. Энэ бол product/business шийдвэр тул хэрэглэгчтэй тохиролцох шаардлагатай.
- **Effort**: Бизнесийн шийдвэрээс хамаарна (schema дээрх ажил бага).

### 3.2 `Tenant.plan` vs `Subscription` синк баталгаажуулах
- **Хийх**: `Subscription` status өөрчлөгдөх бүрт (`ACTIVE`→`EXPIRED` гэх мэт) `Tenant.plan`-г мөн шинэчилдэг эсэхийг код дотроос баталгаажуулах (`lib/subscription*.ts`). Хэрэв алдагдах боломжтой цэгүүд байвал, тогтмол ажилладаг **reconciliation job** (cron) нэмж, зөрүү илэрвэл засварлах болон log бичих.
- **Effort**: Дунд (код нягталгаа + cron нэмэх).

### 3.3 `AuditLog.entity` / `Notification.type` — typo-эрсдэл бууруулах
- **Санал**: DB enum рүү шилжихийг заавал шаардахгүй (учир нь өргөтгөх уян хатан чанарыг тайлбартаа онцолсон), харин TypeScript түвшинд `const ENTITY_TYPES = [...] as const` мөн Zod schema-аар шалгадаг болгож, compile-time аюулгүй байдлыг сайжруулах.
- **Effort**: Жижиг (код-л, schema өөрчлөлт хэрэггүй).

---

## Үе шат 4 — Урт хугацааны / nice-to-have

### 4.1 Vehicle дугаар (`plate`) солигдсон түүхийг хадгалах
- **Санал**: `VehiclePlateHistory { vehicleId, plate, changedAt }` хүснэгт нэмж, `resolveVehicle` логик дугаар шилжих бүрд мөр нэмдэг болгох — ирээдүйд аудит/маргаан шийдвэрлэхэд хэрэг болно.
- **Effort**: Дунд.

### 4.2 `City`/`District`/`Khoroo` — эх өгөгдлийн чанар сайжруулах
- **Хийх**: `scripts/mongolian.sql` эх өгөгдлийг шалгаж, аль болох `name`/`cityId`-г NOT NULL болгох боломжтой эсэхийг үнэлэх (эсвэл одоохондоо nullable хэвээр үлдээж, зөвхөн баримтжуулах).
- **Effort**: Жижиг-дунд (голдуу дата ажил).

---

## Хураангуй хүснэгт

| # | Асуудал | Үе шат | Эрсдэл | Effort | Data цэвэрлэгээ шаардах |
|---|---|---|---|---|---|
| 1 | Device XOR constraint | 0 | Өндөр (бодит зөрчил) | Жижиг | Магадгүй |
| 2 | Appointment.respondedById relation | 0 | Дунд | Жижиг | Үгүй |
| 3 | RefreshToken.replacedById relation | 0 | Бага | Жижиг-дунд | Үгүй |
| 4 | Customer.phone unique | 1 | Дунд | Дунд-том | Тийм |
| 5 | Tenant→AuditLog/Payment Restrict | 1 | Өндөр (санхүү) | Дунд | Үгүй (код аудит) |
| 6 | Multi-tenant isolation guard | 2 | Хамгийн өндөр | Том | Үгүй |
| 7 | Branch.isActive | 2 | Бага | Жижиг-дунд | Үгүй |
| 8 | assignableBranchIds | 2 | Бага-дунд | Жижиг/Том | Үгүй |
| 9 | Tenant.name unique бодлого | 3 | Бизнес эрсдэл | Шийдвэрээс хамаарна | Үгүй |
| 10 | Tenant.plan sync | 3 | Дунд | Дунд | Үгүй |
| 11 | entity/type enum → TS const | 3 | Бага | Жижиг | Үгүй |
| 12 | Plate history | 4 | Бага | Дунд | Үгүй |
| 13 | City/District/Khoroo NOT NULL | 4 | Бага | Жижиг-дунд | Тийм |

---

## Шийдвэр шаардаж буй зүйлс (эхлэхээс өмнө тодруулах)

- **#6 (Multi-tenant isolation)**: Prisma Extension эсвэл Postgres RLS — алийг нь сонгох вэ? (Хурдан хэрэгжих vs хамгийн найдвартай.)
- **#9 (Tenant.name unique)**: Constraint-ийг бүрэн авах уу, эсвэл зөвхөн UX сайжруулах уу — бизнесийн шийдвэр.
- **#5 (Tenant hard-delete)**: Tenant-ийг ямар нэг урсгалд hard-delete хийдэг үү, эсвэл зөвхөн `suspended` ашигладаг уу — үүнийг эхлээд баталгаажуулах хэрэгтэй.
