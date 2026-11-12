import { Code, Endpoint, Section } from "../_shared";

const BEARER = "Bearer (Ажилтан)";
const C = "font-plex-mono text-[var(--oc-muted2)]";

export function TenantAdminDocs() {
  return (
    <>
      {/* --- Байгууллага бүртгүүлэх --- */}
      <Section title="13. Байгууллага бүртгүүлэх (mobile)">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Шинэ засвар (tenant) мобайл аппаас 2 алхмаар бүртгүүлнэ: (1){" "}
          <code className={C}>signup/request-otp</code> — талбаруудыг шалгаж, регистр/имэйл/утас давхцаагүй
          бол админы утсанд 6 оронтой код илгээнэ; (2) <code className={C}>signup</code> — ижил body +{" "}
          <code className={C}>code</code>-оор Tenant + «Үндсэн салбар» + эзэн (OWNER) хэрэглэгчийг үүсгэж шууд
          нэвтрүүлнэ (хариу <code className={C}>/auth/login</code>-тэй ижил). Шинэ байгууллага үнэгүй FREE
          багцтай эхэлнэ. <code className={C}>signup/lookup</code> ба <code className={C}>signup/address</code>{" "}
          нь формыг автоматаар бөглөх туслах endpoint.
        </p>

        <Endpoint
          method="GET"
          path="/api/v1/auth/signup/lookup"
          auth="public"
          tags={["Rate limit: 20/60с (IP)"]}
          title="Регистрээр байгууллага/хувь хүний нэрийг eBarimt-аас татах (1-р алхмын нэрийг бөглөх). Олдоогүй нь алдаа биш — нэрийг гараар бичнэ."
        >
          <Code>{`Query: ?regno=1234567 | ҮҮ99993333   // байгууллага 7 оронтой, хувь хүн 2 үсэг + 8 цифр
Res:  200 { "regno": "1234567", "kind": "org" | "person", "found": true, "name": "..." | null }
400 { "error": "Регистр буруу: ...", "code": "VALIDATION", "fieldErrors": { "registerNumber": "..." } }
429 { "error": "Хэт олон хүсэлт илгээлээ..." }
502 { "error": "Регистр шалгаж чадсангүй." }`}</Code>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/v1/auth/signup/address"
          auth="public"
          tags={["Rate limit: 20/60с (IP)"]}
          title="Газрын зураг дээр тэмдэглэсэн цэгийн хаяг (reverse geocode). Үр дүнг lat/lng-тэй хамт request-otp / signup руу илгээнэ."
        >
          <Code>{`Query: ?lat=47.9185&lng=106.9177   // заавал, lat -90…90, lng -180…180
Res:  200 { "city": "Улаанбаатар", "district": "...", "khoroo": "...", "address": "<бүтэн хаяг>" }
// city/district/khoroo — засаг захиргааны лавлахын нэр. Олдоогүй хэсэг "" — geocoding амжилтгүй бол бүгд "" (200).
400 { "error": "lat (-90…90), lng (-180…180) шаардлагатай.", "code": "VALIDATION" }
429 { "error": "Хэт олон хүсэлт илгээлээ..." }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/auth/signup/request-otp"
          auth="public"
          tags={["Rate limit: 5/60с (IP)"]}
          title="1-р алхам: талбар шалгаж, давхцал хайгаад админы утсанд SIGNUP OTP илгээх. «Код дахин илгээх» мөн энэ endpoint."
        >
          <Code>{`Req:  {
  "orgName": "...",                 // заавал — засварын нэр (хувь хүн бол овог нэр)
  "registerNumber": "1234567",      // заавал — 7 оронтой (байгууллага) эсвэл ҮҮ99993333 (хувь хүн)
  "phone1": "99112233",             // заавал, 8 оронтой (alias: "phone") — админы утас = нэвтрэх нэр
  "orgEmail": "...",                // заавал биш (alias: "email") — өгвөл админы имэйл болно
  "ownerName": "Овог Нэр",          // зөвхөн байгууллагын регистрт заавал (хувь хүнд orgName-ээс авна)
  "password": "минимум 8 тэмдэгт",  // заавал
  "passwordConfirm": "...",         // заавал биш — ирээгүй бол password-тай тэнцүү гэж үзнэ
  "latitude": 47.9185, "longitude": 106.9177,   // заавал — үндсэн салбарын байршил
  "city"?, "district"?, "khoroo"?, "address"?   // GET /auth/signup/address-ийн утгууд
}
Res:  200 { "sent": true, "maskedPhone": "99***33", "message": "Утас 99***33 руу 6 оронтой код илгээлээ." }
400 { "error": "...", "code": "VALIDATION", "fieldErrors": { "orgName" | "registerNumber" | "orgEmail" | "phone1" | "ownerName" | "latitude" | "password" | "passwordConfirm": "..." } }
409 { "error": "...", "code": "CONFLICT", "fieldErrors": { "registerNumber" | "orgEmail" | "orgName" | "phone1": "... аль хэдийн бүртгэгдсэн байна." } }
429 { "error": "<throttle мессеж>" }   // IP rate limit эсвэл хэт олон код хүссэн
502 { "error": "Баталгаажуулах код илгээгдсэнгүй. Утсаа шалгаж дахин оролдоно уу." }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/auth/signup"
          auth="public"
          tags={["Rate limit: 10/60с (IP)"]}
          title="2-р алхам: OTP баталгаажуулж байгууллага + үндсэн салбар (09:00–18:00, Да–Ба) + эзэн хэрэглэгч үүсгээд шууд нэвтрүүлэх."
        >
          <Code>{`Req:  { ...request-otp-тэй ИЖИЛ талбарууд, "code": "123456",   // 6 оронтой (alias: "otpCode")
        "type", "fcm", "model", "os", "loc"?, "deviceId"? }       // төхөөрөмжийн талбарууд /auth/login-тэй ижил
// login-оос ялгаатай нь төхөөрөмжийн талбар заавал биш — дутуу/буруу бол push төхөөрөмжгүйгээр нэвтэрнэ.
Res:  201 { same shape as /auth/login }   // accessToken, refreshToken, user { isOwner: true, tenant, branchId, ... }
400 { "error": "...", "code": "VALIDATION", "fieldErrors": {...} }   // request-otp-тэй ижил шалгалт
400 { "error": "6 оронтой код шаардлагатай.", "code": "VALIDATION", "fieldErrors": { "code": "..." } }
401 { "error": "Код буруу байна." | "Кодны хугацаа дууссан. Шинээр код илгээнэ үү." | "Хэт олон удаа буруу оролдсон. ...",
      "code": "OTP_INVALID", "fieldErrors": { "code": "..." } }
409 { "error": "...", "code": "CONFLICT", "fieldErrors": {...} }   // хооронд нь өөр хүн бүртгүүлсэн
500 { "error": "<алдааны мессеж>" }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Байгууллагын тохиргоо --- */}
      <Section title="14. Байгууллагын тохиргоо">
        <Endpoint
          method="GET"
          path="/api/v1/tenant"
          auth="bearer"
          bearerLabel={BEARER}
          title="Байгууллагын үндсэн мэдээлэл, лого, сануулгын хугацаа, credit, багц. Нэвтэрсэн бүх ажилтан уншина; засах эрхийг canEdit (= эзэн)-ээр мэдэгдэнэ."
        >
          <Code>{`Res: 200 {
  "tenant": { "id", "name", "registerNumber", "email": "..." | null, "phone1", "phone2": "..." | null,
    "logoUrl": "/uploads/..." | null, "acceptsOnlineBooking": false, "requireCashSession": true,
    "appointmentReminderLeadMinutes": 1440, "slug", "plan": "FREE" | "BUSINESS" | "ENTERPRISE", "createdAt",
    "creditScore": ... | null, "creditBreakdown": {...} | null, "creditUpdatedAt": "ISO" | null,
    "creditBlocked": "suspended" | "hidden" | null },
  "modules": { "onlineBooking": true, "appointments": true },   // багцад нээлттэй эсэх
  "canEdit": true }
404 { "error": "Байгууллага олдсонгүй.", "code": "NOT_FOUND" }`}</Code>
        </Endpoint>

        <Endpoint
          method="PATCH"
          path="/api/v1/tenant"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Зөвхөн эзэн"]}
          title="Үндсэн мэдээлэл ба/эсвэл цаг захиалгын сануулгын хугацааг хэсэгчлэн шинэчлэх. Ирээгүй талбар хэвээр, бүх шалгалт бичихээс өмнө."
        >
          <Code>{`Req:  {                                       // бүгд заавал биш, дор хаяж 1; өөр талбар илгээвэл 400
  "name": "...", "registerNumber": "1234567" | "ҮҮ99993333", "phone1": "99112233",   // string
  "email": "..." | null, "phone2": "88112233" | null,    // хоосон/null → арилгана
  "acceptsOnlineBooking": true, "requireCashSession": true,   // boolean
  "appointmentReminderLeadMinutes": 1440                 // бүхэл, 60-ийн үржвэр, 60…10080 (1 цаг – 7 хоног)
}
Res:  200 { GET-тэй ижил хэлбэр (шинэчлэгдсэн) }
400 { "error": "...", "code": "VALIDATION", "fieldErrors": { "<талбар>": "Тодорхойгүй талбар." | "Текст утга байх ёстой." | ... } }
400 { "error": "Шинэчлэх талбар илгээнэ үү.", "code": "VALIDATION", "fieldErrors": {} }
403 { "error": "Зөвхөн админ тохиргоог өөрчилнө." }
403 { "error": "Таны багц онлайн цаг захиалгыг дэмжихгүй байна. ...", "code": "MODULE_DISABLED", "fieldErrors": { "acceptsOnlineBooking": "..." } }
    // acceptsOnlineBooking (одоогийн эсвэл шинэ утга) true бөгөөд багцад online_booking модуль байхгүй
409 { "error": "...", "code": "CONFLICT", "fieldErrors": { "name" | "registerNumber" | "email": "..." } }   // давхцал
500 { "error": "Шинэчлэх явцад алдаа гарлаа." }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/tenant/logo"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Зөвхөн эзэн"]}
          title="Байгууллагын лого байршуулах (хуучныг устгана). multipart/form-data, PNG/JPG/WEBP, 2MB хүртэл (агуулгаар шалгана)."
        >
          <Code>{`Req:  multipart/form-data — file: <зураг>
Res:  200 { "logoUrl": "/uploads/logos/..." }
400 { "error": "Multipart form-data илгээнэ үү." }
400 { "error": "Файл сонгоно уу." | "<файлын шалгалтын алдаа>", "code": "VALIDATION", "fieldErrors": { "file": "..." } }
403 { "error": "Зөвхөн админ тохиргоог өөрчилнө." }`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/tenant/logo" auth="bearer" bearerLabel={BEARER} tags={["Зөвхөн эзэн"]} title="Логог устгах (файл + DB).">
          <Code>{`Res:  200 { "logoUrl": null }
403 { "error": "Зөвхөн админ тохиргоог өөрчилнө." }`}</Code>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/v1/tenant/qpay"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Зөвхөн эзэн"]}
          title="Байгууллагын өөрийн QPay merchant тохиргоо (захиалгын QPay төлбөрт). Нууц үг хэзээ ч буцаагдахгүй — зөвхөн hasPassword."
        >
          <Code>{`Res:  200 { "configured": true,
            "qpay": { "username": "...", "invoiceCode": "...", "callbackUrl": "..." | null, "enabled": true, "hasPassword": true } | null }
403 { "error": "Зөвхөн админ QPay тохиргоог удирдана." }`}</Code>
        </Endpoint>

        <Endpoint
          method="PUT"
          path="/api/v1/tenant/qpay"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Зөвхөн эзэн"]}
          title="QPay тохиргоо нэмэх/шинэчлэх (бүтэн бичлэг). password хоосон/ирээгүй бол хуучныг үлдээнэ; анх тохируулахад заавал."
        >
          <Code>{`Req:  { "username": "...", "invoiceCode": "...",   // заавал
        "password": "...",                           // анх удаа заавал, дараа нь заавал биш
        "callbackUrl": "..." | null,                 // ирээгүй/null бол арилна
        "enabled": true }                            // заавал биш, анхдагч true
Res:  200 { "configured": true, "qpay": {...GET-тэй ижил}, "created": true | false }
400 { "error": "...", "code": "VALIDATION", "fieldErrors": { "username" | "invoiceCode" | "password" | "callbackUrl" | "enabled": "..." } }
403 { "error": "Зөвхөн админ QPay тохиргоог удирдана." }
500 { "error": "Хадгалахад алдаа гарлаа." }`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/tenant/qpay" auth="bearer" bearerLabel={BEARER} tags={["Зөвхөн эзэн"]} title="QPay-г идэвхтэй/идэвхгүй болгох (switch).">
          <Code>{`Req:  { "enabled": true | false }   // заавал
Res:  200 { GET-тэй ижил хэлбэр }
400 { "error": "enabled (true/false) шаардлагатай.", "code": "VALIDATION", "fieldErrors": { "enabled": "..." } }
404 { "error": "QPay тохиргоо хийгдээгүй байна.", "code": "NOT_CONFIGURED" }`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/tenant/qpay" auth="bearer" bearerLabel={BEARER} tags={["Зөвхөн эзэн"]} title="QPay тохиргоог устгах.">
          <Code>{`Res:  200 { "ok": true }
404 { "error": "QPay тохиргоо хийгдээгүй байна.", "code": "NOT_CONFIGURED" }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Салбар удирдлага --- */}
      <Section title="15. Салбар удирдлага">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Бичих үйлдлүүд (POST/PATCH/DELETE) идэвхтэй багц шаардана — түгжигдсэн үед{" "}
          <code className={C}>403 {"{"} code: &quot;SUBSCRIPTION_EXPIRED&quot; {"}"}</code>. Хуваарь өөрчлөх
          (салбарын цаг, тусгай өдөр, улирал) нь ирээдүйн захиалгад нөлөөлөх бол{" "}
          <code className={C}>409 SCHEDULE_IMPACT</code> буцна:{" "}
          <code className={C}>needsConfirm: false</code> — захиалга бүрэн хүчингүй болох (erased) тул хатуу
          хориг, ажилтан эхлээд шийдвэрлэнэ; <code className={C}>needsConfirm: true</code> — зөвхөн богиносох
          (clipped), <code className={C}>impact</code> жагсаалтыг харуулаад ижил body +{" "}
          <code className={C}>&quot;confirm&quot;: true</code>-ээр дахин илгээвэл хадгалж, захиалгын хугацааг
          хаах цагт таарууллна.
        </p>

        <Endpoint
          method="GET"
          path="/api/v1/branches/switchable"
          auth="bearer"
          bearerLabel={BEARER}
          title="«Ажиллах салбар» сэлгэгчийн жагсаалт (идэвхтэй салбарууд; эзэн биш бол өөрийн/оноогдсон салбарууд). Нэмэлт эрх шаардахгүй."
        >
          <Code>{`Res:  200 { "branches": [{ "id", "name", "isPrimary": true, "district": "..." | null, "address": "..." | null,
                           "openTime": "09:00" | null, "closeTime": "18:00" | null }],   // үндсэн нь эхэндээ
            "allowAll": true,                 // «Бүх салбар» сонголт харуулах эсэх
            "lockedBranchId": "..." | null }  // өнөөдрийн ээлжийн хуваариар түгжигдсэн салбар`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/branches"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Эрх: branches.create", "Багц идэвхтэй байх шаардлагатай", "Модуль: enable_multi_branch (2 дахь салбараас)"]}
          title="Шинэ салбар үүсгэх. Тенантын анхны салбар автоматаар үндсэн болно; isPrimary=true бол бусдын үндсэн төлөв арилна."
        >
          <Code>{`Req:  { "name": "...",                       // заавал
        "tagIds": ["..."],                     // заавал, ядаж 1 (идэвхгүй/устсан шошго чимээгүй хасагдана)
        "phone"?: "99112233", "city"?, "district"?, "khoroo"?, "address"?,
        "latitude"?: -90…90, "longitude"?: -180…180,
        "openTime"?: "HH:MM", "closeTime"?: "HH:MM",   // ерөнхий цаг (closeTime > openTime)
        "slotMinutes"?: 5…480, "slotCapacity"?: 1…100,  // онлайн цаг захиалгын slot
        "isPrimary"?: false,
        "schedules"?: [{ "weekday": "MON"…"SUN", "isOpen": true, "openTime": "HH:MM", "closeTime": "HH:MM" }] }
      // schedules-д ирээгүй өдөр: Да–Ба нээлттэй. Нээлттэй өдөр цаггүй бол openTime/closeTime (эсвэл 09:00–18:00) өвлөнө.
Res:  201 { "branch": BranchDetail }   // GET /branches/[id]-тэй ижил
400 { "error": "...", "code": "VALIDATION", "fieldErrors": { "name" | "tagIds" | "phone" | "latitude" | "longitude" | "openTime" | "closeTime"
      | "slotMinutes" | "slotCapacity" | "schedule_MON_openTime" | "schedule_MON_closeTime" ...: "..." } }
403 { "error": "Танд энэ үйлдэл хийх эрх байхгүй." }
403 { "error": "...", "code": "SUBSCRIPTION_EXPIRED" }
403 { "error": "«Олон салбар» модуль таны багцад ороогүй байна. Багцаа ахиулна уу.", "code": "MODULE_DISABLED" }
500 { "error": "...", "code": "UNKNOWN" }`}</Code>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/v1/branches/[id]"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Эрх: branches.edit"]}
          title="Салбарын дэлгэрэнгүй (засах формын талбарууд + 7 хоногийн хуваарь + шошго + ажилтны тоо). Тенант доторх аль ч салбар."
        >
          <Code>{`Res:  200 { "branch": {
  "id", "name", "phone", "city", "district", "khoroo", "address", "latitude", "longitude",
  "openTime", "closeTime", "slotMinutes", "slotCapacity", "isPrimary", "isActive",
  "tags": [{ "id", "name" }], "tagIds": ["..."], "employeeCount": 4,
  "schedules": [{ "weekday": "MON", "isOpen": true, "openTime": "09:00", "closeTime": "18:00" }, ...7 өдөр MON→SUN],
  "createdAt", "updatedAt" } }
404 { "error": "Салбар олдсонгүй.", "code": "NOT_FOUND" }`}</Code>
        </Endpoint>

        <Endpoint
          method="PATCH"
          path="/api/v1/branches/[id]"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Эрх: branches.edit", "Багц идэвхтэй байх шаардлагатай"]}
          title="Салбар засах. Ирээгүй талбар/шошго/өдөр хэвээр; null нь талбарыг хоосолно. Үр дүнд салбар бүхэлдээ дахин хадгалагдана."
        >
          <Code>{`Req:  { ...POST /branches-тэй ижил талбарууд (бүгд заавал биш), "confirm"?: true }
Res:  200 { "branch": BranchDetail, "scheduleClipped": 0 }   // богиносгосон захиалгын тоо
400 { "error": "...", "code": "VALIDATION", "fieldErrors": {...} }
404 { "error": "Салбар олдсонгүй.", "code": "NOT_FOUND" }
409 { "error": "Үндсэн салбарыг идэвхгүй болгохын тулд эхлээд өөр салбарыг үндсэн болгоно уу.", "code": "PRIMARY_LOCKED" }   // үндсэн салбарт isPrimary=false
409 { "error": "...", "code": "SCHEDULE_IMPACT", "needsConfirm": true | false,
      "impact": { "erased": [{ "id", "kind": "APPOINTMENT" | "ORDER_TIME_BOOKING", "requestedAt", "originalDurationMinutes" }],
                  "clipped": [{ "id", "kind", "requestedAt", "durationMinutes", "originalDurationMinutes" }] } }
500 { "error": "...", "code": "UNKNOWN" }`}</Code>
        </Endpoint>

        <Endpoint
          method="DELETE"
          path="/api/v1/branches/[id]"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Эрх: branches.delete", "Багц идэвхтэй байх шаардлагатай"]}
          title="Салбар устгах. Үндсэн, ажилтантай, засварын хуудас/цаг захиалгатай салбарыг устгахгүй (оронд нь toggle-active)."
        >
          <Code>{`Res:  200 { "branch": { "id": "..." } }
404 { "error": "Салбар олдсонгүй.", "code": "NOT_FOUND" }
409 { "error": "Үндсэн салбарыг устгах боломжгүй. ...", "code": "PRIMARY_LOCKED" }
409 { "error": "Энэ салбарт 3 ажилтан бүртгэлтэй. Эхлээд тэднийг өөр салбар руу шилжүүлнэ үү.", "code": "HAS_EMPLOYEES" }
409 { "error": "Энэ салбарт засварын хуудас/цаг захиалга бүртгэлтэй тул устгах боломжгүй.", "code": "FK_CONFLICT" }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/branches/[id]/toggle-active"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Эрх: branches.edit", "Багц идэвхтэй байх шаардлагатай"]}
          title="Салбарын идэвхтэй/идэвхгүй төлөвийг сэлгэх. Body шаардлагагүй."
        >
          <Code>{`Res:  200 { "branch": { "id": "...", "isActive": false } }   // шинэ төлөв
404 { "error": "Салбар олдсонгүй.", "code": "NOT_FOUND" }
409 { "error": "Үндсэн салбарыг идэвхгүй болгохын тулд ...", "code": "PRIMARY_LOCKED" }   // идэвхтэй үндсэн салбар`}</Code>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/v1/branches/[id]/schedules"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Эрх: branches.edit"]}
          title="Салбарын хуваарь: долоо хоногийн үндсэн цаг + тусгай өдрүүд (exception) + улирлууд (season)."
        >
          <Code>{`Res:  200 {
  "branch": { "id", "name" },
  "baseDays": { "MON": { "isOpen": true, "openTime": "09:00", "closeTime": "18:00" }, ... "SUN": {...} },
  "exceptions": [{ "id", "date": "2026-12-31", "isOpen": false, "openTime": null, "closeTime": null, "label": "Шинэ жил" | null }],
  "seasons": [{ "id", "name", "startsOn", "endsOn", "isActive", "days": { "MON": { "isOpen", "openTime", "closeTime" }, ... } }],
  "tenantBranchCount": 3 }   // > 1 үед л «бүх салбарт» (POST /branches/schedules/holiday) санал болгоно
404 { "error": "Салбар олдсонгүй.", "code": "NOT_FOUND" }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/branches/[id]/schedules"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Эрх: branches.edit", "Багц идэвхтэй байх шаардлагатай"]}
          title="Тусгай өдөр (exception) эсвэл улирал (season) нэмэх. Хуваарийн нөлөөг SCHEDULE_IMPACT + confirm-оор шийднэ."
        >
          <Code>{`Req (exception): { "kind": "exception", "date": "YYYY-MM-DD", "isOpen": true,
                   "openTime"?: "HH:MM", "closeTime"?: "HH:MM",   // isOpen=true үед заавал
                   "label"?: "≤120 тэмдэгт", "confirm"?: true }
Req (season):    { "kind": "season", "name": "≤120 тэмдэгт", "startsOn": "YYYY-MM-DD", "endsOn": "YYYY-MM-DD",   // endsOn > startsOn
                   "days": { "MON": { "isOpen": true, "openTime": "HH:MM", "closeTime": "HH:MM" }, ... },   // ирээгүй өдөр хаалттай
                   "confirm"?: true }
Res:  201 { "kind": "exception" | "season", "id": "...", "created": true, "scheduleClipped": 0,
            "message": "Тусгай өдрийн хуваарь хадгалагдлаа.", "schedules": { GET-тэй ижил } }
400 { "error": "...", "code": "VALIDATION", "fieldErrors": { "kind" | "date" | "label" | "openTime" | "closeTime"
      | "name" | "startsOn" | "endsOn" | "days.MON.openTime" ...: "..." } }
404 { "error": "Салбар олдсонгүй.", "code": "NOT_FOUND" }
409 { "error": "Энэ өдөр аль хэдийн тусгай хуваарьтай байна." | "Энэ хугацаа \\"...\\" улиралтай давхцаж байна.", "code": "CONFLICT" }
409 { "error": "...", "code": "SCHEDULE_IMPACT", "impact": {...}, "needsConfirm": true | false }   // PATCH /branches/[id]-тэй ижил
500 { "error": "Хуваарь хадгалахад алдаа гарлаа." }`}</Code>
        </Endpoint>

        <Endpoint
          method="PATCH"
          path="/api/v1/branches/[id]/schedules/[scheduleId]"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Эрх: branches.edit", "Багц идэвхтэй байх шаардлагатай"]}
          title="Тусгай өдөр/улирал хэсэгчлэн засах — төрлийг (exception/season) сервер scheduleId-аар тодорхойлно. Ирээгүй талбар хэвээр."
        >
          <Code>{`Req (exception): { "date"?, "isOpen"?, "openTime"?, "closeTime"?, "label"?, "confirm"? }   // огноо солибол шинэ өдөрт шилжинэ
Req (season):    { "name"?, "startsOn"?, "endsOn"?, "days"?: { "MON": {...} }, "confirm"? }   // days-д ирээгүй өдөр хэвээр
Res:  200 { "kind": "exception" | "season", "id": "...", "scheduleClipped": 0, "message": "...", "schedules": { GET-тэй ижил } }
400 VALIDATION { "fieldErrors": {...} }
404 { "error": "Салбар олдсонгүй." | "Хуваарь олдсонгүй.", "code": "NOT_FOUND" }
409 CONFLICT | 409 SCHEDULE_IMPACT { "impact", "needsConfirm" }   // POST-той ижил дүрэм
500 { "error": "Хуваарь хадгалахад алдаа гарлаа." }`}</Code>
        </Endpoint>

        <Endpoint
          method="DELETE"
          path="/api/v1/branches/[id]/schedules/[scheduleId]"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Эрх: branches.edit", "Багц идэвхтэй байх шаардлагатай"]}
          title="Тусгай өдөр/улирал устгах. Захиалга бүрэн хүчингүй болох бол хатуу хориг; зөвхөн богиносох бол баталгаажуулалтгүйгээр устгаж хугацааг таарууллна."
        >
          <Code>{`Res:  200 { "ok": true, "kind": "exception" | "season", "id": "..." }
404 { "error": "Хуваарь олдсонгүй.", "code": "NOT_FOUND" }
409 { "error": "...", "code": "SCHEDULE_IMPACT", "impact": {...}, "needsConfirm": false }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/branches/schedules/holiday"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Эрх: branches.edit", "Багц идэвхтэй байх шаардлагатай"]}
          title="Баярын өдрийг тенантын БҮХ салбарт тусгай өдөр болгон upsert хийх. All-or-nothing биш — асуудалтай салбар л алгасагдана."
        >
          <Code>{`Req:  { "date": "YYYY-MM-DD", "isOpen": false, "openTime"?: "HH:MM", "closeTime"?: "HH:MM", "label"?: "...", "confirm"?: true }
Res:  200 { "ok": true, "message": "2/3 салбарт хадгалагдлаа. (1 амжилтгүй)", "succeeded": 2, "failed": 1,
            "errors": ["Салбар Б: ..."],
            "results": [{ "branchId", "branchName", "ok": true, "id": "...", "message": "..." },
                        { "branchId", "branchName", "ok": false, "code": "SCHEDULE_IMPACT", "message", "impact", "needsConfirm" },
                        { "branchId", "branchName", "ok": false, "code": "VALIDATION", "fieldErrors": {...} },
                        { "branchId", "branchName", "ok": false, "code": "CONFLICT" | "NOT_FOUND" | "ERROR", "message" }] }
// Бүх салбар амжилтгүй (ok=false) үед ч 200 — шалтгаан results-д. needsConfirm=true салбаруудад confirm:true-ээр дахин илгээнэ.
400 { "error": "JSON body шаардлагатай.", "code": "VALIDATION" }
404 { "error": "Салбар олдсонгүй.", "code": "NOT_FOUND" }   // тенантад салбар алга`}</Code>
        </Endpoint>
      </Section>

      {/* --- Багц --- */}
      <Section title="16. Багц худалдан авах">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Багц: FREE (үнэгүй), BUSINESS (QPay-ээр өөрөө авна), ENTERPRISE (үнийн санал → систем админ гараар
          олгоно). Багцууд модулиар ялгагдана — апп <code className={C}>modules</code>-д ороогүй дэлгэцийг
          нуух ёстой (хаалттай endpoint <code className={C}>403 MODULE_DISABLED</code>). Эдгээр endpoint
          багц дууссан/түгжигдсэн үед ч нээлттэй (сунгах боломжтой байх ёстой). Төлбөрийн урсгал:{" "}
          <code className={C}>GET /subscription</code> → <code className={C}>prices[].id</code> сонгох →{" "}
          <code className={C}>POST /subscription/qpay</code> → QR/deeplink харуулах →{" "}
          <code className={C}>POST /subscription/qpay/check</code>-ээр polling хийх.
        </p>

        <Endpoint
          method="GET"
          path="/api/v1/subscription"
          auth="bearer"
          bearerLabel={BEARER}
          title="Одоогийн багцын төлөв, нээлттэй модулиуд, модулийн каталог, багц бүрийн модуль, сунгах үнэ, хүлээгдэж буй QPay төлбөр, төлбөрийн түүх. Нэвтэрсэн бүх ажилтан."
        >
          <Code>{`Res: 200 {
  "plan": "FREE" | "BUSINESS" | "ENTERPRISE",
  "status": "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELLED",   // төлбөртэй subscription-гүй бол "ACTIVE" (FREE)
  "locked": false, "isTrial": false,
  "daysLeft": 23 | null, "expiresAt": "ISO" | null,          // хугацаагүй (FREE) бол null
  "expiringSoon": false, "warnDays": 7, "hasPendingPayment": false,
  "modules": ["enable_appointments", "online_booking", ...],  // одоогийн багцад нээлттэй модулиуд
  "moduleCatalog": [{ "code": "enable_appointments", "label": "...", "description": "..." }, ...],   // бүх модуль
      // code: enable_appointments | enable_diagnostics | online_booking | enable_finance | enable_inventory | enable_staff_schedule
      //       | enable_customer_broadcast | enable_reports | enable_multi_branch | enable_audit | enable_api
  "planModules": { "FREE": [...], "BUSINESS": [...], "ENTERPRISE": [...] },
  "prices": [{ "id": "...", "plan": "BUSINESS", "period": "MONTH" | "QUARTER" | "YEAR", "periodLabel": "Сар",
               "amount": "99000", "currency": "MNT", "notes": "..." | null, "features": ["...", ...] }],   // зөвхөн QPay-ээр авах идэвхтэй үнэ
  "pendingPayment": { "id", "plan", "period", "amount": "99000", "currency", "qrImage": "<base64 PNG>", "qrText", "urls": [...], "createdAt" } | null,
      // зөвхөн эзэнд (бусдад үргэлж null)
  "payments": [{ "id", "plan", "period", "amount": "99000", "method": "QPAY" | "BANK_TRANSFER" | "CASH" | "OTHER",
                 "status": "PENDING" | "PAID" | "CANCELLED" | "FAILED", "createdAt", "paidAt": "ISO" | null }],   // сүүлийн 50
  "canManage": true }   // = эзэн (QPay төлөх, үнийн санал илгээх)`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/subscription/qpay"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Зөвхөн эзэн"]}
          title="Сонгосон үнээр багцын QPay нэхэмжлэх (PENDING төлбөр) үүсгэх. Зөвхөн self-serve (BUSINESS) багц."
        >
          <Code>{`Req:  { "planPriceId": "..." }   // заавал — GET /subscription → prices[].id
Res:  201 { "payment": { "id", "plan", "period", "amount": "99000", "currency": "MNT",
                         "qrImage": "<base64 PNG>", "qrText": "...", "urls": [{ банкны апп deeplink }], "createdAt" } }
400 { "error": "JSON body шаардлагатай.", "code": "VALIDATION" }
400 { "error": "Үнэ сонгоно уу.", "code": "VALIDATION", "fieldErrors": { "planPriceId": "..." } }
403 { "error": "Зөвхөн админ багц авна." }
404 { "error": "Сонгосон үнэ олдсонгүй / идэвхгүй.", "code": "NOT_FOUND" }
422 { "error": "Энгийн (FREE) багц үнэгүй ..." | "Энтерпрайз багц тогтсон үнэгүй — «Үнийн санал авах»-аар ...", "code": "NOT_SELF_SERVE" }
502 { "error": "QPay нэхэмжлэх үүсгэхэд алдаа гарлаа. ...", "code": "QPAY_ERROR" }`}</Code>
        </Endpoint>

        <Endpoint
          method="DELETE"
          path="/api/v1/subscription/qpay"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Зөвхөн эзэн"]}
          title="Хүлээгдэж буй (PENDING) багцын төлбөрийг цуцлах (QR хаах)."
        >
          <Code>{`Req:  { "paymentId": "..." }   // заавал
Res:  200 { "ok": true, "paymentId": "...", "cancelled": true | false }   // PENDING биш/олдоогүй бол cancelled=false
400 { "error": "paymentId шаардлагатай.", "code": "VALIDATION" }
403 { "error": "Зөвхөн админ багц авна." }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/subscription/qpay/check"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Зөвхөн эзэн"]}
          title="Багцын төлбөрийг QPay-аас шалгаж, бүрэн төлөгдсөн бол багцыг идэвхжүүлэх. Idempotent — апп polling хийнэ."
        >
          <Code>{`Req:  { "paymentId": "..." }   // заавал
Res:  200 { "paid": true }
   | 200 { "paid": false }                                                       // хүлээгдэж байна
   | 200 { "paid": false, "message": "Төлбөр бүрэн төлөгдөөгүй байна. Дахин шалгана уу." }
400 { "error": "paymentId шаардлагатай.", "code": "VALIDATION" }
403 { "error": "Зөвхөн админ багц авна." }
404 { "error": "Төлбөр олдсонгүй.", "code": "NOT_FOUND" }   // энэ тенантын төлбөр биш
502 { "error": "...", "code": "QPAY_ERROR" }   // QPay шалгалт/идэвхжүүлэлт амжилтгүй — дахин оролдоно`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/subscription/quote"
          auth="bearer"
          bearerLabel={BEARER}
          tags={["Зөвхөн эзэн", "Rate limit: 5/10мин (IP)"]}
          title="Энтерпрайз багцын үнийн санал хүсэх — хүсэлт тенанттай холбогдож, систем админд мэдэгдэл очно."
        >
          <Code>{`Req:  { "orgName": "≤120 тэмдэгт",          // заавал
        "contactName": "≤80 тэмдэгт",       // заавал
        "phone": "99112233",                // заавал, 8 оронтой
        "email"?: "≤120 тэмдэгт",
        "branchCount"?: 1…10000,            // бүхэл тоо (number эсвэл string)
        "modules": ["enable_finance", ...], // заавал, ядаж 1 — moduleCatalog[].code (танигдаагүй код хасагдана)
        "message"?: "≤2000 тэмдэгт" }
Res:  201 { "ok": true, "id": "..." }
400 { "error": "...", "code": "VALIDATION", "fieldErrors": { "orgName" | "contactName" | "phone" | "email" | "branchCount" | "modules" | "message": "..." } }
403 { "error": "Зөвхөн админ үнийн санал илгээнэ." }
429 { "error": "Хэт олон хүсэлт илгээлээ..." }`}</Code>
        </Endpoint>
      </Section>
    </>
  );
}
