# carservice.mn

Авто засвар, үйлчилгээний байгууллагуудад зориулсан **олон тенантын (multi-tenant) SaaS платформ**. Захиалга, машины түүх, нөөц, ажилтан, тайлан, онлайн цаг захиалга — бүгд нэг системд. Хэрэглэгчид утсаараа байгууллагаа сонгож онлайн цаг захиална.

---

## Агуулга
- [Үндсэн боломжууд](#үндсэн-боломжууд)
- [Технологи](#технологи)
- [Архитектур](#архитектур)
- [Эхлүүлэх (хөгжүүлэлт)](#эхлүүлэх-хөгжүүлэлт)
- [Орчны хувьсагч (env)](#орчны-хувьсагч-env)
- [npm script-ууд](#npm-script-ууд)
- [Интеграцууд](#интеграцууд)
- [Төслийн бүтэц](#төслийн-бүтэц)
- [Байршуулалт (deploy)](#байршуулалт-deploy)
- [Баримтжуулалт](#баримтжуулалт)

---

## Үндсэн боломжууд

### Тенант (байгууллага) талд — `/dashboard`
- **Олон салбар** — ажиллах цаг, хуваарь, газрын зураг дээрх байршил.
- **Үүрэг ба эрх (RBAC)** — байгууллага өөрийн Role үүсгэж, нөөц бүрд CRUD эрх (view/create/edit/delete) онооно. Эзэн (owner) бүх эрхтэй.
- **Захиалга (ServiceOrder)** — төлөв (товлогдсон → хийгдэж буй → дууссан), ажил/сэлбэг/хураамжийн мөр, хариуцагч мастер, төлбөр.
- **Үйлчлүүлэгч ба машин** — улсын дугаараар **HUR**-аас машины мэдээллийг автоматаар татах.
- **Оношилгоо** — загвар (template), тайлан (report), OBD кодын дэмжлэг.
- **Үйлчилгээ/Бараа** — ажил, оношилгоо, сэлбэг, нэгж, ажлын ангилал, нөөц.
- **Цаг захиалга (inbox)** — онлайн болон утсаар орж ирсэн цагийг баталгаажуулах, календарь харагдац, захиалга руу хөрвүүлэх.
- **Тайлан, аудит лог** — орлого, ачаалал, үйлдлийн түүх.
- **Нэвтэрсэн төхөөрөмж** — өөрийн идэвхтэй session-ийг харах, алсаас гаргах (revoke).

### Эцсийн хэрэглэгч талд — `/discover`, `/org/[slug]`, `/account`
- **Утас + OTP** нэвтрэлт (нууц үггүй, global аккаунт).
- **Байгууллага хайх** — жагсаалт + Leaflet газрын зураг.
- **Slot-based цаг захиалга** — салбар → календараас өдөр → боломжит/завгүй цагнаас сонгох (амардаг өдөр идэвхгүй).
- **Миний машинууд** (HUR-аас татах), **үйлчилгээний түүх**, push мэдэгдэл.

### Системийн админ талд — `/system` (SuperAdmin)
- Бүх байгууллага, багц/үнэ (PlanPrice/PlanFeature/PlanLimit), QPay тохиргоо.
- **Нэвтрэлт/төхөөрөмжийн түүх** — ажилтан (байгууллага/нэр/дугаараар шүүх) + хэрэглэгч.
- Платформын тохиргоо (footer сошиал холбоос).

### Маркетинг — `/page/landing`
- Hero, боломжууд, үнэ (**backend PlanPrice/PlanFeature-аас**), асуулт хариулт.
- Нөхцөл (`/terms`), Нууцлал (`/privacy`), Холбоо барих (`/contact`).

---

## Технологи
| Давхарга | Технологи |
|---|---|
| Framework | **Next.js 16** (App Router, Server Actions, RSC) |
| UI | **React 19**, **Tailwind CSS 4** |
| ORM / DB | **Prisma 7** + PostgreSQL (`@prisma/adapter-pg`, pg) |
| Auth | JWT (**jose**) cookie session, bcrypt (**bcryptjs**), утас OTP |
| Газрын зураг | **Leaflet** (OpenStreetMap) |
| Push | **firebase-admin** (сервер), **firebase** web SDK (FCM) |
| Хэл | TypeScript |

---

## Архитектур

### 3 төрлийн principal (тус бүр өөрийн session/cookie)
1. **User** — тенантын ажилтан. Email/нууц үгээр нэвтэрнэ. RBAC эрхтэй. Web session нь DB-д хадгалагдаж (`UserSession`) revoke хийгдэнэ. Мобайлд `RefreshToken`.
2. **Account** — эцсийн хэрэглэгч (cross-tenant). Утас + OTP-ээр нэвтэрнэ. Цаг захиалахад тенантын `Customer`-той **утсаар автомат холбогдоно** (гүүр).
3. **SuperAdmin** — платформын эзэн (`/system`).

### Олон тенант (multi-tenant)
Бараг бүх өгөгдөл `tenantId`-аар тусгаарлагдсан. Ажилтан зөвхөн өөрийн байгууллагын дата хардаг; салбараар нэмж хязгаарлаж болно.

### Гол моделиуд (Prisma)
`Tenant`, `User`, `Role`, `Branch`, `BranchSchedule`, `Customer`, `Vehicle`, `ServiceOrder`, `ServiceItem`, `Service`, `DiagnosticTemplate`, `DiagnosticReport`, `Subscription`, `PlanPrice`, `PlanFeature`, `PlanLimit`, `Account`, `Appointment`, `AccountVehicle`, `Otp`, `RefreshToken`, `UserSession`, `Device`, `PlatformSetting`, `AuditLog`, `SuperAdmin` гэх мэт.

---

## Эхлүүлэх (хөгжүүлэлт)

Шаардлага: **Node.js 20+**, **PostgreSQL**.

```bash
# 1. Хамаарал суулгах
npm ci

# 2. Орчны хувьсагч
cp .env.example .env
#   → .env дотор DATABASE_URL, SESSION_SECRET зэргийг бөглөнө

# 3. Өгөгдлийн сан бэлдэх (migration хэрэглэх)
npx prisma migrate dev      # эсвэл prod-д: npx prisma migrate deploy

# 4. Хөгжүүлэлтийн сервер (port 4000)
npm run dev
```

Нээх: http://localhost:4000

SuperAdmin үүсгэх:
```bash
npm run system:create-admin
```

> Хөгжүүлэлтэд SMS/OTP-г илгээхгүй байж болзошгүй — кодыг `/system/otp` (зөвхөн dev) хуудаснаас харна.

---

## Орчны хувьсагч (env)

`.env.example`-г үндэс болго. Гол хувьсагчид:

| Нэр | Зориулалт |
|---|---|
| `DATABASE_URL` | PostgreSQL холболт (заавал) |
| `SESSION_SECRET` | JWT session нууц (32+ тэмдэгт, заавал) |
| `API_TOKEN_SECRET` | Мобайл API token (заавал биш, default нь SESSION_SECRET) |
| `ENCRYPTION_KEY` | QPay зэрэг нууц мэдээлэл шифрлэх |
| `CRON_SECRET` | Cron endpoint-ийн Bearer secret |
| `SMS_PROVIDER` | SMS gateway: `sendsms` (default) эсвэл `callpro` |
| `SEND_SMS_API_KEY`, `SEND_SMS_API_TOKEN`, `SEND_SMS_API_URL`, `SEND_SMS_MAX_LENGHT` | SMS (sendsms.mn, үндсэн) |
| `CALL_PRO_API_KEY`, `CALL_PRO_SPECIAL_KEY`, `CALL_PRO_URL` | SMS (CallPro/messagepro, нөөц) |
| `HUR_URL`, `HUR_USERNAME`, `HUR_PASSWORD`, `HUR_CODE` | Машины бүртгэлийн API (HUR) |
| `QPAY_MERCHANT_URL`, `EBARIMT_BASE_URL` | Төлбөр, и-баримт |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` *(эсвэл `_FILE`)* | Firebase admin (push) |
| `NEXT_PUBLIC_FIREBASE_*` (6 ш) | Web push client config + VAPID key |

---

## npm script-ууд
| Script | Үйлдэл |
|---|---|
| `npm run dev` | Хөгжүүлэлтийн сервер (порт 4000) |
| `npm run build` | Production build |
| `npm run start` | Production сервер |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:deploy` | `prisma migrate deploy` (prod) |
| `npm run db:studio` | Prisma Studio |
| `npm run db:generate` | Prisma client дахин үүсгэх |
| `npm run lint` | ESLint |
| `npm run system:create-admin` | SuperAdmin үүсгэх |

---

## Интеграцууд
- **HUR** (МАК vehicle registry) — улсын дугаараар машины марк/загвар/он/VIN автоматаар татах. Ажилтан болон хэрэглэгчийн машин бүртгэлд хоёуланд.
- **sendsms.mn SMS** — OTP, цаг сануулга, мэдэгдэл (CallPro gateway нөөцөөр үлдсэн, `SMS_PROVIDER=callpro`).
- **Firebase Cloud Messaging** — web + мобайл push (цаг баталгаажих, сануулга). `Device` хүснэгтэд FCM token хадгална.
- **QPay** — багцын төлбөр (QR/invoice).
- **eBarimt** — төлбөрийн баримт.

### Cron (хуваарьт ажил)
- `POST /api/cron/expire-subscriptions` — хугацаа дууссан багцыг EXPIRED болгох.
- `POST /api/cron/appointment-reminders` — удахгүй болох цагуудад SMS + push сануулга.
- `POST /api/cron/expire-appointments` — хугацаа хэтэрсэн, хариу өгөөгүй (PENDING) цаг захиалгыг CANCELLED болгох.
- `POST /api/cron/subscription-reminders` — багц дуусах гэж буй тенант эздэд сануулга.
- `POST /api/cron/notifications-prune` — 90 хоногоос хуучин, уншсан мэдэгдлийг устгах.
- `POST /api/cron/credit-scores` — засварын газрын credit score тооцож, босгоос доош бол автоматаар блоклох/сэргээх.

Бүгд `Authorization: Bearer $CRON_SECRET`-ээр хамгаалагдсан.

### Мобайл REST API
`/api/v1/...` (token-based). Хэрэглэгчийн апп: `/api/v1/app/*` (OTP auth, orgs каталог, appointments, vehicles, devices, HUR lookup). Дэлгэрэнгүйг [`docs/mobile-device-push.md`](docs/mobile-device-push.md).

---

## Төслийн бүтэц
```
app/
  (app)/            # Эцсийн хэрэглэгчийн вэб (discover, org/[slug], account)
  dashboard/        # Тенантын ажилтны самбар
  system/(authed)/  # SuperAdmin панел
  page/             # Маркетинг (landing, login, signup, forgot)
  privacy|terms|contact/  # Нийтийн хуудас
  api/v1/           # REST API (мобайл/гадаад)
  api/cron/         # Cron endpoint-ууд
  _actions/         # Server actions
  _components/      # Дундын UI компонентууд
lib/                # Домэйн логик (auth, orders, appointments, push, sms, hur ...)
prisma/             # schema.prisma + migrations
docs/               # Нэмэлт баримт
```

---

## Байршуулалт (deploy)
Ubuntu server дээр (Nginx + systemd + HTTPS) байршуулах бүрэн заавар: [`docs/deploy-ubuntu.md`](docs/deploy-ubuntu.md).

Товчоор: `npm ci` → `.env` бөглөх → `npx prisma migrate deploy` → `npm run build` → systemd-ээр `npm run start` → Nginx reverse proxy + certbot (HTTPS) → crontab-аар cron-ууд.

> Web push, secure cookie зэрэг нь **HTTPS** шаардана.

---

## Баримтжуулалт
- [`docs/deploy-ubuntu.md`](docs/deploy-ubuntu.md) — Ubuntu байршуулалт.
- [`docs/mobile-device-push.md`](docs/mobile-device-push.md) — мобайл апп интеграц (auth, төхөөрөмж бүртгэх, push).
- `AGENTS.md` / `CLAUDE.md` — кодын зөвлөмж (энэ Next.js хувилбарын онцлог).

---

© infosystems.mn — carservice.mn
