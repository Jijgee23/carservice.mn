"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod/v4";
import { requireSuperAdmin } from "@/lib/auth/system";
import {
  type AgentAttachment,
  type ApplyResult,
  type DataAgentResult,
  type DataProposal,
  AttachmentError,
  AttachmentSchema,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_USER_MESSAGE_CHARS,
  ProposalListSchema,
  applyDataProposals,
  deleteDataAgentFiles,
  isDataAgentConfigured,
  runDataAgentTurn,
  uploadDataAgentFile,
} from "@/lib/ai/data-agent";

const AttachmentListSchema = z.array(AttachmentSchema).max(MAX_ATTACHMENTS_PER_MESSAGE);

const HistorySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      text: z.string().max(60_000),
      attachments: AttachmentListSchema.optional(),
    }),
  )
  .max(40);

const FILE_ONLY_PROMPT = "Хавсаргасан файл(ууд)-ыг шинжилж, нэмэх зүйлсийг санал болго.";

/** AI туслахад нэг мессеж илгээнэ. Юу ч бичихгүй — зөвхөн санал буцаана. */
export async function sendDataAgentMessageAction(
  history: unknown,
  message: unknown,
  draft: unknown,
  attachments: unknown = [],
): Promise<DataAgentResult> {
  await requireSuperAdmin();
  const h = HistorySchema.safeParse(history);
  const d = ProposalListSchema.safeParse(draft);
  const a = AttachmentListSchema.safeParse(attachments);
  if (!h.success || !d.success || !a.success) return { ok: false, message: "Хүсэлт буруу." };

  const typed = typeof message === "string" ? message.trim() : "";
  if (!typed && a.data.length === 0) return { ok: false, message: "Мессеж хоосон байна." };
  if (typed.length > MAX_USER_MESSAGE_CHARS) {
    return { ok: false, message: `Мессеж ${MAX_USER_MESSAGE_CHARS.toLocaleString()} тэмдэгтээс урт — хэсэгчлэн илгээнэ үү.` };
  }
  return await runDataAgentTurn(h.data, typed || FILE_ONLY_PROMPT, d.data as DataProposal[], a.data);
}

/** Нэг файлыг Anthropic Files API руу upload хийнэ (файл бүр тусдаа дуудлага — body хязгаарт багтана). */
export async function uploadDataAgentFileAction(
  formData: FormData,
): Promise<{ ok: true; attachment: AgentAttachment } | { ok: false; message: string }> {
  await requireSuperAdmin();
  if (!isDataAgentConfigured()) return { ok: false, message: "ANTHROPIC_API_KEY тохируулаагүй байна." };
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, message: "Файл алга." };
  try {
    return { ok: true, attachment: await uploadDataAgentFile(file) };
  } catch (e) {
    if (e instanceof AttachmentError) return { ok: false, message: e.message };
    console.error("[data-agent] upload failed", e);
    return { ok: false, message: `«${file.name}»-ыг upload хийж чадсангүй.` };
  }
}

/** Яриа цэвэрлэх / хавсралт хасахад Files API дээрх файлуудыг устгана. */
export async function deleteDataAgentFilesAction(fileIds: unknown): Promise<void> {
  await requireSuperAdmin();
  const ids = z.array(AttachmentSchema.shape.fileId).max(200).safeParse(fileIds);
  if (!ids.success || ids.data.length === 0) return;
  await deleteDataAgentFiles(ids.data);
}

/** Admin баталсан саналуудыг бичнэ (server дээр дахин шалгана). */
export async function applyDataAgentProposalsAction(
  proposals: unknown,
): Promise<{ ok: true; result: ApplyResult } | { ok: false; message: string }> {
  const actor = await requireSuperAdmin();
  const parsed = ProposalListSchema.safeParse(proposals);
  if (!parsed.success || parsed.data.length === 0) return { ok: false, message: "Хэрэгжүүлэх санал алга." };

  const result = await applyDataProposals(parsed.data as DataProposal[], actor.id);

  revalidatePath("/system/catalog");
  revalidatePath("/system/service-keys");
  revalidatePath("/system/system-categories");
  revalidatePath("/system/branch-tags");
  revalidatePath("/dashboard/services", "layout");
  return { ok: true, result };
}
