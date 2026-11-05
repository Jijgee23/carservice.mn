# Ubuntu server дээр deploy хийх

Vercel биш, өөрийн Ubuntu (22.04/24.04) server дээр байршуулах заавар.
Бүтэц: **Node (next start, PM2-оор)** ← **Nginx (reverse proxy + HTTPS)** ← интернет.
Cron-ийг **crontab**-аар (vercel.json энд ажиллахгүй).

> Энэ заавар нь **прод серверийн бодит тохиргоотой таарсан**: апп `ubuntu`
> хэрэглэгчийн дор `/home/ubuntu/carcare.mn`-д, PM2-оор `carcare` нэртэй,
> порт **3020**-д ажиллаж байна.

---

## 1. Серверийн бэлтгэл

```bash
sudo apt update && sudo apt -y upgrade
# Node 20 LTS (прод дээр v22, nvm-ээр)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx
# PostgreSQL (ижил серверт ажиллуулах бол; managed DB бол алгасна)
sudo apt install -y postgresql
# PM2 (процесс менежер)
sudo npm install -g pm2
```

PostgreSQL DB + хэрэглэгч:
```bash
sudo -u postgres psql -c "CREATE USER carcare WITH PASSWORD 'ХҮЧТЭЙ_НУУЦ';"
sudo -u postgres psql -c "CREATE DATABASE \"carcare.mn\" OWNER carcare;"
```

---

## 2. Код + env

```bash
mkdir -p /home/ubuntu/carcare.mn
git clone <repo-url> /home/ubuntu/carcare.mn
cd /home/ubuntu/carcare.mn
```

`.env` (repo root, gitignore-д орсон). Заавал тохируулах:
```ini
NODE_ENV=production
DATABASE_URL="postgresql://carcare:ХҮЧТЭЙ_НУУЦ@localhost:5432/carcare.mn?schema=public"
SESSION_SECRET="32+ тэмдэгт санамсаргүй"
CRON_SECRET="санамсаргүй секрет"
# Апп-ийн бодит нийтийн base URL — QPay callback (getAppBaseUrl(), lib/subscription-server.ts)
# үүнийг ашиглана. Тохируулаагүй бол кодын hardcoded fallback руу унана — үргэлж тохируул.
NEXT_PUBLIC_APP_URL="https://www.carservice.mn"
ENCRYPTION_KEY="..."            # QPay нууцлал
CALL_PRO_API_KEY="..."          # SMS
CALL_PRO_SPECIAL_KEY="..."
HUR_URL="https://hur.api.macs.mn/"
HUR_USERNAME="..." 
HUR_PASSWORD="..."
HUR_CODE="..."
UPLOAD_DIR=/var/www/carcare-uploads
# Firebase admin (push) — JSON файлыг серверт тавиад замыг заана (git-д орохгүй):
FIREBASE_SERVICE_ACCOUNT_FILE="/home/ubuntu/carcare.mn/secrets/firebase-adminsdk.json"
# Firebase web (push авах) — NEXT_PUBLIC_* нь BUILD үед шигтгэгддэг тул build-ээс өмнө байх ёстой:
NEXT_PUBLIC_FIREBASE_API_KEY="..."
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="carcare-bf796.firebaseapp.com"
NEXT_PUBLIC_FIREBASE_PROJECT_ID="carcare-bf796"
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="..."
NEXT_PUBLIC_FIREBASE_APP_ID="..."
NEXT_PUBLIC_FIREBASE_VAPID_KEY="..."
```

> ⚠️ `NEXT_PUBLIC_*` нь `npm run build` үед код руу шигтгэгддэг. Утгаа өөрчилбөл
> **дахин build** хийнэ.
>
> ⚠️ **`PORT`-г `.env`-д бичсэнээр хангалтгүй.** Next.js-ийн CLI (`next start`)
> HTTP server-ээ асаахдаа `.env` файлыг **уншихаас өмнө** порт сонголтоо
> тодорхойлдог тул `.env`-ийн `PORT=...` утга үл хэрэгсэгдэнэ (зөвхөн
> жинхэнэ process/shell env variable, эсвэл `-p` флаг л ажиллана). Тиймээс
> порт тохиргоог доор `ecosystem.config.js`-ийн `env`-ээр өгнө, `.env`-д
> `PORT` бичихгүй.

Firebase admin JSON-г серверт хуулна (git-д биш):
```bash
mkdir -p /home/ubuntu/carcare.mn/secrets
# scp-ээр локалоосоо хуулна:
# scp carcare-bf796-firebase-adminsdk-...json ubuntu@server:/home/ubuntu/carcare.mn/secrets/firebase-adminsdk.json
chmod 600 /home/ubuntu/carcare.mn/secrets/firebase-adminsdk.json
```

---

## 3. Build + migration

```bash
cd /home/ubuntu/carcare.mn
npm ci
npx prisma migrate deploy      # бүх migration-ийг прод DB-д хэрэглэнэ
npm run build                  # next build (NEXT_PUBLIC_* шигтгэгдэнэ)
```

Upload (лого, diagnostics зураг) хадгалах хавтас — **persistent, project-ийн гадна**:
```bash
sudo mkdir -p /var/www/carcare-uploads
sudo chown ubuntu:ubuntu /var/www/carcare-uploads
```
`.env`-д (дээр section 2-т нэмсэн) `UPLOAD_DIR=/var/www/carcare-uploads` байх ёстой.
> `lib/storage.ts` бичих үедээ `UPLOAD_DIR`-г хэрэглэнэ (тохируулаагүй бол dev-ийн
> адил `public/uploads`). **`public/uploads`-г `/var/www/carcare-uploads`-руу
> symlink хийж болохгүй** — Turbopack build нь project root-оос гадагш чиглэсэн
> symlink-г зөвшөөрдөггүй бөгөөд `next build` panic-аар унана
> (`Symlink ... is invalid, it points out of the filesystem root`).
> Nginx `location /uploads/`-аар статик файлуудыг шууд `alias /var/www/carcare-uploads/`-аас
> түгээнэ (доор харна уу).

---

## 4. PM2 (процесс барих, дахин асаах)

`/home/ubuntu/carcare.mn/ecosystem.config.js`:
```js
module.exports = {
  apps: [
    {
      name: "carcare",
      script: "npm",
      args: "run start",
      cwd: "/home/ubuntu/carcare.mn",
      env: {
        NODE_ENV: "production",
        PORT: 3020,
      },
    },
  ],
};
```
```bash
cd /home/ubuntu/carcare.mn
pm2 start ecosystem.config.js
pm2 save                            # одоогийн процесс жагсаалтыг хадгална
pm2 startup systemd -u ubuntu --hp /home/ubuntu   # энэ команд өгөх sudo мөрийг ажиллуулна — reboot-той хамт асахын тулд
pm2 status                          # ажиллаж буйг шалга
pm2 logs carcare                    # лог харах
```
(`ecosystem.config.js`-ийн `env.PORT` нь `.env`-ийн бусад утгаас ялгаатай —
`DATABASE_URL`, `SESSION_SECRET` гэх мэт бусад бүх утга `.env`-ээс runtime-д
уншигдана, зөвхөн `PORT` л энд заавал байх ёстой.)

---

## 5. Nginx reverse proxy + HTTPS

`/etc/nginx/sites-available/carcare`:
```nginx
server {
    server_name carservice.mn www.carservice.mn;
    client_max_body_size 5m;             # 4mb upload-д зориулж

    location /uploads/ {
        alias /var/www/carcare-uploads/;   # UPLOAD_DIR-тэй адил зам
    }

    location / {
        proxy_pass http://127.0.0.1:3020;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/carcare /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# HTTPS (web push, secure cookie-д ЗААВАЛ):
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d carservice.mn -d www.carservice.mn
```

> `X-Forwarded-For/Proto` чухал — IP лог, secure cookie зөв ажиллана.

---

## 6. Cron (systemcron — vercel.json энд ажиллахгүй)

`crontab -e` (`ubuntu` хэрэглэгчээр, sudo хэрэггүй):
```cron
# Захиалгын сануулга — 30 минут тутам (тенант бүр өөрийн lead хугацаатай,
# 24 цагаас их байж болдог тул цаг тутмаас нягт шалгах шаардлагатай)
*/30 * * * * curl -fsS -H "Authorization: Bearer ШИНИЙ_CRON_SECRET" https://carservice.mn/api/cron/appointment-reminders > /dev/null 2>&1
# Хугацаа хэтэрсэн (хариу өгөөгүй) цаг захиалгыг цуцлах — цаг тутам
15 * * * * curl -fsS -H "Authorization: Bearer ШИНИЙ_CRON_SECRET" https://carservice.mn/api/cron/expire-appointments > /dev/null 2>&1
# Subscription хугацаа дуусгах — өдөр бүр 00:05
5 0 * * * curl -fsS -H "Authorization: Bearer ШИНИЙ_CRON_SECRET" https://carservice.mn/api/cron/expire-subscriptions > /dev/null 2>&1
# Багц дуусах сануулга (эзэд рүү push/мэдэгдэл) — өдөр бүр 09:00
0 9 * * * curl -fsS -H "Authorization: Bearer ШИНИЙ_CRON_SECRET" https://carservice.mn/api/cron/subscription-reminders > /dev/null 2>&1
# Хуучин (уншсан) мэдэгдэл цэвэрлэх — өдөр бүр 03:00
0 3 * * * curl -fsS -H "Authorization: Bearer ШИНИЙ_CRON_SECRET" https://carservice.mn/api/cron/notifications-prune > /dev/null 2>&1
# Credit score — өдөр бүр 04:00: оноо тооцож, босгоос доош бол автоматаар блоклоно
0 4 * * * curl -fsS -H "Authorization: Bearer ШИНИЙ_CRON_SECRET" https://carservice.mn/api/cron/credit-scores > /dev/null 2>&1
# Хугацаа дууссан ажилтныг идэвхгүй болгох (login өөрөө шалгадаг ч жагсаалтын
# статусыг тогтвортой байлгана) — өдөр бүр 00:10
10 0 * * * curl -fsS -H "Authorization: Bearer ШИНИЙ_CRON_SECRET" https://carservice.mn/api/cron/deactivate-expired-users > /dev/null 2>&1
```
`CRON_SECRET`-ийг `.env`-ийнхтэй ижил болго.

---

## 7. Шинэчлэх (re-deploy)

Нэг командаар (`scripts/deploy.sh`) — `git pull` хийгээд шинэ commit байвал
`package.json`/`package-lock.json` өөрчлөгдсөн эсэхээс хамааруулж `npm ci`
(эсвэл зөвхөн `schema.prisma` өөрчлөгдсөн бол `prisma generate`) ажиллуулж,
дараа нь `prisma migrate deploy` (шинэ migration байхгүй үед no-op, аюулгүй),
`npm run build`, `pm2 restart carcare` дараалалтайгаар хийнэ.
`.env`-д гараар нэмсэн/өөрчилсөн утга бол зөвхөн `pm2 restart`-аар л шинэчлэгдэнэ
(process шинээр асахдаа `.env`-ийг дахин уншина) — script-д тусад нь алхам
хэрэггүй:
```bash
cd /home/ubuntu/carcare.mn
bash scripts/deploy.sh
```

> `git init` / `git add .` хэрэггүй — эдгээр нь зөвхөн section 2-т нэг удаа
> хийсэн `git clone`-той холбоотой анхны алхам. Re-deploy бүрт зүгээр
> **local**-аасаа `git push` хийчихээд, серверт дээрх нэг команд ажиллуулна.

Гараар алхам алхмаар хийх бол (script амжилтгүй болвол дебаг хийхэд):
```bash
cd /home/ubuntu/carcare.mn
git pull
npm ci
npx prisma migrate deploy
npm run build
pm2 restart carcare
```

---

## Шалгах жагсаалт
- [ ] `.env` бүх шаардлагатай утгатай (дээрх), `PORT` **биш** (`ecosystem.config.js`-д)
- [ ] `prisma migrate deploy` амжилттай
- [ ] `pm2 status` → `carcare` online, `pm2 save` хийгдсэн, `pm2 startup` тохирсон
- [ ] HTTPS (certbot) тохирсон — web push, secure cookie ажиллана
- [ ] crontab 5 мөр нэмсэн, CRON_SECRET таарсан
- [ ] `UPLOAD_DIR=/var/www/carcare-uploads` зам үүсгэгдсэн, `ubuntu` хэрэглэгч бичиж чадна, persistent (`public/uploads`-руу symlink БИШ)
- [ ] Firebase JSON серверт (git-д биш), `FIREBASE_SERVICE_ACCOUNT_FILE` зөв зам
- [ ] PostgreSQL backup (pg_dump cron) тохируулсан

## Ubuntu дээр өөрчлөгдөх зүйл (Vercel-тэй харьцуулахад)
- ✅ **Лого upload ажиллана** (persistent диск) — Vercel дээр ажиллахгүй байсан.
- ⚙️ Cron нь **vercel.json биш crontab**-аар.
- ⚙️ Process/SSL/proxy-г өөрөө барина (PM2 + Nginx + certbot).
- ⚠️ `lib/sms.ts`-д hardcoded API key fallback — env-ээр дарж бичих/устгахыг зөвлөж байна.
- ℹ️ Нэг серверийн in-memory rate-limit зүгээр ажиллана (Vercel-ийн олон instance асуудал энд байхгүй).
