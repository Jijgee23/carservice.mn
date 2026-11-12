import { Code, Endpoint, Section } from "../_shared";

const BEARER = "Bearer (Ажилтан)";

export function StaffDocs() {
  return (
    <>
      {/* --- Ажилтан, үүрэг, эрх --- */}
      <Section title="17. Ажилтан, үүрэг, эрх">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Байгууллагын ажилтнууд (<code className="font-plex-mono text-[var(--oc-muted2)]">User</code>), тэдний
          үүрэг (<code className="font-plex-mono text-[var(--oc-muted2)]">Role</code>) болон эрхийн каталог. Бүх
          алдаа <code className="font-plex-mono text-[var(--oc-muted2)]">{"{ error, code, fieldErrors? }"}</code>{" "}
          хэлбэртэй (эрхгүй үеийн 403 нь <code className="font-plex-mono text-[var(--oc-muted2)]">code</code>-гүй).
          Тенант админы (<code className="font-plex-mono text-[var(--oc-muted2)]">isOwner</code>) бүртгэлийг зөвхөн
          өөр админ өөрчилнө — эс бөгөөс 403 <code className="font-plex-mono text-[var(--oc-muted2)]">OWNER_ONLY</code>.
        </p>

        <Endpoint method="GET" path="/api/v1/employees" auth="bearer" bearerLabel={BEARER} tags={["Эрх: employees.view"]} title="Ажилтнуудын жагсаалт (нэр/имэйл/утсаар хайлт, салбар/үүрэг/идэвхээр шүүлт) + шүүлтийн чипүүд.">
          <Code>{`Query: ?q=&branchId=&roleId=&active=yes|no&page=&pageSize=|limit=   // pageSize ≤100 (default 50); бусад параметр → 422
Res: 200 { "employees": [EmployeeDto], "pagination": {...},
  "meta": { "branches": [{ "id": "...", "name": "...", "count": 4 }],   // шүүлтээс үл хамаарах тоо; салбаргүй бол { "id": "", "name": "Хуваарилагдаагүй" }
            "roles": [{ "id": "...", "name": "..." }] } }                 // идэвхтэй үүргүүд
EmployeeDto = { "id", "firstName", "lastName", "email", "phone", "isOwner": false, "roleId": "..."|null, "roleName": "..."|null,
  "isActive": true, "activeUntil": "ISO"|null, "tenantId", "branchId": "..."|null, "assignableBranchIds": ["..."],
  "verified": true,                 // OTP идэвхжүүлэлт хийсэн эсэх
  "deactivatedAt": "ISO"|null }     // ажилтан өөрөө түр хаасан (isActive=false = админ блоклосон)
422 { "error": "foo параметр танигдсангүй.", "code": "VALIDATION", "fieldErrors": { "foo": "..." } }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/employees" auth="bearer" bearerLabel={BEARER} tags={["Эрх: employees.create", "Багц идэвхтэй байх шаардлагатай"]} title="Шинэ ажилтан нэмэх — нууц үггүй, verified=false үүснэ; ажилтан анхны нэвтрэлтэд OTP-оор нууц үгээ үүсгэнэ.">
          <Code>{`Req:  { "lastName": "...", "firstName": "...", "email": "a@b.mn", "phone": "99112233",   // бүгд заавал; email lowercase болно, утас 8 оронтой
        "roleId": "...",                      // заавал (isOwner=true үед үл тооцно) — идэвхтэй, энэ тенантын үүрэг
        "branchId": "...", "assignableBranchIds": ["..."],   // заавал биш; нэмэлт салбараас үндсэн салбар хасагдана, бусад тенантынх шүүгдэнэ
        "isActive": true, "activeUntil": "2026-12-31",        // заавал биш; isActive default true
        "isOwner": true }                     // заавал биш — зөвхөн дуудагч өөрөө админ бол хүчинтэй (roleId=null болно)
Res:  201 { "employee": EmployeeDto }
400 { "error": "JSON body шаардлагатай.", "code": "VALIDATION" }
403 { "error": "...", "code": "SUBSCRIPTION_EXPIRED" }
422 { "error": "Оруулсан мэдээлэл буруу.", "code": "VALIDATION", "fieldErrors": { "lastName" | "firstName" | "email" | "phone" | "roleId" | "branchId" | "activeUntil": "..." } }
422 { "error": "Давхцал байна.", "code": "DUPLICATE", "fieldErrors": { "phone": "Энэ утасны дугаар аль хэдийн бүртгэгдсэн байна." } }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/employees/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: employees.view"]} title="Нэг ажилтны дэлгэрэнгүй.">
          <Code>{`Res: 200 { "employee": EmployeeDto }
404 { "error": "Ажилтан олдсонгүй.", "code": "NOT_FOUND" }   // байхгүй / устгагдсан / өөр тенант`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/employees/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: employees.edit", "Багц идэвхтэй байх шаардлагатай"]} title="Ажилтны мэдээлэл засах — бүх талбарыг бүтнээр нь илгээнэ (whole-record replace). Нууц үг энд солигдохгүй.">
          <Code>{`Req:  { "lastName", "firstName", "email", "phone", "roleId", "branchId"?, "assignableBranchIds"?, "isActive"?, "activeUntil"? }
      // POST-той ижил шалгалт (roleId заавал), isOwner хүлээн авахгүй. Илгээгээгүй isActive → true болно.
      // Админ (isOwner) ажилтны roleId/isActive/activeUntil хэвээр үлдэнэ — зөвхөн профайл засагдана.
Res:  200 { "employee": EmployeeDto }
403 { "error": "Тенант админы бүртгэлийг зөвхөн админ өөрчилнө.", "code": "OWNER_ONLY" }
404 { "error": "Ажилтан олдсонгүй.", "code": "NOT_FOUND" }
409 { "error": "Тенант админы үүргийг өөрчилж болохгүй.", "code": "OWNER_ROLE_LOCKED", "fieldErrors": { "roleId": "..." } }
409 { "error": "Та өөрийн үүргийг өөрчлөх боломжгүй.", "code": "SELF_ACTION", "fieldErrors": { "roleId": "..." } }
422 { "code": "VALIDATION" | "DUPLICATE", "fieldErrors": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/employees/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: employees.delete", "Багц идэвхтэй байх шаардлагатай"]} title="Ажилтан устгах (soft delete) — бүх session, refresh token, push төхөөрөмж нь цуцлагдана.">
          <Code>{`Res: 200 { "employee": { "id": "..." } }
403 { "code": "OWNER_ONLY" }
404 { "error": "Ажилтан олдсонгүй.", "code": "NOT_FOUND" }
409 { "error": "Та өөрийгөө устгах боломжгүй.", "code": "SELF_ACTION" }
409 { "error": "Сүүлийн админыг устгах боломжгүй.", "code": "LAST_OWNER" }
409 { "error": "Энэ ажилтанд 3 нээлттэй захиалга хуваарилагдсан байна. Эхлээд өөр ажилтанд шилжүүлнэ үү.", "code": "OPEN_ORDERS" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/employees/[id]/reset-password" auth="bearer" bearerLabel={BEARER} tags={["Эрх: employees.edit", "Багц идэвхтэй байх шаардлагатай"]} title="Ажилтны нууц үгийг хүчингүй болгох (passwordHash=null, verified=false) — дараагийн нэвтрэлтэд OTP + шинэ нууц үгийн урсгал руу орно. Нууц үг үүсгэж буцаахгүй; одоогийн session хэвээр.">
          <Code>{`Req:  (body байхгүй)
Res:  200 { "employee": { "id": "..." } }
403 { "code": "OWNER_ONLY" }
404 { "error": "Ажилтан олдсонгүй.", "code": "NOT_FOUND" }
409 { "error": "Та өөрийн нууц үгээ энд шинэчлэх боломжгүй.", "code": "SELF_ACTION" }   // өөрийнхөө — POST /me/password ашиглана`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/employees/[id]/toggle-active" auth="bearer" bearerLabel={BEARER} tags={["Эрх: employees.edit", "Багц идэвхтэй байх шаардлагатай"]} title="Ажилтныг идэвхтэй / идэвхгүй (админ блок) болгох.">
          <Code>{`Req:  { "isActive": true | false }   // хүссэн шинэ төлөв; true-оос бусад бүх утга → false
Res:  200 { "employee": { "id": "...", "isActive": false } }
400 { "error": "JSON body шаардлагатай.", "code": "VALIDATION" }
403 { "code": "OWNER_ONLY" }
404 { "error": "Ажилтан олдсонгүй.", "code": "NOT_FOUND" }
409 { "error": "Та өөрийгөө идэвхгүй болгох боломжгүй.", "code": "SELF_DEACTIVATE" }
409 { "error": "Сүүлийн админыг идэвхгүй болгох боломжгүй.", "code": "LAST_OWNER" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/employees/bulk" auth="bearer" bearerLabel={BEARER} tags={["Эрх: employees.edit", "Багц идэвхтэй байх шаардлагатай"]} title="Олон ажилтны үүрэг ба/эсвэл үндсэн салбарыг нэг дор солих — мөр тус бүрээр (бүгд эсвэл юу ч биш биш).">
          <Code>{`Req:  { "employeeIds": ["...", "..."], "roleId": "...", "branchId": "..." }   // ids ≥1; roleId/branchId-ийн дор хаяж нэг
Res:  200 { "succeeded": 2, "failed": 1, "errors": ["Овог Нэр: Тенант админыг өөрчлөх боломжгүй."] }
      // Зарим/бүх мөр амжилтгүй байсан ч 200 — мөрийн алдаа errors-д. Админ (isOwner) ажилтан үргэлж алдаа.
422 { "error": "Үүрэг эсвэл салбарын аль нэгийг сонгоно уу." | "Сонгосон үүрэг олдсонгүй эсвэл идэвхгүй байна."
      | "Сонгосон салбар олдсонгүй." | "Дор хаяж нэг ажилтан сонгоно уу.", "code": "VALIDATION" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/roles" auth="bearer" bearerLabel={BEARER} tags={["Эрх: employees.view / employees.create / employees.edit (аль нэг)"]} title="Тенантын үүргүүд (идэвхтэй нь эхэндээ, нэрээр) — ажилтны формын үүрэг сонгогчид.">
          <Code>{`Query: ?page=&pageSize=|limit=   // бусад параметр → 422 VALIDATION
Res: 200 { "roles": [{ "id": "...", "name": "Менежер", "description": "..."|null, "permissions": ["orders.view", ...], "isActive": true }],
           "pagination": {...} }
403 { "error": "Танд энэ үйлдэл хийх эрх байхгүй." }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/roles" auth="bearer" bearerLabel={BEARER} tags={["Зөвхөн эзэн"]} title="Шинэ үүрэг үүсгэх (зөвхөн тенант админ).">
          <Code>{`Req:  { "name": "Менежер",            // заавал, ≤60 тэмдэгт, тенант дотор давтагдахгүй
        "description": "...",          // заавал биш
        "permissions": ["orders.view", "orders.edit", ...],   // ≥1 (GET /permissions-ийн code-ууд)
        "isActive": true }             // заавал биш, default true
      // orders.edit/editOwn сонгосон бол orders.view/viewOwn заавал; orders.edit → orders.view заавал (fieldErrors.orderScopes)
Res:  201 { "role": { "id", "name", "description", "permissions", "isActive" } }
403 { "error": "Зөвхөн тенант админ үүргийг удирдана." }
422 { "error": "Оруулсан мэдээлэл буруу.", "code": "VALIDATION", "fieldErrors": { "name" | "permissions" | "orderScopes": "..." } }
422 { "error": "Энэ нэртэй үүрэг аль хэдийн байна.", "code": "DUPLICATE", "fieldErrors": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/roles/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: employees.view / employees.create / employees.edit (аль нэг)"]} title="Нэг үүргийн дэлгэрэнгүй.">
          <Code>{`Res: 200 { "role": { "id", "name", "description", "permissions", "isActive" } }
404 { "error": "Үүрэг олдсонгүй.", "code": "NOT_FOUND" }`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/roles/[id]" auth="bearer" bearerLabel={BEARER} tags={["Зөвхөн эзэн"]} title="Үүрэг засах — name, description, permissions, isActive-ийг бүтнээр нь илгээнэ.">
          <Code>{`Req:  { "name": "...", "description": "...", "permissions": [...], "isActive": true }   // POST-той ижил шалгалт
Res:  200 { "role": {...} }
403 { "error": "Зөвхөн тенант админ үүргийг удирдана." }
404 { "error": "Үүрэг олдсонгүй.", "code": "NOT_FOUND" }
422 { "code": "VALIDATION" | "DUPLICATE", "fieldErrors": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/roles/[id]" auth="bearer" bearerLabel={BEARER} tags={["Зөвхөн эзэн"]} title="Үүрэг устгах — тухайн үүрэгтэй ажилтан байхгүй үед л.">
          <Code>{`Res: 200 { "role": { "id": "..." } }
403 { "error": "Зөвхөн тенант админ үүргийг удирдана." }
404 { "error": "Үүрэг олдсонгүй.", "code": "NOT_FOUND" }
409 { "error": "Энэ үүрэгтэй 2 ажилтан байна. Эхлээд тэдний үүргийг солино уу.", "code": "ROLE_IN_USE" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/permissions" auth="bearer" bearerLabel={BEARER} tags={["Эрх: employees.view / employees.create / employees.edit (аль нэг)"]} title="Эрхийн каталог (тенантаас үл хамаарна) — үүргийн эрх сонгогч бүтээхэд.">
          <Code>{`Res: 200 { "groups": [{ "group": "...", "items": [{ "code": "orders.view", "label": "...", "description": "..." }] }],
           "standalone": [{ "code": "...", "label": "...", "description": "...", "group": "..." }] }
403 { "error": "Танд энэ үйлдэл хийх эрх байхгүй." }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Ээлжийн хуваарь --- */}
      <Section title="18. Ажилтны ээлжийн хуваарь">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          <code className="font-plex-mono text-[var(--oc-muted2)]">/api/v1/employee-schedules/*</code> нь{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">enable_staff_schedule</code> («Ажлын хувиар»)
          модуль шаардана — багцад ороогүй бол 403{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">{`{ "code": "MODULE_DISABLED", "module": "enable_staff_schedule" }`}</code>.
          Нүд бүрийн хуваарь: тусгай өдөр (<code className="font-plex-mono text-[var(--oc-muted2)]">exception</code>) →
          долоо хоногийн гараг (<code className="font-plex-mono text-[var(--oc-muted2)]">weekly</code>) → үндсэн
          салбарын цаг (<code className="font-plex-mono text-[var(--oc-muted2)]">default</code>) дарааллаар шийдэгдэнэ.
          Гараг: <code className="font-plex-mono text-[var(--oc-muted2)]">MON TUE WED THU FRI SAT SUN</code>.
        </p>

        <Endpoint method="GET" path="/api/v1/employee-schedules" auth="bearer" bearerLabel={BEARER} tags={["Эрх: employees.view", "Модуль: enable_staff_schedule"]} title="Ажилтан × өдрийн хуваарийн хүснэгт (долоо хоног эсвэл сар).">
          <Code>{`Query: ?view=week|month (default week) &date=YYYY-MM-DD (default өнөөдөр) &branchId= (үндсэн салбар) &q= (нэр/үүрэг)
Res: 200 { "view": "week", "dates": ["2026-11-09", ...],
  "rows": [{ "id": "<userId>", "name": "...", "roleName": "..."|null, "homeBranchId": "..."|null, "homeBranchName": "..."|null,
             "cells": { "2026-11-09": { "weekday": "MON", "working": true, "source": "exception" | "weekly" | "default",
               "segments": [{ "branchId", "branchName", "startTime": "09:00"|null, "endTime": "18:00"|null, "customTime": true }] } } }],
  "branches": [{ "id", "name", "openTime", "closeTime", "schedules": [{ "weekday", "isOpen", "openTime", "closeTime" }] }],
  "countByBranch": { "<branchId>": 5 }, "totalEmployees": 12,
  "canEdit": true }   // employees.schedule эрхтэй эсэх — PUT/DELETE/bulk дуудаж болох эсэх
400 { "error": "view утга буруу байна." | "date утга буруу байна." | "foo параметр танигдсангүй.", "code": "VALIDATION", "fieldErrors": {...} }
403 { "error": "...", "code": "MODULE_DISABLED", "module": "enable_staff_schedule" }`}</Code>
        </Endpoint>

        <Endpoint method="PUT" path="/api/v1/employee-schedules/[userId]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: employees.schedule", "Модуль: enable_staff_schedule"]} title="Нэг ажилтны нэг өдрийн (scope=date) эсвэл байнгын гарагийн (scope=weekday) хуваарь тохируулах. Нэг өдөр хэд хэдэн салбарт ажиллаж болно.">
          <Code>{`Req:  { "scope": "date" | "weekday",
        "date": "2026-11-12",          // scope=date үед заавал
        "weekday": "MON",              // scope=weekday үед заавал (date-ээс өөр scope бүр weekday гэж тооцогдоно)
        "isWorking": true,             // true-оос бусад → амарна (segments үл тооцно)
        "segments": [{ "branchId": "...", "startTime": "09:00", "endTime": "13:00" }] }
      // isWorking=true үед segments ≥1; branchId энэ тенантынх; цаг HH:MM, хоёулаа эсвэл хоёулаа хоосон (null = салбарын цаг), end > start
Res:  200 { "message": "Хадгалагдлаа.", "scope": "date", "date": "2026-11-12" }   // эсвэл "scope": "weekday", "weekday": "MON"
400 { "error": "Огноо буруу." | "Гараг буруу.", "code": "VALIDATION" }
400 { "error": "Алдаа гарлаа.", "code": "VALIDATION", "fieldErrors": { "segments": "Дор хаяж нэг салбар сонгоно уу." } }
404 { "error": "Ажилтан олдсонгүй.", "code": "NOT_FOUND" }   // өөр тенант / өөрөө хаасан / устгагдсан ажилтан`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/employee-schedules/[userId]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: employees.schedule", "Модуль: enable_staff_schedule"]} title="Тохируулсан хуваарийг (override) арилгаж анхны утга руу буцаах.">
          <Code>{`Query: ?scope=date&date=YYYY-MM-DD  эсвэл  ?scope=weekday&weekday=MON
Res: 200 { "scope": "date" | "weekday" }   // мөр байгаагүй ч 200
400 { "error": "Огноо эсвэл гараг буруу байна.", "code": "VALIDATION" }
404 { "error": "Ажилтан олдсонгүй.", "code": "NOT_FOUND" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/employee-schedules/bulk" auth="bearer" bearerLabel={BEARER} tags={["Эрх: employees.schedule", "Модуль: enable_staff_schedule"]} title="Олон (ажилтан × өдөр/гараг) нүдэнд ижил хуваарь нэг дор тохируулах.">
          <Code>{`Req:  { "scope": "date" | "weekday", "isWorking": true,
        "segments": [{ "branchId": "...", "startTime": "09:00", "endTime": "18:00" }],   // PUT-тэй ижил шалгалт
        "targets": [{ "userId": "...", "date": "2026-11-12" }, { "userId": "...", "weekday": "TUE" }] }   // ≥1
      // Буруу огноо/гараг, өөр тенантын / хаасан ажилтан бүхий target чимээгүй алгасагдана; weekday давхардал нэг удаа бичигдэнэ.
Res:  200 { "message": "5 байршил шинэчлэгдлээ.", "applied": 5 }
400 { "error": "Дор хаяж нэг нүд сонгоно уу." | "Сонголт уншигдсангүй.", "code": "VALIDATION" }
400 { "error": "Алдаа гарлаа.", "code": "VALIDATION", "fieldErrors": { "segments": "..." } }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/me/schedule" auth="bearer" bearerLabel={BEARER} title="Өөрийн нэг сарын шийдэгдсэн хуваарь (эрх шаардахгүй, зөвхөн өөрийнх). Модулийн хаалтгүй.">
          <Code>{`Query: ?month=YYYY-MM   // заавал биш, default энэ сар
Res: 200 { "month": "2026-11", "dates": ["2026-11-01", ...],
           "row": { ...GET /employee-schedules-ийн rows[] мөр } | null,
           "cells": { "2026-11-01": { "weekday", "working", "source", "segments": [...] } },
           "branches": [{ "id", "name", "openTime", "closeTime", "schedules": [...] }] }
400 { "error": "month утга буруу байна." | "foo параметр танигдсангүй.", "code": "VALIDATION", "fieldErrors": {...} }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Миний бүртгэл --- */}
      <Section title="19. Миний бүртгэл, session">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Бүгд зөвхөн нэвтэрсэн ажилтны өөрийн бүртгэл дээр ажиллана (эрх шаардахгүй). Session жагсаалт нь веб
          (<code className="font-plex-mono text-[var(--oc-muted2)]">UserSession</code>,{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">source: &quot;web&quot;</code>) ба мобайл
          (<code className="font-plex-mono text-[var(--oc-muted2)]">RefreshToken</code>,{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">source: &quot;mobile&quot;</code>) хоёрыг нэгтгэнэ.
          Бүртгэл хаах (түр / бүрмөсөн) нь эхлээд SMS код авна:{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">close/request-otp</code> →{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">deactivate</code> эсвэл{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">delete</code>.
        </p>

        <Endpoint method="PATCH" path="/api/v1/me" auth="bearer" bearerLabel={BEARER} title="Өөрийн профайл засах — 4 талбарыг бүтнээр илгээнэ.">
          <Code>{`Req:  { "lastName": "...", "firstName": "...", "phone": "99112233",   // заавал; утас 8 оронтой
        "email": "a@b.mn" }                                             // хоосон бол null хадгалагдана; бусад үед имэйл формат, lowercase
Res:  200 { same shape as GET /api/v1/me }
400 { "error": "Body нь JSON байх ёстой." }
422 { "error": "Талбарын алдаа.", "code": "VALIDATION", "fieldErrors": { "firstName" | "lastName" | "email" | "phone": "..." } }
      // давхцал: { "phone": "Энэ утас өөр хэрэглэгчид бүртгэгдсэн байна." } | { "email": "Энэ имэйл өөр хэрэглэгчид бүртгэгдсэн байна." }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/me/password" auth="bearer" bearerLabel={BEARER} tags={["Буруу нууц үг: 5/15мин (хэрэглэгчээр)"]} title="Нууц үг солих. Амжилттай бол бусад бүх веб session болон refresh token цуцлагдана — энэ төхөөрөмжийн token (rtid claim) хэвээр.">
          <Code>{`Req:  { "currentPassword": "...", "newPassword": "минимум 8 тэмдэгт", "confirmPassword": "..." }
Res:  200 { "ok": true }
400 { "error": "Body нь JSON байх ёстой." }
422 { "error": "Талбарын алдаа.", "code": "VALIDATION", "fieldErrors": {
        "currentPassword": "Одоогийн нууц үгээ оруулна уу." | "Одоогийн нууц үг буруу.",
        "newPassword": "Шинэ нууц үг 8+ тэмдэгт байна." | "Шинэ нууц үг өмнөхөөс өөр байх ёстой.",
        "confirmPassword": "Нууц үг таарахгүй байна." } }
422 { "error": "Аккаунт идэвхжээгүй байна. Эхлээд нууц үгээ үүсгэнэ үү.", "code": "VALIDATION" }
429 { "error": "...", "code": "RATE_LIMITED" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/me/sessions" auth="bearer" bearerLabel={BEARER} title="Нэвтрэлтийн төхөөрөмж / түүх. active хуудаслагдахгүй; pagination нь зөвхөн ended (цуцлагдсан/дууссан)-д.">
          <Code>{`Query: ?page=&pageSize=|limit=   // бусад параметр → 422
Res: 200 { "active": [AccountSessionDto], "ended": [AccountSessionDto], "otherActiveCount": 2, "pagination": {...} }
AccountSessionDto = { "id": "...", "source": "web" | "mobile", "deviceLabel": "iPhone 15 Pro · iOS 18.1",
  "deviceType": "IOS" | "ANDROID" | null, "location": { "lat", "lng", "mapUrl" } | null, "ip": "..."|null,
  "createdAt": "ISO", "lastActivityAt": "ISO"|null, "expiresAt": "ISO", "revokedAt": "ISO"|null,
  "status": "active" | "revoked" | "expired",
  "current": true }   // энэ bearer-ийн өөрийн refresh token (rtid claim-гүй хуучин token-д аль ч мөр current биш)
422 { "code": "VALIDATION", "fieldErrors": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/me/sessions/[id]" auth="bearer" bearerLabel={BEARER} title="Нэг session / refresh token цуцлах. Өөрийн одоогийн token-ыг цуцалж болно (дараа нь апп локалаар гарна).">
          <Code>{`Query: ?source=web|mobile   // заавал — [id] аль хүснэгтийнх болохыг заана
Res: 200 { "ok": true }   // аль хэдийн цуцлагдсан ч 200 (idempotent)
404 { "error": "Олдсонгүй.", "code": "NOT_FOUND" }   // байхгүй эсвэл өөр хэрэглэгчийнх
422 { "error": "source нь web эсвэл mobile байх ёстой.", "code": "VALIDATION", "fieldErrors": { "source": "..." } }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/me/sessions/revoke-others" auth="bearer" bearerLabel={BEARER} title="Энэ төхөөрөмжөөс бусад бүх идэвхтэй веб session болон мобайл refresh token-ыг цуцлах.">
          <Code>{`Req:  (body байхгүй)
Res:  200 { "ok": true, "webRevoked": 1, "mobileRevoked": 2 }
      // Bearer token rtid claim-гүй (хуучин) бол ӨӨРИЙН token ч цуцлагдана — дараагийн хүсэлт 401 болж дахин нэвтэрнэ.`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/me/close/request-otp" auth="bearer" bearerLabel={BEARER} tags={["Rate limit: 5/10мин (IP)"]} title="Бүртгэл хаах (deactivate / delete) баталгаажуулах 6 оронтой кодыг бүртгэлтэй утас руу SMS-ээр илгээх.">
          <Code>{`Req:  { "purpose": "delete" }   // заавал биш (body хоосон байж болно); "delete" бол нээлттэй захиалгыг SMS илгээхээс өмнө шалгана
Res:  200 { "ok": true, "maskedPhone": "99***33" }
409 { "error": "Танд 2 нээлттэй захиалга хуваарилагдсан байна. Эхлээд админаар өөр ажилтанд шилжүүлүүлнэ үү.", "code": "OPEN_ORDERS" }
429 { "error": "Хэт олон хүсэлт илгээлээ. Түр хүлээгээд дахин оролдоно уу." }   // эсвэл OTP throttle мессеж`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/me/deactivate" auth="bearer" bearerLabel={BEARER} tags={["Rate limit: 10/10мин (IP)"]} title="Өөрийн бүртгэлийг түр хаах — бүх session, refresh token, push төхөөрөмж устгагдана. Нууц үгээрээ дахин нэвтрэхэд сэргэнэ (deactivatedAt цэвэрлэгдэнэ).">
          <Code>{`Req:  { "code": "123456" }   // close/request-otp-ээр ирсэн код
Res:  200 { "ok": true }
400 { "error": "JSON body шаардлагатай." } | { "error": "6 оронтой код шаардлагатай." }
422 { "error": "Код буруу эсвэл хугацаа дууссан.", "code": "OTP_INVALID" }
409 { "error": "Байгууллагын цорын ганц эзэмшигч аккаунтаа хааж болохгүй.", "code": "LAST_OWNER" }
429 { "error": "Хэт олон хүсэлт илгээлээ. ..." }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/me/delete" auth="bearer" bearerLabel={BEARER} tags={["Rate limit: 10/10мин (IP)"]} title="Өөрийн бүртгэлийг бүрмөсөн устгах (anonymize) — буцаагдахгүй. Захиалга/цагийн түүхэнд «Устгагдсан ажилтан» гэж үлдэнэ.">
          <Code>{`Req:  { "code": "123456" }   // close/request-otp { "purpose": "delete" }-ээр ирсэн код
Res:  200 { "ok": true }
400 { "error": "JSON body шаардлагатай." } | { "error": "6 оронтой код шаардлагатай." }
422 { "error": "Код буруу эсвэл хугацаа дууссан.", "code": "OTP_INVALID" }
409 { "error": "Танд 2 нээлттэй захиалга хуваарилагдсан байна. ...", "code": "OPEN_ORDERS" }
409 { "error": "Байгууллагын цорын ганц эзэмшигч аккаунтаа устгаж болохгүй.", "code": "LAST_OWNER" }
429 { "error": "Хэт олон хүсэлт илгээлээ. ..." }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Тооллого --- */}
      <Section title="20. Барааны тооллого">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          <code className="font-plex-mono text-[var(--oc-muted2)]">enable_inventory</code> («Нөөц») модуль
          шаардана — багцад ороогүй бол 403{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">MODULE_DISABLED</code>. Тооллого эхлүүлэхэд
          идэвхтэй бараа (GOODS)-ны системийн үлдэгдэл хормын хувилбараар мөр болно; нэг тенантад нэг л нээлттэй
          (<code className="font-plex-mono text-[var(--oc-muted2)]">DRAFT</code>) тооллого байна. Дуусгахад зөрүү
          үлдэгдэлд хэрэглэгдэнэ; цуцлахад үлдэгдэл өөрчлөгдөхгүй. Тоо хэмжээ, мөнгөн дүн бүгд string. Тооллого
          хийх эрхгүй бол 403 <code className="font-plex-mono text-[var(--oc-muted2)]">STOCK_COUNT_FORBIDDEN</code>.
        </p>

        <Endpoint method="GET" path="/api/v1/stock-counts" auth="bearer" bearerLabel={BEARER} tags={["Эрх: services.view", "Модуль: enable_inventory"]} title="Тооллогын түүх (30/хуудас, дугаараар буурахаар) + нээлттэй DRAFT + эхлүүлэх ангиллын сонголт.">
          <Code>{`Query: ?page=1
Res: 200 { "stockCounts": [{ "id", "number": 12, "label": "ТО-0012", "status": "DRAFT" | "COMPLETED" | "CANCELLED",
    "statusLabel": "Тоолж байна", "note": "..."|null, "categoryName": "..."|null, "createdAt", "completedAt"|null, "cancelledAt"|null,
    "lineCount": 40, "countedCount": 38, "diffCount": 3, "shortageValue": "12000", "surplusValue": "0",
    "createdBy": "Овог Нэр", "completedBy": "..."|null }],
  "page": 1, "total": 12, "totalPages": 1,
  "draft": { "id", "number", "label" } | null,
  "canStart": true,                                            // services.edit эрхтэй бөгөөд нээлттэй тооллого байхгүй
  "categories": [{ "id", "name", "goodsCount": 15 }] }        // services.edit эрхгүй бол []`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/stock-counts" auth="bearer" bearerLabel={BEARER} tags={["Эрх: services.edit", "Багц идэвхтэй байх шаардлагатай", "Модуль: enable_inventory"]} title="Шинэ тооллого эхлүүлэх (ангилал сонгоогүй бол бүх идэвхтэй бараа).">
          <Code>{`Req:  { "categoryId": "..." | null, "note": "..." | null }   // бүгд заавал биш, body хоосон байж болно; note ≤500 тэмдэгт (таслагдана)
Res:  201 { "stockCount": { "id": "...", "number": 13, "label": "ТО-0013" } }
400 { "error": "Өгөгдөл буруу байна.", "code": "VALIDATION", "fieldErrors": { "categoryId" | "note": "..." } }
409 { "error": "Нээлттэй тооллого (ТО-0012) байна — ...", "code": "STOCK_COUNT_DRAFT_EXISTS", "draftId": "..." }   // клиент тэр тооллогыг нээнэ
422 { "error": "Ангилал олдсонгүй.", "code": "STOCK_COUNT_INVALID", "fieldErrors": { "categoryId": "..." } }
422 { "error": "Тоолох идэвхтэй бараа алга.", "code": "STOCK_COUNT_EMPTY" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/stock-counts/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: services.view", "Модуль: enable_inventory"]} title="Тооллогын дэлгэрэнгүй (мөрүүдтэй).">
          <Code>{`Res: 200 { "stockCount": { ...жагсаалтын талбарууд,
  "editable": true,   // status=DRAFT бөгөөд services.edit
  "lines": [{ "id": "<lineId>", "serviceId", "name", "code"|null, "unit"|null, "costPrice": "..."|null,
              "systemQty": "5", "countedQty": "4"|null, "difference": "-1"|null }] } }
404 { "error": "Тооллого олдсонгүй.", "code": "STOCK_COUNT_NOT_FOUND" }`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/stock-counts/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: services.edit", "Багц идэвхтэй байх шаардлагатай", "Модуль: enable_inventory"]} title="Тоолсон тоог хадгалах — зөвхөн өөрчлөгдсөн мөрүүдийг илгээнэ.">
          <Code>{`Req:  { "lines": [{ "lineId": "...", "countedQty": "4.5" | 4 | null }] }   // null / "" = тоолоогүй; ≥0, 3 хүртэлх бутархай
Res:  200 { "ok": true, "saved": 2, "message": "2 мөр хадгалагдлаа." }
400 { "error": "Зарим мөр буруу байна.", "code": "VALIDATION", "fieldErrors": { "lines.0.lineId" | "<lineId>": "..." } }
404 { "code": "STOCK_COUNT_NOT_FOUND" }
409 { "error": "Энэ тооллого аль хэдийн хаагдсан.", "code": "STOCK_COUNT_NOT_DRAFT" }
422 { "error": "Зарим тоо буруу байна.", "code": "STOCK_COUNT_INVALID", "fieldErrors": { "<lineId>": "0-ээс их буюу тэнцүү тоо (3 хүртэлх бутархай)." } }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/stock-counts/[id]/complete" auth="bearer" bearerLabel={BEARER} tags={["Эрх: services.edit", "Багц идэвхтэй байх шаардлагатай", "Модуль: enable_inventory"]} title="Тооллого дуусгах — (байвал) хадгалагдаагүй мөрүүдийг эхлээд хадгалаад, зөрүүг барааны үлдэгдэлд хэрэглэнэ.">
          <Code>{`Req:  { "lines": [{ "lineId": "...", "countedQty": "4" }] }   // заавал биш — PATCH-тэй ижил шалгалт
Res:  200 { "ok": true, "message": "Тооллого дууслаа: 3 барааны үлдэгдэл засагдлаа.",
            "stockCount": { "id", "number", "label", "lineCount", "countedCount", "diffCount", "shortageValue", "surplusValue" } }
400 { "code": "VALIDATION", "fieldErrors": {...} }
404 { "code": "STOCK_COUNT_NOT_FOUND" }   409 { "code": "STOCK_COUNT_NOT_DRAFT" }
422 { "code": "STOCK_COUNT_INVALID", "fieldErrors": {...} }
422 { "error": "Нэг ч бараа тоолоогүй байна.", "code": "STOCK_COUNT_NOTHING_COUNTED" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/stock-counts/[id]/cancel" auth="bearer" bearerLabel={BEARER} tags={["Эрх: services.edit", "Багц идэвхтэй байх шаардлагатай", "Модуль: enable_inventory"]} title="Нээлттэй тооллогыг цуцлах (үлдэгдэл өөрчлөгдөхгүй).">
          <Code>{`Req:  (body байхгүй)
Res:  200 { "ok": true, "stockCount": { "id": "..." } }
404 { "error": "Тооллого олдсонгүй.", "code": "STOCK_COUNT_NOT_FOUND" }
409 { "error": "Энэ тооллого аль хэдийн хаагдсан.", "code": "STOCK_COUNT_NOT_DRAFT" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/reports/stock" auth="bearer" bearerLabel={BEARER} tags={["Эрх: services.view", "Модуль: enable_inventory + enable_reports", "branch-scoped"]} title="Сэлбэг барааны үлдэгдлийн тайлан. Үлдэгдэл бүх салбарт нэг; зарцуулалт (used*) нь ажиллах салбараар (X-Working-Branch) хязгаарлагдана.">
          <Code>{`Query: ?q= (нэр/код) &categoryId= &level=out|low|ok &inactive=1 (идэвхгүйг оруулах)
       &sort=name|stock|value|used (default name) &from=YYYY-MM-DD&to=YYYY-MM-DD (зарцуулалтын хугацаа, default энэ сар, ≤366 хоног)
Res: 200 { "range": { "from": "2026-11-01", "to": "2026-11-30", "label": "...", "key": "..." },
  "filters": { "q": null, "categoryId": null, "level": null, "inactive": false, "sort": "name" },
  "rows": [{ "id", "code"|null, "name", "category"|null, "unit"|null, "isActive", "stock": "5", "level": "out" | "low" | "ok",
             "costPrice": "..."|null, "price": "...", "stockCost": "..."|null, "stockRetail": "...", "usedQty": "...", "usedAmount": "..." }],
  "totals": { "items": 40, "outCount": 2, "lowCount": 5, "stockCost": "...", "missingCostCount": 1, "stockRetail": "...", "usedQty": "...", "usedAmount": "..." },
  "categories": [{ "id", "name" }] }
422 { "error": "...", "code": "VALIDATION", "fieldErrors": { "from" | "to" | "level" | "sort" | "<үл мэдэгдэх параметр>": "..." } }
403 { "error": "...", "code": "MODULE_DISABLED", "module": "enable_inventory" | "enable_reports" }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Үнэлгээ --- */}
      <Section title="21. Үнэлгээ">
        <Endpoint method="GET" path="/api/v1/reviews" auth="bearer" bearerLabel={BEARER} tags={["Эрх: customers.view", "branch-scoped"]} title="Үйлчлүүлэгчдийн үнэлгээ (шинэ нь эхэндээ) + салбаруудын дундаж. Ажиллах салбар (X-Working-Branch) тогтсон бол тэр салбараар.">
          <Code>{`Query: ?rating=1..5 &replied=yes|no &page= &pageSize=|limit= (default 50, ≤200)
Res: 200 { "reviews": [{ "id", "rating": 5, "comment": "..."|null, "reply": "..."|null, "repliedAt": "ISO"|null,
    "hidden": false, "createdAt": "ISO", "customerName": "..."|null, "branch": { "id", "name" },
    "order": { "id", "number" } | null }],   // null = засваргүйгээр салбарт шууд өгсөн үнэлгээ
  "branches": [{ "id", "name", "ratingAvg": 4.6, "ratingCount": 12 }],   // үнэлгээтэй салбарууд
  "hideBranches": true,   // ганц салбартай багц — UI-д салбарын нэрийг нуух
  "canReply": true,       // customers.edit
  "pagination": {...} }
400 { "error": "rating нь 1–5 бүхэл тоо байна." | "replied нь yes эсвэл no байна.", "code": "VALIDATION", "fieldErrors": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="PUT" path="/api/v1/reviews/[id]/reply" auth="bearer" bearerLabel={BEARER} tags={["Эрх: customers.edit"]} title="Үнэлгээнд нийтэд харагдах хариу бичих / засах. Хоосон (эсвэл null) reply → хариуг устгана.">
          <Code>{`Req:  { "reply": "Баярлалаа!" }   // ≤1000 тэмдэгт (trim хийгдэнэ)
Res:  200 { "ok": true, "reply": "Баярлалаа!" | null, "message": "Хариу хадгалагдлаа." | "Хариу устгагдлаа." }
400 { "error": "reply нь текст байна.", "code": "VALIDATION", "fieldErrors": { "reply": "Текст оруулна уу." } }
404 { "error": "Үнэлгээ олдсонгүй.", "code": "REVIEW_NOT_FOUND" }
422 { "error": "Хариу 1000 тэмдэгтээс хэтэрсэн байна.", "code": "REPLY_TOO_LONG" }`}</Code>
        </Endpoint>
      </Section>
    </>
  );
}
