-- Account (хэрэглэгчийн) мобайл API token-ийн хувилбар. Нууц үг тохируулах/
-- солих/устгах, хаасан аккаунтыг сэргээхэд нэмэгдэж, өмнөх token-ууд хүчингүй
-- болно (lib/auth/account-api-token.ts). `tv`-гүй хуучин token = 0.
ALTER TABLE "Account" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
