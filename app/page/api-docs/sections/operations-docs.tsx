import { Code, Endpoint, Section } from "../_shared";

const BEARER = "Bearer (Ажилтан)";
const SUB = "Багц идэвхтэй байх шаардлагатай";

export function OperationsDocs() {
  return (
    <>
      {/* --- Засварын хуудас — нэмэлт --- */}
      <Section title="22. Засварын хуудас — нэмэлт үйлдлүүд">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Энэ хэсгийн бүх endpoint{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">X-Working-Branch</code> толгойгоор ажлын салбарыг
          мөрдөнө (branch-scoped). Өөр салбарын захиалга 404{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">ORDER_OUT_OF_SCOPE</code>. Огноог{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">YYYY-MM-DDTHH:mm</code> (Улаанбаатарын цаг, offset-гүй)
          хэлбэрээр илгээнэ.
        </p>

        <Endpoint method="DELETE" path="/api/v1/orders/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.delete", SUB, "branch-scoped"]} title="Засварын хуудсыг бүрмөсөн устгах — PAID төлбөргүй үед л. Хүлээгдэж буй QPay нэхэмжлэхийг QPay дээр эхлээд цуцалж, сэлбэгийн үлдэгдлийг буцаана.">
          <Code>{`Res:  200 { "ok": true, "orderId": "...", "number": "..." }
404 { "code": "ORDER_NOT_FOUND" | "ORDER_OUT_OF_SCOPE" }
422 { "error": "Энэ засварын хуудсанд төлбөр төлөгдсөн тул устгах боломжгүй.", "code": "PAID_PAYMENT_EXISTS" }
409 { "code": "PAID_PAYMENT_EXISTS" | "QPAY_INVOICE_PARTIALLY_PAID" | "QPAY_PENDING_CHANGED" }   // QPay нэхэмжлэх төлөгдсөн/хэсэгчлэн/төлөв өөрчлөгдсөн
502 { "code": "QPAY_CANCEL_FAILED" }`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/orders/[id]/expected-finish" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.edit (эсвэл orders.editOwn)", SUB, "branch-scoped"]} title="Ажиллаж буй (IN_PROGRESS) захиалгын дуусах хугацааг гараар шинэчлэх. Онлайн цагтай бол үйлчлүүлэгчид мэдэгдэл очно.">
          <Code>{`Req:  { "expectedFinishAt": "2026-09-02T17:30" | null, "confirmed"?: false }   // expectedFinishAt заавал (null = арилгах)
Res:  200 { "ok": true, "orderId": "...", "expectedFinishAt": "ISO" | null }
400 { "error": "expectedFinishAt шаардлагатай." } | { "error": "expectedFinishAt огноо буруу." } | { "error": "confirmed нь boolean байна." }
403 { "code": "ORDER_EDIT_FORBIDDEN" }   404 { "code": "ORDER_NOT_FOUND" | "ORDER_OUT_OF_SCOPE" }
409 { "error": "Шинэ дуусах хугацаа салбарын ажиллах цагаас хэтэрч байна...", "code": "CONFIRMATION_REQUIRED", "fieldErrors": { "confirmNeeded": "true" } }
      // → хэрэглэгч зөвшөөрвөл ижил хүсэлтийг "confirmed": true-тэй дахин илгээнэ
422 { "code": "ORDER_LOCKED" | "ORDER_STATUS_INVALID" | "START_TIME_REQUIRED" | "INVALID_FINISH_TIME" }`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/orders/[id]/schedule" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.edit (эсвэл orders.editOwn)", SUB, "branch-scoped"]} title="Эхлээгүй (SCHEDULED) захиалгын товлосон цагийг шилжүүлэх — холбогдсон цаг захиалга хамт шилжинэ.">
          <Code>{`Req:  { "scheduledAt": "2026-09-03T10:00", "confirmed"?: false }
Res:  200 { "ok": true, "orderId": "...", "scheduledAt": "ISO", "previousScheduledAt": "ISO" | null }
400 { "error": "scheduledAt огноо шаардлагатай." }
403 { "code": "ORDER_EDIT_FORBIDDEN" }   404 { "code": "ORDER_NOT_FOUND" | "ORDER_OUT_OF_SCOPE" | "APPOINTMENT_NOT_FOUND" }
409 { "code": "CONFIRMATION_REQUIRED", "fieldErrors": { "confirmNeeded": "true" } }   // ажиллах цагаас гадуур → confirmed: true-ээр давтана
409 { "code": "STALE_LINK" }
422 { "code": "PAST_TIME" | "ORDER_STATUS_INVALID" | "APPOINTMENT_STATUS_INVALID" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/orders/[id]/items/[itemId]/cancel" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.edit (эсвэл orders.editOwn)", SUB, "branch-scoped"]} title="Мөр цуцлах (DELETE /items/[itemId]-ийн шинэ нэр). Сэлбэгийн үлдэгдэл сэргэж, нийт дүн дахин тооцогдоно.">
          <Code>{`Res:  200 { "ok": true, "itemId": "...", "serviceId": "..." | null, "total": "125000" }   // total = захиалгын шинэ нийт дүн
403 { "code": "ORDER_EDIT_FORBIDDEN" }   404 { "code": "ORDER_NOT_FOUND" | "ITEM_NOT_FOUND" | "ORDER_OUT_OF_SCOPE" }
422 { "code": "ORDER_LOCKED" | "ITEM_COMPLETED_LOCKED" | "ITEM_NOT_CANCELLABLE" | "PAID_PAYMENT_EXISTS" | "PAID_PAYMENT_LOCKED" }`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/orders/[id]/items/[itemId]/price" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.itemPrice", SUB, "branch-scoped"]} title="Мөрийн нэгж үнийг өөрчлөх (ижил үнэ бол өөрчлөлтгүй буцаана).">
          <Code>{`Req:  { "unitPrice": "45000" }   // ≥ 0, 2 хүртэл орны бутархай
Res:  200 { "item": { "id", "kind", "description", "quantity", "unitPrice", "total", "status", "startedAt", "completedAt",
                     "cancelledAt", "cancelledById", "serviceId", "diagnosticTemplateId", "diagnosticReportId" } }
403 { "code": "ITEM_PRICE_FORBIDDEN" }   404 { "code": "ORDER_NOT_FOUND" | "ITEM_NOT_FOUND" | "ORDER_OUT_OF_SCOPE" }
422 { "error": "Хүсэлт буруу.", "fieldErrors": { "unitPrice": "Үнэ буруу." } }
422 { "code": "ORDER_LOCKED" | "ITEM_CANCELLED" | "ITEM_COMPLETED_LOCKED" | "ITEM_TOTAL_TOO_LARGE" | "PAID_PAYMENT_EXISTS" | "PAID_PAYMENT_LOCKED" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/orders/[id]/items/[itemId]/status" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.itemStatus", SUB, "branch-scoped"]} title="Ажил/оношилгооны мөрийн явц солих — зөвхөн IN_PROGRESS захиалгад.">
          <Code>{`Req:  { "status": "PENDING" | "IN_PROGRESS" | "COMPLETED" }
Res:  200 { "item": { ...price-ийн item бүтэц } }
422 { "error": "Мөрийн явц буруу." }
403 { "code": "ITEM_STATUS_FORBIDDEN" }   404 { "code": "ORDER_NOT_FOUND" | "ITEM_NOT_FOUND" | "ORDER_OUT_OF_SCOPE" }
422 { "code": "ORDER_STATUS_INVALID" }        // захиалга IN_PROGRESS биш
422 { "code": "ITEM_CANCELLED" | "PART_STATUS_UNSUPPORTED" | "DIAGNOSTIC_REPORT_REQUIRED" | "DIAGNOSTIC_REPORT_LINKED" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/orders/[id]/items/complete-all" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.itemStatus", SUB, "branch-scoped"]} title="«Бүх ажлыг дуусгах» — дуусаагүй ажил/оношилгооны мөрүүдийг COMPLETED болгоно. Бөглөгдөөгүй оношилгоо алгасагдана; захиалгын төлөв өөрчлөгдөхгүй.">
          <Code>{`Res:  200 { "completed": 3, "skippedDiagnostics": 1 }
403 { "code": "ITEM_STATUS_FORBIDDEN" }   404 { "code": "ORDER_NOT_FOUND" | "ORDER_OUT_OF_SCOPE" }
422 { "code": "ORDER_STATUS_INVALID" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/orders/[id]/items/history" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.itemHistory", SUB, "branch-scoped"]} title="Цуцлагдсан мөрүүдийн түүх (сүүлд цуцлагдсан нь түрүүлж).">
          <Code>{`Query: ?page=1&pageSize=20   // pageSize ≤ 100; хуучин ?limit= ч хүлээн авна
Res:  200 { "items": [{ ...item бүтэц, "cancelledBy": { "id", "firstName", "lastName" } | null }],
            "total": 4, "page": 1, "pageSize": 20, "totalPages": 1 }
400 { "error": "Хуудасны параметр буруу." }
403 { "code": "ITEM_HISTORY_FORBIDDEN" }   404 { "code": "ORDER_NOT_FOUND" | "ORDER_OUT_OF_SCOPE" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/orders/[id]/payments/[paymentId]/reverse" auth="bearer" bearerLabel={BEARER} tags={["Эрх: payments.delete", SUB, "branch-scoped"]} title="Нэг төлбөрийг буцаах (CANCELLED болгоно, кассын орлого хүчингүй болно). Салбарын касс нээлттэй байх ёстой.">
          <Code>{`Res:  200 { "ok": true, "paymentId": "...",
            "order": { "paidAmount": "0", "paymentStatus": "UNPAID", "totalAmount": "125000", "remainingAmount": "125000" } }
403 { "code": "ORDER_EDIT_FORBIDDEN" | "POSTPAID_SETTLEMENT_FORBIDDEN" }
404 { "code": "PAYMENT_NOT_FOUND" | "ORDER_NOT_FOUND" | "ORDER_OUT_OF_SCOPE" }
409 { "code": "CASH_SESSION_CLOSED" | "CASH_SESSION_ENTRY_LOCKED" | "ORDER_INTERNAL_NO_PAYMENT" | "QPAY_INVOICE_PAID" | "QPAY_INVOICE_PARTIALLY_PAID" }
422 { "error": "Нэгдсэн тооцооны төлбөрийг тооцоогоор нь цуцална уу.", "code": "SETTLEMENT_PAYMENT_LOCKED" }
502 { "code": "QPAY_CANCEL_FAILED" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/orders/assignable-users" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.assign", "branch-scoped"]} title="Хариуцах мастераар оноож болох ажилтнууд (идэвхтэй, orders.assignable эрхтэй, тухайн салбарын).">
          <Code>{`Query: ?branchId=   // заавал биш; X-Working-Branch-тай зөрвөл 422
Res:  200 { "users": [{ "id": "...", "firstName": "...", "lastName": "..." }] }
422 { "error": "Query branchId нь баталгаажсан ажлын салбартай зөрчилдөж байна.", "fieldErrors": { "branchId": "..." } }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/orders/catalog-items" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.edit (эсвэл orders.editOwn)"]} title="«Мөр нэмэх» сонгогчид нэгдсэн сангийн ажил/сэлбэг — тенант өөртөө хараахан холбоогүйг нь. Сонгосныг POST /orders/[id]/items-д catalogItemId-аар илгээнэ.">
          <Code>{`Query: ?type=LABOR|GOODS&q=&page=&pageSize=   // q: нэр (агуулсан), код (эхлэл), баркод; pageSize default 50, max 200
Res:  200 { "items": [{ "id": "...", "type": "LABOR" | "GOODS", "name": "...", "code": "..." | null, "unitName": "..." | null,
                        "price": "45000", "description": "..." | null, "category": { "id", "name" } | null }],
            "pagination": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/orders/postpaid" auth="bearer" bearerLabel={BEARER} tags={["branch-scoped"]} title="Дараа тооцоот машинууд (нэгтгэл) + тэдгээрийн захиалгын түүх. Захиалга харах эрхийн хүрээнд (viewOwn) шүүгдэнэ.">
          <Code>{`Query: ?vehicleId=&paymentStatus=UNPAID|PARTIAL|PAID&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&page=&pageSize=   // pageSize default 50, max 100 (?limit= ч болно)
Res:  200 {
  "vehicles": [{ "id", "plate", "make", "model", "customer": { "id", "fullName", "phone" } | null,
                 "orderCount": 3, "totalAmount": "300000", "paidAmount": "100000", "balanceAmount": "200000" }],
  "summary": { "orderCount": 3, "totalAmount": "...", "paidAmount": "...", "balanceAmount": "..." },
  "orders": [{ "id", "number", "status", "paymentStatus", "scheduledAt", "completedAt", "createdAt", "totalAmount", "paidAmount",
               "paidInFullBeforeCompletion", "plateSnapshot", "vinSnapshot", "hasLockedPayment", "customer", "vehicle", "branch" }],
  "pagination": {...} }
400 { "error": "paymentStatus утга буруу байна.", "field": "paymentStatus" }   // мөн dateFrom/dateTo/page/pageSize`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/orders/bulk/assign" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.assign", SUB, "branch-scoped"]} title="Олон захиалгын хариуцагчийг нэг дор солих. Мөр бүр бие даан шалгагдана — нэгийн алдаа бусдыг зогсоохгүй.">
          <Code>{`Req:  { "orderIds": ["...", "..."], "assignedToId": "..." }   // 1–100 давхардаагүй id; assignedToId заавал (null → захиалга бүр ASSIGNEE_REQUIRED-аар унана)
Res:  200 { "succeeded": ["..."], "failed": [{ "orderId": "...", "code": "ORDER_LOCKED", "message": "..." }] }
400 { "error": "...", "code": "INVALID_BULK_REQUEST", "field": "orderIds" | "assignedToId" | "body" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/orders/bulk/status" auth="bearer" bearerLabel={BEARER} tags={["Эрх: orders.edit (эсвэл orders.editOwn)", SUB, "branch-scoped"]} title="Олон захиалгын статусыг нэг дор солих (PATCH /orders/[id]-ийн статусын дүрмээр, мөр тус бүр).">
          <Code>{`Req:  { "orderIds": ["..."], "status": "IN_PROGRESS", "durationMinutes"?: 90 | null }
Res:  200 { "succeeded": ["..."], "failed": [{ "orderId": "...", "code": "...", "message": "..." }] }   // code жишээ: PAYMENT_INCOMPLETE, INTERNAL_ERROR
400 { "error": "...", "code": "INVALID_BULK_REQUEST", "field": "orderIds" | "status" | "durationMinutes" | "body" }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Цаг захиалга — ажилтны үйлдлүүд --- */}
      <Section title="23. Цаг захиалга — ажилтны үйлдлүүд">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Амьдралын мөчлөгийн үйлдлүүд (confirm / reject / no-show / arrived / reschedule) нь appointments.edit эрх шалгасны
          дараа дотооддоо багц идэвхтэй эсэх, салбарын хүрээг шалгана: эрхгүй/өөр салбар бол 403{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">{`{ "error": "Зөвхөн өөрийн салбарын цаг захиалгыг удирдана." }`}</code>{" "}
          (code-гүй), багц дууссан бол 403 <code className="font-plex-mono text-[var(--oc-muted2)]">SUBSCRIPTION_EXPIRED</code>.
        </p>

        <Endpoint method="GET" path="/api/v1/appointments/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: appointments.view", "branch-scoped"]} title="Нэг цагийн дэлгэрэнгүй (жагсаалтын элементтэй ижил хэлбэр) — мэдэгдлээс шууд нээхэд.">
          <Code>{`Res:  200 { "appointment": { ...GET /appointments-ийн элемент, "arrivedAt": "ISO" | null,
            "paymentStatus": "NOT_REQUIRED" | "PENDING" | "UNDERPAID" | "FAILED" | "PAID" | "REFUNDED" } }
404 { "error": "Цаг захиалга олдсонгүй." }   // өөр салбар/тенант ч мөн 404`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/appointments/[id]/confirm" auth="bearer" bearerLabel={BEARER} tags={["Эрх: appointments.edit", SUB, "branch-scoped"]} title="PENDING онлайн цагийг баталгаажуулах — Account-ийг үйлчлүүлэгч болгон холбож, машины мэдээллийг хуулна.">
          <Code>{`Req:  { "assignedToId"?: "..." }   // body заавал биш; мастергүй цагт мастер заавал (orders.assign эрхгүй бол өөрөө оноогдоно)
Res:  200 { "ok": true, "appointmentId": "...", "status": "CONFIRMED" }
400 { "error": "JSON body буруу байна." } | { "error": "assignedToId нь string эсвэл null байна." }
404 { "code": "APPOINTMENT_NOT_FOUND" }   403 { "code": "APPOINTMENT_OUT_OF_SCOPE" }
409 { "code": "APPOINTMENT_NOT_PENDING" }   // зэрэг хүсэлтээр өөрчлөгдсөн
422 { "code": "APPOINTMENT_NOT_PENDING" | "APPOINTMENT_OVERDUE" | "APPOINTMENT_FEE_UNPAID" | "APPOINTMENT_NO_ACCOUNT" | "ASSIGNEE_REQUIRED" | "ASSIGNEE_INELIGIBLE" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/appointments/[id]/reject" auth="bearer" bearerLabel={BEARER} tags={["Эрх: appointments.edit", SUB, "branch-scoped"]} title="PENDING цагаас татгалзах (REJECTED).">
          <Code>{`Res:  200 { "ok": true, "appointmentId": "...", "status": "REJECTED" }
404 { "code": "APPOINTMENT_NOT_FOUND" }   403 { "code": "APPOINTMENT_OUT_OF_SCOPE" }
422 | 409 { "error": "Энэ цаг аль хэдийн хариу авсан байна.", "code": "APPOINTMENT_NOT_PENDING" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/appointments/[id]/no-show" auth="bearer" bearerLabel={BEARER} tags={["Эрх: appointments.edit", SUB, "branch-scoped"]} title="CONFIRMED цагийг «Ирээгүй» (NO_SHOW) гэж тэмдэглэх.">
          <Code>{`Res:  200 { "ok": true, "appointmentId": "...", "status": "NO_SHOW" }
404 { "code": "APPOINTMENT_NOT_FOUND" }   403 { "code": "APPOINTMENT_OUT_OF_SCOPE" }
422 | 409 { "error": "Энэ цагийг тэмдэглэх боломжгүй.", "code": "APPOINTMENT_NOT_CONFIRMED" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/appointments/[id]/arrived" auth="bearer" bearerLabel={BEARER} tags={["Эрх: appointments.edit", SUB, "branch-scoped"]} title="CONFIRMED цагийн үйлчлүүлэгч ирсэн гэж тэмдэглэх (arrivedAt; статус өөрчлөгдөхгүй).">
          <Code>{`Res:  200 { "ok": true, "appointmentId": "...", "arrived": true }
404 { "code": "APPOINTMENT_NOT_FOUND" }   403 { "code": "APPOINTMENT_OUT_OF_SCOPE" }
422 { "code": "APPOINTMENT_NOT_CONFIRMED" }
422 | 409 { "error": "Аль хэдийн ирсэн гэж тэмдэглэсэн байна.", "code": "APPOINTMENT_ALREADY_ARRIVED" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/appointments/[id]/reschedule" auth="bearer" bearerLabel={BEARER} tags={["Эрх: appointments.edit", SUB, "branch-scoped"]} title="CONFIRMED цагийг өөр цаг руу шилжүүлэх. Холбогдсон (SCHEDULED) засварын хуудас байвал хамт шилжинэ.">
          <Code>{`Req:  { "requestedAt": "2026-09-03T11:00", "confirmed"?: false }   // offset-гүй, Улаанбаатарын цаг
Res:  200 { "ok": true, "appointmentId": "...", "orderId": "..." | null, "linked": true | false, "requestedAt": "ISO" }
400 { "error": "requestedAt огноо шаардлагатай." } | { "error": "confirmed нь boolean байна." }
403 { "code": "ORDER_EDIT_FORBIDDEN" }   404 { "code": "APPOINTMENT_NOT_FOUND" | "BRANCH_NOT_FOUND" }
409 { "code": "CONFIRMATION_REQUIRED", "fieldErrors": { "confirmNeeded": "true" } }   // холбогдсон захиалга: ажиллах цагаас гадуур → confirmed: true
422 { "code": "PAST_TIME" | "APPOINTMENT_NOT_CONFIRMED" | "LINKED_ORDER_NOT_SCHEDULED" | "APPOINTMENT_LINK_MISSING" | "SPANS_DAY_BOUNDARY" | "OUTSIDE_BUSINESS_HOURS" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/appointments/[id]/payment" auth="bearer" bearerLabel={BEARER} tags={["Эрх: payments.view", "branch-scoped"]} title="Захиалгын хураамжийн QPay төлбөрийг QPay-ээс дахин шалгах (төлөгдсөн бол төлбөрийн бүртгэл үүснэ). Клиентээс дүн хүлээн авахгүй.">
          <Code>{`Res:  200 { "ok": true, "paid": true }
   | 200 { "ok": true | false, "paid": false, "message"?: "...", "underpaidAmount"?: 5000 }
404 { "error": "Цаг захиалга олдсонгүй." }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/appointments/[id]/payment/refund" auth="bearer" bearerLabel={BEARER} tags={["Хаалттай — зөвхөн платформын админ"]} title="Захиалгын хураамж нь платформын орлого (платформын QPay merchant) тул байгууллагын ажилтан буцаах боломжгүй. Буцаалтыг платформын админ вэбээс (/system/booking-revenue) хийнэ. Хуучин апп тодорхой хариу авахын тулд endpoint хэвээр байгаа ч үргэлж 403 буцаана.">
          <Code>{`Res:  403 { "error": "Захиалгын хураамжийг зөвхөн платформын админ буцаана.", "code": "PLATFORM_REFUND_ONLY" }   // ямар ч эрхтэй ажилтан, эзэнд ч
401   // token буруу`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/appointments/[id]/payment/retry" auth="bearer" bearerLabel={BEARER} tags={["Эрх: payments.edit", SUB, "branch-scoped"]} title="Захиалгын хураамжийн QPay нэхэмжлэхийг дахин үүсгэх/татах.">
          <Code>{`Res:  200 { "ok": true, "required": true | false }   // false = хураамж идэвхгүй (үнэгүй)
404 { "error": "Цаг захиалга олдсонгүй." }
409 { "error": "Энэ цаг цуцлагдсан тул хураамж төлөх боломжгүй.", "code": "APPOINTMENT_NOT_PAYABLE" }
502 { "code": "QPAY_ERROR" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/appointments/calendar" auth="bearer" bearerLabel={BEARER} tags={["Эрх: appointments.view", "branch-scoped"]} title="Нэг салбарын нэг өдрийн календарын загвар (lane, статус, хуваарийн асуудал, багтаамж хэтрэлт, тайлбар) — апп өөрөө тооцоолохгүй.">
          <Code>{`Query: ?date=YYYY-MM-DD&branchId=   // date заавал; branchId — X-Working-Branch байхгүй үед заавал
Res:  200 { "branchId", "branchName", "dateKey", "rangeStart": "ISO", "rangeEnd": "ISO", "slotCapacity": 2, "laneCount": 2,
  "hasCapacityOverflow": false,
  "blocks": [{ "key", "appointmentId", "laneIndex": 0, "startAt": "ISO", "endAt": "ISO", "finishKnown": true, "endsAtDayBoundary": false,
               "status": "CONFIRMED" | null, "statusLabel", "name", "assignedToId", "assigneeName", "paymentStatus", "paymentStatusLabel",
               "issue": { "reason", "label" } | null, "capacityOverflow": false, "accessibleLabel" }],
  "legend": [{ "kind": "status", "status", "label" } | { "kind": "issue", "reason", "label" }] }
422 { "fieldErrors": { "branchId" | "date": "..." } }   // branchId дутуу/зөрсөн, date буруу
404 { "error": "Салбар олдсонгүй." }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/appointments/slots" auth="bearer" bearerLabel={BEARER} tags={["Эрх: appointments.view", "branch-scoped"]} title="Салбарын тухайн өдрийн сул цагууд (ажилтанд — онлайн захиалгын багцын шалгалтгүй).">
          <Code>{`Query: ?date=YYYY-MM-DD&branchId=&categoryIds=a,b   // categoryIds заавал биш — үргэлжлэх хугацааг тооцоолно
Res:  200 { "open": true, "reason"?: "...", "slots": [{ "time": "10:00", "iso": "ISO", "available": true, "remaining": 1 }],
            "scheduleSource": "exception" | "season" | "weekday" | "default", "scheduleLabel": "..." | null, "durationMinutes": 60 }
422 { "fieldErrors": { "branchId" | "date" | "categoryIds": "..." } }
404 { "error": "Салбар олдсонгүй." }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/appointments/bulk/category" auth="bearer" bearerLabel={BEARER} tags={["Эрх: appointments.edit", SUB, "branch-scoped"]} title="Олон цагийн үйлчилгээний ангиллыг нэг дор солих. Мөр бүр бие даан шалгагдана.">
          <Code>{`Req:  { "appointmentIds": ["..."], "categoryId": "..." }   // 1–100 давхардаагүй id
Res:  200 { "succeeded": ["..."], "failed": [{ "appointmentId": "...", "code": "...", "message": "..." }] }
400 { "error": "...", "code": "INVALID_BULK_REQUEST", "field": "appointmentIds" | "categoryId" | "body" }`}</Code>
        </Endpoint>
      </Section>

      {/* --- Үйлчлүүлэгч, машин — нэмэлт --- */}
      <Section title="24. Үйлчлүүлэгч, машин — нэмэлт">
        <Endpoint method="GET" path="/api/v1/customers/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: customers.view"]} title="Үйлчлүүлэгчийн дэлгэрэнгүй + идэвхтэй машинууд (машин бүрийн захиалгын тоо).">
          <Code>{`Res:  200 { "customer": { "id", "fullName", "phone", "email", "note", "isOrganization", "orgRegnum", "orgName", "orgEmail", "createdAt" },
            "vehicles": [{ "id": "<TenantVehicle id>", "isPostpaid": false, "orderCount": 2,
                           "vehicle": { "id", "plate", "vin", "make", "model", "year", "mileage" } }] }
404 { "error": "Үйлчлүүлэгч олдсонгүй." }   // өөр тенантын id ч мөн 404`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/customers/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: customers.edit", SUB]} title="Үйлчлүүлэгч засах — бүтэн бичлэг солих (илгээгээгүй талбар хоосорно; phone заавал).">
          <Code>{`Req:  { "fullName": "...", "phone": "99112233", "email": "..." | null, "note": "..." | null,
        "isOrganization": false, "orgRegnum": "...", "orgName": "...", "orgEmail": "..." }   // org* дүрэм POST /customers-тэй ижил
Res:  200 { "customer": { "id": "...", ...хадгалсан талбарууд } }
404 { "error": "Үйлчлүүлэгч олдсонгүй.", "code": "CUSTOMER_NOT_FOUND" }
409 { "error": "...", "fieldErrors": { "phone": "..." } }   // утас давхцсан
422 { "error": "Хүсэлт буруу.", "fieldErrors": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/customers/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: customers.delete", SUB]} title="Үйлчлүүлэгч устгах — засварын хуудасгүй бол л.">
          <Code>{`Res:  200 { "ok": true, "id": "...", "fullName": "..." | null }
404 { "code": "CUSTOMER_NOT_FOUND" }
409 { "error": "Энэ үйлчлүүлэгчтэй холбоотой засварын хуудас байгаа тул устгах боломжгүй.", "code": "CUSTOMER_IN_USE" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/customers/[id]/history" auth="bearer" bearerLabel={BEARER} tags={["Эрх: customers.view"]} title="Үйлчлүүлэгчийн засварын хуудасны түүх (шинэ нь түрүүлж).">
          <Code>{`Query: ?page=&pageSize=   // default 50, max 200
Res:  200 { "orders": [{ "id", "number", "status", "paymentStatus", "scheduledAt", "completedAt", "createdAt", "totalAmount": "..." | null,
                         "branch": { "name" }, "itemCount": 3, "vehicle": { "id", "plate", "make", "model" } }],
            "meta": { "page", "pageSize", "total", "totalPages", "hasPrev", "hasNext" } }   // pagination биш "meta"
404 { "error": "Үйлчлүүлэгч олдсонгүй." }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/customers/notify" auth="bearer" bearerLabel={BEARER} tags={["Эрх: customers.notify", SUB]} title="Зар илгээхийн өмнөх хүлээн авагчийн тоо (зөвхөн Account-тай холбоотой үйлчлүүлэгчид).">
          <Code>{`Res:  200 { "recipientCount": 128 }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/customers/notify" auth="bearer" bearerLabel={BEARER} tags={["Эрх: customers.notify", SUB, "Модуль: enable_customer_broadcast"]} title="Account-тай бүх үйлчлүүлэгчид push зар илгээх.">
          <Code>{`Req:  { "title": "...", "body": "..." }   // хоёулаа заавал
Res:  200 { "notified": 128 }
422 { "error": "Хүсэлт буруу.", "fieldErrors": { "title": "Гарчиг оруулна уу.", "body": "Агуулга оруулна уу." } }
403 { "error": "...", "code": "MODULE_DISABLED" }   // багцад модуль нээгдээгүй`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/vehicles/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: vehicles.view"]} title="Машины дэлгэрэнгүй (энэ тенантад холбогдсон бол).">
          <Code>{`Res:  200 { "vehicle": { "id", "plate", "vin", "make", "model", "year", "mileage", "fuelType", "wheelPosition", "colorName",
                         "capacity", "purpose", "ownerRegnum", "ownerIsOrganization": false, "customerId", "isPostpaid": false,
                         "customer": { "id", "fullName", "phone", "isOrganization", "orgName" } | null } }
404 { "error": "Машин олдсонгүй." }`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/vehicles/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: vehicles.edit"]} title="Машин засах — бүтэн бичлэг солих. Улсын дугаар өөрчлөгдөхгүй (зөвхөн дугааргүй машинд нэг удаа оноож болно).">
          <Code>{`Req:  { "plate", "make", "model", "vin", "year", "mileage", "fuelType", "wheelPosition", "colorName", "capacity", "purpose",
        "ownerRegnum", "customerId": "..." | null, "isPostpaid"?: true }   // илгээгээгүй талбар null болно; isPostpaid өгөөгүй бол хэвээр
Res:  200 { "vehicle": { "id", "plate", "vin", "make", "model", "year", "mileage", "fuelType", "wheelPosition", "colorName",
                         "capacity", "purpose", "ownerRegnum", "customerId", "isPostpaid" } }
404 { "error": "Машин олдсонгүй." }
422 { "error": "Хүсэлт буруу.", "code": "VALIDATION_FAILED", "fieldErrors": {...} }
422 { "code": "VEHICLE_OWNER_CHANGE_BLOCKED", "fieldErrors": { "customerId": "..." } }   // засварын түүхтэй машины эзэн солихгүй`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/vehicles/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: vehicles.delete"]} title="Машиныг энэ тенантаас хасах (global бүртгэл, бусад тенантын түүх хадгалагдана).">
          <Code>{`Res:  200 { "vehicle": { "id", "plate", "make", "model" } }
404 { "error": "Машин олдсонгүй." }
409 { "error": "Энэ машинтай холбоотой засварын хуудас байгаа тул устгах боломжгүй.", "code": "VEHICLE_IN_USE" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/vehicles/[id]/history" auth="bearer" bearerLabel={BEARER} tags={["Эрх: vehicles.view"]} title="Машины засварын хуудас, цаг захиалгын түүх (энэ тенантын).">
          <Code>{`Res:  200 { "orders": [{ "id", "number", "status", "paymentStatus", "scheduledAt", "completedAt", "createdAt", "totalAmount", "branch": { "name" }, "itemCount" }],
            "appointments": [{ "id", "status", "requestedAt", "note", "branch": { "name" }, "category": { "name" } | null }],
            "diagnosticReportCount": 1,
            "ownerLocked": true }   // захиалга эсвэл оношилгоо байвал эзэн солих боломжгүй
404 { "error": "Машин олдсонгүй." }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/vehicles/[id]/refresh-hur" auth="bearer" bearerLabel={BEARER} tags={["Эрх: vehicles.edit"]} title="Машины мэдээллийг (марк, загвар, он, VIN, шатахуун, хүрд, өнгө, багтаамж, зориулалт) HUR-аас дахин татах. Дугаар өөрчлөгдөхгүй.">
          <Code>{`Res:  200 { "vehicle": { "plate", "make", "model", "year", "vin", "fuelType", "wheelPosition", "colorName", "capacity", "purpose" } }
404 { "error": "Машин олдсонгүй." }
502 { "error": "HUR-аас мэдээлэл татаж чадсангүй." }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/vehicles/from-plate" auth="bearer" bearerLabel={BEARER} tags={["Эрх: vehicles.create", SUB]} title="Засварын хуудасны машины хайлтаас «+ дугаар — машин бүртгэх»: мэдээллийг дугаараар татаж (эсвэл гараар өгсөн марк/загвараар) бүртгэнэ.">
          <Code>{`Req:  { "plate": "1234УБА", "customerId"?: "...", "make"?: "Toyota", "model"?: "Prius" }
      // customerId өгвөл түүний машин болно; үгүй бол эзэмшигчгүй бүртгэгдэж POST /orders үед холбогдоно.
Res:  201 { "vehicle": { "id", "plate", "vin", "make", "model", "customerId": "..." | null, "isPostpaid": false } }
   | 200 { "needsDetails": true, "reason": "Машины мэдээлэл олдсонгүй — марк, загвараа оруулна уу." }   // make+model-тэй дахин илгээнэ
422 { "error": "Хүсэлт буруу.", "fieldErrors": { "plate": "Улсын дугаар шаардлагатай." } }
422 { "error": "...", "fieldErrors"?: {...} }   // машин бүртгэх валидаци (customerId олдсонгүй г.м.)`}</Code>
        </Endpoint>
      </Section>

      {/* --- Каталог, оношилгоо — нэмэлт --- */}
      <Section title="25. Каталог, оношилгоо — нэмэлт">
        <Endpoint method="PATCH" path="/api/v1/services/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: services.edit", SUB]} title="Ажил/сэлбэг/оношилгоо засах — бүтэн бичлэг солих. type, stock хадгалагдахгүй (үлдэгдэл зөвхөн /stock-оор). Нэгдсэн сантай холбогдсон бол name/code/barcode сангийнх хэвээр.">
          <Code>{`Req:  { "type": "GOODS", "name": "...", "price": 45000, "code"?, "barcode"?: "..." | null, "unitId"?, "costPrice"?, "stock"?,
        "durationValue"?, "durationUnitId"?, "reminderIntervalMonths"?, "description"?, "isActive": true, "categoryId"? }
      // isActive илгээгээгүй бол false болно; barcode илгээгээгүй бол хөндөхгүй
Res:  200 { "service": { "id", "type", "name", "code", "barcode", "price", "costPrice", "durationValue", "reminderIntervalMonths",
                         "description", "isActive", "unitId", "durationUnitId", "categoryId" } }
404 { "error": "Олдсонгүй.", "code": "SERVICE_NOT_FOUND" }
409 { "error": "Энэ код өөр үйлчилгээнд ашиглагдсан байна.", "code": "SERVICE_CODE_CONFLICT", "fieldErrors": { "code": "..." } }
422 { "error": "Хүсэлт буруу.", "code": "VALIDATION_FAILED", "fieldErrors": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/services/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: services.delete", SUB]} title="Устгах — захиалгад ашиглагдсан бол устгахгүй, идэвхгүй (архив) болгоно.">
          <Code>{`Res:  200 { "service": { "id", "name", "type", "outcome": "deleted" | "archived" } }
404 { "code": "SERVICE_NOT_FOUND" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/services/[id]/stock" auth="bearer" bearerLabel={BEARER} tags={["Эрх: services.edit", SUB]} title="Сэлбэгийн (GOODS) үлдэгдлийг гараар нэмэх/хасах. Сөрөг үлдэгдэл үүсгэхгүй.">
          <Code>{`Req:  { "direction": "in" | "out", "amount": "5" }   // amount > 0
Res:  200 { "service": { "id": "...", "stock": "17" } }
404 { "error": "Бараа олдсонгүй.", "code": "SERVICE_NOT_FOUND" }   // GOODS биш бол мөн
422 { "code": "VALIDATION_FAILED", "fieldErrors": { "amount": "Үлдэгдэл сөрөг болж байна. Одоо: 3" | "Эерэг тоо оруулна уу.", "direction": "..." } }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/services/bulk/category" auth="bearer" bearerLabel={BEARER} tags={["Эрх: services.edit", SUB]} title="Олон ажил/сэлбэгийн ангиллыг нэг дор солих. Ангиллын төрөлтэй таарахгүй мөр алгасагдаж errors-д орно.">
          <Code>{`Req:  { "serviceIds": ["..."], "categoryId": "..." }
Res:  200 { "succeeded": 4, "failed": 1, "errors": ["SKU-1 · Тос: Олдсонгүй."] }   // энд тоо + текст (orders/bulk-аас ялгаатай)
400 { "error": "serviceIds массив байх ёстой." }
400 { "code": "CATEGORY_REQUIRED" | "EMPTY_SELECTION" }   404 { "code": "CATEGORY_NOT_FOUND" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/diagnostics/templates" auth="bearer" bearerLabel={BEARER} tags={["Эрх: diagnostics.create", SUB, "Модуль: оношилгоо"]} title="Шинэ оношилгооны загвар үүсгэх.">
          <Code>{`Req:  { "name": "...", "type": "...", "categoryId": "...", "schema": { "sections": [...] },   // name/type/categoryId/schema заавал
        "description"?, "isActive"?: true, "price"?: 30000, "durationMin"?: 45 }   // isActive илгээгээгүй бол false
Res:  200 { "template": { "id", "name", "description", "type", "version", "isActive", "price", "durationMin", "categoryId", "schema", "updatedAt" } }
422 { "error": "Хүсэлт буруу.", "code": "VALIDATION_FAILED", "fieldErrors": { "name" | "type" | "categoryId" | "schema" | "price" | "durationMin": "..." } }
403 { "error": "Таны багц дээр оношилгооны модуль нээгдээгүй байна.", "code": "FEATURE_DISABLED" }`}</Code>
        </Endpoint>

        <Endpoint method="PATCH" path="/api/v1/diagnostics/templates/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: diagnostics.edit", SUB]} title="Загвар засах — бүтэн бичлэг солих. Бөглөгдсөн тайлантай загварын schema өөрчлөгдвөл version өснө.">
          <Code>{`Req:  { ...POST-тэй ижил талбарууд }
Res:  200 { "template": { ...POST-ийн template, "versionBumped": true | false } }
404 { "code": "TEMPLATE_NOT_FOUND" }
403 { "error": "Системийн үндсэн загварыг засах боломжгүй.", "code": "SYSTEM_DEFAULT_IMMUTABLE" }
422 { "code": "VALIDATION_FAILED", "fieldErrors": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="DELETE" path="/api/v1/diagnostics/templates/[id]" auth="bearer" bearerLabel={BEARER} tags={["Эрх: diagnostics.delete", SUB]} title="Загвар устгах — тайлантай бол идэвхгүй (архив) болгоно.">
          <Code>{`Res:  200 { "template": { "id", "name", "outcome": "deleted" | "archived" } }
404 { "code": "TEMPLATE_NOT_FOUND" }
403 { "code": "SYSTEM_DEFAULT_IMMUTABLE" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/diagnostics/templates/[id]/duplicate" auth="bearer" bearerLabel={BEARER} tags={["Эрх: diagnostics.create", SUB, "Модуль: оношилгоо"]} title="Загварыг (системийн загварыг ч) хуулбарлан шинэ загвар үүсгэх.">
          <Code>{`Res:  200 { "template": { ...POST /diagnostics/templates-ийн template } }
404 { "code": "TEMPLATE_NOT_FOUND" }
403 { "code": "FEATURE_DISABLED" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/diagnostics/reports/[id]/pdf" auth="bearer" bearerLabel={BEARER} tags={["Эрх: diagnostics.view", "branch-scoped"]} title="Оношилгооны тайланг серверт рендерлэсэн PDF-ээр татах (JSON тайлантай ижил хандалтын дүрэм).">
          <Code>{`Res:  200 application/pdf
      Content-Disposition: attachment; filename="diagnostic-<id>-<YYYY-MM-DD>.pdf"
404 { "error": "Тайлан олдсонгүй." }   // байхгүй, өөр салбар, эсвэл холбогдсон захиалгыг харах эрхгүй`}</Code>
        </Endpoint>
      </Section>

      {/* --- Тайлан, хяналт, санал хүсэлт --- */}
      <Section title="26. Тайлан, хяналт, санал хүсэлт">
        <p className="text-sm text-[var(--oc-muted)] -mt-2">
          Энэ хэсгийн GET endpoint-ууд зөвшөөрөгдөөгүй query параметрийг 422{" "}
          <code className="font-plex-mono text-[var(--oc-muted2)]">{`{ "code": "VALIDATION", "fieldErrors": { "<param>": "..." } }`}</code>{" "}
          алдаагаар буцаана.
        </p>

        <Endpoint method="GET" path="/api/v1/overview" auth="bearer" bearerLabel={BEARER} tags={["Нэвтэрсэн бүх ажилтан", "branch-scoped"]} title="Нүүр самбарын нэгтгэл (тоонууд, трэнд, орлого, багц, авлага, сүүлд шинэчлэгдсэн захиалгууд).">
          <Code>{`Query: ?range=week|month|3month|custom&from=YYYY-MM-DD&to=YYYY-MM-DD   // бүгд заавал биш (орлогын хугацаа)
Res:  200 { "overview": {
  "incomeRange": { "key", "from": "ISO", "to": "ISO", "label" },
  "counts": { "branches", "employees", "customers", "vehicles", "openOrders", "completedThisMonth", "todayOrders" },
  "trends": { "orders", "completed", "customers", "vehicles", "branches", "employees" },
  "income": { "total", "changePct": 12.5 | null, "points": [...] },
  "internalCost": "0",                                         // дотоод засварын зардал (орлогод орохгүй)
  "subscription": { "plan", "status", "expiresAt", "daysLeft" } | null,
  "planLimits": { "daily_orders": null, "max_vehicles": null, "max_users": null, "max_branches": null },   // үргэлж null (нийцлийн талбар)
  "postpaid": { "vehicleCount": 2, "receivable": "350000" },   // receivable = дууссан бүх (дотоод бус) захиалгын үлдэгдэл
  "recentlyUpdatedOrders": [{ "id", "number", "status", "updatedAt", "customerName", "vehiclePlate", "hasLockedPayment",
                              "items": [{ "status", "kind" }] }] } }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/reports" auth="bearer" bearerLabel={BEARER} tags={["Нэвтэрсэн бүх ажилтан", "branch-scoped"]} title="Тайлангийн өгөгдөл (орлого, статус, төрөл, салбар, мастер, үйлчлүүлэгч, сэлбэг). Өгөөгүй бол «энэ сар».">
          <Code>{`Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD   // хоёулаа эсвэл аль нь ч биш; from ≤ to, ≤ 366 хоног
Res:  200 { "range": { "from", "to", "label", "key" },
  "data": { "totalRevenue", "internalCost", "completedCount", "avgTicket", "activeCount", "avgJobDurationMinutes",
            "statusRows": [{ "status", "label", "count", "pct" }], "kindRows": [{ "kind", "label", "total", "pct" }],
            "branchRows" | "techRows": [{ "id", "name", "revenue", "internalCost", "count" }],
            "jobDurationRows": [{ "id", "name", "count", "avgMinutes" }],
            "customerRows": [{ "id", "name", "phone", "revenue", "count" }],
            "partRows": [{ "id", "name", "sku", "unit", "qty", "revenue" }],
            "income": { "points": [...], "changePct": 8.1 | null } } }
422 { "code": "VALIDATION", "fieldErrors": { "from" | "to": "..." } }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/reports/export" auth="bearer" bearerLabel={BEARER} tags={["Нэвтэрсэн бүх ажилтан", "branch-scoped"]} title="Тайланг вебийнхтэй ижил .xlsx файлаар татах.">
          <Code>{`Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD   // GET /reports-тэй ижил дүрэм
Res:  200 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
      Content-Disposition: attachment; filename="tailan_<from>_<to>.xlsx"
422 { "code": "VALIDATION", "fieldErrors": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/audit" auth="bearer" bearerLabel={BEARER} tags={["Эрх: audit.view"]} title="Үйлдлийн түүх (audit log) — before/after-ийн мэдрэг утгууд нуугдана. Хуудас бүр 50 мөр.">
          <Code>{`Query: ?q=&action=&entity=&userId=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=
Res:  200 { "items": [{ "id", "entity", "entityId", "action", "summary", "before", "after", "createdAt": "ISO", "branchId",
                        "user": { "id", "firstName", "lastName", "email" } | null }],
            "pagination": {...},
            "meta": { "actions": ["CREATE", ...], "entities": ["ServiceOrder", ...], "users": [{ "id", "firstName", "lastName" }] } }   // шүүлтүүрийн сонголтууд
422 { "code": "VALIDATION", "fieldErrors": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/feedback" auth="bearer" bearerLabel={BEARER} tags={["Нэвтэрсэн бүх ажилтан"]} title="Байгууллагын илгээсэн санал хүсэлтийн жагсаалт (шинэ нь түрүүлж).">
          <Code>{`Query: ?page=&pageSize=   // default 50 (?limit= ч болно)
Res:  200 { "feedback": [{ "id", "type": "BUG" | "SUGGESTION" | "OTHER", "message", "screenshotUrl", "pageUrl", "status",
                           "adminNote", "resolvedAt": "ISO" | null, "createdAt": "ISO" }], "pagination": {...} }
422 { "code": "VALIDATION", "fieldErrors": {...} }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/feedback" auth="bearer" bearerLabel={BEARER} tags={["Нэвтэрсэн бүх ажилтан", "multipart/form-data"]} title="Санал хүсэлт / алдааны мэдээлэл илгээх.">
          <Code>{`Req (form-data): type = BUG | SUGGESTION | OTHER, message (5–2000 тэмдэгт), screenshot? (PNG/JPG/WEBP, ≤ 2MB)
Res:  201 { "feedback": { ...GET-ийн элемент } }
400 { "error": "Multipart form-data илгээнэ үү." }
422 { "error": "...", "code": "VALIDATION" }`}</Code>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/feedback/[id]" auth="bearer" bearerLabel={BEARER} tags={["Нэвтэрсэн бүх ажилтан"]} title="Санал хүсэлтийн дэлгэрэнгүй + харилцааны урсгал.">
          <Code>{`Res:  200 { "feedback": { ...GET /feedback-ийн элемент },
            "messages": [{ "id", "author": "SUBMITTER" | "ADMIN", "message", "createdAt": "ISO" }] }
404 { "error": "Олдсонгүй.", "code": "NOT_FOUND" }`}</Code>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/feedback/[id]/replies" auth="bearer" bearerLabel={BEARER} tags={["Нэвтэрсэн бүх ажилтан"]} title="Санал хүсэлтэд хариу бичих (зохиогч үргэлж SUBMITTER). Шийдэгдсэн/хаагдсан тасалбарт бичвэл дахин IN_REVIEW болно.">
          <Code>{`Req:  { "message": "..." }   // 2–2000 тэмдэгт
Res:  201 { "message": { "id", "author": "SUBMITTER", "message", "createdAt" }, "reopened": true | false }
400 { "error": "JSON body шаардлагатай.", "code": "VALIDATION" }
404 { "code": "NOT_FOUND" }
422 { "error": "...", "code": "VALIDATION" }`}</Code>
        </Endpoint>
      </Section>
    </>
  );
}
