-- Багц бүрийн үнэгүй туршилт (super admin тохируулна).

-- Туршилтаар олгосон subscription-ийг тэмдэглэнэ (дараа нь EXPIRED болсон ч "туршсан" гэдэг мэдэгдэнэ).
ALTER TABLE "Subscription" ADD COLUMN "isTrial" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Subscription" SET "isTrial" = true WHERE "status" = 'TRIAL';

-- Шинэ бүртгэлд автомат туршилт.
ALTER TABLE "PlatformSetting"
  ADD COLUMN "signupTrialEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "signupTrialPlan" "Plan" NOT NULL DEFAULT 'BUSINESS';

-- Багц бүрийн туршилтын тохиргоо.
CREATE TABLE "PlanTrialSetting" (
    "plan" "Plan" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "days" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanTrialSetting_pkey" PRIMARY KEY ("plan")
);

INSERT INTO "PlanTrialSetting" ("plan", "enabled", "days", "updatedAt") VALUES
  ('BUSINESS', true, 30, NOW()),
  ('ENTERPRISE', true, 30, NOW());
