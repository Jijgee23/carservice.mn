-- QA #28: Appointment-д хариуцах мастер (nullable, additive).
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "assignedToId" TEXT;

CREATE INDEX IF NOT EXISTS "Appointment_assignedToId_idx" ON "Appointment"("assignedToId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_assignedToId_fkey'
  ) THEN
    ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_assignedToId_fkey"
      FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
