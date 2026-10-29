import { PublicUpstreamError } from "@/lib/action-errors";
import { normalizeRegno, regnoKind } from "@/lib/tenant-regno";
/**
 * api.ebarimt.mn-аас аж ахуйн нэгжийн мэдээллийг 2 алхамаар авна:
 *   1) /api/info/check/getTinInfo?regNo=XXXXXXX  → татвар төлөгчийн дугаар (TIN)
 *      (байгууллага: 7 оронтой тоо, хувь хүн: ҮҮ99993333 — хоёуланд нь ажиллана)
 *   2) /api/info/check/getInfo?tin={TIN}         → нэр болон бусад мэдээлэл
 *
 * Env:
 *   EBARIMT_BASE_URL — анхдагч https://api.ebarimt.mn
 */

export type EbarimtOrg = {
  found: boolean;
  tin: string | null;
  name: string | null;
  vatPayer: boolean | null;
  cityPayer: boolean | null;
  isGovernment: boolean | null;
  vatpayerRegisteredDate: string | null;
};

function baseUrl(): string {
  return process.env.EBARIMT_BASE_URL ?? "https://api.ebarimt.mn";
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new PublicUpstreamError(`ebarimt алдаа: ${res.status}`);
  }
  return res.json();
}

/**
 * Регистрээс TIN (татвар төлөгчийн дугаар) авна. Олдохгүй бол null.
 * Хариу `data` нь тоо эсвэл текстээр ирэх боломжтой — string-р нормализна.
 */
async function getTinByRegno(regno: string): Promise<string | null> {
  const url = `${baseUrl()}/api/info/check/getTinInfo?regNo=${encodeURIComponent(regno)}`;
  const raw = (await fetchJson(url)) as { data?: unknown } | null;
  const data = raw?.data;
  if (typeof data === "string") return data.trim() || null;
  if (typeof data === "number" && Number.isFinite(data)) return String(data);
  return null;
}

/**
 * TIN-ээс байгууллагын мэдээлэл авна.
 */
async function getInfoByTin(
  tin: string,
): Promise<Record<string, unknown> | null> {
  const url = `${baseUrl()}/api/info/check/getInfo?tin=${encodeURIComponent(tin)}`;
  const raw = (await fetchJson(url)) as { data?: unknown } | null;
  if (!raw?.data || typeof raw.data !== "object") return null;
  return raw.data as Record<string, unknown>;
}

const EMPTY: EbarimtOrg = {
  found: false,
  tin: null,
  name: null,
  vatPayer: null,
  cityPayer: null,
  isGovernment: null,
  vatpayerRegisteredDate: null,
};

export async function lookupOrgByRegno(regno: string): Promise<EbarimtOrg> {
  const clean = normalizeRegno(regno);
  if (!regnoKind(clean)) return EMPTY;

  const tin = await getTinByRegno(clean);
  if (!tin) return EMPTY;

  const info = await getInfoByTin(tin);
  if (!info) return { ...EMPTY, tin };

  const nameRaw = typeof info.name === "string" ? info.name.trim() : "";
  const found =
    typeof info.found === "boolean"
      ? info.found && nameRaw !== ""
      : nameRaw !== "" && nameRaw !== "0";

  return {
    found,
    tin,
    name: found ? nameRaw : null,
    vatPayer: typeof info.vatPayer === "boolean" ? info.vatPayer : null,
    cityPayer: typeof info.cityPayer === "boolean" ? info.cityPayer : null,
    isGovernment:
      typeof info.isGovernment === "boolean" ? info.isGovernment : null,
    vatpayerRegisteredDate:
      typeof info.vatpayerRegisteredDate === "string"
        ? info.vatpayerRegisteredDate
        : null,
  };
}
