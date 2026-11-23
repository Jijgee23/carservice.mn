# carservice.mn — Системийн мэргэжлийн шинжилгээний тайлан

Огноо: 2026-11-20 · Хамрах хүрээ: код, бизнес логик, шаардлага (функциональ / функциональ бус), өгөгдлийн сан, UI/UX, системийн архитектур.
Арга: репогийн бодит код, schema, migration, тест, баримтыг шууд уншиж, тоолсон. Тоон өгөгдөл доор «(тоолсон)» гэж тэмдэглэв. Бүх 1077 файлыг мөр мөрөөр нь уншаагүй — гол модулиуд (prisma, RLS, auth, notifications, storage, cron, QPay, diagnostics, proxy) гүнзгий, үлдсэн хэсгийг бүтэц/хэмжээгээр шинжилсэн.

---

## 0. Удирдлагын хураангуй

**Бүтээгдэхүүн.** Авто засвар үйлчилгээний байгууллагуудад зориулсан олон тенантын (multi-tenant) SaaS + эцсийн хэрэглэгчийн онлайн цаг захиалгын marketplace. Гурван "realm": **Tenant** (ажилтан, `/dashboard`, `/api/v1/*`), **Account** (машин эзэмшигч, `/account`, `/api/v1/app/*`), **System** (платформын админ/STAFF, `/system`, `/api/v1/system/*`). Вэб + Flutter мобайл (`carcare_service_app`).

**Ерөнхий дүгнэлт: 8/10 — өндөр боловсролтой, үйлдвэрлэлийн түвшний суурь.** Давуу тал нь аюулгүй байдлын гүн (DB түвшний RLS, realm тусгаарлалт), бизнесийн дүрмийн нарийвчлал (касс, дараа тооцоо, цаг захиалгын slot/reservation), тестийн өргөн хамрах хүрээ (200 файл, 2136 тест, 0 алдаа). Гол эрсдэл нь **масштаблах чадвар ба үйл ажиллагааны (ops) боловсролт** — нэг VPS/PM2, in-memory rate limit, local файл хадгалалт, CI/CD байхгүй, OpenAPI байхгүй, per-query transaction-ийн ачаалал.

| Хэмжүүр (тоолсон) | Утга |
|---|---|
| Гар бичсэн TS/TSX | 1 077 файл · ≈157 мянган мөр (generated Prisma хасаад) |
| Prisma model / enum | 72 / 32 |
| Migration | 157 (21 нь RLS-тэй холбоотой) |
| Индекс / unique | 154 `@@index` · 50 unique |
| API route | 225 (`app/api/**/route.ts`) · 155 хуудас |
| Server action файл | 78 · client component файл 189 |
| Cron | 8 (сануулга, хугацаа дуусгах, credit score, цэвэрлэгээ…) |
| Тест | 200 файл · 2 136 тест · 2 136 pass · 0 fail (+ энэ session-д 4 шинэ) |
| `any`/`ts-ignore` | 38 (generated хасаад) — маш бага |
| TODO/FIXME | 2 |
| Typecheck (`tsc --noEmit`) | Алдаагүй |

---

## 1. Системийн архитектур

### 1.1 Технологийн стек
Next.js 16 (App Router, RSC, Server Actions) · React 19 · Tailwind 4 · Prisma 7 + PostgreSQL (`@prisma/adapter-pg`) · jose (JWT) + bcryptjs + утасны OTP · firebase-admin (FCM push) · QPay (төлбөр) · ebarimt · HUR (машины мэдээлэл) · Leaflet/Google Maps · ExcelJS, @react-pdf/renderer · Anthropic SDK (super admin AI туслах).

> `AGENTS.md`-д анхааруулсны дагуу Next 16-д `middleware.ts` → `proxy.ts` болсон; төсөл үүнийг зөв хэрэглэж байна.

### 1.2 Логик давхаргууд
```
UI (RSC + client components)  ─┐
Server Actions (app/_actions)  ├─►  Domain commands/queries (lib/**)  ─►  Prisma (RLS extension)  ─►  PostgreSQL
REST /api/v1/* (мобайл)        ─┘            │
                                              ├─ Интеграц: QPay, SMS, FCM, HUR, ebarimt, email
                                              └─ Cron (/api/cron/*, CRON_SECRET)
```
Сайн шийдвэр: вэб Server Action болон мобайл REST хоёр **нэг domain command-ыг** дууддаг (жишээ нь `commitDiagnosticReportCommand`, `order-commands`, `appointment-commands`). Ингэснээр бизнес дүрэм давхардахгүй, "create/patch parity" тестүүд (`order-create-patch-parity`) байна.

### 1.3 Multi-tenancy ба RLS (хамгийн хүчтэй хэсэг)
- `lib/prisma.ts`: Prisma `$allOperations` extension нь query бүрийн өмнө нэг transaction дотор `set_config('app.tenant_id'|'app.bypass_rls', …, true)` тавина. Context тохируулаагүй бол **throw** хийнэ (чимээгүй хоосон үр дүн буцаахгүй) — fail-closed.
- `AsyncLocalStorage`-ийн Node 22 gotcha (await-ын өмнө context тавих, `return await`) баримтжсан, `als-return-await.test.ts` тестээр хамгаалсан.
- Давхар хамгаалалт: application-level `where tenantId` + DB-level RLS + `customerOwnershipFilters` (эзэмшигчийн түүх).
- **Эрсдэл/зардал:** query бүр 2 round-trip (`set_config` + query) transaction болдог тул "N+1" төрлийн endpoint нэмэгдүүлнэ. `SerializedPgClient` нь Prisma 7-ийн зэрэгцээ child query ба pg-ийн нэг client дээрх зэрэг query-н зөрчлийг тойрсон workaround — pg@9 болон Prisma шинэчлэлтээр эвдрэх магадлалтай нүд. Pool = Vercel дээр 1, VPS дээр 10.

### 1.4 Authentication / Authorization
- 3 realm тус бүр тусдаа cookie + JWT + refresh token (rotation, reuse detection, grace), тусдаа API token (`api`, `account-api`, `system-api`); `auth-token-isolation.test.ts`-ээр шалгагдана.
- `proxy.ts` зөвхөн JWT-ийг шалгадаг (хурдан), DB-ээр хүчингүй болсон session-ийг хуудас/`requireUser` шалгана — loop үүсэхгүй байхаар зохиосон. Ажилтны session DB-backed (төхөөрөмж харах/revoke).
- Нэвтрэлтийн lockout (5 буруу → 15 мин) тенант болон system realm-д.
- RBAC: нөөц бүр view/create/edit/delete; **3 давхарга** (системийн editable role → байгууллагын override → ажилтны хязгаарлалт), effective permission томьёо `lib/auth/effective-permissions.ts`, DB predicate `effective-where.ts`.
- Cron хамгаалалт: Bearer + timing-safe харьцуулалт, `?secret=` query сул тал арилгасан (`cron-auth.ts`).

### 1.5 Интеграц ба асинхрон ажил
- **Notification төв**: `NOTIFICATION_REGISTRY` (Record нь бүх type-ийг шаардах тул мартагдахгүй), DB-д хадгалж дараа нь best-effort push, `dedupeKey`-ээр idempotent. 3 хүлээн авагч (User/Account/SuperAdmin) XOR check constraint-тэй.
- **QPay**: платформ (багц, цаг захиалгын хураамж) ба тенант тус бүрийн QPay тохиргоо тусдаа; callback route: `appointments/qpay/callback`, `subscriptions/qpay/callback`.
- **Cron 8 ширхэг**: appointment-reminders, expire-appointments, expire-subscriptions, subscription-reminders, service-reminders, credit-scores, deactivate-expired-users, notifications-prune. Нэг зохицуулагчгүй (job queue, retry, dead-letter байхгүй) — зөвхөн HTTP-ээр дуудагдана.
- **AI туслах** (`lib/ai/data-agent.ts`): агент өгөгдөл шууд бичихгүй, зөвхөн `propose_*` → хүн батлах загвар; `MAX_ITERATIONS`, `MAX_PROPOSALS_PER_TURN`, мессежийн урт хязгаартай. Зөв аюулгүй загвар.

### 1.6 Байршуулалт
Прод: нэг VPS (Ubuntu, nginx → PM2 `carcare` port 3020), `UPLOAD_DIR` local диск. Vercel-ийн урьдчилсан дэмжлэг (pool, idle timeout) кодод байгаа боловч прод VPS.

### 1.7 Архитектурын эрсдэл (эрэмбээр)
| # | Эрсдэл | Нөлөө | Зөвлөмж |
|---|---|---|---|
| A1 | **Нэг instance, нэг VPS** — SPOF, rolling deploy байхгүй | Дууссан үед бүх тенант унана | 2+ instance (PM2 cluster/2 VPS) + нэмэлт health check; DB-г managed болгох эсвэл replica |
| A2 | **In-memory rate limit** (`lib/rate-limit.ts`) — process бүрт тусдаа; restart-д алга болно | Олон instance болоход хамгаалалт сулрана | Redis/DB-backed store (интерфэйс аль хэдийн тусгаарлагдсан) |
| A3 | **Local файл хадгалалт** (`/uploads`) | Олон instance-д үл нийцнэ; backup/CDN байхгүй | S3-нийцтэй object storage + signed URL |
| A4 | **CI/CD байхгүй** (`.github` алга) — 2 136 тест гараар ажилладаг | Regression deploy-д орно | GitHub Actions: lint + tsc + test + `prisma migrate diff`; автомат preview |
| A5 | **Cron-д queue/retry байхгүй** | Push/SMS унавал алдагдана (best-effort) | Outbox table + worker, эсвэл QStash/pg-boss |
| A6 | **RLS per-query transaction** | Өндөр ачаалалд latency 2× | `SET LOCAL`-г request-д нэг удаа (interactive tx) эсвэл PgBouncer + тооцоолсон batching; slow query хэмжилт |
| A7 | **Observability хязгаарлагдмал** (console.warn) | Алдаа/латенси харагдахгүй | Sentry/OpenTelemetry, structured log, uptime монитор |
| A8 | CSP байхгүй (зориуд хойшлуулсан) | XSS-ийн нэмэлт давхарга дутуу | Nonce-based CSP-г report-only горимд эхлүүл |

---

## 2. Бизнес логикийн шинжилгээ

### 2.1 Домэйн загвар
**Tenant** → Branch → (User, Employee schedule) · **Customer** (тенант тус бүрийн) ↔ **Account** (глобал, утсаар) · **Vehicle** (эзэмшигчийн бүртгэл) ↔ **TenantVehicle** · **ServiceOrder** (+ServiceItem, OrderPayment, OrderTimeBooking, DiagnosticReport) · **Appointment** (+AppointmentPayment) · **Cash** (CashSession, CashTransaction, PostpaidSettlement) · **Subscription/Plan** · **Notification/Feedback/Review/QuoteRequest/TenantPhoto**.

### 2.2 Гол урсгалууд ба дүрмүүд
1. **Цаг захиалга (Appointment).** Салбарын ажлын хуваарь + улирлын/онцгой өдрийн хуваарь + ажилтны хуваарь → slot тооцоо → **reservation lock** (`withBookingTransaction`, нэг холболт дээр) давхар захиалгаас хамгаална. Хураамж (super admin тохируулна, үнэгүй болгож болно) QPay-аар төлөгдөнө; цуцлах/хугацаа дуусах/no-show/дахин товлох/refund тус бүр тусдаа command + мэдэгдэл.
2. **Засварын хуудас (ServiceOrder).** SCHEDULED → IN_PROGRESS → COMPLETED/CANCELLED. Алхам бүр `canEditOrder`, салбарын scope, түгжигдсэн төлөв (`isOrderLocked`) шалгана. Захиалгын мөр (ажил/сэлбэг/хураамж), хүлээн авалтын (intake) snapshot — өөрчлөхгүй түгжигддэг (түүх тогтвортой). `plateSnapshot/vinSnapshot/isPostpaid` snapshot хэв маяг зөв.
3. **Төлбөр ба касс.** Касс (ээлж) нээх нь тенантаар заавал/сонголттой (`requireCashSession`); хаасан ээлжийн гүйлгээг шууд засахгүй — reverse/void command-тай. Дараа тооцоо (гэрээт машин) → нэхэмжлэх (PostpaidSettlement). Дотоод (internal) захиалга ба postpaid хоёр нэгэн зэрэг үнэн байж болохгүй (**DB CHECK constraint**).
4. **Оношилгоо.** Template (системийн + тенантын, grant-тай) → report (хувилбарын snapshot `templateVersion`) → захиалгын мөрийг атомаар COMPLETED болгоно (захиалгын row lock дор). **Шинэ:** тайлан үүссэн даруй үйлчлүүлэгчийн апп руу push (§6.3).
5. **Багц (Plan).** FREE үнэгүй, BUSINESS QPay, ENTERPRISE үнийн санал; **тоон хязгааргүй, модулиар ялгана**, багцаас гадуурх дэлгэц нуугдана (lock биш). Хугацаа дуусахад cron `expire-subscriptions`.
6. **Credit score.** Тенантын 0–100 оноо өдөр бүр cron-оор; бага бол нийтээс нуух/түр хаах (платформын тохиргоо), super admin ±50 засвар, `creditExempt`.
7. **Vehicle per-owner.** 2026-09-21-ээс Vehicle = эзэмшигчийн бүртгэл (plate/vin unique биш, шинэ эзэн → шинэ мөр) — түүхийн нууцлал (өмнөх эзний тайлан харагдахгүй) бизнесийн зөв шийдвэр.
8. **Системийн STAFF.** Харилцагч бүртгэх (эзэн SMS-ээр идэвхжүүлнэ), засах, түр хаах; эрхийн хязгаар, аудит.

### 2.3 Бизнес логикийн давуу тал
- Мөнгө `Decimal(12,2)`, API-д string — floating-point алдаа байхгүй.
- Санхүүгийн мөрүүд `onDelete: Restrict` (33 Restrict vs 63 Cascade) — түүх санамсаргүй устахгүй.
- Idempotency (`dedupeKey`, QPay callback), атомар commit + upload cleanup (`commitWithReportUploadCleanup`).
- Аудит лог (`AuditLog`, `SystemAuditLog`, redact helper — PII/нууцыг цэвэрлэнэ).

### 2.4 Бизнес логикийн сул/эрсдэлтэй хэсэг
- **Мэдэгдлийн хүлээн авагчийн холболт ялгаатай:** `order_*` мэдэгдэл `appointment.accountId`-аар, тайлан/сануулга `Customer.accountId`-аар явдаг. Утсаар холбогдсон (`phone` match) ч `accountId`-гүй Customer-д мэдэгдэл **очдоггүй** — апп-д харагддаг түүх (phone-match) ба мэдэгдлийн хүрээ таарахгүй. Нэг `resolveAccountRecipient(customer)` helper болгох нь зүйтэй.
- **Staff refresh token-ы ротаци атомик биш** (customer/system-тэй адил compare-and-set биш) — `docs/mobile-tasks.md`-д тэмдэглэгдсэн, race үед давхар эрхтэй token гарах боломжтой.
- **ROOT админы вэб нэвтрэлтэд хугацаат түгжээ байхгүй** (зөвхөн мобайл system realm-д).
- Cron-ийн «нэг удаа ажиллах» баталгаа (distributed lock) байхгүй — 2 instance болбол сануулга давхар явах эрсдэлтэй (`dedupeKey` зарим дээр хамгаалдаг).
- `Tenant.name` DB-д unique биш (зориуд) — UX түвшинд л шалгадаг; хууран мэхлэлт (impersonation)-ийн эрсдэл бага боловч байна.

---

## 3. Шаардлагын шинжилгээ

### 3.1 Функциональ шаардлага (хэрэгжилтийн төлөв)
| Модуль | Төлөв | Тайлбар |
|---|---|---|
| Олон тенант, салбар, ажлын хуваарь | ✅ | улирал, онцгой өдөр, ажилтны segment |
| RBAC (3 давхарга) | ✅ | |
| Захиалга, мөр, хүлээн авалт, PDF | ✅ | A4/80мм |
| Төлбөр, касс, дараа тооцоо, QPay, ebarimt | ✅ | |
| Цаг захиалга + хураамж + refund | ✅ | |
| Оношилгоо (template/report/PDF/OBD) | ✅ | + мэдэгдэл (шинэ) |
| Нөөцийн тооллого, тайлан, Excel export/import | ✅ | |
| Мэдэгдлийн төв, push, төхөөрөмж | ✅ | |
| Үнэлгээ, санал хүсэлт, үнийн санал | ✅ | |
| Зургийн галерей, газрын зураг | ✅ | |
| System admin/STAFF | ✅ | мобайл system realm |
| AI туслах (катлог өгөгдөл) | ✅ | proposal-only |
| Мобайл (Tenant апп) нүүр/эрх/зураг/импорт | ⚠️ хэсэгчилсэн | `docs/mobile-tasks.md` — P1/P2 олон ☐ |
| Мобайл (Customer) refresh token, галерей, хураамж | ⚠️ | мөн адил |
| OpenAPI spec | ❌ | зөвхөн `/page/api-docs` хуудас |
| Тайлангийн (report created) push → апп дээр deep-link | ⚠️ | backend бэлэн; апп `type=diagnostic_report_created`-г холбох ёстой |

### 3.2 Функциональ бус шаардлага
| Шинж чанар | Одоогийн байдал | Үнэлгээ | Цоорхой / Зөвлөмж |
|---|---|---|---|
| **Аюулгүй байдал** | RLS, realm тусгаарлал, lockout, HSTS/nosniff/XFO, SVG upload хориглосон, magic-byte MIME шалгалт, cron timing-safe, secrets git-д орохгүй (`.gitignore`) | Сайн | CSP, Redis rate limit, 2FA (ажилтан), нууц үгийн бодлого шалгах, dependency audit автомат |
| **Хүртээмж/Найдвартай байдал** | Нэг VPS, PM2, boot-д env шалгалт (`instrumentation.ts`), pool warm-up | Дунд | HA, DB backup автоматжуулалт (`pg_dump` гараар), health/uptime, graceful deploy |
| **Гүйцэтгэл** | 154 индекс, хуудаслалт, Prisma `select`; per-query tx | Сайн/Дунд | EXPLAIN хэмжилт, slow query лог, `discover` жагсаалтыг кэшлэх (ISR/runtime cache) |
| **Масштаблах** | Stateless боловч rate-limit/upload/cron state-тэй | Дунд | §1.7 A2/A3/A5 |
| **Хадгалах (Maintainability)** | TS strict-тэй төстэй, `any` 38, том domain модулиуд, тест өргөн, монгол тайлбар | Сайн | Хэт том файлууд (§4.3) |
| **Тестлэх** | 2 136 тест (unit + source-pattern + route) | Сайн | E2E (Playwright) байхгүй; DB-тэй integration тест "probe" хэлбэрээр л |
| **Нийцэл/Нууцлал** | PII mask, audit redact, account устгах (`account-closure`), `/privacy`, `/terms` | Сайн | Өгөгдөл хадгалах хугацааны бодлого, export (эрх) |
| **Локализац** | Бүх UI монгол, огноо `Asia/Ulaanbaatar` (`booking-time`) | Сайн | i18n framework байхгүй (англи хэл хэрэггүй бол зүгээр) |
| **Ажиглалт** | Аудит лог, history log | Дунд | §1.7 A7 |

---

## 4. Кодын чанарын шинжилгээ

### 4.1 Давуу тал
- **Domain command загвар** (`lib/**/…-commands.ts`) — UI-аас бизнес дүрэм салсан, dependency injection-тэй (`DiagnosticReportCommitDependencies`) тул unit тестлэх боломжтой.
- **Алдааны загвар:** `{error, code, fieldErrors}` — тогтмол; `action-errors.ts`, `prisma-errors.ts`.
- **Хамгаалалтын тестүүд** — тус бүр нь "яагаад" гэдгийг тайлбарласан (`security-audit-fixes`, `auth-race-hardening`, `files-cron-hardening`, `input-validation-hardening`).
- **Хууль тогтоох шиг дэс дараатай тайлбар:** schema дээрх коммент нь бизнес шийдвэр, түүх (D-xxx, QA #xx) хадгалсан — мэдлэгийн хөрөнгө.
- Өөрийн ESLint дүрэм (`eslint-rules/`) — төслийн онцлог алдааг (жишээ нь `return await` ALS) автоматаар барина.
- Zod 4 баталгаажуулалт, `lib/env.ts` boot-д env шалгана.

### 4.2 Анхаарах зүйл
- **Төрлийн аюулгүй байдал:** `any` бага (38) — сайн. `Json` талбарууд (`data`, `intakeChecklist`, `creditBreakdown`) runtime schema-гүй хадгалагддаг — Zod-оор унших үед баталгаажуулах.
- **Давхардал:** `notification-client-href.ts` ба `firebase-messaging-sw.js` нь `NOTIFICATION_REGISTRY.href`-ийн логикийг гараар давхардуулдаг (3 газар). Шинэ type нэмэх бүрт 3 файл — мартагдах эрсдэл. Зөвлөмж: href map-ийг цэвэр (server-free) модуль болгож, SW build-д үүсгэх; төрөл бүрийн тест нэмэх.
- **CRLF/LF холимог** (Windows autocrlf) — source-pattern тестүүд мөр таслалтад мэдрэмтгий (энэ session-д тестийг normalize хийж шийдсэн). Нэмэх: `.gitattributes` `* text=auto eol=lf`.
- **Source-pattern тестүүд** (regex-ээр код шалгах) ойлгомжтой боловч код refactor хийхэд эвдэрнэ; жинхэнэ behavior тест (mock Prisma) хийх боломжтой газарт солих.

### 4.3 Том файлууд (рефакторын нэр дэвшигч)
`discover-client.tsx` 1 608 · `_actions/orders.ts` 1 444 · `api-docs/tenant-docs.tsx` 1 026 · `admin-sidebar.tsx` 1 021 · `_actions/auth.ts` 1 003 · `schedule-grid.tsx` 959 · `_actions/appointments.ts` 928. Server action-ууд domain command руу аль хэдийн шилжиж байгаа (зөв чиглэл) — үлдсэн логикийг мөн шилжүүл; `discover-client`-ийг газрын зураг/жагсаалт/шүүлт гэж хуваа.

### 4.4 Next.js 16 тусгай
`proxy.ts`, `instrumentation.ts`, Server Actions `bodySizeLimit 4mb` (storage 2MB-тай зөв уялдсан). `allowedDevOrigins` нь LAN IP-г хатуу кодолсон — dev-only, прод-д нөлөөгүй.

---

## 5. Өгөгдлийн сангийн бүтцийн шинжилгээ

### 5.1 Ерөнхий
72 model, 32 enum, 157 migration, 154 индекс. Нэршил тогтвортой, schema дотор бизнес тайлбар (монголоор) бий. `tenantId` 153 газар — бараг бүх бизнес хүснэгт тенант-scoped.

### 5.2 Давуу тал
- **RLS** + `FORCE` схем; migration бүрт нь дагалддаг (21).
- **DB түвшний CHECK / partial unique index**: internal ≠ postpaid, Notification XOR, `Customer(tenantId, phone) WHERE accountId IS NULL` — апп-ын логикт найдахгүй.
- Мөнгө `Decimal(12,2)`; snapshot талбарууд (plate, vin, isPostpaid, intakeChecklist, templateVersion) түүхийн тогтвортой байдлыг хангана.
- Cascade/Restrict бодлого утгатай: тенант устахад түүх дагаж устах (Cascade) боловч санхүүгийн `OrderPayment` Restrict.
- `dedupeKey @unique` — идемпотент мэдэгдэл.

### 5.3 Эрсдэл ба сайжруулалт
| # | Асуудал | Нөлөө | Санал |
|---|---|---|---|
| D1 | `Vehicle.plate` unique биш, `@@index([plate])` л | Давхардсан дугаар олон мөр (зориудын шийдвэр) — хайлтын чанар | Идэвхтэй эзэмшигчийн partial unique/`isCurrent` флаг |
| D2 | `Json` талбарууд (diagnostic `data`, `intakeChecklist`, `creditBreakdown`) | Бүтцийн эвдрэл унших үед илэрнэ | Zod schema + хувилбар (`schemaVersion`) |
| D3 | `Notification` хүснэгт хугацаагаар өснө (cron prune байгаа) | Хүснэгт том болбол `accountId,readAt` индекс хангалтгүй болж болно | `(accountId, createdAt desc)` индекс, партишнинг (хэрэв >10M) |
| D4 | Soft-delete тогтмол биш (`User.deletedAt` бий; бусад Cascade) | Өгөгдөл сэргээх бодлого тодорхойгүй | Хадгалах хугацаа + архивын бодлого баримтжуул |
| D5 | Migration 157 — `prisma migrate deploy` + `pg_dump` гар ажиллагаа | Алдааны эрсдэл | Автомат pre-deploy backup + migration dry-run CI-д |
| D6 | RLS bypass (`setBypassContext`) өргөн хэрэглэгддэг (cron, super admin, public) | Нэг алдаа тенант тусгаарлалтыг тойрно | Bypass дуудлагыг grep-тэй лавлагаа/тестээр хязгаарла (allow-list тест) |
| D7 | Файлууд DB-д зөвхөн зам (`/uploads/...`), диск ↔ DB зөрөх (orphan) | Хаягдсан файл | Орфан цэвэрлэгээний cron + object storage |

### 5.4 Индексийн зөвлөмж
Өргөн хэрэглэгддэг шүүлтүүрүүд (`tenantId + status + scheduledAt`, `tenantId + branchId + createdAt`, `Appointment` slot хайлт) индекстэй эсэхийг `EXPLAIN (ANALYZE)`-ээр прод өгөгдөл дээр баталгаажуул; `pg_stat_statements` идэвхжүүл.

---

## 6. UI/UX шинжилгээ

### 6.1 Бүтэц ба хэв маяг
- **Гурван өөр гадаргуу:** маркетинг (`/page/landing`), ажилтны dashboard (sidebar + branch switcher), үйлчлүүлэгчийн (`/discover`, `/account`). Дүр (persona: manager/mechanic/frontdesk/cashier) -ээр нүүр дэлгэц, KPI/widget дараалал (`dashboard-persona`, `dashboard-focus`) — **мэргэжлийн, хэрэглэгч төвтэй шийдэл.**
- Дараагийн алхмын санал (`next-action`), onboarding checklist, shop-name gate — ашиглагчийг чиглүүлэх сайн UX.
- Дизайн токен (`--oc-*`) — Claude Design экспортоос ирсэн; нягт, вэб-стандарт, тухтай layout (landing `max-w-7xl` лавлагаа) — өмнөх шийдвэртэй нийцнэ.

### 6.2 Давуу тал
- Бүх талбарт тодорхой монгол алдааны мессеж, `fieldErrors`-ийг талбар дээр харуулах контракт.
- Баталгаажуулах цонх (`confirm-action`), bulk action, жагсаалтын хайлт/эрэмбэ/шүүлт/хуудаслалт тогтмол.
- Календарь/хуваарийн grid, газрын зураг (Leaflet) + кластер — домэйнд тохирсон.
- Хэвлэх/PDF (A4, 80мм), Excel — бодит ажлын урсгалд.
- Usability тестүүд (`mechanic-usability`, `driver-booking-usability`) — хэрэглэгчийн дүрээр шалгадаг (ховор давуу тал).

### 6.3 Мэдэгдэл (UX, энэ session-ийн өөрчлөлт)
Тайлан үүссэн даруй үйлчлүүлэгч: **«Оношилгооны тайлан бэлэн боллоо»** — «{Байгууллага}: {улсын дугаар} — {загварын нэр} тайлан бэлэн боллоо.» FCM data: `type, reportId, orderId`; вэб deep-link `/account/diagnostics/{reportId}`. Мэдэгдлийн төвд хадгалагдана, давхар явахгүй.

### 6.4 Сул тал / саналууд
| # | Ажиглалт | Санал |
|---|---|---|
| U1 | Том client component-ууд (189 `"use client"`) | Боломжтой газар RSC болгож JS багасга; Lighthouse/CWV хэмж |
| U2 | Хүртээмж (a11y) — формын `aria`, фокус, өнгөний контраст (cyan брэнд) системтэйгээр шалгагдаагүй (кодод a11y тест харагдсангүй) | axe-core/Playwright a11y тест; контраст WCAG AA |
| U3 | Мобайл вэб: `admin-sidebar` 1 000+ мөр, нарийн дэлгэц дээрх хүснэгтүүд | Хүснэгт → карт харагдац (хариу өгөх) шалгах |
| U4 | Loading/skeleton ба optimistic UI нэгдсэн хэв маягтай эсэх тодорхойгүй | Shared `Skeleton`/`EmptyState` стандарт |
| U5 | Мобайл апп UX-ийн өргөн хийгдээгүй ажил (P1/P2) | `docs/mobile-tasks.md`-ийн P1-ээс эхэл |
| U6 | Онбординг/тусламж (`/manual`, `/help`) байгаа — агуулгын хуучраалт | Хувилбар бүрт шалгах checklist |

---

## 7. Аюулгүй байдлын нарийвчилсан дүгнэлт

**Хүчтэй:** DB RLS fail-closed · realm тусгаарлал · refresh rotation + reuse detection · lockout · `x-real-ip` дээр суурилсан IP (XFF spoof сэргийлсэн) · SVG upload хориг + magic-byte шалгалт · AI агент proposal-only · cron timing-safe · audit redact · PII mask · HSTS/nosniff/XFO · secrets `.gitignore`-д.

**Анхаарах (эрэмбээр):**
1. In-memory rate limit → олон instance-д тойрогдоно (A2).
2. CSP байхгүй (A8).
3. Staff refresh token ротаци атомик биш.
4. ROOT админ вэб lockout байхгүй.
5. QPay callback-ийн гарын үсэг/IP баталгаажуулалт QPay-ийн боломжоор хязгаарлагдсан → callback-аар ирсэн төлбөрийг **заавал QPay check API-аар дахин баталгаажуулах** (зарим route `check` байгаа — callback дээр ч адил эсэхийг шалга).
6. `dependabot`/`npm audit` автомат шалгалт байхгүй.
7. Upload: MIME шалгана; нэмж хэмжээ/зургийн хэмжээсийн хязгаар (decompression bomb), EXIF цэвэрлэгээ.
8. Secrets менежмент: `secrets/firebase-adminsdk.json` файл дээр; прод-д env/secret manager руу.

---

## 8. Эрэмбэлсэн roadmap

### Эхний 2 долоо хоног (өндөр өгөөж, бага эрсдэл)
1. GitHub Actions CI: `lint`, `tsc`, `npm test`, `prisma validate`.
2. `.gitattributes` (`eol=lf`) — CRLF-ээс үүдэх тестийн эвдрэл.
3. Мэдэгдлийн `href` давхардлыг нэг эх сурвалж болгох + type бүрт тест.
4. Мэдэгдлийн хүлээн авагчийг нэг helper-ээр (`resolveAccountRecipient`) нэгтгэх.
5. Автомат `pg_dump` (cron) + restore шалгалт.
6. Мобайл апп: `diagnostic_report_created` → тайлан руу deep-link.

### 1–2 сар
7. Redis/DB-backed rate limit; cron-д distributed lock.
8. Object storage (S3) + orphan цэвэрлэгээ.
9. Sentry/OpenTelemetry + uptime монитор.
10. OpenAPI spec (Zod-оос үүсгэх) — мобайл багт гэрээ.
11. Staff refresh token compare-and-set; ROOT lockout.
12. Nonce-based CSP (report-only → enforce).

### 3–6 сар
13. 2+ instance / HA, DB replica, blue-green deploy.
14. Outbox + worker (push/SMS retry).
15. Playwright E2E (захиалга → төлбөр → тайлан; цаг захиалга), a11y тест.
16. Том файлуудыг задлах, `discover-client`, `_actions/orders.ts`.
17. RLS-ийн гүйцэтгэлийн оновчлол (tx-ийн тоо багасгах), `pg_stat_statements` дагуу индекс.

---

## 9. Дүгнэлт

Энэ нь «MVP»-ээс хол давсан, **бизнесийн нарийн дүрэм, аюулгүй байдлын гүн, тестийн өргөнтэй** платформ. Техникийн өр нь ихэвчлэн код биш, **үйл ажиллагаа ба масштаблалт** (CI, HA, observability, shared state) дээр төвлөрч байна. Дээрх roadmap-ын 1–6-р алхмуудыг хийснээр эрсдэлийн ихэнхийг бага зардлаар бууруулж болно.

### Хавсралт A — Энэ session-д нэмсэн функц (тайлан үүсэхэд мобайл мэдэгдэл)
- `lib/notifications.ts` — шинэ type `diagnostic_report_created` (account realm, `dedupeKey: diagnostic_report_created:{reportId}`, href `/account/diagnostics/{reportId}`).
- `lib/diagnostic-report-notify.ts` — `notifyDiagnosticReportCreated(reportId)`; walk-in (accountId=null), тест тенант, дотоод засварт илгээхгүй; алдаа залгина.
- Дуудах цэг: `app/api/v1/diagnostics/reports/route.ts` (мобайл API) ба `app/_actions/diagnostic-reports.ts` (вэб) — commit амжилттай болсны дараа.
- Deep link: `lib/notification-client-href.ts`, `public/firebase-messaging-sw.js`.
- Тест: `tests/diagnostic-report-notification.test.ts` (4/4), `tsc` цэвэр.
- Мобайл апп талд хийх: FCM `data.type === "diagnostic_report_created"` үед `data.reportId`-аар `GET /api/v1/app/diagnostics/{id}` дэлгэц нээх.
