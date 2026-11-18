/**
 * Орчны хувьсагчийн төвлөрсөн баталгаажуулалт — импортлогдох мөчид (module
 * load, `instrumentation.ts`-ийн `register()`-ээр сервер асах үед) `env`-ийг
 * parse хийж, дутуу/буруу тохиргоог АНХНЫ АШИГЛАЛТ дээр биш **boot дээр**
 * throw хийж илрүүлнэ.
 *
 * Зөвхөн апп бүхэлдээ ажиллахад ЗААВАЛ шаардлагатай цөм хувьсагчийг л энд
 * validate хийнэ (`DATABASE_URL`, `SESSION_SECRET`). Тухайн feature-д л
 * хэрэгтэй, сонголттой интеграцийн key-үүд (HUR, CallPro, Firebase, Google
 * Maps, QPay г.м.) энд оруулаагүй — тэдгээр нь дуудагдах цэгтээ (эсвэл
 * дуудагдахаас өмнө) өөрсдийн шаардлагатай шалгалтыг хийсэн хэвээр байна,
 * учир нь эдгээрийн заримыг тохируулаагүй орчинд ч апп бусад хэсгээрээ
 * асаж ажиллах ёстой (жиш нь HUR тохируулаагүй бол зөвхөн машин лавлах
 * feature унана, апп бүхэлдээ биш).
 */

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL заавал шаардлагатай."),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET 32+ тэмдэгт байх ёстой."),

  // Сонголттой ч заасан бол хэлбэрийг нь шалгах хувьсагчид.
  DATABASE_POOL_MAX: z.coerce.number().int().positive().optional(),
  ENCRYPTION_KEY: z
    .string()
    .min(32, "ENCRYPTION_KEY заасан бол 32+ тэмдэгт байх ёстой.")
    .optional(),
  API_TOKEN_SECRET: z
    .string()
    .min(32, "API_TOKEN_SECRET заасан бол 32+ тэмдэгт байх ёстой.")
    .optional(),
  // Эцсийн хэрэглэгчийн хугацаагүй (legacy) mobile token-ийг энэ огнооноос хойш хүлээн авахаа болино
  // (lib/auth/account-api-token.ts). Заахгүй бол үргэлж хүлээн авна. Жишээ: 2027-03-01T00:00:00Z
  ACCOUNT_LEGACY_TOKENS_UNTIL: z
    .string()
    .refine((v) => v === "" || Number.isFinite(Date.parse(v)), "ACCOUNT_LEGACY_TOKENS_UNTIL нь ISO огноо байх ёстой (жишээ нь 2027-03-01T00:00:00Z).")
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(
      `Орчны хувьсагчийн тохиргоо буруу байна:\n${lines.join("\n")}`,
    );
  }
  return parsed.data;
}

export const env = loadEnv();
