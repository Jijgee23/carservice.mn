import type { Prisma } from "@/app/generated/prisma/client";
import { parseChecklistSnapshot, type ChecklistAnswer } from "@/lib/orders/order-settings";

// Хүлээн авах бүртгэлийн (intake) уншихад зориулсан нийтлэг select + JSON хөрвүүлэгч.
// Staff болон customer API хоёулаа ижил `intake` объект буцаана.

export const INTAKE_VIEW_SELECT = {
  intakeNotes: true,
  intakeRecordedAt: true,
  intakeSignaturePath: true,
  intakeMileageKm: true,
  intakeChecklist: true,
  intakePhotos: {
    orderBy: { createdAt: "asc" as const },
    select: { id: true, path: true },
  },
  intakeRecordedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ServiceOrderSelect;

export type IntakeViewRow = {
  intakeNotes: string | null;
  intakeRecordedAt: Date | null;
  intakeSignaturePath: string | null;
  intakeMileageKm: number | null;
  intakeChecklist: Prisma.JsonValue | null;
  intakePhotos: { id: string; path: string }[];
  intakeRecordedBy: { firstName: string | null; lastName: string | null } | null;
};

export type IntakeView = {
  notes: string | null;
  photos: { id: string; url: string }[];
  signatureUrl: string | null;
  mileageKm: number | null;
  /** Шалгах жагсаалт [{label, status: OK|ISSUE|NA, note}] — хоосон бол []. */
  checklist: ChecklistAnswer[];
  recordedAt: string;
  recordedBy: string | null;
};

/** Raw intake багануудыг салгаж, үлдсэнийг буцаана (API хариунд ил гаргахгүйн тулд). */
export function omitIntakeColumns<T extends IntakeViewRow>(row: T): Omit<T, keyof IntakeViewRow> {
  const rest: Record<string, unknown> = { ...row };
  for (const key of Object.keys(INTAKE_VIEW_SELECT)) delete rest[key];
  return rest as Omit<T, keyof IntakeViewRow>;
}

/** `intakeRecordedAt` null бол `null`; үгүй бол `intake` JSON. Зургийн дараалал хадгалагдана. */
export function toIntakeView(
  row: IntakeViewRow,
  opts: { includeRecordedBy: boolean },
): IntakeView | null {
  if (!row.intakeRecordedAt) return null;
  const name = row.intakeRecordedBy
    ? `${row.intakeRecordedBy.lastName ?? ""} ${row.intakeRecordedBy.firstName ?? ""}`.trim()
    : "";
  return {
    notes: row.intakeNotes,
    photos: row.intakePhotos.map((p) => ({ id: p.id, url: p.path })),
    signatureUrl: row.intakeSignaturePath,
    mileageKm: row.intakeMileageKm,
    checklist: parseChecklistSnapshot(row.intakeChecklist),
    recordedAt: row.intakeRecordedAt.toISOString(),
    recordedBy: opts.includeRecordedBy ? name || null : null,
  };
}
