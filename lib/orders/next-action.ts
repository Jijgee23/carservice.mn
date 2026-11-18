// Засварын хуудасны «ДАРААГИЙН АЛХАМ» — хуудасны төлөв, ажил, оношилгоо, төлбөрөөс хамаарч хэрэглэгчид
// одоо яг юу хийхийг ганц өгүүлбэрээр хэлнэ. PURE (unit тест). Хаах нөхцөлийг ДАХИН зохиохгүй:
// `orderCompleteBlocker` (lib/orders/order-complete-guard.ts) — сервер/«Дуусгах» товчтой ижил эх сурвалж.

import type { CompleteBlocker } from "./order-complete-guard";

export type NextActionTone = "action" | "ready" | "waiting" | "done";

/** Хуудасны хэсгүүдийн anchor id (page.tsx дахь id=…). */
export type NextActionAnchor = "order-items" | "order-status" | "order-payments";

export type NextAction = {
  tone: NextActionTone;
  title: string;
  detail?: string;
  anchor?: NextActionAnchor;
};

export type NextActionInput = {
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  /** Энэ хэрэглэгч хуудсыг засаж чадах эсэх (хуваарилагдсан/эрх). */
  canEdit: boolean;
  /** Төлбөр бүртгэх эрх. */
  canTakePayment: boolean;
  /** Салбарын кассын ээлж нээлттэй эсэх (төлбөр бүртгэхэд шаардлагатай). */
  cashSessionOpen: boolean;
  isInternal: boolean;
  /** Төлөгдөөгүй үлдэгдэл > 0. */
  hasRemaining: boolean;
  /** Цуцлагдаагүй ажлын мөрийн тоо. */
  activeItems: number;
  unfilledDiagnostics: number;
  unfinishedItems: number;
  /** Хаах нөхцөлийн тээг (null = хаахад бэлэн). */
  blocker: CompleteBlocker | null;
};

function payment(i: NextActionInput, after: string): NextAction {
  if (!i.canTakePayment) {
    return { tone: "waiting", title: "Төлбөр төлөгдөхийг хүлээж байна", detail: "Төлбөр авах эрхтэй ажилтан бүртгэнэ." };
  }
  if (!i.cashSessionOpen) {
    return {
      tone: "action",
      title: "Кассын ээлж нээж төлбөр авах",
      detail: `Ээлж нээлттэй биш байна. ${after}`,
      anchor: "order-payments",
    };
  }
  return { tone: "action", title: "Төлбөр авах", detail: after, anchor: "order-payments" };
}

/** Хэрэглэгчид харуулах дараагийн алхам; харуулах зүйл байхгүй (цуцлагдсан) бол null. */
export function nextOrderAction(i: NextActionInput): NextAction | null {
  switch (i.status) {
    case "CANCELLED":
      return null;

    case "SCHEDULED":
      return i.canEdit
        ? { tone: "action", title: "Ажлыг эхлүүлэх", detail: "Төлвийг «Хийгдэж буй» болгоно уу.", anchor: "order-status" }
        : { tone: "waiting", title: "Ажил эхлэхийг хүлээж байна" };

    case "IN_PROGRESS": {
      if (!i.canEdit) return { tone: "waiting", title: "Хуудас хийгдэж байна" };
      if (i.activeItems === 0) {
        return { tone: "action", title: "Ажил, үйлчилгээ нэмэх", detail: "Хуудсанд дор хаяж нэг ажил байх ёстой.", anchor: "order-items" };
      }
      const b = i.blocker;
      if (!b) {
        return { tone: "ready", title: "Хуудсыг дуусгах", detail: "Бүх нөхцөл биелсэн — «Дуусгах» дарна уу.", anchor: "order-status" };
      }
      switch (b.kind) {
        case "diagnostics":
          return {
            tone: "action",
            title: `Оношилгоо бөглөх (${i.unfilledDiagnostics})`,
            detail: "Бөглөөгүй оношилгооны маягтыг бөглөнө үү.",
            anchor: "order-items",
          };
        case "items":
          return {
            tone: "action",
            title: `Үлдсэн ${i.unfinishedItems} ажлыг дуусгах`,
            detail: "Ажил бүрийн төлвийг «Дууссан» болгоно уу.",
            anchor: "order-items",
          };
        case "payment":
          return payment(i, "Төлбөр бүрэн төлөгдсөний дараа хуудсыг хаана.");
        case "postpaid":
          return { tone: "waiting", title: "Төлбөргүй хаах эрх шаардлагатай", detail: b.message };
      }
      return null;
    }

    case "COMPLETED":
      if (!i.isInternal && i.hasRemaining) return payment(i, "Үлдэгдэл төлөгдөөгүй байна.");
      return { tone: "done", title: i.isInternal ? "Дотоод засвар дууссан" : "Хуудас дууссан, төлбөр төлөгдсөн" };
  }
}
