-- Account (үйлчлүүлэгч): заавал биш нууц үг. OTP-оор нэвтрэх хэвээр; нууц үг тохируулахад ACCOUNT_PASSWORD OTP.
-- AlterEnum
ALTER TYPE "OtpType" ADD VALUE 'ACCOUNT_PASSWORD';

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "passwordUpdatedAt" TIMESTAMP(3);

