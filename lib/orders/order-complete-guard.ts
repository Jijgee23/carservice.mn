import { Prisma } from "@/app/generated/prisma/client";
import { POSTPAID_CLOSE_FORBIDDEN_MESSAGE, formatTugrik } from "@/lib/orders";

/**
 * «Дуусгах»-ын урьдчилсан нөхцөл (UI-д товчийг идэвхгүй болгох шалтгаан) —
 * applyOrderPatchCommand-ийн шалгалттай ижил. Засварын хуудасны дэлгэрэнгүй
 * болон жагсаалтын «Төлөв өөрчлөх» хоёулаа үүнийг ашиглана; сервер өөрөө
 * дахин шалгадаг тул энэ нь зөвхөн UX.
 */
export type CompleteBlockerInput = {
  unfilledDiagnostics: number;
  unfinishedItems: number;
  isInternal: boolean;
  isPostpaid: boolean;
  remaining: Prisma.Decimal;
  canCloseUnpaidPostpaid: boolean;
  /** Tenant-ийн засварын хуудасны тохиргоо (байхгүй бол анхдагч = хатуу дүрэм). */
  settings?: { requireDiagnosticsFilled: boolean; requireItemsCompleted: boolean; allowCloseUnpaid: boolean };
};

/** Хаах нөхцөл юунд тээглэж байна (бүтэцтэй) — «дараагийн алхам» чиглүүлэгч ашиглана. */
export type CompleteBlocker = {
  kind: "diagnostics" | "items" | "payment" | "postpaid";
  message: string;
};

/** Эхний тээг (дараалал: оношилгоо → дуусаагүй ажил → төлбөр → дараа тооцоо) эсвэл null (хаахад бэлэн). */
export function orderCompleteBlocker(input: CompleteBlockerInput): CompleteBlocker | null {
  const settings = input.settings ?? { requireDiagnosticsFilled: true, requireItemsCompleted: true, allowCloseUnpaid: false };
  if (settings.requireDiagnosticsFilled && input.unfilledDiagnostics > 0) {
    return { kind: "diagnostics", message: "Бөглөгдөөгүй оношилгоо байна." };
  }
  if (settings.requireItemsCompleted && input.unfinishedItems > 0) {
    return { kind: "items", message: `Дуусаагүй ${input.unfinishedItems} ажил байна.` };
  }
  if (input.isInternal) return null;
  if (input.remaining.gt(0) && !input.isPostpaid && !settings.allowCloseUnpaid) {
    return {
      kind: "payment",
      message: `Төлбөр бүрэн төлөгдөөгүй (үлдэгдэл ${formatTugrik(input.remaining.toString())}). Төлбөр авсны дараа (касс) хаана.`,
    };
  }
  if (input.remaining.gt(0) && !input.canCloseUnpaidPostpaid) {
    return { kind: "postpaid", message: POSTPAID_CLOSE_FORBIDDEN_MESSAGE };
  }
  return null;
}

export function orderCompleteBlockedReason(input: CompleteBlockerInput): string | null {
  return orderCompleteBlocker(input)?.message ?? null;
}
