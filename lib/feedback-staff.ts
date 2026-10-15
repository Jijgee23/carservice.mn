// P7-B2 — staff feedback business rules, extracted from
// `app/_actions/feedback.ts`'s `submitStaffFeedback`/`addSubmitterFeedbackReply`
// so the web server actions and `app/api/v1/feedback/**` share one core.
// Framework-free: no `"use server"`, `revalidatePath`, `redirect`, or cookies
// here — those stay in the web action wrapper. Messages are byte-identical
// to the pre-extraction actions (D-176: feedback stays auth-only, no
// permission code).
//
// Screenshot uploads reuse `lib/storage.ts`'s existing `saveUpload` (same
// mime/size limits as every other upload path — 2MB, PNG/JPG/WEBP).

import type {
  Feedback,
  FeedbackMessage,
  FeedbackStatus,
  FeedbackType,
} from "@/app/generated/prisma/client";
import { isFeedbackType } from "@/lib/feedback";
import { prisma } from "@/lib/prisma";
import { saveUpload } from "@/lib/storage";

export type StaffFeedbackActor = { id: string; tenantId: string };

export type FeedbackResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code?: "NOT_FOUND" };

export type StaffFeedbackInput = {
  type: FeedbackType;
  message: string;
  pageUrl: string;
  userAgent: string;
};

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Мессежийн урт болон төрлийг шалгана. Буруу бол `null`. */
export function parseStaffFeedbackInput(fd: FormData): StaffFeedbackInput | null {
  const rawType = s(fd, "type");
  const message = s(fd, "message");
  const pageUrl = s(fd, "pageUrl").slice(0, 500);
  const userAgent = s(fd, "userAgent").slice(0, 500);
  if (!isFeedbackType(rawType)) return null;
  if (message.length < 5 || message.length > 2000) return null;
  return { type: rawType, message, pageUrl, userAgent };
}

/** `screenshot` талбар сонгогдсон бол хадгалж URL буцаана; сонгоогүй бол null. */
export async function saveStaffFeedbackScreenshot(fd: FormData): Promise<string | null> {
  const file = fd.get("screenshot");
  if (!(file instanceof File) || file.size === 0) return null;
  const saved = await saveUpload(file, "feedback");
  return saved.path;
}

/**
 * Ажилтны (dashboard/mobile) талаас санал хүсэлт/алдаа мэдээлэх.
 * `actor.tenantId` дор шинэ `Feedback` мөр үүсгэнэ.
 */
export async function createStaffFeedback(
  actor: StaffFeedbackActor,
  formData: FormData,
): Promise<FeedbackResult<{ feedback: Feedback }>> {
  const input = parseStaffFeedbackInput(formData);
  if (!input) {
    return { ok: false, message: "Мессеж 5-2000 тэмдэгт байх ёстой." };
  }

  let screenshotUrl: string | null;
  try {
    screenshotUrl = await saveStaffFeedbackScreenshot(formData);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Зураг хадгалахад алдаа гарлаа." };
  }

  const feedback = await prisma.feedback.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.id,
      type: input.type,
      message: input.message,
      screenshotUrl,
      pageUrl: input.pageUrl || null,
      userAgent: input.userAgent || null,
    },
  });

  return { ok: true, data: { feedback } };
}

/**
 * Tenant (dashboard/mobile) тал: өөрсдийн илгээсэн feedback дээр SuperAdmin-д
 * хариу бичих. Шийдэгдсэн/хаагдсан feedback дээр шинэ хариу ирвэл дахин
 * "Хянаж буй" болгож админы анхаарлыг татна. Author нь ЯГ ХАЖИН "SUBMITTER"
 * — caller энэ талбарыг өөрчлөх боломжгүй.
 */
export async function addStaffFeedbackReply(
  actor: StaffFeedbackActor,
  id: string,
  message: string,
): Promise<FeedbackResult<{ feedbackMessage: FeedbackMessage; reopened: boolean }>> {
  const trimmed = typeof message === "string" ? message.trim() : "";
  if (!id || trimmed.length < 2 || trimmed.length > 2000) {
    return { ok: false, message: "Хариу 2-2000 тэмдэгт байх ёстой." };
  }

  const feedback = await prisma.feedback.findFirst({
    where: { id, tenantId: actor.tenantId },
  });
  if (!feedback) return { ok: false, message: "Олдсонгүй.", code: "NOT_FOUND" };

  const feedbackMessage = await prisma.feedbackMessage.create({
    data: {
      feedbackId: id,
      tenantId: actor.tenantId,
      author: "SUBMITTER",
      message: trimmed,
    },
  });

  let reopened = false;
  const reopenStatuses: FeedbackStatus[] = ["RESOLVED", "DISMISSED"];
  if (reopenStatuses.includes(feedback.status)) {
    await prisma.feedback.update({
      where: { id },
      data: { status: "IN_REVIEW", resolvedAt: null },
    });
    reopened = true;
  }

  return { ok: true, data: { feedbackMessage, reopened } };
}

/** Тухайн tenant-д хамаарах feedback ганцыг мессежийн thread-тэй нь авна. */
export async function getStaffFeedbackWithThread(
  actor: StaffFeedbackActor,
  id: string,
): Promise<(Feedback & { messages: FeedbackMessage[] }) | null> {
  return await prisma.feedback.findFirst({
    where: { id, tenantId: actor.tenantId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

export type FeedbackDto = {
  id: string;
  type: FeedbackType;
  message: string;
  screenshotUrl: string | null;
  pageUrl: string | null;
  status: FeedbackStatus;
  adminNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

/** Feedback Prisma мөрийг API-д буцаах DTO болгоно (sensitive талбар алга). */
export function toFeedbackDto(feedback: Feedback): FeedbackDto {
  return {
    id: feedback.id,
    type: feedback.type,
    message: feedback.message,
    screenshotUrl: feedback.screenshotUrl,
    pageUrl: feedback.pageUrl,
    status: feedback.status,
    adminNote: feedback.adminNote,
    resolvedAt: feedback.resolvedAt ? feedback.resolvedAt.toISOString() : null,
    createdAt: feedback.createdAt.toISOString(),
  };
}

export type FeedbackMessageDto = {
  id: string;
  author: FeedbackMessage["author"];
  message: string;
  createdAt: string;
};

export function toFeedbackMessageDto(message: FeedbackMessage): FeedbackMessageDto {
  return {
    id: message.id,
    author: message.author,
    message: message.message,
    createdAt: message.createdAt.toISOString(),
  };
}

export type ListStaffFeedbackParams = {
  skip: number;
  take: number;
};

/** Тухайн tenant-ийн feedback жагсаалт, хуудаслалттай. */
export async function listStaffFeedback(
  actor: StaffFeedbackActor,
  params: ListStaffFeedbackParams,
): Promise<{ items: Feedback[]; total: number }> {
  const where = { tenantId: actor.tenantId };
  const [items, total] = await Promise.all([
    prisma.feedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: params.skip,
      take: params.take,
    }),
    prisma.feedback.count({ where }),
  ]);
  return { items, total };
}
