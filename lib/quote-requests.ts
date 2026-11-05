// Энтерпрайз багцын үнийн саналын хүсэлт — client/server хоёуланд (Prisma-гүй).

import { MODULE_LIMIT_CODES, type PlanModuleCode } from "./plan-limits";
import { normalizePhone } from "./phone";

export const QUOTE_STATUS_VALUES = ["NEW", "CONTACTED", "CLOSED"] as const;
export type QuoteStatus = (typeof QUOTE_STATUS_VALUES)[number];

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  NEW: "Шинэ",
  CONTACTED: "Хариу илгээсэн",
  CLOSED: "Хаагдсан",
};

export function isQuoteStatus(v: string): v is QuoteStatus {
  return (QUOTE_STATUS_VALUES as readonly string[]).includes(v);
}

export const QUOTE_CHANNEL_LABEL = { SMS: "SMS", EMAIL: "Имейл" } as const;

// Хариуны анхны текст — систем админ илгээхээс өмнө засаж болно. SMS-ийн
// дээд урт (SEND_SMS_MAX_LENGHT, default 159)-д багтахаар богино.
export const DEFAULT_QUOTE_REPLY_SUBJECT = "Үнийн саналын хүсэлт хүлээн авлаа — Carservice";

export function defaultQuoteReplyMessage(contactName: string): string {
  const name = contactName.trim();
  return `${name ? `${name}, ` : ""}Таны Энтерпрайз багцын үнийн саналын хүсэлтийг хүлээн авлаа. Удахгүй тантай холбогдоно. Carservice`;
}

export const QUOTE_LIMITS = {
  orgName: 120,
  contactName: 80,
  email: 120,
  message: 2000,
  replyBody: 2000,
  replySubject: 150,
  maxBranches: 10000,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type QuoteRequestInput = {
  orgName: string;
  contactName: string;
  phone: string;
  email: string | null;
  branchCount: number | null;
  modules: PlanModuleCode[];
  message: string | null;
};

export type QuoteFieldErrors = Partial<
  Record<"orgName" | "contactName" | "phone" | "email" | "branchCount" | "modules" | "message", string>
>;

/** Маягтын түүхий утгыг шалгаж нормализна. Алдаатай бол fieldErrors. */
export function parseQuoteRequestInput(raw: {
  orgName: string;
  contactName: string;
  phone: string;
  email: string;
  branchCount: string;
  modules: string[];
  message: string;
}): { ok: true; data: QuoteRequestInput } | { ok: false; fieldErrors: QuoteFieldErrors } {
  const errors: QuoteFieldErrors = {};
  const orgName = raw.orgName.trim();
  const contactName = raw.contactName.trim();
  const email = raw.email.trim();
  const message = raw.message.trim();

  if (!orgName) errors.orgName = "Байгууллагын нэр оруулна уу.";
  else if (orgName.length > QUOTE_LIMITS.orgName) errors.orgName = "Хэт урт байна.";

  if (!contactName) errors.contactName = "Холбогдох хүний нэр оруулна уу.";
  else if (contactName.length > QUOTE_LIMITS.contactName) errors.contactName = "Хэт урт байна.";

  const phone = normalizePhone(raw.phone);
  if (!phone) errors.phone = "Утасны дугаар буруу байна (8 оронтой).";

  if (email && (!EMAIL_RE.test(email) || email.length > QUOTE_LIMITS.email)) {
    errors.email = "Имейл хаяг буруу байна.";
  }

  let branchCount: number | null = null;
  if (raw.branchCount.trim()) {
    const n = Number(raw.branchCount.trim());
    if (!Number.isInteger(n) || n < 1 || n > QUOTE_LIMITS.maxBranches) {
      errors.branchCount = "Салбарын тоо буруу байна.";
    } else {
      branchCount = n;
    }
  }

  const modules = MODULE_LIMIT_CODES.filter((c) => raw.modules.includes(c));
  if (modules.length === 0) errors.modules = "Дор хаяж нэг модуль сонгоно уу.";

  if (message.length > QUOTE_LIMITS.message) errors.message = "Хэт урт байна.";

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    data: {
      orgName,
      contactName,
      phone: phone!,
      email: email ? email.toLowerCase() : null,
      branchCount,
      modules,
      message: message || null,
    },
  };
}
