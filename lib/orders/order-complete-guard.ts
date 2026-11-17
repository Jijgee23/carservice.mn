import { Prisma } from "@/app/generated/prisma/client";
import { POSTPAID_CLOSE_FORBIDDEN_MESSAGE, formatTugrik } from "@/lib/orders";

/**
 * «Дуусгах»-ын урьдчилсан нөхцөл (UI-д товчийг идэвхгүй болгох шалтгаан) —
 * applyOrderPatchCommand-ийн шалгалттай ижил. Засварын хуудасны дэлгэрэнгүй
 * болон жагсаалтын «Төлөв өөрчлөх» хоёулаа үүнийг ашиглана; сервер өөрөө
 * дахин шалгадаг тул энэ нь зөвхөн UX.
 */
export function orderCompleteBlockedReason(input: {
  unfilledDiagnostics: number;
  unfinishedItems: number;
  isInternal: boolean;
  isPostpaid: boolean;
  remaining: Prisma.Decimal;
  canCloseUnpaidPostpaid: boolean;
  /** Tenant-ийн засварын хуудасны тохиргоо (байхгүй бол анхдагч = хатуу дүрэм). */
  settings?: { requireDiagnosticsFilled: boolean; requireItemsCompleted: boolean; allowCloseUnpaid: boolean };
}): string | null {
  const settings = input.settings ?? { requireDiagnosticsFilled: true, requireItemsCompleted: true, allowCloseUnpaid: false };
  if (settings.requireDiagnosticsFilled && input.unfilledDiagnostics > 0) return "Бөглөгдөөгүй оношилгоо байна.";
  if (settings.requireItemsCompleted && input.unfinishedItems > 0) return `Дуусаагүй ${input.unfinishedItems} ажил байна.`;
  if (input.isInternal) return null;
  if (input.remaining.gt(0) && !input.isPostpaid && !settings.allowCloseUnpaid) {
    return `Төлбөр бүрэн төлөгдөөгүй (үлдэгдэл ${formatTugrik(input.remaining.toString())}).`;
  }
  if (input.remaining.gt(0) && !input.canCloseUnpaidPostpaid) return POSTPAID_CLOSE_FORBIDDEN_MESSAGE;
  return null;
}
