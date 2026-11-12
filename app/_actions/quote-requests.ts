"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { requireSuperAdmin } from "@/lib/auth/system";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import {
  type QuoteFieldErrors,
  QUOTE_LIMITS,
  isQuoteStatus,
  parseQuoteRequestInput,
} from "@/lib/quote-requests";
import {
  QUOTE_REQUEST_RATE_BUCKET,
  QUOTE_REQUEST_RATE_LIMIT,
  saveQuoteRequest,
} from "@/lib/quote-requests-server";
import { consumeRateLimit, ipFromHeaders, RATE_LIMITED_MESSAGE } from "@/lib/rate-limit";
import { sendSms } from "@/lib/sms";

export type QuoteRequestActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: QuoteFieldErrors;
  // Алдаатай үед маягтын утгыг буцаана (React 19 form action дараа нь маягтыг цэвэрлэдэг).
  values?: QuoteFormValues;
} | null;

export type QuoteFormValues = {
  orgName: string;
  contactName: string;
  phone: string;
  email: string;
  branchCount: string;
  modules: string[];
  message: string;
};

export type QuoteAdminActionState = { ok: boolean; message?: string } | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

/**
 * Энтерпрайз багцын үнийн саналын хүсэлт илгээнэ. Нүүр хуудаснаас (нэвтрээгүй)
 * эсвэл dashboard-аас (`source=dashboard` → тенанттай холбоно). Систем админд
 * мэдэгдэл (quote_request_created) очно.
 */
export async function submitQuoteRequestAction(
  _prev: QuoteRequestActionState,
  formData: FormData,
): Promise<QuoteRequestActionState> {
  // Dashboard-аас бол нэвтэрсэн тенантыг холбоно (session-гүй бол login руу).
  const tenantId = s(formData, "source") === "dashboard" ? (await requireUser()).tenantId : null;

  const values: QuoteFormValues = {
    orgName: s(formData, "orgName"),
    contactName: s(formData, "contactName"),
    phone: s(formData, "phone"),
    email: s(formData, "email"),
    branchCount: s(formData, "branchCount"),
    modules: formData.getAll("modules").filter((v): v is string => typeof v === "string"),
    message: s(formData, "message"),
  };

  const h = await headers();
  const ip = ipFromHeaders(h);
  if (!consumeRateLimit(`${QUOTE_REQUEST_RATE_BUCKET}:${ip}`, QUOTE_REQUEST_RATE_LIMIT).ok) {
    return { ok: false, message: RATE_LIMITED_MESSAGE, values };
  }

  // Spam bot-ын honeypot талбар — хүн бөглөхгүй (харагдахгүй). Бөглөсөн бол
  // амжилттай мэт буцааж, юу ч хадгалахгүй.
  if (s(formData, "website").trim()) {
    return { ok: true };
  }

  const parsed = parseQuoteRequestInput(values);
  if (!parsed.ok) return { ok: false, fieldErrors: parsed.fieldErrors, values };

  await saveQuoteRequest(parsed.data, tenantId);

  revalidatePath("/system/quote-requests");
  return { ok: true };
}

export async function updateQuoteRequestStatusAction(
  _prev: QuoteAdminActionState,
  formData: FormData,
): Promise<QuoteAdminActionState> {
  await requireSuperAdmin();
  const id = s(formData, "id");
  const status = s(formData, "status");
  const adminNote = s(formData, "adminNote").trim();
  if (!id || !isQuoteStatus(status)) return { ok: false, message: "Буруу хүсэлт." };
  if (adminNote.length > 2000) return { ok: false, message: "Тэмдэглэл хэт урт байна." };

  const res = await prisma.quoteRequest.updateMany({
    where: { id },
    data: { status, adminNote: adminNote || null },
  });
  if (res.count !== 1) return { ok: false, message: "Хүсэлт олдсонгүй." };

  revalidatePath("/system/quote-requests");
  revalidatePath(`/system/quote-requests/${id}`);
  return { ok: true, message: "Хадгалагдлаа." };
}

/**
 * Хүсэлт илгээгчид SMS ба/эсвэл имейлээр хариу илгээнэ. Суваг бүрийн үр дүнг
 * QuoteRequestReply-д хадгална; аль нэг нь амжилттай бол NEW → CONTACTED.
 */
export async function replyQuoteRequestAction(
  _prev: QuoteAdminActionState,
  formData: FormData,
): Promise<QuoteAdminActionState> {
  const admin = await requireSuperAdmin();
  const id = s(formData, "id");
  const channels = formData.getAll("channels").filter((v): v is string => typeof v === "string");
  const body = s(formData, "body").trim();
  const subject = s(formData, "subject").trim();

  if (!id) return { ok: false, message: "Буруу хүсэлт." };
  const wantSms = channels.includes("SMS");
  const wantEmail = channels.includes("EMAIL");
  if (!wantSms && !wantEmail) return { ok: false, message: "SMS эсвэл имейл сонгоно уу." };
  if (!body) return { ok: false, message: "Хариуны текст оруулна уу." };
  if (body.length > QUOTE_LIMITS.replyBody) return { ok: false, message: "Хариу хэт урт байна." };
  if (wantEmail && !subject) return { ok: false, message: "Имейлийн гарчиг оруулна уу." };
  if (subject.length > QUOTE_LIMITS.replySubject) return { ok: false, message: "Гарчиг хэт урт байна." };

  const request = await prisma.quoteRequest.findUnique({
    where: { id },
    select: { id: true, phone: true, email: true, status: true },
  });
  if (!request) return { ok: false, message: "Хүсэлт олдсонгүй." };
  if (wantEmail && !request.email) return { ok: false, message: "Хүсэлтэд имейл хаяг алга." };
  if (wantEmail && !isEmailConfigured()) {
    return { ok: false, message: "Имейл (SMTP) тохируулаагүй тул имейл илгээх боломжгүй." };
  }

  const results: { channel: "SMS" | "EMAIL"; ok: boolean; error: string | null }[] = [];

  if (wantSms) {
    const ok = await sendSms(request.phone, body);
    results.push({ channel: "SMS", ok, error: ok ? null : "SMS илгээгдсэнгүй (gateway/тохиргоо)." });
  }
  if (wantEmail && request.email) {
    const r = await sendEmail({ to: request.email, subject, text: body });
    results.push({ channel: "EMAIL", ok: r.ok, error: r.ok ? null : r.error });
  }

  await prisma.quoteRequestReply.createMany({
    data: results.map((r) => ({
      quoteRequestId: request.id,
      channel: r.channel,
      recipient: r.channel === "SMS" ? request.phone : (request.email ?? ""),
      subject: r.channel === "EMAIL" ? subject : null,
      body,
      ok: r.ok,
      error: r.error,
      sentById: admin.id,
    })),
  });

  const anyOk = results.some((r) => r.ok);
  if (anyOk && request.status === "NEW") {
    await prisma.quoteRequest.update({ where: { id: request.id }, data: { status: "CONTACTED" } });
  }

  revalidatePath("/system/quote-requests");
  revalidatePath(`/system/quote-requests/${request.id}`);

  const label = (c: "SMS" | "EMAIL") => (c === "SMS" ? "SMS" : "Имейл");
  const sent = results.filter((r) => r.ok).map((r) => label(r.channel));
  const failed = results.filter((r) => !r.ok).map((r) => label(r.channel));
  if (failed.length === 0) return { ok: true, message: `${sent.join(", ")} илгээгдлээ.` };
  if (sent.length === 0) return { ok: false, message: `${failed.join(", ")} илгээгдсэнгүй.` };
  return { ok: false, message: `${sent.join(", ")} илгээгдлээ; ${failed.join(", ")} илгээгдсэнгүй.` };
}
