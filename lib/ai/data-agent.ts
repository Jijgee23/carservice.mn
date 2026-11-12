import "server-only";

// Super admin-ий «AI туслах» — Claude API (tool use) ашиглан платформын
// нийтлэг (global) өгөгдлийг байгуулахад тусална: Нэгдсэн сан (CatalogItem),
// Системийн ангилал (SystemServiceKey), Сэлбэгийн ангилал (Category,
// tenantId NULL, GOODS), Салбарын шошго (BranchTag).
//
// Аюулгүй байдлын зарчим: агент ӨГӨГДӨЛ ШУУД БИЧИХГҮЙ. Унших хэрэгслүүд
// (search_*/list_*) шууд ажиллана; propose_* хэрэгслүүд зөвхөн шалгаад
// «санал» (DataProposal) болгон буцаана. Admin UI дээр хянаад «Хэрэгжүүлэх»
// дарахад л `applyDataProposals` бичнэ.
//
// RLS: дуудагч (server action) `requireSuperAdmin()`-ээр bypass context
// тавьсан байх ёстой. Tool runner-ийн `run()` нь олон await-ын дараа
// дуудагддаг тул tool бүрийн эхэнд `setBypassContext()`-г дахин тавьж,
// prisma-г үргэлж `return await` хийнэ (Node 22 ALS gotcha).

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { Prisma } from "@/app/generated/prisma/client";
import { createCatalogItemAdmin, loadSystemCategories, matchSystemCategory } from "@/lib/catalog/catalog-admin";
import { parseCatalogInput } from "@/lib/catalog/catalog-input";
import { normalizeCatalogName } from "@/lib/catalog/normalize";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";

export const DATA_AGENT_MODEL = "claude-opus-5-5";
const MAX_ITERATIONS = 16;
const MAX_PROPOSALS_PER_TURN = 200;
export const MAX_USER_MESSAGE_CHARS = 20_000;

// --- Санал (proposal) төрлүүд ---------------------------------------------

export type CatalogProposal = {
  kind: "catalogItem";
  type: "LABOR" | "GOODS";
  name: string;
  code: string | null;
  barcode: string | null;
  unitName: string;
  price: string;
  category: string | null;
  durationValue: string | null;
  durationUnitName: string | null;
  description: string | null;
};
export type NamedProposal = {
  kind: "serviceKey" | "systemCategory" | "branchTag";
  name: string;
  description: string | null;
};
export type DataProposal = CatalogProposal | NamedProposal;

export const PROPOSAL_KIND_LABEL: Record<DataProposal["kind"], string> = {
  catalogItem: "Нэгдсэн сан",
  serviceKey: "Системийн ангилал",
  systemCategory: "Сэлбэгийн ангилал",
  branchTag: "Салбарын шошго",
};

export function proposalKey(p: DataProposal): string {
  if (p.kind === "catalogItem") {
    return p.code ? `catalog|${p.type}|c|${p.code}` : `catalog|${p.type}|n|${normalizeCatalogName(p.name)}`;
  }
  return `${p.kind}|${p.name.trim().toLowerCase()}`;
}

/** Client-ээс ирсэн (итгэмжгүй) саналын жагсаалтыг шалгаж цэвэрлэнэ. */
const NamedProposalSchema = z.object({
  kind: z.enum(["serviceKey", "systemCategory", "branchTag"]),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).nullable(),
});
const CatalogProposalSchema = z.object({
  kind: z.literal("catalogItem"),
  type: z.enum(["LABOR", "GOODS"]),
  name: z.string().max(200),
  code: z.string().max(60).nullable(),
  barcode: z.string().max(64).nullable(),
  unitName: z.string().max(40),
  price: z.string().max(30),
  category: z.string().max(80).nullable(),
  durationValue: z.string().max(30).nullable(),
  durationUnitName: z.string().max(40).nullable(),
  description: z.string().max(1000).nullable(),
});
export const ProposalListSchema = z
  .array(z.discriminatedUnion("kind", [CatalogProposalSchema, NamedProposalSchema]))
  .max(500);

// --- Шалгалт (propose болон apply хоёулаа ашиглана) -----------------------

/** CatalogProposal-ыг parseCatalogInput-ийн дүрмээр шалгана (маягт/Excel-тэй ижил). */
function validateCatalog(p: Omit<CatalogProposal, "kind">) {
  return parseCatalogInput(p.type, {
    name: p.name,
    code: p.code ?? "",
    barcode: p.barcode ?? "",
    unitName: p.unitName,
    price: p.price,
    category: p.category ?? "",
    durationValue: p.durationValue ?? "",
    durationUnitName: p.durationUnitName ?? "",
    description: p.description ?? "",
  });
}

// --- Хэрэгслүүд ------------------------------------------------------------

export type TurnState = {
  proposals: DataProposal[];
  /** Өмнө нь (draft-д) байгаа + энэ ээлжинд санал болгосон түлхүүрүүд. */
  seenKeys: Set<string>;
  /** Draft-д байгаа, эсвэл энэ ээлжинд санал болгосон сэлбэгийн ангиллын нэрс (жижиг үсгээр). */
  pendingCategoryNames: Set<string>;
};

const json = (v: unknown) => JSON.stringify(v);

/** Exported for smoke tests. */
export function buildTools(state: TurnState) {
  const searchCatalog = betaZodTool({
    name: "search_catalog",
    description:
      "Нэгдсэн сангаас (CatalogItem) нэр, код, баркодоор хайна. Шинэ мөр санал болгохоос ӨМНӨ давхардал шалгахад заавал ашигла. Олон хувилбараар (кирилл/латин, товчлол) хайж болно.",
    inputSchema: z.object({
      query: z.string().min(1).max(100).describe("Хайх үг — нэрийн хэсэг, код эсвэл баркод"),
      type: z.enum(["LABOR", "GOODS"]).optional().describe("LABOR = ажил, GOODS = сэлбэг/бараа"),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    run: async ({ query, type, limit }) => {
      setBypassContext();
      const q = query.trim();
      const rows = await prisma.catalogItem.findMany({
        where: {
          ...(type ? { type } : {}),
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { nameKey: { contains: normalizeCatalogName(q) } },
            { codeKey: { contains: q.toUpperCase() } },
            { barcode: q },
          ],
        },
        orderBy: { name: "asc" },
        take: limit ?? 20,
        select: {
          type: true,
          name: true,
          code: true,
          barcode: true,
          unitName: true,
          price: true,
          isActive: true,
          category: { select: { name: true } },
        },
      });
      return json({
        count: rows.length,
        items: rows.map((r) => ({ ...r, price: r.price.toString(), category: r.category?.name ?? null })),
      });
    },
  });

  const listReferenceData = betaZodTool({
    name: "list_reference_data",
    description:
      "Системийн лавлах өгөгдлийг бүхэлд нь жагсаана: serviceKeys (Системийн ангилал — үйлчлүүлэгчийн сонгох ажлын төрөл), systemCategories (Сэлбэгийн ангилал — GOODS мөрийн ангилал), branchTags (Салбарын шошго), мөн нэгдсэн сангийн тоо ба түгээмэл нэгжүүд. Ажлын эхэнд нэг удаа дууд.",
    inputSchema: z.object({}),
    run: async () => {
      setBypassContext();
      const [serviceKeys, systemCategories, branchTags, catalogCounts, units] = await Promise.all([
        prisma.systemServiceKey.findMany({ orderBy: { name: "asc" }, select: { name: true, description: true, isActive: true } }),
        prisma.category.findMany({
          where: { tenantId: null },
          orderBy: { name: "asc" },
          select: { name: true, kind: true, isActive: true },
        }),
        prisma.branchTag.findMany({ orderBy: { name: "asc" }, select: { name: true, isActive: true } }),
        prisma.catalogItem.groupBy({ by: ["type"], _count: { _all: true } }),
        prisma.catalogItem.groupBy({
          by: ["unitName"],
          _count: { _all: true },
          orderBy: { _count: { unitName: "desc" } },
          take: 15,
        }),
      ]);
      return json({
        serviceKeys,
        systemCategories,
        branchTags,
        catalogCounts: Object.fromEntries(catalogCounts.map((c) => [c.type, c._count._all])),
        commonUnits: units.map((u) => u.unitName),
        pendingProposals: state.proposals.length,
      });
    },
  });

  const proposeCatalogItems = betaZodTool({
    name: "propose_catalog_items",
    description:
      "Нэгдсэн санд шинэ мөр нэмэх САНАЛ үүсгэнэ (шууд бичихгүй — admin хянаж батална). Мөр бүрийг шалгаж, санд/саналд аль хэдийн байвал алгасна. Үр дүнд accepted/rejected тоо болон шалтгааныг буцаана — rejected мөрийг засаад дахин санал болгож болно.",
    inputSchema: z.object({
      items: z
        .array(
          z.object({
            type: z.enum(["LABOR", "GOODS"]),
            name: z.string().describe("Монгол нэр, цэвэрхэн (жиш. «Тосны шүүлтүүр солих»)"),
            code: z.string().nullable().describe("Код/OEM/SKU мэдэгдэж байвал, эс бөгөөс null"),
            barcode: z.string().nullable().describe("Зөвхөн GOODS, мэдэгдэж байвал"),
            unitName: z.string().describe("Нэгж: ажилд ихэвчлэн «удаа», бараанд «ш», «л», «багц» г.м."),
            price: z.string().describe("Санал болгох үнэ ₮, зөвхөн тоо (жиш. «45000»)"),
            category: z
              .string()
              .nullable()
              .describe("Зөвхөн GOODS: байгаа эсвэл энэ ээлжинд санал болгосон Сэлбэгийн ангиллын НЭР; LABOR бол null"),
            durationValue: z.string().nullable().describe("Зөвхөн LABOR: үргэлжлэх хугацаа (тоо)"),
            durationUnitName: z.string().nullable().describe("Зөвхөн LABOR: «мин» эсвэл «цаг»"),
            description: z.string().nullable(),
          }),
        )
        .min(1)
        .max(100),
    }),
    run: async ({ items }) => {
      setBypassContext();
      const accepted: string[] = [];
      const rejected: { name: string; reason: string }[] = [];
      const categoriesByType = {
        GOODS: await loadSystemCategories("GOODS"),
        LABOR: await loadSystemCategories("LABOR"),
      };

      for (const item of items) {
        if (state.proposals.length >= MAX_PROPOSALS_PER_TURN) {
          rejected.push({ name: item.name, reason: `Нэг ээлжинд ${MAX_PROPOSALS_PER_TURN}-аас олон санал болгохгүй.` });
          continue;
        }
        const parsed = validateCatalog(item);
        if (!parsed.ok) {
          rejected.push({ name: item.name, reason: Object.values(parsed.errors).join(" ") });
          continue;
        }
        const v = parsed.values;
        if (v.type === "GOODS" && v.category) {
          const known =
            matchSystemCategory(categoriesByType.GOODS, v.category) !== undefined ||
            state.pendingCategoryNames.has(v.category.toLowerCase());
          if (!known) {
            rejected.push({
              name: v.name,
              reason: `«${v.category}» сэлбэгийн ангилал байхгүй — эхлээд propose_named_records-оор санал болго эсвэл байгаа ангиллыг сонго.`,
            });
            continue;
          }
        }
        const proposal: CatalogProposal = { kind: "catalogItem", ...v };
        const key = proposalKey(proposal);
        if (state.seenKeys.has(key)) {
          rejected.push({ name: v.name, reason: "Энэ мөр саналын жагсаалтад аль хэдийн байна." });
          continue;
        }
        const existing =
          (v.barcode
            ? await prisma.catalogItem.findFirst({ where: { barcode: v.barcode }, select: { name: true, code: true } })
            : null) ??
          (await prisma.catalogItem.findFirst({
            where: v.code ? { type: v.type, codeKey: v.code } : { type: v.type, codeKey: null, nameKey: normalizeCatalogName(v.name) },
            select: { name: true, code: true },
          }));
        if (existing) {
          rejected.push({ name: v.name, reason: `Санд аль хэдийн байна: ${existing.name}${existing.code ? ` (${existing.code})` : ""}` });
          continue;
        }
        state.seenKeys.add(key);
        state.proposals.push(proposal);
        accepted.push(v.name);
      }
      return json({ accepted: accepted.length, rejected, totalPending: state.proposals.length });
    },
  });

  const proposeNamedRecords = betaZodTool({
    name: "propose_named_records",
    description:
      "Системийн ангилал (serviceKey), Сэлбэгийн ангилал (systemCategory) эсвэл Салбарын шошго (branchTag) нэмэх САНАЛ үүсгэнэ (шууд бичихгүй). Нэр давхцвал (том/жижиг үсэг үл хамаарна) алгасна.",
    inputSchema: z.object({
      records: z
        .array(
          z.object({
            kind: z.enum(["serviceKey", "systemCategory", "branchTag"]),
            name: z.string().describe("Монгол нэр, 80 тэмдэгт хүртэл"),
            description: z.string().nullable().describe("200 тэмдэгт хүртэл, эсвэл null"),
          }),
        )
        .min(1)
        .max(50),
    }),
    run: async ({ records }) => {
      setBypassContext();
      const accepted: string[] = [];
      const rejected: { name: string; reason: string }[] = [];
      for (const r of records) {
        const name = r.name.trim().replace(/\s+/g, " ");
        const description = r.description?.trim() || null;
        if (!name || name.length > 80) {
          rejected.push({ name: r.name, reason: "Нэр хоосон эсвэл 80 тэмдэгтээс урт." });
          continue;
        }
        if (description && description.length > 200) {
          rejected.push({ name, reason: "Тайлбар 200 тэмдэгтээс урт." });
          continue;
        }
        const proposal: NamedProposal = { kind: r.kind, name, description };
        const key = proposalKey(proposal);
        if (state.seenKeys.has(key)) {
          rejected.push({ name, reason: "Саналын жагсаалтад аль хэдийн байна." });
          continue;
        }
        if (await namedRecordExists(r.kind, name)) {
          rejected.push({ name, reason: "Ийм нэртэй бүртгэл аль хэдийн байна." });
          continue;
        }
        state.seenKeys.add(key);
        if (r.kind === "systemCategory") state.pendingCategoryNames.add(name.toLowerCase());
        state.proposals.push(proposal);
        accepted.push(`${PROPOSAL_KIND_LABEL[r.kind]}: ${name}`);
      }
      return json({ accepted, rejected, totalPending: state.proposals.length });
    },
  });

  return [listReferenceData, searchCatalog, proposeCatalogItems, proposeNamedRecords];
}

async function namedRecordExists(kind: NamedProposal["kind"], name: string): Promise<boolean> {
  const ci = { equals: name, mode: "insensitive" as const };
  if (kind === "serviceKey") return Boolean(await prisma.systemServiceKey.findFirst({ where: { name: ci }, select: { id: true } }));
  if (kind === "branchTag") return Boolean(await prisma.branchTag.findFirst({ where: { name: ci }, select: { id: true } }));
  return Boolean(await prisma.category.findFirst({ where: { tenantId: null, name: ci }, select: { id: true } }));
}

// --- System prompt ---------------------------------------------------------

const SYSTEM_PROMPT = `Чи carservice.mn платформын super admin-д зориулсан өгөгдөл байгуулах туслах. carservice.mn бол Монголын авто засварын газруудад зориулсан SaaS (засвар үйлчилгээний захиалга, агуулах, цаг захиалга).

Чиний ажил: admin-ий тайлбар, жагсаалт, хуулж буулгасан хүснэгт, үнийн жагсаалтаас платформын НИЙТЛЭГ лавлах өгөгдлийг цэгцэлж, нэмэх санал бэлдэх. Хамрах хүрээ:
- Нэгдсэн сан (CatalogItem): LABOR = засварын ажил (жиш. «Тосны шүүлтүүр солих»), GOODS = сэлбэг/бараа (жиш. «Моторын тос 5W-30 4л»). Бүх байгууллага эндээс өөрийн үйлчилгээгээ сонгоно.
- Системийн ангилал (serviceKey): үйлчлүүлэгч цаг захиалахдаа сонгох ажлын төрөл (жиш. «Тос солих», «Явах эд анги»).
- Сэлбэгийн ангилал (systemCategory): GOODS мөрийг бүлэглэх ангилал.
- Салбарын шошго (branchTag): салбарын онцлог (жиш. «24 цаг», «Ачааны машин»).

Ажлын дараалал:
1. Эхлээд list_reference_data дуудаж одоо байгаа зүйлийг хар.
2. Нэмэх мөр бүрийн хувьд search_catalog-оор давхардал шалга (ялангуяа ойролцоо нэртэй, өөр бичлэгтэй).
3. Хэрэгтэй бол эхлээд шинэ ангиллыг propose_named_records-оор, дараа нь мөрүүдийг propose_catalog_items-оор санал болго.
4. rejected гарвал шалтгааныг уншаад зас эсвэл admin-д тайлбарла.

Дүрэм:
- Чи өгөгдөл ШУУД БИЧИХГҮЙ. Санал зөвхөн admin «Хэрэгжүүлэх» дарсны дараа л бичигдэнэ — тиймээс «нэмчихлээ» гэж хэзээ ч бүү хэл; «санал болголоо» гэж хэл.
- Нэр монгол кириллээр, цэвэрхэн, нэг хэв маягаар (эхний үсэг том, илүү зай, цэггүй). Брэнд, загвар, OEM кодыг латинаар хэвээр үлдээ.
- Үнийг admin өгөөгүй бол бүү зохио — admin-аас асуу, эсвэл тодорхой «ойролцоо зах зээлийн үнэ» гэж тэмдэглээд зөвхөн admin зөвшөөрсөн бол санал болго.
- Код, баркодыг зохиож болохгүй — өгөгдөлд байгаа бол л ашигла.
- Тодорхойгүй, олон утгатай зүйл байвал таамаглахын оронд товч асуу.
- Admin-тай монголоор, товч ярь. Эцэст нь юу санал болгосон, юуг яагаад алгассаныг жагсаа.`;

// --- Ажиллуулах -------------------------------------------------------------

export type AgentTurn = { role: "user" | "assistant"; text: string };

export type DataAgentResult =
  | { ok: true; reply: string; proposals: DataProposal[]; usage: { input: number; output: number } }
  | { ok: false; message: string };

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  cachedClient ??= new Anthropic(); // ANTHROPIC_API_KEY env-ээс
  return cachedClient;
}

export function isDataAgentConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function describeDraft(draft: readonly DataProposal[]): string {
  if (draft.length === 0) return "";
  const lines = draft.slice(0, 200).map((p) =>
    p.kind === "catalogItem"
      ? `- [${PROPOSAL_KIND_LABEL[p.kind]} ${p.type}] ${p.name}${p.code ? ` (${p.code})` : ""} — ${p.price}₮/${p.unitName}`
      : `- [${PROPOSAL_KIND_LABEL[p.kind]}] ${p.name}`,
  );
  return `\n\n<pending_draft note="Admin хараахан хэрэгжүүлээгүй, өмнө нь санал болгосон зүйлс — дахин бүү санал болго">\n${lines.join("\n")}\n</pending_draft>`;
}

/**
 * Нэг ээлж ажиллуулна. `history` нь өмнөх ээлжүүдийн зөвхөн текст (thinking/tool
 * блокгүй) — тиймээс history-editing шалгалт хамаарахгүй; ээлж доторх tool
 * loop-ийг SDK-ийн tool runner блокуудыг өөрчлөлтгүй дамжуулж зохицуулна.
 */
export async function runDataAgentTurn(
  history: readonly AgentTurn[],
  userMessage: string,
  draft: readonly DataProposal[],
): Promise<DataAgentResult> {
  if (!isDataAgentConfigured()) return { ok: false, message: "ANTHROPIC_API_KEY тохируулаагүй байна." };

  const state: TurnState = {
    proposals: [],
    seenKeys: new Set(draft.map(proposalKey)),
    pendingCategoryNames: new Set(draft.filter((p) => p.kind === "systemCategory").map((p) => p.name.toLowerCase())),
  };

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.text })),
    { role: "user", content: userMessage + describeDraft(draft) },
  ];

  try {
    const runner = client().beta.messages.toolRunner({
      model: DATA_AGENT_MODEL,
      max_tokens: 16000,
      max_iterations: MAX_ITERATIONS,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      // Татгалзал (refusal) гарвал сервер талд өөр загвараар дахин ажиллуулна.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system: SYSTEM_PROMPT,
      tools: buildTools(state),
      messages,
    });

    let input = 0;
    let output = 0;
    let last: Anthropic.Beta.BetaMessage | null = null;
    for await (const message of runner) {
      last = message;
      input += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0);
      output += message.usage.output_tokens;
    }
    if (!last) return { ok: false, message: "Хариу ирсэнгүй." };

    const reply = last.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    let note = "";
    if (last.stop_reason === "refusal") note = "\n\n(Загвар энэ хүсэлтэд хариулахаас татгалзлаа.)";
    else if (last.stop_reason === "max_tokens") note = "\n\n(Хариу хэт урт болж тасарсан — жижиг хэсгээр дахин илгээнэ үү.)";
    else if (last.stop_reason === "tool_use") note = "\n\n(Алхмын дээд хязгаарт хүрлээ — «үргэлжлүүл» гэж бичнэ үү.)";

    return {
      ok: true,
      reply: (reply || "(Хариу текстгүй)") + note,
      proposals: state.proposals,
      usage: { input, output },
    };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      const key = process.env.ANTHROPIC_API_KEY ?? "";
      const hint = key.startsWith("sk-ant-api") ? "" : " Түлхүүр «sk-ant-api…»-аар эхлэх ёстой — хуулахдаа илүү тэмдэгт орсон эсэхийг шалгана уу.";
      console.error("[data-agent] auth error:", e.message);
      return { ok: false, message: `Anthropic API түлхүүр буруу байна (401).${hint}` };
    }
    if (e instanceof Anthropic.RateLimitError) return { ok: false, message: "Хүсэлтийн хязгаарт хүрлээ — түр хүлээгээд дахин оролдоно уу." };
    if (e instanceof Anthropic.APIError) {
      console.error("[data-agent] API error", e.status, e.message);
      return { ok: false, message: `Claude API алдаа (${e.status ?? "?"}).` };
    }
    console.error("[data-agent] failed", e);
    return { ok: false, message: "Туслахыг ажиллуулахад алдаа гарлаа." };
  }
}

// --- Хэрэгжүүлэх (admin баталсны дараа) -------------------------------------

export type ApplyResult = {
  created: number;
  skipped: { name: string; reason: string }[];
};

/**
 * Admin баталсан саналуудыг бичнэ. Дуудагч `requireSuperAdmin()` дуудсан байх
 * ёстой. Дараалал: ангилал/шошго эхлээд (GOODS мөр шинэ ангилалд холбогдох
 * боломжтой), дараа нь нэгдсэн сан. Бүх шалгалтыг server дээр ДАХИН хийнэ.
 */
export async function applyDataProposals(proposals: readonly DataProposal[], actorId: string): Promise<ApplyResult> {
  setBypassContext();
  let created = 0;
  const skipped: ApplyResult["skipped"] = [];

  const named = proposals.filter((p): p is NamedProposal => p.kind !== "catalogItem");
  const catalog = proposals.filter((p): p is CatalogProposal => p.kind === "catalogItem");

  for (const p of named) {
    const name = p.name.trim().replace(/\s+/g, " ");
    if (await namedRecordExists(p.kind, name)) {
      skipped.push({ name, reason: "Аль хэдийн байна." });
      continue;
    }
    try {
      if (p.kind === "serviceKey") {
        await prisma.systemServiceKey.create({ data: { name, description: p.description, createdById: actorId }, select: { id: true } });
      } else if (p.kind === "branchTag") {
        await prisma.branchTag.create({ data: { name, description: p.description, createdById: actorId }, select: { id: true } });
      } else {
        await prisma.category.create({
          data: { name, description: p.description, kind: "GOODS", tenantId: null, systemServiceKeyId: null },
          select: { id: true },
        });
      }
      created++;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        skipped.push({ name, reason: "Аль хэдийн байна." });
      } else {
        throw e;
      }
    }
  }

  if (catalog.length > 0) {
    const categories = {
      GOODS: await loadSystemCategories("GOODS"),
      LABOR: await loadSystemCategories("LABOR"),
    };
    for (const p of catalog) {
      const parsed = validateCatalog(p);
      if (!parsed.ok) {
        skipped.push({ name: p.name, reason: Object.values(parsed.errors).join(" ") });
        continue;
      }
      const outcome = await createCatalogItemAdmin(parsed.values, categories[parsed.values.type]);
      if (outcome.ok) created++;
      else if (outcome.reason === "exists") skipped.push({ name: p.name, reason: `Санд байна: ${outcome.existing.name}` });
      else skipped.push({ name: p.name, reason: "Сэлбэгийн ангилал олдсонгүй." });
    }
  }

  return { created, skipped };
}
