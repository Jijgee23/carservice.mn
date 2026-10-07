-- Remove the «Дансанд орсон» reconciliation tick (feature dropped). Bank columns stay.
ALTER TABLE "OrderPayment" DROP CONSTRAINT IF EXISTS "OrderPayment_reconciledById_fkey";
ALTER TABLE "OrderPayment" DROP COLUMN IF EXISTS "reconciledAt";
ALTER TABLE "OrderPayment" DROP COLUMN IF EXISTS "reconciledById";
ALTER TABLE "CashTransaction" DROP CONSTRAINT IF EXISTS "CashTransaction_reconciledById_fkey";
ALTER TABLE "CashTransaction" DROP COLUMN IF EXISTS "reconciledAt";
ALTER TABLE "CashTransaction" DROP COLUMN IF EXISTS "reconciledById";
