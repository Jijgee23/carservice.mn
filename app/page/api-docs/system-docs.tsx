import { Code, Endpoint, Section } from "./_shared";

// System realm: платформын админ (ROOT) болон «System ажилтан» (STAFF) — мобайл апп. Вэб /system-д STAFF нэвтэрдэггүй.
export function SystemDocs() {
  return (
    <>
      <Section title="1. Нэвтрэлт — имэйл + нууц үг">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          System ажилтныг root админ вэбийн <code className="font-plex-mono">/system/admins</code> хуудаснаас үүсгэж анхны нууц үгийг
          тохируулна. Token нь Хэрэглэгч/Байгууллагын token-оос тусдаа (хооронд нь солигдохгүй). Эрхийг сервер хүсэлт бүрд DB-ээс шалгана —
          идэвхгүй болгосон ажилтан шууд хаагдана.
        </p>

        <Endpoint
          method="POST"
          path="/api/v1/system/auth/login"
          auth="public"
          tags={["Rate limit: 20/15 мин (IP), 5/15 мин (имэйл)"]}
          title="Нэвтрэх. 5 буруу оролдлого → 15 минут түгжинэ."
        >
          <Code>{`Req:  { "email": "staff@example.mn", "password": "..." }
Res:  200 {
  "admin": { "id": "...", "email": "...", "firstName": "...", "lastName": "...", "kind": "STAFF" | "ROOT",
             "permissions": ["tenants.view", "tenants.create", "tenants.edit", "tenants.suspend"] },
  "accessToken": "<JWT>", "accessTokenExpiresInSeconds": 3600,
  "refreshToken": "<opaque>", "refreshTokenExpiresInSeconds": 7776000, "refreshTokenExpiresAt": "ISO"
}
400  хэлбэр буруу
401  { "error": "Имэйл эсвэл нууц үг буруу байна." }   // имэйл бүртгэлтэй эсэхийг ялгаж хэлэхгүй
403  идэвхгүй админ (нууц үг зөв үед л)
429  хэт олон оролдлого / түгжигдсэн`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/system/auth/refresh" auth="public" tags={["Rate limit: 30/мин (IP)"]} title="Access token шинэчлэх (refresh token ротаци — хуучин нь нэг л удаа хүчинтэй).">
          <Code>{`Req:  { "refreshToken": "<opaque>" }
Res:  200 { "accessToken", "accessTokenExpiresInSeconds", "refreshToken", "refreshTokenExpiresInSeconds", "refreshTokenExpiresAt" }
401  { "reason": "invalid" | "expired" | "reused" }   // дахин нэвтэрнэ ("reused" бол бүх төхөөрөмж гарна)`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/system/auth/logout" auth="public" title="Энэ төхөөрөмжийн refresh token-г revoke (idempotent). Апп access + refresh хоёуланг устгана.">
          <Code>{`Req:  { "refreshToken": "<opaque>" }
Res:  200 { "ok": true }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/system/me" auth="bearer" title="Миний мэдээлэл + эрхүүд (апп цэсээ эрхээр харуулахад).">
          <Code>{`Res:  200 { "admin": { "id", "email", "firstName", "lastName", "kind", "permissions": [...] } }
401  token хүчингүй / админ идэвхгүй`}</Code>
        </Endpoint>

        <Endpoint method="PUT" path="/api/v1/system/me/password" auth="bearer" tags={["Rate limit: 10/10 мин"]} title="Өөрийн нууц үгийг солих (root-ын тохируулсан анхны нууц үгийг ажилтан солино). Бусад төхөөрөмж гарна.">
          <Code>{`Req:  { "currentPassword": "...", "newPassword": "..." }
Res:  200 { "ok": true, "accessToken", "refreshToken", ... }   // энэ төхөөрөмжид ШИНЭ token хос
401  одоогийн нууц үг буруу
422  { "code": "PASSWORD_INVALID" | "PASSWORD_UNCHANGED" }
429  хэт олон оролдлого`}</Code>
        </Endpoint>
      </Section>

      <Section title="2. Харилцагч (байгууллага) — унших">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Ажилтанд орлого, зээл, багц/төлбөр, захиалга, нууц үг ХАРАГДАХГҮЙ — зөвхөн холбоо барих/бүртгэлийн мэдээлэл.
        </p>

        <Endpoint method="GET" path="/api/v1/system/tenants" auth="bearer" tags={["tenants.view"]} title="Жагсаалт. ?q= (нэр, регистр, имэйл, утас) &status=active|suspended &page &pageSize">
          <Code>{`Res:  200 { "tenants": [{ "id", "name", "registerNumber", "phone1", "email", "plan", "suspended", "isTest", "createdAt",
                          "owner": { "id", "firstName", "lastName", "phone", "email", "activated" } | null }],
            "pagination": { ... } }
// owner.activated=false → эзэн SMS кодоор нууц үгээ тохируулаагүй (activation-code дахин илгээнэ)
400  status буруу`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/system/tenants/{id}" auth="bearer" tags={["tenants.view"]} title="Дэлгэрэнгүй (мэдээллийн хэсэг).">
          <Code>{`Res:  200 { "tenant": { "id", "slug", "name", "registerNumber", "email", "phone1", "phone2", "logoUrl", "plan", "suspended",
                        "isTest", "acceptsOnlineBooking", "createdAt",
                        "owners": [{ "id", "firstName", "lastName", "phone", "email", "activated" }],
                        "primaryBranch": { "id", "name", "phone", "city", "district", "khoroo", "address", "latitude", "longitude" } | null,
                        "branchCount", "employeeCount" } }
404  { "code": "NOT_FOUND" }`}</Code>
        </Endpoint>
      </Section>

      <Section title="3. Харилцагч бүртгэх, засах, түр хаах">
        <Endpoint
          method="POST"
          path="/api/v1/system/tenants"
          auth="bearer"
          tags={["tenants.create", "Rate limit: 30/10 мин"]}
          title="Шинэ харилцагч бүртгэх. Эзэн нууц үггүй үүсч, утсандаа ирсэн SMS кодоор өөрөө идэвхжүүлнэ."
        >
          <Code>{`Req:  { "orgName", "registerNumber", "phone", "email"?, "ownerName", "latitude", "longitude", "city"?, "district"?, "khoroo"?, "address"? }
      // нууц үг ШААРДАХГҮЙ (илгээсэн ч үл тооно). Регистр/нэр/утас нь өөрөө бүртгүүлэхтэй яг ижил дүрмээр шалгагдана.
Res:  201 { "tenant": TenantDetail, "activation": { "ownerId", "phone", "activated": false } }
409  { "code": "CONFLICT", "fieldErrors": { ... } }   // регистр/нэр/имэйл/утас бүртгэлтэй
422  { "code": "VALIDATION", "fieldErrors": { ... } }
// Үүсгэх: байгууллага (FREE), Үндсэн салбар + 7 хоногийн хуваарь, анхдагч нэгж/касс/оношилгооны загвар, эзэн (идэвхжээгүй).`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/system/tenants/{id}/owner/activation-code"
          auth="bearer"
          tags={["tenants.edit", "Rate limit: 10/10 мин"]}
          title="Эзэнд нууц үг тохируулах SMS код илгээх / дахин илгээх. Эзэн /api/v1/auth/activate-аар өөрөө идэвхжинэ."
        >
          <Code>{`Res:  200 { "sent": true, "ownerId": "...", "maskedPhone": "99••••33" }
404  { "code": "NOT_FOUND" }
409  { "code": "ALREADY_ACTIVE" }   // эзэн аль хэдийн идэвхжсэн
429  { "code": "THROTTLED" }
502  { "code": "SMS_FAILED" }`}</Code>
        </Endpoint>

        <Endpoint
          method="PATCH"
          path="/api/v1/system/tenants/{id}"
          auth="bearer"
          tags={["tenants.edit", "Rate limit: 60/10 мин"]}
          title="Харилцагчийн мэдээлэл засах (PATCH — ирээгүй талбар өөрчлөгдөхгүй). Өөрчлөлт бүр before/after-тэй аудитад бичигдэнэ."
        >
          <Code>{`Req:  { "name"?, "registerNumber"?, "email"? ("" / null = цэвэрлэх), "phone1"? (эсвэл "phone"), "phone2"? ("" / null = цэвэрлэх),
        "acceptsOnlineBooking"?,
        "branch"?: { "phone"?, "city"?, "district"?, "khoroo"?, "address"?, "latitude"? + "longitude"? (хамт, эсвэл хоёул null) } }
      // branch = Үндсэн салбар. Дор хаяж нэг талбар шаардлагатай.
      // ЗАСАГДАХГҮЙ: эзний нэвтрэх утас/имэйл (эзэн өөрөө профайлаасаа солино), багц, зээл, төлбөр, кассын тохиргоо.
Res:  200 { "tenant": TenantDetail, "changed": true | false }   // өөрчлөлтгүй бол changed=false, аудит бичигдэхгүй
403  { "code": "PLAN" }        // онлайн цаг захиалгыг дэмжихгүй багцад асаах гэсэн
404  { "code": "NOT_FOUND" }
409  { "code": "CONFLICT", "fieldErrors": { ... } }   // регистр/имэйл/нэр өөр байгууллагад бүртгэлтэй
422  { "code": "VALIDATION", "fieldErrors": { ... } }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/system/tenants/{id}/suspend"
          auth="bearer"
          tags={["tenants.suspend", "Rate limit: 60/10 мин"]}
          title="Байгууллагыг түр хаах (нэвтрэх, ажиллахыг зогсооно; өгөгдөл хэвээр). Body шаардахгүй."
        >
          <Code>{`Res:  200 { "tenant": TenantDetail }   // аль хэдийн хаалттай бол мөн 200 (аудит бичигдэхгүй)
404  { "code": "NOT_FOUND" }`}</Code>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/v1/system/tenants/{id}/activate"
          auth="bearer"
          tags={["tenants.suspend", "Rate limit: 60/10 мин"]}
          title="Түр хаасан байгууллагыг дахин нээх. Body шаардахгүй."
        >
          <Code>{`Res:  200 { "tenant": TenantDetail }
404  { "code": "NOT_FOUND" }`}</Code>
        </Endpoint>
      </Section>
    </>
  );
}
