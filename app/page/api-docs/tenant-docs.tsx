import { Code, Endpoint, Section } from "./_shared";

const BEARER = "Bearer (Ажилтан)";

export function TenantDocs() {
  return (
    <>
      {/* --- Нэвтрэлт --- */}
      <Section title="1. Нэвтрэлт — имэйл / утас + нууц үг">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Ажилтан (байгууллагын дотоод хэрэглэгч, <code className="font-plex-mono text-[var(--oc-muted2)]">User</code> загвар)
          имэйл эсвэл утасны дугаар + нууц үгээр нэвтэрнэ. Бүх auth endpoint{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">identifier</code>{" "}
          (имэйл эсвэл утас — <code className="font-plex-mono text-[var(--oc-muted2)]">99112233</code>,{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">9911-2233</code>,{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">+976...</code>) хүлээн авна; хуучин{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">email</code> талбар хэвээр ажиллана. Эхлээд{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">check-email</code>-ээр
          төлөвийг шалгаад, хариуны <code className="font-plex-mono text-[var(--oc-muted2)]">identifier</code>-ийг дамжуулан <code className="font-plex-mono text-[var(--oc-muted2)]">login</code>{" "}
          (идэвхжсэн бол) эсвэл <code className="font-plex-mono text-[var(--oc-muted2)]">activate/*</code>{" "}
          урсгал (анхны идэвхжүүлэлт) руу орно.
        </p>

        <Endpoint
          method="POST"
          path="/api/v1/auth/check-email"
          auth="public"
          tags={["Rate limit: 15/60с (IP)"]}
          title="Нэвтрэх нэрийн (имэйл / утас) төлөв шалгах — дараагийн алхмыг шийднэ (password / activate / not_registered)."
        >
          <Code>{`Req:  { "identifier": "manager@example.com" | "99112233" }   // хуучин { "email": "..." } ч болно
Res:  200 { "status": "not_registered", "identifier": "...", "message": "..." }
   | 200 { "status": "password", "identifier": "..." }
   | 200 { "status": "activate", "identifier": "...", "maskedPhone": "99***33", "otpSent": true, "message": "..." }
// identifier = канон утга (имэйл lowercase / 8 оронтой утас). "email" талбар зөвхөн имэйлээр орсон үед нэмэгдэж ирнэ.
400 { "error": "Имэйл эсвэл утасны дугаар буруу." }
429 { "error": "Хэт олон хүсэлт илгээлээ..." }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/auth/login"
          auth="public"
          tags={["Rate limit: 10/60с (IP)"]}
          title="Идэвхжсэн хэрэглэгчийн нэвтрэлт (status=password үед)."
        >
          <Code>{`Req:  { "identifier": "manager@example.com" | "99112233", "password": "..." }
Res:  200 {
  "accessToken": "<JWT>", "accessTokenExpiresInSeconds": 86400,
  "refreshToken": "<token>", "refreshTokenExpiresInSeconds": ..., "refreshTokenExpiresAt": "2026-...",
  "user": {
    "id": "...", "email": "...", "firstName": "...", "lastName": "...", "phone": "...",
    "isOwner": true, "role": { "id": "...", "name": "Менежер", "permissions": [...] } | null,
    "branchId": "..." | null, "tenant": { "id": "...", "name": "Инфосистемс" }
  }
}
401 { "error": "Нэвтрэх нэр эсвэл нууц үг буруу." }
423 { "error": "Хэт олон удаа буруу оролдсон тул аккаунт түгжигдсэн. Нууц үгээ сэргээнэ үү." }
403 { "error": "Энэ аккаунт идэвхжээгүй байна. Веб дээр анхны нэвтрэлт хийж нууц үгээ үүсгэнэ үү." }
403 { "error": "Таны байгууллага түр хугацаагаар зогссон байна." }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/auth/activate/request-otp"
          auth="public"
          tags={["Rate limit: 5/60с (IP)"]}
          title="Анхны идэвхжүүлэлт — бүртгэлтэй утас руу 6 оронтой код илгээх (status=activate үед)."
        >
          <Code>{`Req:  { "identifier": "manager@example.com" | "99112233" }
Res:  200 { "sent": true, "maskedPhone": "99***33", "message": "..." }
429 { "error": "<throttle мессеж>" }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/auth/activate"
          auth="public"
          tags={["Rate limit: 10/60с (IP)"]}
          title="OTP код баталгаажуулж, шинэ нууц үг тохируулан идэвхжүүлэх."
        >
          <Code>{`Req:  { "identifier": "manager@example.com" | "99112233", "code": "123456", "password": "минимум 8 тэмдэгт" }
Res:  200 { same shape as /auth/login }
400  { "error": "6 оронтой код шаардлагатай." } | { "error": "Нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой." }
401  { "error": "Кодны хугацаа дууссан. Шинээр код илгээнэ үү." }
401  { "error": "Хэт олон удаа буруу оролдсон. Шинээр код илгээнэ үү." }
401  { "error": "Код буруу байна." }
404  { "error": "Хэрэглэгч олдсонгүй." }
409  { "error": "Аккаунт аль хэдийн идэвхжсэн байна. Нууц үгээрээ нэвтэрнэ үү." }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/auth/password/request-otp"
          auth="public"
          tags={["Rate limit: 5/60с (IP)"]}
          title="Нууц үг сэргээх — бүртгэлтэй утас руу 6 оронтой код илгээх (дахин илгээхэд ч үүнийг дуудна)."
        >
          <Code>{`Req:  { "identifier": "manager@example.com" | "99112233" }
Res:  200 { "sent": true, "maskedPhone": "99***33", "message": "..." }
// Бүртгэлгүй нэвтрэх нэрд ч 200 { "sent": true, "maskedPhone": "**" } (enumeration-safe).
400 { "error": "Имэйл эсвэл утасны дугаар буруу." }
429 { "error": "<throttle мессеж>" }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/auth/password/reset"
          auth="public"
          tags={["Rate limit: 10/60с (IP)"]}
          title="OTP код + шинэ нууц үг — нууц үгийг шинэчилж, аккаунтыг unlock хийнэ. Бүх refresh token цуцлагдана; дараа нь /auth/login хийнэ."
        >
          <Code>{`Req:  { "identifier": "manager@example.com" | "99112233", "code": "123456", "password": "минимум 8 тэмдэгт" }
Res:  200 { "ok": true, "message": "Нууц үг шинэчлэгдлээ. Шинэ нууц үгээрээ нэвтэрнэ үү." }
400  { "error": "6 оронтой код шаардлагатай." } | { "error": "Нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой." }
401  { "error": "Кодны хугацаа дууссан. Шинээр код илгээнэ үү." }
401  { "error": "Хэт олон удаа буруу оролдсон. Шинээр код илгээнэ үү." }
401  { "error": "Код буруу байна." }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/auth/refresh"
          auth="public"
          tags={["Rate limit: 30/60с (IP)"]}
          title="24 цагийн дараа хугацаа дуусах accessToken-ийг refreshToken-оор шинэчлэх (rotate)."
        >
          <Code>{`Req:  { "refreshToken": "<token>" }
Res:  200 { "accessToken": "...", "accessTokenExpiresInSeconds": 86400,
            "refreshToken": "...", "refreshTokenExpiresInSeconds": ..., "refreshTokenExpiresAt": "..." }
401 { "error": "Refresh token-ийн хугацаа дууссан.", "reason": "expired" }
401 { "error": "Refresh token аль хэдийн ашиглагдсан. Дахин нэвтэрнэ үү.", "reason": "reused" }
401 { "error": "Refresh token хүчингүй.", "reason": "invalid" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/auth/logout" auth="public" title="Тухайн төхөөрөмжийн refreshToken-ийг цуцлах.">
          <Code>{`Req:  { "refreshToken": "<token>" }
Res:  200 { "ok": true }`}</Code>
        </Endpoint>

        <div className="rounded-[10px] border border-[var(--oc-accent)]/25 bg-[var(--oc-accent)]/[0.06] p-4">
          <p className="text-sm text-[var(--oc-ink2)]">
            <strong>Токены амьдрал.</strong> Account realm-ээс ялгаатай нь энд{" "}
            <code className="font-plex-mono">accessToken</code> 24 цагийн дараа
            дуусна (<code className="font-plex-mono">exp</code> claim-тай) — тиймээс
            апп нь <code className="font-plex-mono">refreshToken</code>-ийг
            найдвартай хадгалж, 401 (<code className="font-plex-mono">reason: &quot;expired&quot;</code>)
            авахад автоматаар <code className="font-plex-mono">/auth/refresh</code> дуудах ёстой.
          </p>
        </div>
      </Section>

      {/* --- Профайл --- */}
      <Section title="2. Профайл">
        <Endpoint method="GET" path="/api/v1/me" auth="bearer" bearerLabel={BEARER} title="Өөрийн болон харьяалагдах байгууллагын мэдээлэл.">
          <Code>{`Res: 200 {
  "id": "...", "email": "...", "firstName": "...", "lastName": "...", "phone": "...",
  "isOwner": true, "role": { "id": "...", "name": "...", "permissions": [...] } | null,
  "tenant": { "id": "...", "name": "...", "slug": "...", "logoUrl": "..." } | null,
  "branch": { "id": "...", "name": "..." } | null
}`}</Code>
        </Endpoint>
      </Section>

      {/* --- Push --- */}
      <Section title="3. Төхөөрөмж бүртгэл (push мэдэгдэл)">
        <Endpoint method="POST" path="/api/v1/devices" auth="bearer" bearerLabel={BEARER} title="Push токен бүртгэх/шинэчлэх (deviceId-аар upsert).">
          <Code>{`Req:  { "deviceId": "<uuid>", "platform": "ANDROID", "firebaseToken": "...", "name": "...", "model": "...", "os": "..." }
Res:  200 { "device": { "id": "...", "deviceId": "..." } }
400  { "error": "deviceId шаардлагатай." } | { "error": "platform нь WEB/ANDROID/IOS байх ёстой." }`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/devices/[deviceId]" auth="bearer" bearerLabel={BEARER} title="Logout үед төхөөрөмжийг бүртгэлээс хасах.">
          <Code>{`Res: 200 { "ok": true }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Салбар / Үйлчлүүлэгч / Машин --- */}
      <Section title="4. Салбар, үйлчлүүлэгч, машин">
        <Endpoint method="GET" path="/api/v1/branches" auth="bearer" bearerLabel={BEARER} tags={["branch-scoped"]} title="Байгууллагын салбарууд (branch-с гадуурх ажилтан зөвхөн өөрийн салбарыг харна).">
          <Code>{`Query: ?page=&pageSize=
Res: 200 { "branches": [{ "id": "...", "name": "...", "address": "...", "phone": "..." }], "pagination": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/customers" auth="bearer" bearerLabel={BEARER} title="Үйлчлүүлэгчдийн жагсаалт (нэр/утас/имэйл/байгууллагын нэр, регистрээр хайлт).">
          <Code>{`Query: ?q=&kind=org|person&page=&pageSize=
Res: 200 { "customers": [{ "id": "...", "fullName": "...", "phone": "...", "email": "...", "note": "...",
  "isOrganization": false, "orgRegnum": null, "orgName": null, "orgEmail": null, "createdAt": "..." }], "pagination": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/customers" auth="bearer" bearerLabel={BEARER} tags={["Эрх: customers.create", "Багц идэвхтэй байх шаардлагатай"]} title="Шинэ үйлчлүүлэгч нэмэх (утас 8 оронтой, давхцахгүй байх ёстой).">
          <Code>{`Req:  { "phone": "99112233", "fullName": "...", "email": "...", "note": "...",
        "isOrganization": true, "orgRegnum": "1234567", "orgName": "...", "orgEmail": "..." }  // phone заавал; org* нь зөвхөн isOrganization=true үед (7 оронтой регистр, нэр заавал), эс бөгөөс null хадгалагдана
Res:  201 { "customer": { "id": "...", "fullName": "...", "phone": "...", "email": "...", "note": "...", "isOrganization": false, "orgRegnum": null, "orgName": null, "orgEmail": null, "createdAt": "..." } }
403  { "error": "Танд энэ үйлдэл хийх эрх байхгүй." }
403  { "error": "...", "code": "SUBSCRIPTION_EXPIRED" }
422  { "error": "Хүсэлт буруу.", "fieldErrors": { "phone": "Утас шаардлагатай." } }
409  { "error": "Энэ утасны дугаартай харилцагч аль хэдийн бүртгэлтэй байна." }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/ebarimt/org" auth="bearer" bearerLabel={BEARER} tags={["Эрх: customers.create эсвэл customers.edit", "20 хүсэлт/мин (хэрэглэгч тутамд)"]} title="eBarimt-аас байгууллагын нэр татах (7 оронтой регистр).">
          <Code>{`Query: ?regno=1234567
Res:  200 { "regno": "1234567", "name": "...", "vatPayer": true | null, "isGovernment": false | null }
404  { "error": "...", "code": "ORG_NOT_FOUND" }
422  { "error": "...", "code": "ORG_REGNO_INVALID" }
502  { "error": "...", "code": "ORG_LOOKUP_FAILED" }  // хадгалахыг блоклохгүй - нэрийг гараар оруулна`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/customers/from-plate" auth="bearer" bearerLabel={BEARER} tags={["Эрх: customers.create", "Багц идэвхтэй байх шаардлагатай", "20 хүсэлт/мин (HUR lookup-тай нэг хязгаар)"]} title="Улсын дугаараар эзэмшигчийг олж үйлчлүүлэгч үүсгэх (tenant холбоос → HUR).">
          <Code>{`Req:  { "plate": "1234УБА" }
Res:  201 { "customer": { "id": "...", "fullName": "...", "phone": "...", "email": null, "note": null, "createdAt": "..." } }  // аль хэдийн байсан бол 200
403  { "error": "Танд энэ үйлдэл хийх эрх байхгүй." }
422  { "error": "Хүсэлт буруу.", "fieldErrors": { "plate": "Улсын дугаар шаардлагатай." } }
404  { "error": "Эзэмшигчийн мэдээлэл олдсонгүй.", "code": "OWNER_NOT_FOUND" }
429  { "error": "Хэт олон хүсэлт илгээлээ. ...", "code": "RATE_LIMITED" }
502  { "error": "...", "code": "HUR_UPSTREAM" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/vehicles" auth="bearer" bearerLabel={BEARER} title="Машинуудын жагсаалт (дугаар/загвар/vin-ээр хайлт, харилцагчаар шүүлт).">
          <Code>{`Query: ?q=&customerId=&ownerKind=org|person&page=&pageSize=
Res: 200 { "vehicles": [{ "id": "...", "plate": "...", "vin": "...", "make": "...", "model": "...",
  "year": 2018, "mileage": 45000, "customerId": "...", "isPostpaid": false, "ownerIsOrganization": false,
  "customer": { "id": "...", "fullName": "...", "phone": "...", "isOrganization": false, "orgName": null } | null }],
  "pagination": {...} }
// isPostpaid: TenantVehicle-ийн дараа тооцоо тохиргоо — захиалга үүсгэх формыг урьдчилан бөглөхөд.`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/vehicles/{id}/vin-history" auth="bearer" bearerLabel={BEARER} tags={["Эрх: vehicles.view"]} title="Ижил арлын дугаартай (VIN) бусад бүртгэл.">
          <Code>{`Res: 200 { "vin": "..."|null, "records": [{ "vehicleId": "...", "plate": "...", "make": "...", "model": "...", "year": 2018|null,
  "ownerName": "..."|null, "orderCount": 3, "lastOrderAt": "ISO"|null, "createdAt": "ISO" }], "otherTenantRecords": 0 }
// records: зөвхөн энэ байгууллагад холбоотой (TenantVehicle) бүртгэл, шинэ нь түрүүлж. orderCount: цуцлагдаагүй захиалга.
// otherTenantRecords: бусад байгууллагын тоо (мэдээлэлгүй). VIN байхгүй бол { vin: null, records: [], otherTenantRecords: 0 }.
// 404: машин энэ байгууллагад холбогдоогүй.`}</Code>
        </Endpoint>
        <Endpoint method="POST" path="/api/v1/vehicles" auth="bearer" bearerLabel={BEARER} tags={["Эрх: vehicles.create", "Багц идэвхтэй байх шаардлагатай"]} title="Шинэ машин нэмэх (plate/make/model заавал).">
          <Code>{`Req:  { "plate": "1234УБА", "make": "Toyota", "model": "Prius", "vin": "...", "year": 2018, "mileage": 45000, "customerId": "...", "fromLookup": true }
// fromLookup (заавал биш): HUR/системийн бүртгэлээс бөглөсөн бол true — эзэмшигчийн регистрийг сервер шийднэ.
Res:  201 { "vehicle": { "id": "...", "plate": "...", "vin": "...", "make": "...", "model": "...", "year": 2018, "mileage": 45000, "customerId": "..." } }
422  { "error": "Хүсэлт буруу.", "fieldErrors": { "plate": "Улсын дугаар шаардлагатай." } }
422  { "error": "Хүсэлт буруу.", "fieldErrors": { "customerId": "Үйлчлүүлэгч олдсонгүй." } }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Засварын хуудас --- */}
      <Section title="5. Засварын хуудас">
        <Endpoint method="GET" path="/api/v1/orders" auth="bearer" bearerLabel={BEARER} tags={["branch-scoped"]} title="Засварын хуудасны жагсаалт (статус/салбар/машин/харилцагчаар шүүлт).">
          <Code>{`Query: ?status=&branchId=&vehicleId=&customerId=&internal=yes|no&page=&pageSize=
      // internal=yes — зөвхөн дотоод засвар, internal=no — дотоод засваргүй. Өгөөгүй бол бүгд.
Res: 200 { "orders": [{ "id": "...", "number": "...", "status": "...", "paymentStatus": "...",
  "scheduledAt": "...", "startedAt": "...", "completedAt": "...", "totalAmount": 0, "paidAmount": 0,
  "notes": "...", "createdAt": "...", "customer": {...}, "vehicle": {...}, "branch": {...}, "assignedTo": {...},
  "isPostpaid": false, "isInternal": false, "paidInFullBeforeCompletion": false, "plateSnapshot": "1234УБА"|null, "vinSnapshot": "..."|null,
  "hasLockedPayment": false }],   // true = захиалгын ямар нэг PAID төлбөр ХААГДСАН ээлжид: буцаах/цуцлах боломжгүй (PAID_PAYMENT_LOCKED). Мөн GET/PATCH /orders/[id], GET /orders/postpaid (orders[]), GET /overview (recentlyUpdatedOrders[]) дээр ижил
  "pagination": {...} }
// isInternal: дотоод засвар (төлбөргүй, орлогод орохгүй — «Дотоод зардал»-д бүртгэгдэнэ). isPostpaid-тэй зэрэг true байж болохгүй.
// isPostpaid: дараа тооцоот захиалга. paidInFullBeforeCompletion: зөвхөн status=COMPLETED, paymentStatus=PAID бөгөөд
//   сүүлийн PAID төлбөрийн paidAt <= completedAt үед true ("Шууд төлсөн"). plateSnapshot/vinSnapshot: үүсгэх үеийн машины дугаар.
// Хайлт (q) болон ?plate= шүүлт нь plateSnapshot БА одоогийн vehicle.plate хоёуланг нь хайна.`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/orders" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.create", "Багц идэвхтэй байх шаардлагатай"]} title="Шинэ засварын хуудас үүсгэх.">
          <Code>{`Req:  { "branchId": "...", "customerId": "...", "vehicleId": "...", "assignedToId": "...", "scheduledAt": "...", "notes": "...", "isPostpaid": true, "isInternal": false,
        "intake": { "notes": "...", "photoPaths": ["/uploads/..."], "signaturePath": "/uploads/...", "mileageKm": 152300 } }
      // intake заавал биш — машин хүлээн авах бүртгэл. ЗӨВХӨН үүсгэх үед бичигдэж, дараа нь засагдахгүй (PATCH хүлээн авахгүй).
      // photoPaths/signaturePath нь POST /uploads (kind=intake)-ээр өөрөө байршуулсан замууд. Дээд тал нь 20 зураг, notes ≤ 5000 тэмдэгт.
      // mileageKm заавал биш — гүйлт (км), бүхэл тоо 0–2,000,000. Дангаараа ч хүлээн авах бүртгэл болно.
      // isPostpaid (boolean) заавал биш — өгөөгүй бол машины (TenantVehicle) isPostpaid-аас авна.
      // isInternal (boolean) заавал биш (анхдагч false) — дотоод засвар. isPostpaid=true-тэй зэрэг илгээвэл 422 ORDER_INTERNAL_POSTPAID_CONFLICT.
      // assignedToId заавал. orders.assign эрхгүй бол илгээхгүй байж болно — өөрөө оноогдоно.
Res:  201 { "order": {...} }
422  { "error": "Хариуцах мастер сонгоно уу.", "fieldErrors": { "assignedToId": "..." } }   // ASSIGNEE_REQUIRED
422  { "error": "Дотоод засвар болон дараа тооцоо зэрэг байж болохгүй.", "code": "ORDER_INTERNAL_POSTPAID_CONFLICT" }
422  { "error": "Хүсэлт буруу.", "fieldErrors": { "branchId": "...", "customerId": "...", "vehicleId": "..." } }
422  { "error": "Хүсэлт буруу.", "fieldErrors": { "intake": "..." } }   // intake буруу төрөлтэй
422  { "error": "Гүйлт 0–2,000,000 км байх ёстой.", "fieldErrors": { "intake": "..." } }   // mileageKm бүхэл тоо биш / сөрөг / хэт том
422  { "error": "Хамгийн ихдээ 20 зураг.", "fieldErrors": { "intake": "..." } }   // intake шалгалт (тэмдэглэл урт, зураг олон/буруу/олдсонгүй)
422  { "error": "Хүсэлт буруу.", "fieldErrors": { "branchId": "Зөвхөн өөрийн салбарт засварын хуудас үүсгэх боломжтой." } }
403  { "error": "Та зөвхөн өөрийгөө хариуцагчаар оноож болно." }   // orders.assign эрхгүй ажилтан өөр хүн оноох гэвэл
500  { "error": "Захиалгын дугаар үүсгэж чадсангүй. Дахин оролдоно уу." }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/orders/[id]" auth="bearer" bearerLabel={BEARER} tags={["branch-scoped"]} title="Засварын хуудасны дэлгэрэнгүй (мөрүүд + оношилгооны тайлан хамт).">
          <Code>{`Res: 200 { "order": { ...list-ийн талбарууд, "paidAt", "updatedAt",
  "items": [{ "id": "...", "kind": "...", "description": "...", "quantity": 1, "unitPrice": 0, "total": 0, "serviceId": "...",
    "status": "PENDING|IN_PROGRESS|COMPLETED|CANCELLED", "cancelledAt": "..."|null, "cancelledById": "..."|null }],
  "reports": [{ "id": "...", "createdAt": "...", "template": { "id": "...", "name": "...", "type": "..." } }],
  "intake": { "notes": "..."|null, "photos": [{ "id": "...", "url": "/uploads/..." }], "signatureUrl": "/uploads/..."|null, "mileageKm": 152300|null,
    "recordedAt": "...", "recordedBy": "Овог Нэр"|null } | null } }
      // intake: хүлээн авах бүртгэл (зөвхөн унших). Бүртгээгүй бол null. url-ууд нь харьцангуй зам.
404 { "error": "Засварын хуудас олдсонгүй." }`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/orders/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.edit (эсвэл orders.editOwn — өөрийн хариуцсан)", "Багц идэвхтэй байх шаардлагатай"]} title="Засварын хуудасны статус/тэмдэглэл/хариуцагч засах — зөвшөөрөгдсөн шилжилтээр л статус солигдоно. IN_PROGRESS руу шилжихэд ажлын хугацаа тодорхойгүй бол (мөрүүдээс тооцоолох боломжгүй) durationMinutes заавал.">
          <Code>{`Req:  { "status": "IN_PROGRESS", "durationMinutes": 90, "notes": "...", "assignedToId": "...", "isPostpaid": true, "isInternal": true }  // бүгд заавал биш
      // isInternal: дотоод засвар болгох/болихыг өөрчилнө (orders.edit шаардана). true болговол isPostpaid автоматаар false болно; isPostpaid=true-тэй зэрэг (эсвэл дотоод захиалгад isPostpaid=true) илгээвэл 422 ORDER_INTERNAL_POSTPAID_CONFLICT.
      //   Төлбөр (PAID) бүртгэгдсэн захиалгыг дотоод болгох гэвэл 409 ORDER_INTERNAL_HAS_PAYMENTS. Дотоод захиалга төлбөргүйгээр COMPLETED болно.
      // isPostpaid: дараа тооцоо тэмдэглэгээг өөрчилнө (orders.edit шаардана). Машин солигдсон үед (web) өгөөгүй бол шинэ машинаас дахин авна.
Res:  200 { "order": {...} }   // list-ийн isPostpaid, paidInFullBeforeCompletion, plateSnapshot, vinSnapshot талбарууд орно
409  { "error": "Төлбөр бүртгэгдсэн захиалгыг дотоод засвар болгох боломжгүй.", "code": "ORDER_INTERNAL_HAS_PAYMENTS" }
403  { "error": "Дараа тооцоот захиалгыг төлбөр дутуу байхад зөвхөн эрхтэй хэрэглэгч (нягтлан) хаана.", "code": "POSTPAID_CLOSE_FORBIDDEN" }
      // status=COMPLETED, захиалга isPostpaid, төлбөрийн үлдэгдэл > 0, хэрэглэгч "orders.closeUnpaidPostpaid" эрхгүй (owner-д үргэлж байна).
      // Дараа тооцоот биш захиалга төлбөр дутуу бол өмнөх адил 422 PAYMENT_INCOMPLETE.
422  { "error": "Хариуцах мастерыг арилгах боломжгүй — өөр мастер сонгоно уу." }   // assignedToId: null (ASSIGNEE_REQUIRED)
403  { "error": "Танд энэ засварын хуудсыг засах эрх байхгүй." } | { "error": "Зөвхөн orders.assign эрхтэй хэрэглэгч хариуцагч өөрчилж болно." }
404  { "error": "Засварын хуудас олдсонгүй." }
422  { "error": "Дууссан / цуцлагдсан засварын хуудасны мэдээллийг засах боломжгүй." }
422  { "error": "\\"PENDING\\" статусаас \\"COMPLETED\\" руу шилжих боломжгүй." }
422  { "error": "Ажлыг эхлүүлэхийн өмнө \\"durationMinutes\\" (бүхэл тоо, 5–720) шаардлагатай." }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/orders/[id]/items" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.edit", "Багц идэвхтэй байх шаардлагатай"]} title="Засварын хуудсанд ажил/сэлбэг/оношилгооны мөр нэмэх (каталогоос үнэ/нэр автоматаар татагдана).">
          <Code>{`Req:  { "serviceId": "..." | "diagnosticTemplateId": "...", "kind": "LABOR|DIAGNOSTIC|PART|FEE", "description": "...", "quantity": 1, "unitPrice": 0 }
Res:  201 { "item": { "id": "...", "kind": "...", "description": "...", "quantity": 1, "unitPrice": 0, "total": 0, "serviceId": "...", "status": "PENDING" } }
404  { "error": "Засварын хуудас олдсонгүй." }
422  { "error": "Дууссан эсвэл цуцлагдсан засварын хуудсанд мөр нэмэх боломжгүй." }
422  { "error": "Хүсэлт буруу.", "fieldErrors": { "quantity": "Үлдэгдэл хүрэхгүй байна." } }`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/orders/[id]/items/[itemId]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.edit", "Багц идэвхтэй байх шаардлагатай"]} title="Засварын хуудасны мөр засах.">
          <Code>{`Req:  { "kind": "...", "description": "...", "quantity": 1, "unitPrice": 0 }  // бүгд заавал биш
Res:  200 { "item": {...} }
404  { "error": "Засварын хуудас олдсонгүй." } | { "error": "Мөр олдсонгүй." }
422  { "error": "Дууссан эсвэл цуцлагдсан засварын хуудасны мөрийг засах боломжгүй." }
422  { "error": "Цуцлагдсан мөрийг засах боломжгүй." }
422  { "error": "Дууссан ажлыг засах боломжгүй.", "code": "ITEM_COMPLETED_LOCKED" }  // COMPLETED мөр түгжигдсэн (засах/үнэ/цуцлах; явцыг захиалга ажиллаж байхад буцааж болно)
422 { "error": "Оношилгоо бөглөгдсөн тул явцыг буцаах боломжгүй.", "code": "DIAGNOSTIC_REPORT_LINKED" }  // тайлантай оношилгооны мөрийг буцаахгүй`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/orders/[id]/items/[itemId]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.edit", "Багц идэвхтэй байх шаардлагатай"]} title="Засварын хуудасны мөр цуцлах (УСТГАХГҮЙ — түүх, цуцалсан хэрэглэгч хадгалагдана; сэлбэгийн үлдэгдэл сэргэнэ, нийт дүн дахин тооцогдоно).">
          <Code>{`Res: 200 { "ok": true }
404 { "error": "Засварын хуудас олдсонгүй." } | { "error": "Мөр олдсонгүй." }
422 { "error": "Дууссан эсвэл цуцлагдсан засварын хуудасны мөрийг цуцлах боломжгүй." }
422 { "error": "Энэ мөрийг цуцлах боломжгүй." }
422 { "error": "Дууссан ажлыг засах боломжгүй.", "code": "ITEM_COMPLETED_LOCKED" }  // COMPLETED мөр түгжигдсэн (засах/үнэ/цуцлах; явцыг захиалга ажиллаж байхад буцааж болно)
422 { "error": "Оношилгоо бөглөгдсөн тул явцыг буцаах боломжгүй.", "code": "DIAGNOSTIC_REPORT_LINKED" }  // тайлантай оношилгооны мөрийг буцаахгүй`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/orders/[id]/payment" auth="bearer" bearerLabel={BEARER} tags={["Эрх: payments.edit", "Багц идэвхтэй байх шаардлагатай"]} title="Засварын хуудсыг бүхэлд нь Төлөгдсөн/Төлөгдөөгүй болгох (Хагас/PARTIAL энд гараар байхгүй — зөвхөн бодит бүртгэгдсэн төлбөрүүдээс автоматаар тооцогдоно).">
          <Code>{`Req:  { "paymentStatus": "UNPAID" | "PAID" }
Res:  200 { "order": {...} }
403  { "error": "Дууссан дараа тооцоот захиалгын төлбөрийг зөвхөн эрхтэй хэрэглэгч (нягтлан) бүртгэнэ.", "code": "POSTPAID_SETTLEMENT_FORBIDDEN" }
      // Дараа тооцоот захиалга COMPLETED болсны дараа төлбөр бүртгэх/буцаах, QPay үүсгэх/шалгах/цуцлах нь "orders.closeUnpaidPostpaid" эрх шаардана (owner-д үргэлж байна). Төлбөр бүртгэх/буцаах бусад эндпойнтууд (/payments, /payments/[paymentId]/reverse, /qpay, /qpay/check)-д мөн адил.
409  { "error": "Дотоод засварт төлбөр бүртгэхгүй.", "code": "ORDER_INTERNAL_NO_PAYMENT" }
      // Дотоод засвар (isInternal=true)-д төлбөр бүртгэх/буцаах, QPay үүсгэх/шалгах/цуцлах бүх үйлдэл 409 ORDER_INTERNAL_NO_PAYMENT.
404  { "error": "Засварын хуудас олдсонгүй." }
422  { "error": "Төлбөрийн төлөв буруу." }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/orders/[id]/payments" auth="bearer" bearerLabel={BEARER} tags={["Эрх: payments.view"]} title="Засварын хуудасны бүртгэгдсэн төлбөрүүд (банкны мэдээлэлтэй).">
          <Code>{`Res: 200 { "payments": [{ "id": "...", "amount": "50000", "method": "CASH|CARD|BANK_TRANSFER|QPAY|OTHER", "status": "PAID|PENDING|CANCELLED|FAILED",
                         "paidAt": "ISO" | null, "createdAt": "ISO",
                         "bank": "KHAN" | null, "bankLabel": "Хаан банк" | null,
                         "locked": false,                                  // true = төлбөрийн кассын бичлэг ХААГДСАН ээлжид: буцаах боломжгүй (409 CASH_SESSION_ENTRY_LOCKED); UI товчийг идэвхгүй болгоно
                         "settlementId": "..." | null }] }   // settlementId != null = «Нэгдсэн тооцоо»-ны төлбөр: тусад нь буцаах боломжгүй (422 SETTLEMENT_PAYMENT_LOCKED)
403 { "error": "Танд энэ төлбөрийг харах эрх байхгүй.", "code": "ORDER_VIEW_FORBIDDEN" }
404 { "error": "Засварын хуудас олдсонгүй.", "code": "ORDER_NOT_FOUND" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/orders/[id]/payments" auth="bearer" bearerLabel={BEARER} tags={["Эрх: payments.create", "Багц идэвхтэй байх шаардлагатай"]} title="Төлбөр бүртгэх. BANK_TRANSFER/CARD үед хүлээн авсан банк (bank) заавал; бусад аргад bank үл тооцогдож null хадгалагдана.">
          <Code>{`Req:  { "method": "CASH|CARD|BANK_TRANSFER|OTHER", "amount": "50000", "bank": "KHAN" }
      // bank — зөвхөн BANK_TRANSFER/CARD үед. CARD-д POS терминалын банк. GET /api/v1/banks-ийн кодуудаас.
Res:  201 { "payment": { ...дээрх payment бүтэц }, "order": { "paidAmount", "paymentStatus", "totalAmount", "remainingAmount" } }
422 { "error": "Банкаа сонгоно уу.", "code": "PAYMENT_BANK_REQUIRED", "fieldErrors": { "bank": "..." } }
422 { "error": "Энэ банк идэвхгүй байна.", "code": "PAYMENT_BANK_NOT_ENABLED", "fieldErrors": { "bank": "..." } }
      // Бусад: PAYMENT_AMOUNT_INVALID, PAYMENT_ALREADY_PAID, PAYMENT_OVERPAYMENT, ORDER_EDIT_FORBIDDEN ...
409 { "error": "Касс нээгээгүй байна. Эхлээд кассаа нээнэ үү.", "code": "CASH_SESSION_CLOSED" }   // салбарын кассын ээлж нээлттэй биш (бүх төлбөрийн арга)
      // CASH_SESSION_CLOSED: төлбөр бүртгэх, буцаах (reverse, бүгдийг буцаах), QPay нэхэмжлэх үүсгэхэд захиалгын салбарт нээлттэй касс (кассын ээлж) заавал байна. Нээсэн QPay нэхэмжлэхийн төлбөр орсныг баталгаажуулах/QPay цуцлахад хамаарахгүй.
      // Хуучин PATCH /orders/[id]/payment { paymentStatus: "PAID", method, bank } мөн адил bank шаардана.
      // CASH_SESSION_ENTRY_LOCKED: хаагдсан кассын ээлжид хамаарах төлбөрийг (аль ч арга) буцаах боломжгүй — 409 { "code": "CASH_SESSION_ENTRY_LOCKED", "error": "Хаагдсан ээлжийн гүйлгээг буцаах боломжгүй." } (POST /payments/[paymentId]/reverse, PATCH /payment {paymentStatus:"UNPAID"} бүгдийг буцаах). Бүгдийг буцаахад нэг ч түгжигдсэн төлбөр байвал бүхэлд нь татгалзана. Ээлжгүй (хуучин) бичлэг нээлттэй ээлжид буцаагдсаар байна. Иймээс хаагдсан ээлжид төлөгдсөн захиалгыг цуцлах, мөрийг засах/цуцлахад 422 { "code": "PAID_PAYMENT_LOCKED" } буцна («Төлбөр нь хаагдсан ээлжид бүртгэгдсэн тул захиалгыг цуцлах боломжгүй.» / «...мөрийг засах, цуцлах боломжгүй.») — энэ үед PAID_PAYMENT_EXISTS («эхлээд төлбөрийг буцаа») биш; payment.locked = true байгааг UI-д ашиглана.`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/banks" auth="bearer" bearerLabel={BEARER} title="Банкны тогтмол жагсаалт + тенантын идэвхтэй банкууд (төлбөрийн банк сонгогчид).">
          <Code>{`Res: 200 { "banks": [{ "code": "KHAN", "label": "Хаан банк" }, ...11 банк],
           "enabledBanks": ["KHAN", "GOLOMT"],   // хоосон тохиргоо → бүх банк
           "configured": false }                   // тенант өөрөө сонгоогүй бол false
      // Сонгогч зөвхөн enabledBanks-ийг харуулна. Хадгалагдсан банк идэвхгүй болсон ч label-ээ үргэлж харуулна (үл мэдэгдэх код → код өөрөө).`}</Code>
        </Endpoint>

        <Endpoint method="PUT" path="/api/v1/banks/enabled" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage", "Багц идэвхтэй байх шаардлагатай"]} title="Идэвхтэй банкуудыг тохируулах (хоосон жагсаалт = бүх банк).">
          <Code>{`Req:  { "enabledBanks": ["KHAN", "GOLOMT"] }   // давхардал арилгагдана
Res:  200 { "banks": [...], "enabledBanks": [...], "configured": true }
403 { "error": "Танд кассыг удирдах эрх байхгүй.", "code": "CASH_MANAGE_FORBIDDEN" }
422 { "error": "Банкны код буруу байна.", "code": "BANK_CODE_INVALID" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/cash/entries" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage"]} title="Кассын орлого/зарлагын бичлэгүүд + нийлбэр (хүчингүй болсон бичлэг нийлбэрт орохгүй).">
          <Code>{`Query: from=YYYY-MM-DD  to=YYYY-MM-DD (Улаанбаатарын өдөр, to өдрийн төгсгөл хүртэл)  branchId  direction=INCOME|EXPENSE
       typeId  method=CASH|BANK_TRANSFER|CARD|QPAY|OTHER  bank=KHAN..  includeVoided=1  outsideSession=1 («Ээлжээс гадуур»: method=CASH бөгөөд sessionId=null)  page  pageSize (≤200, default 50)
       // Ажиллах салбар (X-Working-Branch) тогтсон бол branchId-г дарж тэр салбараар хязгаарлана.
Res: 200 {
  "entries": [{
    "id": "...", "direction": "INCOME" | "EXPENSE",
    "type": { "id", "name": "Засварын орлого", "systemKey": "ORDER_PAYMENT" | "POSTPAID_SETTLEMENT" | "INTERNAL_REPAIR" | null, "isSystem": true },
    "branch": { "id", "name" },
    "amount": "50000", "method": "CASH", "methodLabel": "Бэлэн", "bank": "KHAN" | null, "bankLabel": "Хаан банк" | null,
    "occurredAt": "ISO", "note": "..." | null, "attachmentPath": "/uploads/cash/{tenantId}/..." | null,
    "taxIncluded": "5000" | null,            // «Татвар (туршилт)» — зөвхөн зарлага, ямар ч нийлбэрт орохгүй
    "customer": { "id", "name" } | null, "counterparty": "..." | null,
    "orderId": "..." | null, "orderNumber": "..." | null, "orderPaymentId": "..." | null, "settlementId": null, "sessionId": null,
    "isSystem": true,                         // автомат бичлэг — гараар хүчингүй болгохгүй
    "createdBy": { "id", "name" }, "createdAt": "ISO",
    "voidedAt": "ISO" | null, "voidedBy": { "id", "name" } | null, "voidReason": "..." | null
  }],
  "totals": { "income": "0", "expense": "0", "net": "0", "incomeCount": 0, "expenseCount": 0 },
  "pagination": { "page", "pageSize", "total", "totalPages", "hasPrev", "hasNext" } }
403 { "error": "Танд кассыг удирдах эрх байхгүй.", "code": "CASH_MANAGE_FORBIDDEN" }
422 { "code": "CASH_DATE_INVALID" | "CASH_TYPE_INVALID" | "CASH_METHOD_INVALID" | "PAYMENT_BANK_NOT_ENABLED", "fieldErrors": {...} }
      // Төлбөр PAID болох бүрт орлого автоматаар бичигдэнэ; төлбөр буцаавал бичлэг хүчингүй болно. Дотоод засвар дуусахад зарлага автоматаар бичигдэнэ.`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/cash/entries" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage", "Багц идэвхтэй байх шаардлагатай"]} title="Гар орлого/зарлага бүртгэх.">
          <Code>{`Req:  { "direction": "INCOME" | "EXPENSE", "typeId": "...", "branchId": "...", "amount": "50000",
        "method": "CASH" | "BANK_TRANSFER" | "CARD" | "OTHER",           // QPAY гараар бүртгэхгүй
        "bank": "KHAN",                                                    // BANK_TRANSFER/CARD үед заавал
        "occurredAt": "2026-10-05" | "2026-10-05T14:30" | ISO (+offset),   // default одоо; 1 хоногоос урагш болохгүй. Offset-гүй = Улаанбаатарын цаг
        "note": "...", "attachmentPath": "/uploads/cash/{tenantId}/...",   // POST /cash/attachments-ийн url
        "taxIncluded": "5000",                                             // зөвхөн EXPENSE, ≤ amount
        "customerId": "...", "counterparty": "..." }
Res:  201 { "entry": { ...дээрх бүтэц } }
403 CASH_MANAGE_FORBIDDEN
409 { "code": "CASH_SESSION_CLOSED", "error": "Касс нээгээгүй байна. Эхлээд кассаа нээнэ үү." }   // салбарт кассын ээлж нээлттэй биш (бүх төлбөрийн арга)
422 { "error": "...", "code": "<code>", "fieldErrors": { "<талбар>": "..." } }
      codes: CASH_TYPE_INVALID (төрөл идэвхгүй/чиглэл таарахгүй/системийн төрөл) · CASH_AMOUNT_INVALID (>0, ≤2 орон, ≤9,999,999,999.99) ·
             CASH_METHOD_INVALID · CASH_DATE_INVALID · CASH_BRANCH_INVALID (салбар олдсонгүй/идэвхгүй/ажиллах хүрээнээс гадуур) ·
             CASH_TAX_INVALID · CASH_FIELD_INVALID (note ≤1000, counterparty ≤200, customer олдсонгүй) · CASH_ATTACHMENT_INVALID ·
             PAYMENT_BANK_REQUIRED · PAYMENT_BANK_NOT_ENABLED`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/cash/entries/[id]/void" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage", "Багц идэвхтэй байх шаардлагатай"]} title="Бичлэгийг хүчингүй болгох (засах/устгах байхгүй).">
          <Code>{`Req:  { "reason": "..." }                 // заавал, ≤500
Res:  200 { "entry": { ..., "voidedAt": "ISO", "voidedBy": {...}, "voidReason": "..." } }
403 CASH_MANAGE_FORBIDDEN
404 { "code": "CASH_ENTRY_NOT_FOUND" }
409 { "code": "CASH_SESSION_CLOSED", "error": "Касс нээгээгүй байна. Эхлээд кассаа нээнэ үү." }   // салбарт кассын ээлж нээлттэй биш (бүх төлбөрийн арга)
409 { "code": "CASH_SESSION_ENTRY_LOCKED", "error": "Хаагдсан ээлжийн гүйлгээг буцаах боломжгүй." }   // бичлэг хаагдсан ээлжид (аль ч арга) — entry.locked = true
422 { "code": "CASH_VOID_REASON_REQUIRED" } | { "code": "CASH_ALREADY_VOIDED" } | { "code": "CASH_SYSTEM_ENTRY" }   // автомат бичлэгийг зөвхөн эх үйлдэл (төлбөр буцаах, захиалга цуцлах) хүчингүй болгоно`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/cash/settlements/eligible" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage"]} title="«Тооцоо нийлэх»: үйлчлүүлэгчийн төлбөр үлдэгдэлтэй дараа төлбөрт дууссан захиалгууд.">
          <Code>{`Query: customerId=...  branchId=...   // хоёулаа заавал
Res: 200 { "orders": [{ "id", "number", "plate": "..." | null, "completedAt": "ISO" | null,
                        "totalAmount": "100000", "paidAmount": "0", "outstanding": "100000" }],   // outstanding > 0 бүхий, дууссан огноогоор өсөхөөр
           "total": "100000" }                                                                     // нийт үлдэгдэл
403 CASH_MANAGE_FORBIDDEN  422 CASH_FIELD_INVALID | CASH_BRANCH_INVALID`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/cash/settlements" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage + orders.closeUnpaidPostpaid", "Багц идэвхтэй байх шаардлагатай"]} title="Нэг удаагийн төлбөрөөр олон дараа төлбөрт захиалгыг нэг дор хаах (бүтэн тооцоо) — кассад НЭГ орлого бичигдэнэ.">
          <Code>{`Req:  { "branchId": "...", "customerId": "...", "orderIds": ["...", "..."],   // ≥1, ≤100, давхардал арилгагдана
        "method": "CASH" | "BANK_TRANSFER" | "CARD" | "OTHER",               // QPAY байхгүй
        "bank": "KHAN",                                                        // BANK_TRANSFER/CARD үед заавал
        "occurredAt": "2026-10-05" | "2026-10-05T14:30" | ISO,                // default одоо; захиалга дууссанаас өмнө байж болохгүй
        "note": "...",
        "expectedAmount": "250000" }                                           // сонголттой: хэрэглэгчийн харсан нийт дүн
      // Дүн = сонгосон захиалга бүрийн үлдэгдлийн нийлбэр (хэсэгчилсэн тооцоо байхгүй). Захиалга бүрт нэг PAID төлбөр (settlementId-тай) үүснэ.
Res:  201 { "settlement": {
  "id", "branch": { "id", "name" }, "customer": { "id", "name" }, "amount": "250000",
  "method": "BANK_TRANSFER", "methodLabel": "Дансаар", "bank": "KHAN" | null, "bankLabel": "..." | null,
  "occurredAt": "ISO", "note": "..." | null, "orderCount": 2, "entryId": "...",
  "locked": false,   // true = нэгдсэн бичлэг хаагдсан ээлжид: цуцлах боломжгүй (409 CASH_SESSION_ENTRY_LOCKED)
  "createdAt": "ISO", "createdBy": { "id", "name" }, "voidedAt": "ISO" | null, "voidedBy": {...} | null, "voidReason": "..." | null,
  "orders": [{ "orderId", "orderNumber", "plate", "orderTotal": "100000", "orderPaymentStatus": "PAID",
               "paymentId", "paymentStatus": "PAID" | "CANCELLED", "amount": "100000" }],
  "entry": { ...cash entry бүтэц (type.systemKey = "POSTPAID_SETTLEMENT", settlementId) } | null } }
403 { "code": "POSTPAID_SETTLEMENT_FORBIDDEN" } | { "code": "CASH_MANAGE_FORBIDDEN" }
409 { "code": "SETTLEMENT_AMOUNT_CHANGED", "expectedAmount": "...", "actualAmount": "..." }   // үлдэгдэл өөрчлөгдсөн (мөн сонгосон захиалгын хүлээгдэж буй QPay нэхэмжлэх төлөгдсөн байсан үед) — жагсаалтаа дахин ачаална
409 { "code": "QPAY_INVOICE_PARTIALLY_PAID" }   // сонгосон захиалгын QPay нэхэмжлэхэд хэсэгчлэн төлбөр орсон
502 { "code": "QPAY_CANCEL_FAILED" }   // сонгосон захиалгын хүлээгдэж буй QPay нэхэмжлэхийг QPay дээр цуцалж чадсангүй
422 { "code": "SETTLEMENT_ORDER_INVALID", "orderId": "...", "reason": "NOT_FOUND|BRANCH_MISMATCH|CUSTOMER_MISMATCH|NOT_POSTPAID|INTERNAL|NOT_COMPLETED|NO_BALANCE" }
422 { "code": "SETTLEMENT_EMPTY" } | CASH_METHOD_INVALID | CASH_DATE_INVALID | CASH_AMOUNT_INVALID | CASH_BRANCH_INVALID | CASH_FIELD_INVALID | PAYMENT_BANK_REQUIRED | PAYMENT_BANK_NOT_ENABLED
409 { "code": "CASH_SESSION_CLOSED", "error": "Касс нээгээгүй байна. Эхлээд кассаа нээнэ үү." }   // салбарт кассын ээлж нээлттэй биш (бүх төлбөрийн арга)`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/cash/settlements" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage"]} title="Тооцооны жагсаалт.">
          <Code>{`Query: from=YYYY-MM-DD  to=YYYY-MM-DD (кассын бичлэгийн occurredAt)  branchId  customerId  includeVoided=1  page  pageSize
Res: 200 { "settlements": [{ ...дээрх settlement бүтэц, "orders"/"entry"-гүй }], "pagination": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/cash/settlements/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage"]} title="Тооцооны дэлгэрэнгүй (захиалгууд, дүн, кассын бичлэг).">
          <Code>{`Res: 200 { "settlement": { ...дээрх бүтэц, "orders": [...], "entry": {...} } }
404 { "code": "SETTLEMENT_NOT_FOUND" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/cash/settlements/[id]/void" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage + orders.closeUnpaidPostpaid", "Багц идэвхтэй байх шаардлагатай"]} title="Тооцоог бүхэлд нь цуцлах (захиалга бүрийн төлбөр буцаагдаж, кассын бичлэг хүчингүй болно).">
          <Code>{`Req:  { "reason": "..." }                  // заавал, ≤500
Res:  200 { "settlement": { ..., "voidedAt": "ISO", "voidReason": "...", "orders": [{ ..., "paymentStatus": "CANCELLED" }] } }
403 POSTPAID_SETTLEMENT_FORBIDDEN | CASH_MANAGE_FORBIDDEN   404 SETTLEMENT_NOT_FOUND
422 { "code": "SETTLEMENT_ALREADY_VOIDED" } | { "code": "CASH_VOID_REASON_REQUIRED" }
409 { "code": "CASH_SESSION_ENTRY_LOCKED", "error": "Хаагдсан ээлжийн гүйлгээг буцаах боломжгүй." }   // нэгдсэн бичлэг хаагдсан ээлжид (аль ч арга) — settlement.locked = true
409 { "code": "CASH_SESSION_CLOSED", "error": "Касс нээгээгүй байна. Эхлээд кассаа нээнэ үү." }   // салбарт кассын ээлж нээлттэй биш (бүх төлбөрийн арга)
      // Тооцооны төлбөрийг тусад нь буцаах (POST /orders/[id]/payments/[paymentId]/reverse, PATCH /orders/[id]/payment {paymentStatus:"UNPAID"}) нь 422 SETTLEMENT_PAYMENT_LOCKED
      // «Нэгдсэн тооцооны төлбөрийг тооцоогоор нь цуцална уу.» Кассын бичлэгийг /cash/entries/[id]/void-оор цуцлах нь CASH_SYSTEM_ENTRY.`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/cash/sessions" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage", "Багц идэвхтэй байх шаардлагатай"]} title="«Касс нээх»: салбарын кассын ээлж нээх (салбар бүрт нэг зэрэг ганц нээлттэй ээлж).">
          <Code>{`Req:  { "branchId": "...", "openingCash": "50000" | "0", "note": "..." }   // openingCash ≥ 0, ≤ 2 орон
Res:  201 { "session": {
  "id", "status": "OPEN" | "CLOSED", "branch": { "id", "name" },
  "openedAt": "ISO", "openedBy": { "id", "name" }, "openingCash": "50000",
  "closedAt": "ISO" | null, "closedBy": {...} | null,
  "countedCash": "..." | null, "expectedCash": "...",   // нээлттэй үед ШУУД тооцоолсон, хаасан үед хөлдөөсөн утга
  "difference": "..." | null,                           // countedCash − expectedCash (хаасны дараа)
  "note": "..." | null,
  "cashIn": "...", "cashOut": "...", "entryCount": 0,        // хүчингүй болоогүй БЭЛЭН бичлэгүүдийн нийлбэр/тоо
  "totalEntryCount": 0,                                  // бүх аргын (хүчингүй болоогүй) бичлэгийн тоо
  "byMethod": [{ "method": "CASH|CARD|BANK_TRANSFER|QPAY|OTHER", "bank": "KHAN" | null,
    "income": "...", "expense": "...", "net": "...", "count": 0,
    "expected": "..." | null, "counted": "..." | null, "difference": "..." | null }] } }
      // byMethod: (арга, банк) бүлэг тус бүр. expected/counted/difference нь нээлттэй үед expected=net (CASH: нээлтийн үлдэгдэлтэй), бусад null; хаасны дараа хөлдсөн утга.
409 { "code": "CASH_SESSION_ALREADY_OPEN" }  422 { "code": "CASH_AMOUNT_INVALID" | "CASH_BRANCH_INVALID" }
      // expectedCash = openingCash + Σ(бэлэн ОРЛОГО) − Σ(бэлэн ЗАРЛАГА), хүчингүй болсон бичлэггүй.
      // Ээлж нээлттэй байх хугацаанд тухайн салбарт бичигдэх БЭЛЭН бичлэг бүр (гар бичлэг, захиалгын бэлэн төлбөр, бэлэн тооцоо) ээлжид автоматаар холбогдоно (sessionId). Бэлэн бус (карт, шилжүүлэг, QPay, бусад) бичлэг ч мөн холбогдоно.
      // Касс нээгдээгүй үед хэрэглэгчийн мөнгөний бичилт (аль ч арга) 409 CASH_SESSION_CLOSED. «Ээлжээс гадуур» = өмнөх (хуучин) болон системийн ээлжгүй бичлэгүүд.`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/cash/sessions" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage"]} title="Кассын ээлжийн жагсаалт (нээсэн огноогоор шинэ нь эхэндээ).">
          <Code>{`Query: from=YYYY-MM-DD  to=YYYY-MM-DD (openedAt)  branchId  status=OPEN|CLOSED  page  pageSize
Res: 200 { "sessions": [{ ...дээрх session бүтэц }], "pagination": {...} }
422 { "code": "CASH_FIELD_INVALID" | "CASH_DATE_INVALID" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/cash/sessions/current" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage"]} title="Салбарын одоогийн нээлттэй ээлж (шууд тооцоолсон expectedCash-тай).">
          <Code>{`Query: branchId=...   // ажиллах салбар (X-Working-Branch) тогтсон бол заавал биш
Res: 200 { "branchId": "...", "session": { ...session бүтэц, "status": "OPEN" } | null }   // null = касс нээгдээгүй
422 { "code": "CASH_BRANCH_INVALID" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/cash/sessions/open-flag" auth="bearer" bearerLabel={BEARER} tags={["Эрх: payments.create эсвэл cash.manage"]} title="Салбарт касс нээлттэй эсэх (бэлэн төлбөр бүртгэх үед анхааруулга үзүүлэх хөнгөн тэмдэг).">
          <Code>{`Query: branchId=...   // ажиллах салбар тогтсон бол заавал биш
Res: 200 { "branchId": "...", "open": true | false }
      // open=false үед хэрэглэгчийн төлбөр/кассын бичлэг 409 CASH_SESSION_CLOSED болно; нээлттэй үед бүх арга (бэлэн, карт, данс, QPay) ээлжид хамаарна.
403 / 422 { "code": "CASH_BRANCH_INVALID" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/cash/sessions/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage"]} title="Ээлжийн дэлгэрэнгүй: бичлэгүүд, нийлбэр, хаасны дараах хүчингүйжилт.">
          <Code>{`Res: 200 {
  "session": { ...session бүтэц },
  "entries": [{ ...кассын бичлэг бүтэц }],          // хүчингүй болоогүй (≤500)
  "voidedEntries": [{ ... }],                        // хүчингүй болсон бүх бичлэг (≤500)
  "postCloseVoids": { "count": 0, "incomeAmount": "0", "expenseAmount": "0", "netAmount": "0", "entries": [{ ... }] } }
      // postCloseVoids: ээлж хаагдсаны ДАРАА хүчингүй болсон бичлэгүүд (төлбөр буцаалт гэх мэт). Хаасан ээлжийн expectedCash/difference хөлдсөн хэвээр.
404 { "code": "CASH_SESSION_NOT_FOUND" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/cash/sessions/[id]/close" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage", "Багц идэвхтэй байх шаардлагатай"]} title="«Касс хаах»: тоолсон мөнгөө оруулж ээлжийг хаах (expectedCash, difference хөлдөнө).">
          <Code>{`Req:  { "countedCash": "148000", "methodCounts": [{ "method": "CARD", "bank": "KHAN", "counted": "120000" }], "note": "..." }
      // countedCash ≥ 0 (бэлэн мөнгө). methodCounts заавал биш: бэлэн бус бүлэг (CARD/BANK_TRANSFER банкаар) тус бүрийн тоолсон дүн;
      // counted хоосон/null = тоолоогүй. QPAY тооллогогүй (counted = expected). Ээлжид байхгүй бүлэг/CASH/сөрөг дүн → 422 CASH_FIELD_INVALID.
      // Хаахад бүлэг бүрийн expected (цэвэр дүн), counted, difference хөлдөнө (session.byMethod).
Res:  200 { "session": { ..., "status": "CLOSED", "countedCash": "148000", "expectedCash": "150000", "difference": "-2000", "closedAt": "ISO", "closedBy": {...} } }
404 { "code": "CASH_SESSION_NOT_FOUND" }  422 { "code": "CASH_SESSION_NOT_OPEN" } (аль хэдийн хаагдсан)  422 { "code": "CASH_AMOUNT_INVALID" }
      // Хаагдсан ээлж өөрчлөгдөхгүй.`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/cash/report" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage"]} title="«Мөнгөн гүйлгээний тайлан»: арга/банк/төрлөөр орлого-зарлага, цэвэр дүн, дараа тооцоо, дотоод зардал, ээлжүүд.">
          <Code>{`Query: from=YYYY-MM-DD  to=YYYY-MM-DD (хоёул заавал биш; байхгүй бол «энэ сар», ≤366 хоног)  branchId (ажиллах салбар тогтсон бол үл тооцно)
Res: 200 { "range": { "from", "to", "label", "key" }, "summary": {
  "range": { "from": "ISO", "to": "ISO" }, "branchId": "..." | null,
  "incomeByMethod": [{ "method": "CASH|BANK_TRANSFER|CARD|QPAY|OTHER", "methodLabel", "total": "...", "count": 0,
      "banks": [{ "bank": "KHAN" | null, "bankLabel": "Хаан банк" | "Банк тодорхойгүй", "total", "count" }] }],  // banks зөвхөн BANK_TRANSFER, CARD
  "incomeByType": [{ "typeId", "name", "systemKey": "ORDER_PAYMENT" | "POSTPAID_SETTLEMENT" | null, "total", "count" }],
  "expenseByType": [{ ...ижил, systemKey "INTERNAL_REPAIR" = дотоод засварын зардал }],
  "expenseByMethod": [{ "method", "methodLabel", "total", "count" }],
  "netByMethod": [{ "method", "methodLabel", "income", "expense", "net" }],   // net = орлого − зарлага
  "netCash": "...",                                                            // бэлэн мөнгөний цэвэр хөдөлгөөн (CASH мөрийн net)
  "postpaid": { "workDone": { "total", "count" },            // хугацаанд дууссан дараа төлбөрт (дотоод биш) захиалгын нийт дүн
                "collected": { "total", "settlements": { "total", "count" }, "directPayments": { "total", "count" } },
                "outstanding": { "total", "asOf": "ISO" } },  // авлага үлдэгдэл — ХУГАЦААНЫ ЭЦСИЙН байдлаар (өнөөдрөөр биш); дараа төлбөрт эсэхээс үл хамааран бүх дууссан (дотоод биш) захиалгын төлөгдөөгүй үлдэгдэл (QA #11)
  "internalCost": { "total", "count" },                        // кассын INTERNAL_REPAIR зарлага (системийн эх сурвалж)
  "sessions": { "items": [{ "id", "branch": { "id", "name" }, "status": "OPEN|CLOSED", "openedAt", "closedAt", "openingCash", "cashIn", "cashOut",
      "expectedCash" /* хаасан: хөлдөөсөн, нээлттэй: шууд */, "countedCash", "difference",
      "postCloseVoids": { "count", "incomeAmount", "expenseAmount", "netAmount" } }],             // хугацаанд нээгдсэн ээлжүүд
      "outsideSession": { "income", "expense", "net", "count" } },                                // «Ээлжээс гадуур» бэлэн бичлэг
  "totals": { "income", "expense", "net" } } }
403 { "code": "CASH_MANAGE_FORBIDDEN" }  422 { "code": "VALIDATION", "fieldErrors": {...} }
      // Хүчингүй болсон бичлэг ямар ч нийлбэрт орохгүй; taxIncluded хэзээ ч нийлбэрт орохгүй. Бүх дүн string.`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/cash/report/export" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage"]} title="«Мөнгөн гүйлгээний тайлан»-г .xlsx болгож татах (тайлангийн хэсэг бүр нэг sheet).">
          <Code>{`Query: /cash/report-тай ижил (from, to, branchId)
Res: 200 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, Content-Disposition: attachment; filename="mungun-guilgee_<from>_<to>.xlsx"
403 { "code": "CASH_MANAGE_FORBIDDEN" }  422 { "code": "VALIDATION" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/cash/types" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage"]} title="Орлого/зарлагын төрлүүд (анхдагч төрлүүд анх удаа автоматаар үүснэ).">
          <Code>{`Query: direction=INCOME|EXPENSE  includeInactive=1
Res: 200 { "types": [{ "id", "direction", "name", "systemKey": null | "ORDER_PAYMENT" | "POSTPAID_SETTLEMENT" | "INTERNAL_REPAIR",
                       "isSystem": false, "isActive": true, "createdAt", "updatedAt" }] }
      // Гараар бичлэг хийхэд зөвхөн isActive && !isSystem төрлийг сонгоно.`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/cash/types" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage", "Багц идэвхтэй байх шаардлагатай"]} title="Төрөл нэмэх.">
          <Code>{`Req:  { "direction": "INCOME" | "EXPENSE", "name": "..." }   // нэр 1–60 тэмдэгт
Res:  201 { "type": { ... } }
409 { "code": "CASH_TYPE_DUPLICATE" }  422 { "code": "CASH_TYPE_NAME_INVALID" | "CASH_TYPE_INVALID" }`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/cash/types/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage", "Багц идэвхтэй байх шаардлагатай"]} title="Төрлийн нэр солих / идэвхгүй болгох.">
          <Code>{`Req:  { "name": "...", "isActive": false }   // аль нэг нь
Res:  200 { "type": { ... } }
404 { "code": "CASH_TYPE_INVALID" }  409 { "code": "CASH_TYPE_DUPLICATE" }
422 { "code": "CASH_TYPE_SYSTEM" }   // системийн төрлийг (systemKey != null) нэр/идэвх өөрчлөх, устгах боломжгүй`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/cash/attachments" auth="bearer" bearerLabel={BEARER} tags={["Эрх: cash.manage", "Багц идэвхтэй байх шаардлагатай"]} title="Бичлэгийн хавсралт зураг (баримт) байршуулах.">
          <Code>{`Req:  multipart/form-data  file = PNG | JPG | WEBP (≤ 2MB)
Res:  201 { "url": "/uploads/cash/{tenantId}/....jpg", "size": 12345, "mime": "image/jpeg" }   // url-ийг attachmentPath болгон илгээнэ
400 { "error": "...", "code": "CASH_ATTACHMENT_INVALID" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/orders/[id]/qpay" auth="bearer" bearerLabel={BEARER} title="Засварын хуудасны идэвхтэй QPay нэхэмжлэхийг харах.">
          <Code>{`Res: 200 { "qpayEnabled": true, "pending": { "id": "...", "qrImage": "...", "qrText": "...", "amount": "0", "urls": [...] } | null }
404 { "error": "Засварын хуудас олдсонгүй." }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/orders/[id]/qpay" auth="bearer" bearerLabel={BEARER} tags={["Эрх: payments.create"]} title="Засварын хуудсанд QPay нэхэмжлэх үүсгэх (анхдагч нь үлдэгдэл дүн).">
          <Code>{`Req (заавал биш): { "amount": "20000" }   // string; байхгүй бол үлдэгдэл дүнгээр. Тухайн дүнтэй PENDING нэхэмжлэх байвал дахин ашиглана, өөр дүнтэй бол цуцлаад шинээр үүсгэнэ.
Res: 200 { "payment": { "id": "...", "qrImage": "...", "qrText": "...", "amount": "0", "urls": [...] } }
404 { "error": "Засварын хуудас олдсонгүй." }
422 { "error": "Дүн буруу байна.", "code": "QPAY_AMOUNT_INVALID" } | { "error": "Дүн үлдэгдлээс их байж болохгүй.", "code": "QPAY_AMOUNT_EXCEEDS" }
422 { "error": "Засварын хуудас бүрэн төлөгдсөн." } | { "error": "Үлдэгдэл байхгүй." }
409 { "error": "Касс нээгээгүй байна. Эхлээд кассаа нээнэ үү.", "code": "CASH_SESSION_CLOSED" }   // салбарын кассын ээлж нээлттэй биш (бүх төлбөрийн арга)
409 { "error": "Өмнөх QPay QR төлөгдсөн байна.", "code": "QPAY_PREVIOUS_PAID" }   // өөр дүнтэй шинэ QR үүсгэхийн өмнө хуучин нэхэмжлэх QPay дээр төлөгдсөн байсан: төлбөр бүртгэгдсэн, ШИНЭ нэхэмжлэх ҮҮСЭЭГҮЙ — захиалгыг дахин ачаална
409 { "error": "Энэ QPay нэхэмжлэхэд хэсэгчлэн төлбөр орсон байна. Шалгаад дахин оролдоно уу.", "code": "QPAY_INVOICE_PARTIALLY_PAID" }
409 { "error": "...", "code": "QPAY_PENDING_CHANGED" }   // зэрэгцээ өөрчлөлт — дахин оролдоно уу
502 { "error": "QPay нэхэмжлэх цуцлахад алдаа гарлаа. Дахин оролдоно уу.", "code": "QPAY_CANCEL_FAILED" }   // хуучин нэхэмжлэхийг QPay дээр цуцалж чадсангүй (локал бүртгэл өөрчлөгдөөгүй)
502 { "error": "<qpay провайдерын алдаа>" }`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/orders/[id]/qpay" auth="bearer" bearerLabel={BEARER} tags={["Эрх: payments.delete"]} title="Хүлээгдэж буй QPay нэхэмжлэхийг цуцлах.">
          <Code>{`Req:  { "paymentId": "..." }
Res:  200 { "ok": true }   // нэхэмжлэх эхлээд QPay дээр цуцлагдаж, дараа нь локал бүртгэл CANCELLED болно
400 { "error": "paymentId шаардлагатай." }
409 { "error": "...", "code": "QPAY_INVOICE_PAID" }   // нэхэмжлэх QPay дээр төлөгдсөн байсан — төлбөр бүртгэгдсэн, цуцлаагүй: жагсаалтаа дахин ачаална
409 { "error": "...", "code": "QPAY_INVOICE_PARTIALLY_PAID" }   // хэсэгчлэн төлөгдсөн — цуцлахгүй
502 { "error": "QPay нэхэмжлэх цуцлахад алдаа гарлаа. Дахин оролдоно уу.", "code": "QPAY_CANCEL_FAILED" }   // QPay цуцлалт амжилтгүй — локал бүртгэл өөрчлөгдөөгүй`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/orders/[id]/qpay/check" auth="bearer" bearerLabel={BEARER} tags={["Эрх: payments.edit"]} title="QPay нэхэмжлэхийн төлбөр орсон эсэхийг шалгах.">
          <Code>{`Req:  { "paymentId": "..." }
Res:  200 { "paid": true } | { "paid": false, "message": "Төлбөр төлөгдөөгүй байна." }
404 { "error": "Төлбөр олдсонгүй." }
422 { "error": "QPay invoice байхгүй." }
502 { "error": "<qpay провайдерын алдаа>" }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Цаг захиалга --- */}
      <Section title="6. Цаг захиалга">
        <Endpoint method="GET" path="/api/v1/appointments" auth="bearer" bearerLabel={BEARER} tags={["Эрх: appointments.view", "branch-scoped"]} title="Цагийн жагсаалт. month= параметрээр өдөр тус бүрийн тоог авах боломжтой.">
          <Code>{`Query: ?status=&date=YYYY-MM-DD&month=YYYY-MM&branchId=&page=&pageSize=
Res (month горим): 200 { "dates": ["2026-09-02", "2026-09-05", ...] }
Res (энгийн):      200 { "appointments": [{ "id": "...", "status": "PENDING", "requestedAt": "...", "note": "...", "createdAt": "...",
  "branch": { "id": "...", "name": "..." }, "category": { "id": "...", "name": "..." } | null,
  "account": { "name": "...", "phone": "..." } | null,                          // онлайн захиалга
  "customer": { "id": "...", "fullName": "...", "phone": "..." } | null,
  "accountVehicle": { "plate": "...", "make": "...", "model": "..." } | null,
  "vehicle": { "id": "...", "plate": "...", "make": "...", "model": "..." } | null,
  "serviceOrder": { "id": "...", "number": "..." } | null,
  "assignedToId": "..." | null, "assignedTo": { "id": "...", "firstName": "...", "lastName": "..." } | null }],   // хариуцах мастер (онлайн захиалгад мастер байхгүй байж болно → null; идэвхгүй болсон ч хуучин оноолтыг харуулна)
  "pagination": {...} }   // pageSize max 100`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/appointments" auth="bearer" bearerLabel={BEARER} tags={["Эрх: appointments.create", "branch-scoped"]} title="Ажилтан утсаар цаг бүртгэх (CONFIRMED-ээр үүснэ).">
          <Code>{`Req:  { "branchId": "...", "customerId": "...", "requestedAt": "2026-09-02T10:00:00", "vehicleId"?: "...", "note"?: "...",
        "categoryIds"?: ["..."], "confirmed"?: false,
        "assignedToId"?: "..." }     // хариуцах мастер ЗААВАЛ (orders.assign эрхтэй хэрэглэгчид). orders.assign эрхгүй бол илгээхгүй байж болно — өөрөө оноогдоно.
Res:  201 { "appointment": {...} }       // жагсаалтын нэг элемент, assignedToId/assignedTo-той
403  { "error": "Зөвхөн өөрийгөө хариуцагчаар оноож болно." }   // orders.assign эрхгүй ажилтан өөр хүн оноох гэвэл
422  { "error": "Хариуцах мастер сонгоно уу.", "code": "ASSIGNEE_REQUIRED", "fieldErrors": { "assignedToId": "Хариуцах мастер сонгоно уу." } }   // orders.assign эрхтэй хэрэглэгч мастер өгөөгүй
422  { "error": "Сонгосон ажилтан энэ салбарт хариуцагч болж болохгүй.", "code": "ASSIGNEE_INELIGIBLE", "fieldErrors": { "assignedToId": "..." } }
     // засварын хуудасны мастертай ижил дүрэм: идэвхтэй, идэвхжсэн, хугацаа дуусаагүй, orders.assignable эрхтэй, тухайн салбарт`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/appointments/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: appointments.edit", "branch-scoped"]} title="Цагийн статус солих (зөвшөөрөгдсөн шилжилтээр л) эсвэл хариуцах мастер солих.">
          <Code>{`Req:  { "status": "CONFIRMED", "assignedToId"?: "..." }   // assignedToId зөвхөн CONFIRMED-тэй хамт
  эсвэл { "assignedToId": "..." }   // status-гүй: зөвхөн мастер СОЛИХ (PENDING/CONFIRMED цаг; өөр хүнд оноохд orders.assign)
  // Мастерыг арилгах (null) боломжгүй. Мастертай цагт null илгээвэл 422 ASSIGNEE_REQUIRED.
  // Мастергүй (онлайн) цагийг CONFIRMED болгоход мастер заавал: assignedToId өгөх, эсвэл orders.assign эрхгүй хэрэглэгч өгөхгүй бол өөрөө оноогдоно. Өгөөгүй + orders.assign байвал 422 ASSIGNEE_REQUIRED.
  // Анхаар: цагт өөрийгөө мастераар оноох нь orders.assign эрхгүйгээр зөвшөөрөгдөнө (orders PATCH-аас ялгаатай); өөр хүнд оноохд л orders.assign шаардана.
  // POST /api/v1/appointments/[id]/confirm мөн body-д { "assignedToId" } хүлээн авна (мастергүй цагт заавал, дээрх дүрмээр).
Res:  200 { "appointment": {...} }
400  { "error": "status шаардлагатай." } | { "error": "Онлайн бус захиалгыг энэ замаар баталгаажуулах боломжгүй." }
403  { "error": "Зөвхөн өөрийн салбарын цаг захиалгыг удирдана." }
404  { "error": "Цаг захиалга олдсонгүй." }
409  { "error": "PENDING → COMPLETED шилжилт боломжгүй." }
422  { "error": "Хариуцах мастерыг арилгах боломжгүй — өөр мастер сонгоно уу.", "code": "ASSIGNEE_REQUIRED", "fieldErrors": { "assignedToId": "Хариуцах мастер сонгоно уу." } }   // арилгах оролдлого эсвэл мастергүй цагийг мастергүй батлах
422  { "error": "Цагийн хугацаа өнгөрсөн тул баталгаажуулах боломжгүй.", "code": "APPOINTMENT_OVERDUE" }
     // PENDING цагийн товлосон хугацаа өнгөрсөн бол CONFIRMED болгох үед (POST /api/v1/appointments/[id]/confirm-д мөн адил)`}</Code>
        </Endpoint>
      </Section>

      {/* --- Каталог --- */}
      <Section title="7. Үйлчилгээний каталог">
        <Endpoint method="GET" path="/api/v1/services" auth="bearer" bearerLabel={BEARER} title="Ажил/сэлбэг/оношилгооны каталог.">
          <Code>{`Query: ?type=LABOR|GOODS|DIAGNOSTIC&q=&isActive=&page=&pageSize=
Res: 200 { "services": [{ "id": "...", "type": "...", "name": "...", "code": "...", "price": 0, "costPrice": 0,
  "stock": 0, "description": "...", "isActive": true,
  "durationValue": 1.5 | null, "durationUnit": { "id": "...", "name": "цаг", "code": "h" } | null,   // ажлын хугацаа (LABOR)
  "unit": { "id": "...", "name": "...", "code": "..." } | null, "category": { "id": "...", "name": "..." } | null, "createdAt": "..." }],
  "pagination": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/services" auth="bearer" bearerLabel={BEARER} tags={["Багц идэвхтэй байх шаардлагатай"]} title="Шинэ ажил/сэлбэг/оношилгоо үүсгэх.">
          <Code>{`Req:  { "type": "GOODS", "name": "...", "price": 0, "code": "...", "costPrice": 0, "stock": 0, "unitId": "...", "categoryId": "...",
        "durationValue": 1.5, "durationUnitId": "..." }   // type/name/price заавал
Res:  200 { "service": {...} }
400  { "error": "Төрөл буруу байна (LABOR | GOODS | DIAGNOSTIC)" } | { "error": "Нэр заавал шаардлагатай" } | { "error": "Үнэ буруу байна" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/services/[id]" auth="bearer" bearerLabel={BEARER} title="Ганц үйлчилгээний дэлгэрэнгүй.">
          <Code>{`Res: 200 { "service": { ...list-ийн талбарууд, "updatedAt", "_count": { "items": 0 } } }
404 { "error": "Үйлчилгээ олдсонгүй." }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/labor-categories" auth="bearer" bearerLabel={BEARER} title="Ажлын ангиллын жагсаалт.">
          <Code>{`Query: ?all=true (идэвхгүй ч оруулах)
Res: 200 { "categories": [{ "id": "...", "name": "...", "description": "...", "isActive": true, "createdAt": "..." }] }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/labor-categories" auth="bearer" bearerLabel={BEARER} title="Шинэ ажлын ангилал үүсгэх (нэр давхцахгүй).">
          <Code>{`Req:  { "name": "...", "description": "...", "isActive": true }
Res:  200 { "category": {...} }        // системийн ангилал автоматаар "Ерөнхий" түлхүүрт холбогдоно
400  { "error": "Тийм нэртэй ангилал аль хэдийн байна" }
500  { "error": "Системийн ерөнхий ангилал тохируулагдаагүй байна." }`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/labor-categories/[id]" auth="bearer" bearerLabel={BEARER} title="Ажлын ангилал засах.">
          <Code>{`Req:  { "name": "...", "description": "...", "isActive": true }  // бүгд заавал биш
Res:  200 { "category": {...} }
404  { "error": "Ангилал олдсонгүй" }`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/labor-categories/[id]" auth="bearer" bearerLabel={BEARER} title="Ажлын ангилал устгах (ашиглагдаж байгаа бол боломжгүй).">
          <Code>{`Res: 200 { "ok": true }
404 { "error": "Ангилал олдсонгүй" }
400 { "error": "3 үйлчилгээнд ашиглагдаж байгаа тул устгах боломжгүй" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/units" auth="bearer" bearerLabel={BEARER} title="Хэмжих нэгжийн жагсаалт.">
          <Code>{`Query: ?all=true
Res: 200 { "units": [{ "id": "...", "name": "...", "code": "...", "isActive": true, "createdAt": "..." }] }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/units" auth="bearer" bearerLabel={BEARER} title="Шинэ нэгж үүсгэх (нэр давхцахгүй).">
          <Code>{`Req:  { "name": "...", "code": "...", "isActive": true }
Res:  200 { "unit": {...} }
400  { "error": "Тийм нэртэй нэгж аль хэдийн байна" }`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/units/[id]" auth="bearer" bearerLabel={BEARER} title="Нэгж засах.">
          <Code>{`Req:  { "name": "...", "code": "...", "isActive": true }  // бүгд заавал биш
Res:  200 { "unit": {...} }
404  { "error": "Нэгж олдсонгүй" }`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/units/[id]" auth="bearer" bearerLabel={BEARER} title="Нэгж устгах (ашиглагдаж байгаа бол боломжгүй).">
          <Code>{`Res: 200 { "ok": true }
404 { "error": "Нэгж олдсонгүй" }
400 { "error": "5 үйлчилгээнд ашиглагдаж байгаа тул устгах боломжгүй" }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Оношилгоо --- */}
      <Section title="8. Оношилгоо">
        <Endpoint method="GET" path="/api/v1/diagnostics/reports" auth="bearer" bearerLabel={BEARER} tags={["branch-scoped"]} title="Бөглөсөн оношилгооны тайлангийн жагсаалт.">
          <Code>{`Query: ?vehicleId=&customerId=&orderId=&filledByMe=true&page=&pageSize=
Res: 200 { "reports": [{ "id": "...", "createdAt": "...", "templateVersion": 1, "mileageAtReport": 45000, "orderId": "...",
  "template": { "id": "...", "name": "...", "type": "..." }, "customer": {...}, "vehicle": {...}, "branch": {...},
  "filledBy": { "id": "...", "firstName": "...", "lastName": "..." } }], "pagination": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/diagnostics/reports" auth="bearer" bearerLabel={BEARER} tags={["multipart/form-data"]} title="Оношилгооны тайлан бөглөх (зураг/гарын үсэг хавсаргах боломжтой) — orderId эсвэл customerId+vehicleId+branchId илгээнэ.">
          <Code>{`Req (form-data): templateId, orderId | (customerId + vehicleId + branchId), mileageAtReport, notes,
                 + загварын dynamic талбарууд/файлууд
Res:  201 { "report": { "id": "...", "createdAt": "...", "templateVersion": 1, "orderId": "...", "customerId": "...", "vehicleId": "...", "branchId": "..." } }
400  { "error": "Multipart form-data илгээнэ үү (зураг хавсаргах боломжтой)." }
403  { "error": "Зөвхөн өөрийн салбарт оношилгоо бүртгэх боломжтой." }
404  { "error": "Загвар олдсонгүй." } | { "error": "Засварын хуудас олдсонгүй." }
422  { "error": "customerId, vehicleId, branchId шаардлагатай (эсвэл orderId илгээнэ үү)." }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/diagnostics/reports/[id]" auth="bearer" bearerLabel={BEARER} tags={["branch-scoped"]} title="Тайлангийн дэлгэрэнгүй (загварын бүтэц/схем хамт).">
          <Code>{`Res: 200 { "report": { ...list-ийн талбарууд, "template": { ..., "schema": {...} }, "order": { "id": "...", "number": "..." } | null } }
404 { "error": "Тайлан олдсонгүй." }`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/diagnostics/reports/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: diagnostics.delete, эсвэл өөрийн бөглөсөн тайлан"]} title="Тайлан устгах — устгах эрхтэй эсвэл өөрөө бөглөсөн тайлан бол зөвшөөрнө.">
          <Code>{`Res: 200 { "ok": true }
404 { "error": "Тайлан олдсонгүй." }
403 { "error": "Танд устгах эрх байхгүй." }
422 { "error": "Дууссан ажлыг засах боломжгүй.", "code": "ITEM_COMPLETED_LOCKED" }  // холбогдсон оношилгооны мөр COMPLETED бол`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/diagnostics/templates" auth="bearer" bearerLabel={BEARER} title="Оношилгооны загваруудын жагсаалт (унших зөвхөн — засах вэб дашбоардаас).">
          <Code>{`Query: ?type=&q=&includeInactive=true&page=&pageSize=
Res: 200 { "templates": [{ "id": "...", "name": "...", "description": "...", "type": "...", "version": 1,
  "isActive": true, "price": 0, "durationMin": 0, "updatedAt": "..." }], "pagination": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/diagnostics/templates/[id]" auth="bearer" bearerLabel={BEARER} title="Загварын дэлгэрэнгүй (schema хамт).">
          <Code>{`Res: 200 { "template": { ...list-ийн талбарууд, "schema": {...}, "updatedAt": "..." } }
404 { "error": "Загвар олдсонгүй." }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Мэдэгдэл --- */}
      <Section title="9. Мэдэгдэл">
        <Endpoint method="GET" path="/api/v1/notifications" auth="bearer" bearerLabel={BEARER} title="Мэдэгдлийн жагсаалт + уншаагүй тоо.">
          <Code>{`Query: ?page=&pageSize= (default 20, max 50)
Res: 200 { "notifications": [{ "id": "...", "type": "...", "title": "...", "body": "...", "data": {...}, "readAt": "..." | null, "createdAt": "..." }],
  "pagination": {...}, "unreadCount": 3 }`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/notifications/[id]/read" auth="bearer" bearerLabel={BEARER} title="Нэг мэдэгдлийг уншсан гэж тэмдэглэх (идэмпотент).">
          <Code>{`Res: 200 { "ok": true }
404 { "error": "Мэдэгдэл олдсонгүй." }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/notifications/read-all" auth="bearer" bearerLabel={BEARER} title="Бүх мэдэгдлийг уншсан гэж тэмдэглэх.">
          <Code>{`Res: 200 { "ok": true, "count": 12 }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Багц --- */}
      <Section title="10. Багц">
        <Endpoint method="GET" path="/api/v1/subscription" auth="bearer" bearerLabel={BEARER} title="Байгууллагын багцын төлөв (олон бичих endpoint эндээс SUBSCRIPTION_EXPIRED алдаа буцаах эсэхийг тодорхойлно).">
          <Code>{`Res: 200 { "plan": "...", "status": "...", "locked": false, "isTrial": false, "daysLeft": 12 | null,
  "expiresAt": "...", "expiringSoon": false, "warnDays": 7, "hasPendingPayment": false }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Файл --- */}
      <Section title="11. Файл байршуулах">
        <Endpoint method="POST" path="/api/v1/uploads" auth="bearer" bearerLabel={BEARER} tags={["multipart/form-data"]} title="Оношилгооны зураг/гарын үсэг, машин хүлээн авах зураг байршуулах.">
          <Code>{`Req (form-data): file (заавал), kind: "diagnostics" | "signatures" | "intake" (заавал биш, анхдагч "diagnostics")
      // kind=intake: Эрх orders.create + багц идэвхтэй шаардлагатай; файл өөрийн staging хавтсанд хадгалагдана.
      // Буцсан url-ийг POST /orders-ийн intake.photoPaths / intake.signaturePath-д дамжуулна.
Res:  201 { "url": "...", "size": 123456, "mime": "image/jpeg" }
400  { "error": "Multipart form-data илгээнэ үү." } | { "error": "\`file\` талбарт зураг хавсаргана уу." }`}</Code>
        </Endpoint>
      </Section>

      {/* --- HUR --- */}
      <Section title="12. Улсын дугаараар лавлах (HUR)">
        <Endpoint method="GET" path="/api/v1/hur/vehicle" auth="bearer" bearerLabel={BEARER} tags={["Rate limit: 20/60с (хэрэглэгчээр)"]} title="Улсын дугаараар машин лавлах — систем дотор байвал тэндээс, үгүй бол улсын бүртгэлийн (HUR) системээс. Account realm-ийн /api/v1/app/hur/lookup-аас тусдаа endpoint.">
          <Code>{`Query: ?plate=1234УБА
Res: 200 { "vehicle": { ..., "owner": { "firstName", "lastName", "phone": "99••••82", "regnum": null, "type", "address": null, "kind": "Байгууллага" | "Хувь хүн" | null } | null },
          "source": "global", "registered": true, "matchedCustomerId": "<id>" | null }
   | 200 { "vehicle": { ..., "owner": {...дээрхтэй ижил} | null }, "source": "hur", "matchedCustomerId": "<id>" | null }
Тайлбар: эзэмшигчийн бүтэн утас/регистр/хаяг ХЭЗЭЭ Ч гарахгүй (утас маскалсан, regnum/address null, kind-ийг сервер тооцно).
"global" үед owner нь өөрийн tenant-ийн холбоосоос л гарна (байхгүй бол null).
matchedCustomerId — эзэмшигчийн утсаар таарсан ЭНЭ tenant-ийн үйлчлүүлэгчийн id (байхгүй бол null).
400 { "error": "Улсын дугаар шаардлагатай." }
502 { "error": "HUR алдаа гарлаа." }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Алдааны формат --- */}
      <Section title="13. Алдааны формат">
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
          <p className="text-sm text-[var(--oc-muted)] mb-3">
            Ихэнх алдаа <code className="font-plex-mono">{`{ "error": "..." }`}</code> хэлбэртэй,
            валидацийн алдаа нэмэлт <code className="font-plex-mono">fieldErrors</code>{" "}
            обьекттой, багц дууссан алдаа нэмэлт <code className="font-plex-mono">code</code>{" "}
            талбартай:
          </p>
          <Code>{`{ "error": "Хүний-унших мессеж." }
{ "error": "Хүсэлт буруу.", "fieldErrors": { "phone": "Утас шаардлагатай." } }
{ "error": "...", "code": "SUBSCRIPTION_EXPIRED" }`}</Code>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 text-sm">
            {[
              ["400", "Буруу/дутуу параметр"],
              ["401", "Токен байхгүй/хүчингүй/дууссан"],
              ["403", "Эрхгүй / багц дууссан / салбар зөрсөн"],
              ["404", "Олдсонгүй"],
              ["409", "Зөрчил (статус шилжилт боломжгүй, дугаар давхцсан)"],
              ["422", "Валидацийн алдаа (fieldErrors-тэй)"],
              ["423", "Хэт олон буруу оролдлогоор түгжигдсэн"],
              ["429", "Rate limit хэтэрсэн"],
              ["500", "Дотоод алдаа (ж: засварын хуудасны дугаар үүсгэлт)"],
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
    </>
  );
}
