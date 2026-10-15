import { Code, Endpoint, Section } from "./_shared";

export function AccountDocs() {
  return (
    <>
      {/* --- Алхам 1-3: Нэвтрэлт --- */}
      <Section title="1. Нэвтрэлт — утас + OTP">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Нууц үггүй, зөвхөн утасны дугаар + 6 оронтой SMS кодоор. Дараах 2
          алхмыг дараалан дуудна.
        </p>

        <Endpoint
          method="POST"
          path="/api/v1/app/auth/request-otp"
          auth="public"
          tags={["Rate limit: 5/10 мин (IP)"]}
          title="Алхам 1 — утсанд 6 оронтой код илгээх."
        >
          <Code>{`Req:  { "phone": "99112233" }
Res:  200 { "ok": true }
400  { "error": "Утасны дугаар буруу." }
429  { "error": "<throttle мессеж>" }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/app/auth/verify-otp"
          auth="public"
          title="Алхам 2 — кодыг баталгаажуулж accessToken авах. Account шинэ бол автоматаар үүснэ."
        >
          <Code>{`Req:  { "phone": "99112233", "code": "123456", "name": "Бат" }  // name заавал биш
Res:  200 {
  "accessToken": "<JWT>",
  "account": { "id": "...", "phone": "99112233", "name": "Бат" | null }
}
400  { "error": "Утасны дугаар буруу." } | { "error": "6 оронтой код шаардлагатай." }
401  { "error": "Код буруу байна." } | { "error": "Кодны хугацаа дууссан." } | { "error": "Хэт олон удаа буруу оролдсон." }
403  { "error": "Энэ дугаар түр хаагдсан байна." }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/app/auth/login-password"
          auth="public"
          tags={["Rate limit: 30/15 мин (IP), 10/15 мин (утас)"]}
          title="Нууц үгээр нэвтрэх (кодын оронд). Зөвхөн нууц үг тохируулсан Account; шинэ Account үүсгэхгүй."
        >
          <Code>{`Req:  { "phone": "99112233", "password": "..." }
Res:  200 { "accessToken": "<JWT>", "reactivated": false,
            "account": { "id": "...", "phone": "99112233", "name": "Бат" | null, "hasPassword": true } }   // verify-otp-той ижил
400  { "error": "Утасны дугаар буруу." } | { "error": "Нууц үг шаардлагатай." }
401  { "error": "Утасны дугаар эсвэл нууц үг буруу байна.", "code": "INVALID_CREDENTIALS" }   // дугаар бүртгэлгүй / нууц үггүй ч ижил
403  { "error": "Энэ дугаар түр хаагдсан байна.", "code": "ACCOUNT_BLOCKED" }
429  { "error": "...", "code": "RATE_LIMITED" }   // энэ дугаарт хэт олон буруу оролдлого — кодоор нэвтрэх боломжтой хэвээр
// verify-otp-ийн account-д мөн "hasPassword" ирнэ — апп «Нууц үгээр нэвтрэх» сонголтыг харуулахад ашиглана.`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/app/account/password" auth="bearer" title="Нууц үг тохируулсан эсэх.">
          <Code>{`Res:  200 { "hasPassword": true, "updatedAt": "2026-10-15T02:00:00.000Z" | null }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/app/account/password/request-otp" auth="bearer" tags={["Rate limit: 5/10 мин"]} title="Нууц үг тохируулах/солих/устгахад шаардлагатай SMS кодыг бүртгэлтэй утсанд илгээх.">
          <Code>{`Req:  {}
Res:  200 { "ok": true, "maskedPhone": "******33" }
429  { "error": "<throttle мессеж>" }`}</Code>
        </Endpoint>

        <Endpoint method="PUT" path="/api/v1/app/account/password" auth="bearer" tags={["Rate limit: 10/10 мин"]} title="Нууц үг тохируулах эсвэл солих (request-otp-оор авсан код заавал).">
          <Code>{`Req:  { "code": "123456", "password": "Shine2026" }   // 8–128 тэмдэгт, үсэг + тоо
Res:  200 { "ok": true, "hasPassword": true }
422  { "error": "...", "code": "PASSWORD_INVALID", "fieldErrors": { "password": "..." } }
422  { "error": "Код буруу байна.", "code": "OTP_INVALID", "fieldErrors": { "code": "..." } }`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/app/account/password" auth="bearer" tags={["Rate limit: 10/10 мин"]} title="Нууц үг устгах — цаашид зөвхөн кодоор нэвтэрнэ.">
          <Code>{`Req:  { "code": "123456" }
Res:  200 { "ok": true, "hasPassword": false }
422  { "error": "Код буруу байна.", "code": "OTP_INVALID", "fieldErrors": { "code": "..." } }
// Нууц үгээ мартсан: кодоор нэвтэрч (verify-otp), дараа нь PUT-оор шинийг тохируулна.`}</Code>
        </Endpoint>

        <div className="rounded-[10px] border border-[var(--oc-accent)]/25 bg-[var(--oc-accent)]/[0.06] p-4">
          <p className="text-sm text-[var(--oc-ink2)]">
            <strong>Алхам 3 — токен ашиглах.</strong> Цаашид бүх auth
            шаардсан хүсэлтэд header нэмнэ:
          </p>
          <Code>{`Authorization: Bearer <accessToken>`}</Code>
          <p className="text-xs text-[var(--oc-muted3)] mt-2">
            Токен <strong>хугацаагүй</strong> (`exp` claim байхгүй) — refresh
            endpoint шаардлагагүй, апп үүгээр дахин суулгах хүртэл ашиглана.
            Зөвхөн Account идэвхгүй (устгагдсан/блоклогдсон) болгосноор хүчингүй
            болно.
          </p>
        </div>
      </Section>

      {/* --- Каталог --- */}
      <Section title="2. Байгууллага, салбар (каталог / discover)">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Нэвтрэхээс өмнө ч дуудаж болно — нийтэд нээлттэй, онлайн цаг
          захиалга хүлээн авдаг байгууллагуудын жагсаалт. Бүх шүүлтүүр сервер
          талд хийгдэнэ.
        </p>

        <Endpoint
          method="GET"
          path="/api/v1/app/orgs"
          auth="public"
          title="Байгууллагын каталог (байгууллагаар pagination-тэй). lat/lng өгсөн бол хамгийн ойрын салбараар эрэмбэлж, салбар бүрд distanceKm хавсаргана."
        >
          <Code>{`Query: ?q=&city=&district=&lat=&lng=&radius=<км, max 100>&openNow=1&weekend=1
       &serviceKey=<SystemServiceKey.id>&tag=<BranchTag.id>&page=&pageSize=<default 20>
Res: 200 {
  "orgs": [{
    "slug": "infosystems", "name": "Инфосистемс", "logoUrl": "..." | null,
    "branches": [{
      "id": "...", "name": "Үндсэн салбар",
      "city": "Улаанбаатар", "district": "Баянзүрх",
      "latitude": 47.91, "longitude": 106.91,
      "serviceKeyIds": ["..."],                 // энэ салбарт санал болгох системийн ангиллын id
      "tags": [{ "id": "...", "name": "Автомашины угаалга" }],
      "distanceKm": 2.4                          // зөвхөн lat/lng өгсөн үед
    }]
  }],
  "pagination": { "page": 1, "pageSize": 20, "total": 12, "totalPages": 1, "hasPrev": false, "hasNext": false },
  "facets": { "cities": ["Улаанбаатар", ...], "districts": ["Баянзүрх", ...] }
}
400 { "error": "Шүүлтүүр буруу байна." }`}</Code>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/v1/app/orgs/map"
          auth="public"
          title="Газрын зургийн marker-ууд (хөнгөн). Ижил шүүлтүүр + viewport (north/south/east/west — дөрвүүлээ хамт). Хамгийн ихдээ 500 marker."
        >
          <Code>{`Query: ?north=&south=&east=&west=  + orgs-тэй ижил шүүлтүүрүүд (q, city, district, lat, lng, radius, openNow, weekend, serviceKey, tag)
Res: 200 {
  "markers": [{
    "id": "<branchId>", "orgSlug": "infosystems", "orgName": "Инфосистемс", "logoUrl": "..." | null,
    "branchName": "Үндсэн салбар", "city": "...", "district": "...",
    "latitude": 47.91, "longitude": 106.91,
    "serviceKeyIds": ["..."], "tagIds": ["..."], "distanceKm": 2.4
  }],
  "count": 37, "truncated": false, "max": 500
}
400 { "error": "north, south, east, west бүгд шаардлагатай." } | { "error": "Газрын зургийн хүрээ буруу байна." }`}</Code>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/v1/app/service-keys"
          auth="public"
          title="Системийн ангиллын түлхүүрүүд — “Ямар ажил хийлгэх гэж байна?” сонголт. orgs-ийн ?serviceKey= шүүлт болон branch.serviceKeyIds-тай тааруулна. Ямар ч ангилалд холбогдоогүй түлхүүр орохгүй."
        >
          <Code>{`Res: 200 { "serviceKeys": [{ "id": "...", "name": "Тоормос" }] }`}</Code>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/v1/app/branch-tags"
          auth="public"
          title="Бизнесийн төрлийн шошго — orgs-ийн ?tag= шүүлт болон branch.tags-тай тааруулна. Салбарт холбогдоогүй шошго орохгүй."
        >
          <Code>{`Res: 200 { "tags": [{ "id": "...", "name": "Автомашины угаалга" }] }`}</Code>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/v1/app/orgs/[slug]"
          auth="public"
          title="Нэг байгууллагын дэлгэрэнгүй + салбарууд. Салбар бүрд онлайн захиалгад санал болгох ангилалууд (хугацаатай) болон бүтэн цагийн хуваарь хавсарна."
        >
          <Code>{`Res: 200 {
  "org": {
    "slug": "infosystems", "name": "Инфосистемс", "logoUrl": "..." | null, "phone1": "70110000",
    "branches": [{
      "id": "...", "name": "Үндсэн салбар", "city": "...", "district": "...",
      "khoroo": "...", "address": "...", "latitude": 47.91, "longitude": 106.91,
      "openTime": "09:00", "closeTime": "18:00",                       // анхдагч (default) цаг
      "schedules": [{ "weekday": "MON", "isOpen": true, "openTime": "09:00", "closeTime": "18:00" }],
      "scheduleExceptions": [{ "date": "2026-07-11", "isOpen": false, "openTime": null, "closeTime": null, "label": "Наадам" }],
      "scheduleSeasons": [{ "name": "Зун", "startsOn": "...", "endsOn": "...", "isActive": true,
                            "days": [{ "weekday": "SAT", "isOpen": true, "openTime": "10:00", "closeTime": "16:00" }] }],
      "categories": [{ "id": "...", "name": "Тоормос", "systemServiceKeyId": "..." | null, "durationMinutes": 60 }]
    }]
  }
}
404 { "error": "Байгууллага олдсонгүй." }`}</Code>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/v1/app/branches/[branchId]/availability?date=YYYY-MM-DD&categoryIds=a,b"
          auth="public"
          title="Тухайн өдрийн сул цагууд (slot). categoryIds өгсөн бол сонгосон ангиллуудын нийлбэр хугацаанд багтах slot-уудыг л буцаана; хоосон бол салбарын анхдагч slot урт. Цаг захиалахын өмнө ЭНИЙГ дуудаж slot.iso-г requestedAt-д илгээнэ."
        >
          <Code>{`Res: 200 {
  "date": "2026-09-20",
  "open": true,
  "reason": "Энэ өдөр амарна." | undefined,     // open=false үед л
  "slots": [{ "time": "09:00", "iso": "2026-09-20T01:00:00.000Z", "available": true, "remaining": 1 }],
  "scheduleSource": "exception" | "season" | "weekday" | "default",
  "scheduleLabel": "Наадам" | null,
  "durationMinutes": 60                          // захиалгын нийт үргэлжлэх хугацаа
}
400 { "error": "date (YYYY-MM-DD) шаардлагатай." } | { "error": "Буруу өдөр." } | { "error": "Үйлчилгээний ангиллаа дахин сонгоно уу." }
403 { "error": "Энэ байгууллага онлайн цаг захиалга хүлээн авахгүй." }
404 { "error": "Салбар олдсонгүй." }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Машин --- */}
      <Section title="3. Миний машинууд">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Машины бүх хариу нэг ижил <code className="font-plex-mono text-[var(--oc-muted2)]">vehicle</code>{" "}
          хэлбэртэй. <code className="font-plex-mono text-[var(--oc-muted2)]">id</code> нь
          холбоосын (AccountVehicle) id — DELETE, refresh-hur, appointments-ийн
          accountVehicleId-д энийг ашиглана.
        </p>
        <Code>{`vehicle: {
  "id": "...", "plate": "1234УБА", "make": "Toyota", "model": "Prius", "year": 2018 | null, "vin": "..." | null,
  "fuelType": "Бензин" | null, "wheelPosition": "Зүүн" | null, "colorName": "Цагаан" | null,
  "capacity": 1496 | null, "purpose": "Суудал" | null,
  "serviceCount": 3,        // дууссан засварын хуудасны тоо (бүх байгууллага)
  "diagnosisCount": 2       // оношилгооны тайлангийн тоо
}`}</Code>

        <Endpoint method="GET" path="/api/v1/app/vehicles" auth="bearer" title="Өөрийн нэмсэн машинуудын жагсаалт.">
          <Code>{`Res: 200 { "vehicles": [vehicle, ...] }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/app/vehicles" auth="bearer" title="Шинэ машин нэмэх (plate/make/model заавал). Ихэвчлэн hur/lookup-ийн хариуг шууд дамжуулна.">
          <Code>{`Req:  { "plate": "1234УБА", "make": "Toyota", "model": "Prius",
        "year": 2018, "vin": "...", "fuelType": "Бензин", "wheelPosition": "Зүүн",
        "colorName": "Цагаан", "capacity": 1496, "purpose": "Суудал" }   // plate/make/model-оос бусад нь заавал биш
Res:  201 { "vehicle": vehicle }
400  { "error": "plate, make, model шаардлагатай." } | { "error": "year буруу." } | { "error": "capacity буруу." }
409  { "error": "Энэ дугаар аль хэдийн бүртгэгдсэн." }`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/app/vehicles/[id]" auth="bearer" title="Өөрийн нэмсэн машиныг устгах (id = холбоосын id).">
          <Code>{`Res: 200 { "ok": true }
404 { "error": "Машин олдсонгүй." }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/app/vehicles/[id]/refresh-hur" auth="bearer" title="Машины техникийн мэдээллийг HUR (улсын бүртгэл)-ээс дахин татаж шинэчлэх. Хариу GET /vehicles-тэй ижил хэлбэр.">
          <Code>{`Res: 200 { "vehicle": vehicle }
404 { "error": "Машин олдсонгүй." }
502 { "error": "HUR-аас мэдээлэл татаж чадсангүй." }`}</Code>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/v1/app/hur/lookup?plate=1234УБА"
          auth="bearer"
          tags={["Rate limit: 20/мин (account)"]}
          title="Улсын дугаараар машин лавлах — эхлээд системд бүртгэлтэй эсэхийг шалгаад, үгүй бол HUR-ээс татна. Эзэмшигчийн PII буцахгүй. Талбарын нэр vehicle-ээс ЯЛГААТАЙ: color (colorName биш)."
        >
          <Code>{`Res: 200 {
  "vehicle": {
    "plate": "1234УБА", "make": "Toyota", "model": "Prius", "year": 2018, "vin": "...",
    "color": "Цагаан", "country": "Япон" | null, "fuelType": "Бензин", "capacity": 1496,
    "className": "..." | null, "importDate": "..." | null, "wheelPosition": "Зүүн", "purpose": "Суудал"
  },
  "source": "global" | "hur"     // global = системд байсан (country/className/importDate null)
}
400 { "error": "Улсын дугаар шаардлагатай." }
502 { "error": "HUR алдаа гарлаа." }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Цаг захиалга --- */}
      <Section title="4. Цаг захиалга">
        <Endpoint
          method="GET"
          path="/api/v1/app/appointments"
          auth="bearer"
          title="Миний идэвхтэй цагууд (бүх байгууллага дамнасан). Дууссан+бүрэн төлөгдсөн болон цуцлагдсан/татгалзсан нь энд БИШ — /orders (түүх)-д. Мөн цаг захиалгагүй ажилтны шууд үүсгэсэн идэвхтэй захиалгууд (walkInOrders) тусдаа ирнэ."
        >
          <Code>{`Res: 200 {
  "appointments": [{
    "id": "...", "status": "PENDING" | "CONFIRMED" | ..., "requestedAt": "2026-09-02T09:00:00.000Z", "note": "..." | null,
    "tenant": { "name": "Инфосистемс", "slug": "infosystems" },
    "branch": { "id": "...", "name": "Үндсэн салбар" },
    "category": { "name": "Тоормос" } | null,               // хуучин (ганц) — back-compat
    "categories": [{ "id": "...", "name": "Тоормос" }],      // олон ангилал (booking v2)
    "accountVehicle": { "plate": "1234УБА" } | null,
    "serviceOrder": {                                        // баталгаажсаны дараа засварын хуудас нээгдвэл
      "id": "...", "number": "1042", "status": "IN_PROGRESS", "paymentStatus": "UNPAID",
      "scheduledAt": "...", "startedAt": "..." | null, "completedAt": "..." | null,
      "estimatedDurationMinutes": 90 | null, "expectedFinishAt": "..." | null,
      "totalAmount": 150000 | null, "paidAmount": 0 | null,
      "vehicle": { "plate": "...", "make": "...", "model": "...", "year": 2018 },
      "items": [{ "id": "...", "kind": "LABOR", "description": "...", "status": "PENDING", "quantity": 1, "unitPrice": 50000, "total": 50000 }],
      "reports": [{ "id": "...", "type": "POST_SERVICE", "templateName": "...", "createdAt": "...", "mileageAtReport": 45000 }]
    } | null,
    "payment": { ...хураамжийн объект, харах 4.1 } | null
  }],
  "walkInOrders": [{                                          // Appointment-гүй, идэвхтэй захиалга
    "id": "...", "number": "1043", "status": "SCHEDULED", "paymentStatus": "UNPAID",
    "scheduledAt": "...", "startedAt": null, "completedAt": null,
    "estimatedDurationMinutes": null, "expectedFinishAt": null, "totalAmount": 0, "paidAmount": 0,
    "tenant": { "name": "...", "slug": "..." }, "branch": { "id": "...", "name": "..." },
    "vehicle": {...}, "items": [...], "reports": [...]
  }]
}`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/app/appointments"
          auth="bearer"
          title="Шинэ цаг захиалах. requestedAt-д availability-ийн slot.iso-г илгээнэ. Хураамж идэвхтэй бол QPay invoice-ыг ЭНД шууд татаж хариунд хавсаргана."
        >
          <Code>{`Req:  { "branchId": "...", "requestedAt": "2026-09-02T09:00:00.000Z",
        "categoryIds": ["...", "..."],           // олон ангилал (санал болгож буй) — эсвэл хуучин "categoryId": "..."
        "accountVehicleId": "...", "note": "..." } // заавал биш
Res:  201 { "appointment": {
  "id": "...", "status": "PENDING", "requestedAt": "...",
  "payment": { ...хураамжийн объект, харах 4.1 } | null
} }
400  { "error": "branchId шаардлагатай." } | { "error": "requestedAt буруу (ISO огноо шаардлагатай)." }
400  { "error": "Өнгөрсөн цаг сонгох боломжгүй." } | { "error": "Хэтэрхий хол хугацаанд цаг захиалах боломжгүй." }  // 366 хоногоос цааш
400  { "error": "Ажиллах цагт багтах сул цаг сонгоно уу." } | { "error": "Үйлчилгээний ангиллаа дахин сонгоно уу." } | { "error": "Машин олдсонгүй." }
403  { "error": "Энэ байгууллага онлайн цаг захиалга хүлээн авахгүй." } | { "error": "Энэ салбар цаг захиалга хүлээн авахгүй." }
403  { "error": "Салбар олдсонгүй." }        // идэвхгүй салбар (lock үед)
404  { "error": "Салбар олдсонгүй." }
409  { "error": "Энэ цаг дүүрсэн байна. Өөр цаг сонгоно уу." }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/app/appointments/[id]/reschedule"
          auth="bearer"
          title="Өөрийн PENDING/CONFIRMED цагийг өөр хугацаанд шилжүүлэх. Багтаамж/давхцлыг шинээр шалгана. Засварын хуудас нээгдсэн цагийг шилжүүлэх боломжгүй."
        >
          <Code>{`Req:  { "requestedAt": "2026-09-03T10:00:00.000Z" }
Res:  200 { "ok": true }
400  { "error": "requestedAt шаардлагатай." } | { "error": "requestedAt буруу." } | { "error": "Өнгөрсөн цаг сонгох боломжгүй." }
404  { "error": "Цаг захиалга олдсонгүй." }
409  { "error": "Энэ цагийг шилжүүлэх боломжгүй." } | { "error": "Энэ цаг дүүрсэн байна. Өөр цаг сонгоно уу." }
409  { "error": "Энэ цагт засварын хуудас нээгдсэн тул онлайнаар шилжүүлэх боломжгүй. Байгууллагатай холбогдоно уу." }
409  { "error": "Ажиллах цагт багтах сул цаг сонгоно уу." } | { "error": "Хэтэрхий хол хугацаанд цаг захиалах боломжгүй." }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/app/appointments/[id]/cancel"
          auth="bearer"
          title="Өөрийн цагийг цуцлах (зөвхөн PENDING/CONFIRMED төлөвт байхад)."
        >
          <Code>{`Res: 200 { "ok": true }
404 { "error": "Цаг олдсонгүй." }
409 { "error": "Энэ цагийг цуцлах боломжгүй." }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Цаг захиалгын хураамж --- */}
      <Section title="4.1. Цаг захиалгын хураамж (QPay)">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Платформын хураамжийг (super admin{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">
            /system/settings
          </code>
          -ээс тохируулна — идэвхгүй бол бүрэн үнэгүй) хэрэглэгч цаг
          захиалахдаа шууд QPay-ээр төлнө.{" "}
          <strong>DB-д Invoice зөвхөн бодитоор ТӨЛӨГДСӨНИЙ дараа л үүснэ</strong>{" "}
          — доорх бүх endpoint нэг ижил хэлбэрийн{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">
            payment
          </code>{" "}
          объект буцаана:
        </p>
        <Code>{`payment: null                                    // хураамж шаардлагагүй (үнэгүй/идэвхгүй)
payment: {
  status: "PENDING" | "PAID" | "UNDERPAID" | "FAILED",
  amount: 1000, currency: "MNT",
  qrImage: "<base64>" | null,   // PENDING/UNDERPAID үед л ирнэ (банкны апп-аар уншуулах)
  qrText: "qpay://..." | null,  // deeplink — банкны апп руу шууд шилжих
  urls: [{ "name": "Khan bank", "name_mn": "Хаан банк", "logo": "<url>", "description": "...", "link": "khanbank://..." }],
                                // банк тус бүрийн deeplink (PAID үед хоосон [])
  underpaidAmount: 500 | null   // зөвхөн UNDERPAID үед: одоог хүртэл ирсэн дутуу дүн
}`}</Code>

        <Endpoint
          method="GET"
          path="/api/v1/app/appointments/[id]/payment"
          auth="bearer"
          title="Тухайн цагийн хураамжийн одоогийн төлөв — 'Төлбөр' дэлгэц нээх бүрд дуудна."
        >
          <Code>{`Res: 200 { "payment": { ... } | null }
404 { "error": "Цаг олдсонгүй." }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/app/appointments/[id]/payment/check"
          auth="bearer"
          title="QR уншуулсны дараа дарж шалгах (polling). Бүрэн төлөгдсөн бол ЭНД анх удаа Invoice үүсэж, тенант рүү мэдэгдэл очно. Дахин дуудсан ч аюулгүй (idempotent)."
        >
          <Code>{`Res: 200 { "paid": true, "underpaidAmount": null, "message": null }
Res: 200 { "paid": false, "underpaidAmount": 500,
           "message": "Дутуу төлбөр: 500₮ / 1,000₮ ирсэн. Үлдэгдлийг нөхөж төлнө үү." }
Res: 200 { "paid": false, "underpaidAmount": null, "message": null }  // хараахан төлөгдөөгүй
404 { "error": "Цаг олдсонгүй." }
422 { "error": "QPay invoice байхгүй." }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/app/appointments/[id]/payment/retry"
          auth="bearer"
          title="Invoice татах үед QPay доголдож (status: FAILED) checkout эхлээгүй тохиолдолд дахин оролдох."
        >
          <Code>{`Res: 200 { "payment": { "status": "PENDING", "amount": 1000, ... } | null }
404 { "error": "Цаг олдсонгүй." }
502 { "error": "QPay invoice үүсгэхэд алдаа: ..." }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Үйлчилгээний түүх --- */}
      <Section title="5. Үйлчилгээний түүх (засварын хуудас)">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Хэрэглэгчийн (бүх байгууллага дамнасан) ДУУССАН болон ЦУЦЛАГДСАН
          засварын хуудсууд — эзэмшлийн машин (баталгаажсан утсаар холбогдсон)
          болон account-тай холбоотой Customer-ийнх. Мөн хэзээ ч засварын хуудас
          болж хувираагүй цуцлагдсан/татгалзсан/ирээгүй цагууд (
          <code className="font-plex-mono text-[var(--oc-muted2)]">cancelledAppointments</code>
          ) тусдаа жагсаалтаар ирнэ. Идэвхтэй ажил энд биш — /appointments-д.
        </p>

        <Endpoint
          method="GET"
          path="/api/v1/app/orders"
          auth="bearer"
          title="Миний үйлчилгээний түүх. Query: page, pageSize (эсвэл limit; default 50, max 200), vehicleId, q (байгууллага/салбар/дугаар/машинаар хайх), year (YYYY), month (1-12, зөвхөн year-тэй хамт). Хоёр жагсаалт ижил page/pageSize цонхоор ирнэ."
        >
          <Code>{`Res: 200 {
  "orders": [{
    "id": "...", "number": "1042", "status": "COMPLETED" | "CANCELLED", "paymentStatus": "PAID" | "PARTIAL" | "UNPAID",
    "scheduledAt": "...", "completedAt": "..." | null, "createdAt": "...",
    "totalAmount": "150000", "paidAmount": "150000",                 // Decimal → string
    "tenant": { "name": "Инфосистемс", "slug": "infosystems" },
    "branch": { "name": "Үндсэн салбар" },
    "vehicle": { "plate": "1234УБА", "make": "Toyota", "model": "Prius", "year": 2018 },
    "itemCount": 4,
    "reports": [{ "id": "...", "type": "POST_SERVICE", "templateName": "Үйлчилгээний дараах шалгалт",
                  "mileageAtReport": 45000, "createdAt": "..." }]
  }],
  "pagination": { "page": 1, "pageSize": 50, "total": 3, "totalPages": 1, "hasPrev": false, "hasNext": false },
  "cancelledAppointments": [{
    "id": "...", "status": "CANCELLED" | "NO_SHOW" | "REJECTED", "requestedAt": "...",
    "tenant": { "name": "...", "slug": "..." }, "branch": { "name": "..." }, "category": { "name": "..." } | null
  }],
  "cancelledPagination": { ... },
  "availableYears": [2026, 2025]                                   // шүүлтүүрийн сонголтод
}
400 { "error": "Он буруу байна." } | { "error": "Сар буруу байна." } | { "error": "Сарын шүүлт хийхийн тулд оноо сонгоно уу." }`}</Code>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/v1/app/orders/[id]"
          auth="bearer"
          title="Нэг засварын хуудасны дэлгэрэнгүй — хийгдсэн ажил/сэлбэгийн мөрүүд, мөн хавсаргасан оношилгооны тайлангуудын БҮРЭН бөглөлт (templateSchema-тай хамт, шууд харуулахад бэлэн)."
        >
          <Code>{`Res: 200 { "order": {
  "id": "...", "number": "1042", "status": "COMPLETED", "paymentStatus": "PAID",
  "scheduledAt": "...", "completedAt": "...", "createdAt": "...", "notes": "..." | null,
  "totalAmount": "150000", "paidAmount": "150000",
  "tenant": { "name": "Инфосистемс", "slug": "infosystems" },
  "branch": { "name": "Үндсэн салбар", "phone": "70110000" | null },
  "vehicle": { "plate": "1234УБА", "make": "Toyota", "model": "Prius", "year": 2018 },
  "items": [{ "id": "...", "kind": "LABOR" | "PART" | "DIAGNOSTIC" | "FEE", "description": "Тосны солилт",
              "quantity": "1", "unitPrice": "50000", "total": "50000",
              "status": "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" }],
  "reports": [{
    "id": "...", "type": "POST_SERVICE", "templateName": "Үйлчилгээний дараах шалгалт",
    "templateSchema": { "sections": [{ "id": "...", "title": "...", "items": [
      { "id": "...", "label": "Тормоз", "type": "check", "required": true, "options": ["Хэвийн","Анхаарах","Солих"] }
    ] }] },
    "templateVersion": 1,
    "data": { "<itemId>": { "value": "Хэвийн", "photos": ["..."], "note": "..." } },
    "signatureUrl": "..." | null, "mileageAtReport": 45000 | null, "notes": "..." | null,
    "createdAt": "..."
  }]
} }
404 { "error": "Засварын хуудас олдсонгүй." }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Оношилгоо --- */}
      <Section title="5.1. Миний оношилгоонууд">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Засварын хуудсаас үл хамааран бүх оношилгооны тайланг нэг жагсаалтаар
          харах. Зөвшөөрөл order-уудтай ижил (account-ийн Customer эсвэл
          эзэмшлийн машин).
        </p>

        <Endpoint
          method="GET"
          path="/api/v1/app/diagnostics"
          auth="bearer"
          title="Оношилгооны тайлангийн товч жагсаалт. Query: page, pageSize, vehicleId, q, severity (GOOD|WARN|BAD), year (YYYY)."
        >
          <Code>{`Res: 200 {
  "reports": [{
    "id": "...", "type": "POST_SERVICE", "templateName": "Үйлчилгээний дараах шалгалт",
    "mileageAtReport": 45000 | null, "severity": "GOOD" | "WARN" | "BAD" | null, "createdAt": "...",
    "vehicle": { "plate": "...", "make": "...", "model": "...", "year": 2018 },
    "branch": { "name": "Үндсэн салбар" },
    "order": { "id": "...", "number": "1042" } | null
  }],
  "pagination": { ... },
  "availableYears": [2026, 2025]
}
400 { "error": "Оношилгооны төлөв буруу байна." } | { "error": "Он буруу байна." }`}</Code>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/v1/app/diagnostics/[id]"
          auth="bearer"
          title="Нэг тайлангийн БҮРЭН бөглөлт (templateSchema + data) — orders/[id]-ийн reports[] элементтэй ижил хэлбэр, дээр нь vehicle/branch/order/severity."
        >
          <Code>{`Res: 200 { "report": {
  "id": "...", "type": "POST_SERVICE", "templateName": "...", "templateSchema": {...}, "templateVersion": 1,
  "data": { "<itemId>": { "value": "...", "photos": [...], "note": "..." } },
  "severity": "WARN" | null, "signatureUrl": "..." | null, "mileageAtReport": 45000 | null, "notes": "..." | null,
  "createdAt": "...",
  "vehicle": { "plate": "...", "make": "...", "model": "...", "year": 2018 },
  "branch": { "name": "..." },
  "order": { "id": "...", "number": "1042" } | null
} }
404 { "error": "Тайлан олдсонгүй." }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Push --- */}
      <Section title="6. Төхөөрөмж бүртгэл (push мэдэгдэл)">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Нэвтэрсний дараа (эсвэл FCM токен шинэчлэгдэх бүрт) дуудна.{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">deviceId</code>{" "}
          тогтмол (upsert) тул дахин дуудахад давхардахгүй.
        </p>

        <Endpoint method="POST" path="/api/v1/app/devices" auth="bearer" title="Push токен бүртгэх/шинэчлэх.">
          <Code>{`Req:  {
  "deviceId":      "<тогтвортой install id, uuid>",   // ЗААВАЛ
  "platform":      "ANDROID",                          // ЗААВАЛ — ANDROID | IOS | WEB
  "firebaseToken": "<FCM registration token>",
  "name": "Bat's iPhone", "model": "iPhone 14 Pro", "os": "iOS 17.2"  // заавал биш
}
Res:  200 { "device": { "id": "...", "deviceId": "..." } }
400  { "error": "deviceId шаардлагатай." } | { "error": "platform нь WEB/ANDROID/IOS байх ёстой." }`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/app/devices/[deviceId]" auth="bearer" title="Logout үед төхөөрөмжийг бүртгэлээс хасах.">
          <Code>{`Res: 200 { "ok": true }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Алдааны формат --- */}
      <Section title="7. Алдааны формат">
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
          <p className="text-sm text-[var(--oc-muted)] mb-3">
            Бүх алдаа ижил хэлбэртэй буцна:
          </p>
          <Code>{`{ "error": "Хүний-унших мессеж." }`}</Code>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 text-sm">
            {[
              ["400", "Буруу/дутуу параметр, өнгөрсөн/хол цаг, ажиллах цагт багтахгүй"],
              ["401", "Токен байхгүй/хүчингүй, OTP буруу"],
              ["403", "Онлайн захиалга хаалттай байгууллага/салбар, хаагдсан дугаар"],
              ["404", "Олдсонгүй"],
              ["409", "Зөрчил (слот дүүрсэн, дугаар давхцсан, төлөв зөвшөөрөхгүй)"],
              ["422", "QPay invoice байхгүй (payment/check)"],
              ["429", "Rate limit хэтэрсэн"],
              ["502", "Гадаад үйлчилгээ (HUR/QPay) алдаа"],
            ].map(([code, label]) => (
              <div key={code} className="flex items-center gap-2">
                <code className="font-plex-mono text-[var(--oc-accent)] w-10 shrink-0">{code}</code>
                <span className="text-[var(--oc-muted2)]">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <p className="mt-10 text-xs text-[var(--oc-muted3)]">
        Push мэдэгдлийн бүтэц (FCM payload) болон жишээ код (React Native
        fetch)-ыг <code className="font-plex-mono">docs/mobile-device-push.md</code>{" "}
        файлаас үзнэ үү.
      </p>
    </>
  );
}
