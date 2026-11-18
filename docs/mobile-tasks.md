# Мобайл апп-уудын хийгдээгүй ажлууд

Backend (энэ репо) талд бэлэн болсон боловч мобайл апп талд **хараахан холбогдоогүй** зүйлсийн жагсаалт.
Бүх endpoint-ийн дэлгэрэнгүй: `/page/api-docs` (Хэрэглэгч · Байгууллага · System таб).
Төлөв: ☐ хийгдээгүй · Хамаарал нь «Backend» баганад.

Апп-ууд:
- **Tenant апп** — байгууллагын ажилтан (User realm, `/api/v1/*`)
- **Customer апп** — машин эзэмшигч (Account realm, `/api/v1/app/*`)
- **System апп** — платформын админ / System ажилтан (`/api/v1/system/*`) — **шинэ**, одоогоор апп байхгүй

---

## 1. System апп (шинэ) — P1

System ажилтан (STAFF) зөвхөн мобайлаар нэвтэрнэ (вэб `/system`-д орж чадахгүй).

| ☐ | Ажил | Backend |
|---|------|---------|
| ☐ | Нэвтрэх дэлгэц (имэйл + нууц үг). 429 = түгжигдсэн (5 буруу → 15 мин), нэг төрлийн 401 мессеж | `POST /system/auth/login` |
| ☐ | Token хадгалалт (secure storage) + 401 дээр автоматаар refresh, refresh ротацитай (хуучин нь нэг л удаа); `reused` → бүх төхөөрөмж гарсан, дахин нэвтрүүл | `POST /system/auth/refresh` |
| ☐ | Гарах: `refreshToken` revoke + локал token устгах | `POST /system/auth/logout` |
| ☐ | Анхны нэвтрэлтэд нууц үг солиулах (root анхны нууц үгийг тохируулдаг). Амжилттай бол ШИНЭ token хос ирнэ — хуучныг солих | `PUT /system/me/password` |
| ☐ | `me.permissions`-оор цэс/товчийг нуух (`tenants.view/create/edit/suspend`); сервер дахин шалгана | `GET /system/me` |
| ☐ | Харилцагчийн жагсаалт: хайлт (`q`), шүүлтүүр (`status`), pagination; эзний «идэвхжээгүй» тэмдэг (`owner.activated=false`) | `GET /system/tenants` |
| ☐ | Харилцагчийн дэлгэрэнгүй (мэдээлэл, эзэн, үндсэн салбар, зураг байхгүй одоогоор) | `GET /system/tenants/{id}` |
| ☐ | Шинэ харилцагч бүртгэх форм: регистрээр хайх (`/auth/signup/lookup`, `/auth/signup/address`), газрын зураг дээр байршил (lat/lng заавал), нууц үг БИШ. 409/422 `fieldErrors`-ийг талбар дээр харуулах | `POST /system/tenants` |
| ☐ | Бүртгэсний дараа эзэнд SMS код илгээх товч + «дахин илгээх» (`THROTTLED` 429, `SMS_FAILED` 502, `ALREADY_ACTIVE` 409 боловсруулах), `maskedPhone` харуулах | `POST /system/tenants/{id}/owner/activation-code` |
| ☐ | Мэдээлэл засах форм (PATCH — зөвхөн өөрчилсөн талбарыг илгээ; имэйл/утас2 `""`=цэвэрлэх; салбарын lat+lng хамт). `PLAN` 403 (онлайн цаг захиалгыг дэмжихгүй багц) | `PATCH /system/tenants/{id}` |
| ☐ | Түр хаах / дахин нээх (баталгаажуулах цонхтой) | `POST /system/tenants/{id}/suspend` · `/activate` |
| ☐ | (Хожим) ROOT админ мобайлаар нэвтрэх — realm бэлэн, `me.kind=ROOT` үед нэмэлт цэс | — |

Анхаар: ажилтанд орлого/зээл/багц/захиалга харагдахгүй — тэдгээрийг харуулах UI хийх хэрэггүй. Эзний нэвтрэх утас/имэйлийг PATCH-ээр солих боломжгүй.

---

## 2. Tenant апп (ажилтан) — P1/P2

| ☐ | Ажил | Backend |
|---|------|---------|
| ☐ P1 | **Дүрээр тохирсон нүүр дэлгэц**: `persona` (manager/mechanic/frontdesk/cashier) ба `layout.kpis/main/side`-ээр карт, widget-ийг дараалуулан зурах; `X-Working-Branch` header дамжуулах | `GET /home` |
| ☐ P1 | **Эрх өөрчлөгдсөн үед нүүр/цэсээ шинэчлэх**: `GET /me` (permissions эффектив — ролийн override + ажилтны хязгаарлалт тооцсон) апп нээгдэх/сэргэх бүрд | `GET /me` |
| ☐ P1 | **Байгууллагын зураг** (эзэн): жагсаалт, олон зураг сонгож оруулах (`files`, нэг удаад ≤6, ≤2MB, PNG/JPG/WEBP — оруулахаас өмнө client дээр шахах), устгах; 12-ийн дээд хязгаар (`409 LIMIT`) | `GET/POST /tenant/photos`, `DELETE /tenant/photos/{id}` |
| ☐ P1 | **Салбарын зураг** (`branches.edit` эрхтэй): салбар засах дэлгэцэд ижил менежер (`branchId`) | мөн адил |
| ☐ P2 | **Ролийн эрх тохиргоо** (эзэн): «өөрчилж болох» эрх бүрийг switch-ээр нэмэх/хасах; түгжигдсэн эрхийг (`LOCKED`) идэвхгүй харуулах | `GET /roles/overrides`, `GET/PUT /roles/{id}/override` |
| ☐ P2 | **Ажилтны эрхийн хязгаарлалт**: ажилтан бүрээс эрх хасах switch (нэмэх боломжгүй); `OWNER_TARGET/SELF/SUPERIOR_TARGET` 403-ыг тайлбарлах | `GET/PUT /employees/{id}/restrictions` |
| ☐ P2 | **Excel-ээс ажилтан оруулах**: .xlsx сонгох → preview (багана автоматаар таарсан, мөрийн алдаа, давхцал) → засаад импорт; хэсэгчилсэн амжилт (`succeeded/failed/results`) | `POST /employees/import/preview`, `POST /employees/import` |
| ☐ P2 | **Excel-ээс үйлчилгээ оруулах** (ижил урсгал) | `POST /services/import/preview`, `POST /services/import` |
| ☐ P2 | **PDF хэвлэх/хуваалцах**: захиалгын нэхэмжлэх (`format=a4|80mm`), тооцооны нэхэмжлэх; native share sheet / Bluetooth принтер | `GET /orders/{id}/pdf`, `GET /cash/settlements/{id}/pdf` |
| ☐ P2 | **Эхлэх жагсаалт (onboarding checklist)** ба «дараагийн алхам» зөвлөмж: захиалгын дэлгэцэд next-action banner | `GET /overview`, `GET /home`, захиалгын хариу |
| ☐ P3 | Үйлчлүүлэгчийн профайл (түүх, машин) дэлгэц | `GET /customers/{id}`, `/customers/{id}/history` |
| ☐ P3 | Төхөөрөмжийн push-ийн мэдэгдлийн төвийг (`Notification`) апп дотор жагсаах | `docs/mobile-device-push.md` |

---

## 3. Customer апп — P1/P2

| ☐ | Ажил | Backend |
|---|------|---------|
| ☐ P1 | **Token хугацаа + refresh рүү шилжих**: нэвтрэхдээ `supportsRefresh: true` илгээх → 1 цагийн access + 90 хоногийн refresh (ротаци, 60с grace). 401 дээр `POST /app/auth/refresh`, гарахад `POST /app/auth/logout`. Хуучин хугацаагүй token дэмжигдсэн хэвээр, гэхдээ бүх хэрэглэгч шинэчлэгдсэний дараа `ACCOUNT_LEGACY_TOKENS_UNTIL` тавина (backend/ops) | `POST /app/auth/{verify-otp,login-password,refresh,logout}` |
| ☐ P1 | **Байгууллага/салбарын зураг**: `org.photos` (байгууллагын) ба `branches[].photos` (салбарын) — дэлгэрэнгүй дэлгэцэд галерей (swipe + томруулах); `url` нь харьцангуй (`/uploads/...`) → base URL залгах; хоосон бол хэсгийг нуух | `GET /app/orgs/{slug}` |
| ☐ P2 | Нууц үгээр нэвтрэх/нууц үг тохируулах (`hasPassword` дээр үндэслэн сонголт харуулах) | `POST /app/auth/login-password`, `PUT /app/account/password` |
| ☐ P2 | Цаг захиалгын хураамж: байгууллага/дэлгэц дээр хураамжийг урьдчилж харуулах, `payBy` хугацаа, QPay төлбөр | `GET /app/booking-fee`, appointment fee обьект |

---

## 4. Backend талд үлдсэн (мобайл хамаарал бүхий)

| ☐ | Ажил |
|---|------|
| ☐ | **Прод deploy** (5 migration): өмнө `pg_dump`, `UPLOAD_DIR` persistent байх |
| ☐ | `ACCOUNT_LEGACY_TOKENS_UNTIL` env-г customer апп шинэчлэгдсэний дараа тавих |
| ☐ | System ажилтны анхны нууц үгийг root вэбээс үүсгэх (`/system/admins`, «Ажилтан» төрөл) — апп-д нэвтрэхэд шаардлагатай |
| ☐ | OpenAPI spec (одоо зөвхөн `/page/api-docs` хуудас) |
| ☐ | Staff `refresh-token.ts` дахь атомик бус ротаци (customer/system-тэй адил compare-and-set болгох) |
| ☐ | ROOT админы вэб нэвтрэлтэд хугацаат түгжээ (одоо зөвхөн мобайл system realm-д) |
| ☐ | System болон tenant нэвтрэх хуудсыг нэгтгэх (санал, шийдвэр хүлээгдэж байна) |
| ☐ | System tenant detail-д зургийн тоо/урьдчилж харах (одоогоор харуулахгүй) |

---

## Ерөнхий дүрэм (бүх апп)

- Алдааны хариу: `{ "error": "...", "code": "...", "fieldErrors": {...} }` — `fieldErrors`-ийг талбар дээр харуул, `code`-оор логик салга.
- Мөнгөний дүн `string`, огноо ISO.
- Файл upload: `multipart/form-data`; зургийг оруулахаас өмнө шахаж 2MB-аас бага болго.
- Realm-ууд хоорондоо token солилцохгүй: User (`api`), Account (`account-api`), System (`system-api`).
