import type { Prisma } from "@/app/generated/prisma/client";
import { formatOrderNumber, normalizeOrderSettings, orderNumberYear } from "@/lib/orders/order-settings";

/**
 * Allocate the next human-facing order number while holding the tenant row
 * lock for the whole transaction. Computing it outside the create
 * transaction lets concurrent requests all choose the same number and then
 * exhaust their retry loops on the unique (tenantId, number) constraint.
 *
 * Format is per tenant (TenantOrderSettings): {prefix}{YYYY-}{seq padStart},
 * defaults = the historical `00001`. The running sequence lives in
 * `numberNextSeq` (+ `numberSeqYear` when the year is part of the number, so
 * it restarts at 1 every year). When it is still null (tenant never numbered
 * under settings) it is derived once from existing numbers: older data may
 * use values such as `D1-1001`, so read the numeric suffix instead of relying
 * on lexical ordering.
 */
export async function nextOrderNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  now: Date = new Date(),
): Promise<string> {
  const tenant = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE
  `;
  if (!tenant.length) throw new Error("Тенант олдсонгүй.");

  const row = await tx.tenantOrderSettings.findUnique({ where: { tenantId } });
  const settings = normalizeOrderSettings(row as Parameters<typeof normalizeOrderSettings>[0]);
  const year = orderNumberYear(now);

  let seq: number;
  if (settings.numberIncludeYear) {
    seq = row?.numberNextSeq != null && row.numberSeqYear === year ? row.numberNextSeq : 1;
  } else if (row?.numberNextSeq != null) {
    seq = row.numberNextSeq;
  } else {
    seq = (await maxNumericSuffix(tx, tenantId)) + 1;
  }
  if (!Number.isSafeInteger(seq) || seq < 1) seq = 1;

  let candidate = formatOrderNumber(settings, seq, year);
  // Гараар/хуучин форматаар аль хэдийн байгаа дугаарыг алгасна.
  while (await tx.serviceOrder.findFirst({ where: { tenantId, number: candidate }, select: { id: true } })) {
    seq += 1;
    candidate = formatOrderNumber(settings, seq, year);
  }

  await tx.tenantOrderSettings.upsert({
    where: { tenantId },
    update: { numberNextSeq: seq + 1, numberSeqYear: year },
    create: { tenantId, numberNextSeq: seq + 1, numberSeqYear: year },
  });
  return candidate;
}

async function maxNumericSuffix(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
  const existing = await tx.serviceOrder.findMany({
    where: { tenantId },
    select: { number: true },
  });
  return existing.reduce((max, { number }) => {
    const match = /([0-9]+)$/.exec(number.trim());
    if (!match) return max;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isSafeInteger(parsed) ? Math.max(max, parsed) : max;
  }, 0);
}
