"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod/v4";
import { requireSuperAdmin } from "@/lib/auth/system";
import {
  type ApplyResult,
  type DataAgentResult,
  type DataProposal,
  MAX_USER_MESSAGE_CHARS,
  ProposalListSchema,
  applyDataProposals,
  runDataAgentTurn,
} from "@/lib/ai/data-agent";

const HistorySchema = z
  .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(60_000) }))
  .max(40);

/** AI туслахад нэг мессеж илгээнэ. Юу ч бичихгүй — зөвхөн санал буцаана. */
export async function sendDataAgentMessageAction(
  history: unknown,
  message: unknown,
  draft: unknown,
): Promise<DataAgentResult> {
  await requireSuperAdmin();
  const h = HistorySchema.safeParse(history);
  const d = ProposalListSchema.safeParse(draft);
  const text = typeof message === "string" ? message.trim() : "";
  if (!h.success || !d.success) return { ok: false, message: "Хүсэлт буруу." };
  if (!text) return { ok: false, message: "Мессеж хоосон байна." };
  if (text.length > MAX_USER_MESSAGE_CHARS) {
    return { ok: false, message: `Мессеж ${MAX_USER_MESSAGE_CHARS.toLocaleString()} тэмдэгтээс урт — хэсэгчлэн илгээнэ үү.` };
  }
  return await runDataAgentTurn(h.data, text, d.data as DataProposal[]);
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
