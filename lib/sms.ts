/**
 * SMS илгээх. Үндсэн gateway — sendsms.mn; хуучин CallPro (messagepro.mn)
 * gateway-г нөөц болгон үлдээсэн (`SMS_PROVIDER=callpro`-оор буцааж асаана).
 *
 * Хэрэгтэй env:
 *   SMS_PROVIDER          - "sendsms" (default) | "callpro"
 *
 *   sendsms.mn:
 *   SEND_SMS_API_URL      - api endpoint (default: https://api.sendsms.mn/api/user/send;
 *                           хуучин `SENS_SMS_API_URL` нэрийг мөн уншина)
 *   SEND_SMS_API_KEY      - body-ийн "apiKey"
 *   SEND_SMS_API_TOKEN    - body-ийн "apiToken"
 *   SEND_SMS_MAX_LENGHT   - нэг мессежийн дээд урт (default: 159)
 *
 *   CallPro:
 *   CALL_PRO_URL          - api endpoint (default: https://api.messagepro.mn/send)
 *   CALL_PRO_API_KEY      - x-api-key header
 *   CALL_PRO_SPECIAL_KEY  - "from" параметр
 */

import type { OtpType } from "@/lib/auth/otp";

// CallPro gateway нь баталгаажаагүй линк агуулсан текстийг 400 алдаа болгож
// буцаадаг тул брэндийн ".mn" TLD-ийг хасаж энгийн нэрээр илгээнэ.
const SMS_BRAND = "Carservice";

const SUBJECT_BY_TYPE: Record<OtpType, string> = {
  SIGNUP: "Бүртгэл баталгаажуулах",
  CHANGE_PASSWORD: "Нууц үг солих",
  RESET_PASSWORD: "Нууц үг сэргээх",
  CONSUMER_LOGIN: "Нэвтрэх код",
  SET_PASSWORD: "Аккаунт идэвхжүүлэх",
  ACCOUNT_CLOSE: "Бүртгэл хаах код",
  ACCOUNT_PASSWORD: "Нууц үг тохируулах код",
};

function normalizePhone(phone: string): string {
  return phone.replace(/\D+/g, "");
}

/**
 * Дурын текст SMS илгээх ерөнхий функц — `SMS_PROVIDER`-оор gateway сонгоно.
 */
export async function sendSms(phone: string, text: string): Promise<boolean> {
  const provider = (process.env.SMS_PROVIDER ?? "sendsms").toLowerCase();
  return provider === "callpro"
    ? sendViaCallPro(phone, text)
    : sendViaSendSms(phone, text);
}

/**
 * sendsms.mn gateway — POST JSON { apiKey, apiToken, phone, message }.
 */
async function sendViaSendSms(phone: string, text: string): Promise<boolean> {
  const apiUrl =
    process.env.SEND_SMS_API_URL ??
    process.env.SENS_SMS_API_URL ??
    "https://api.sendsms.mn/api/user/send";
  const apiKey = process.env.SEND_SMS_API_KEY;
  const apiToken = process.env.SEND_SMS_API_TOKEN;
  if (!apiKey || !apiToken) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[sms] SEND_SMS тохиргоо дутуу — "${text}" -> ${phone} илгээхгүй.`);
    }
    return false;
  }

  const to = normalizePhone(phone);
  if (!to) return false;

  const maxLength = Number(process.env.SEND_SMS_MAX_LENGHT) || 159;
  let message = text;
  if (message.length > maxLength) {
    console.warn(
      `[sms] мессеж ${message.length} тэмдэгт (дээд ${maxLength}) — таслав.`,
    );
    message = message.slice(0, maxLength);
  }

  if (process.env.NODE_ENV !== "production") {
    console.debug(`[sms] Илгээх гэж байна (sendsms): ${message} -> ${to}`);
  }
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ apiKey, apiToken, phone: to, message }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`[sms] sendsms алдаа ${res.status}: ${body}`);
      return false;
    }
    // HTTP 200 ч body-д амжилтгүй гэж ирж болзошгүй тул шалгана.
    try {
      const json = JSON.parse(body) as Record<string, unknown> | null;
      if (json && (json.success === false || json.error)) {
        console.error(`[sms] sendsms амжилтгүй: ${body}`);
        return false;
      }
    } catch {
      // JSON биш хариу — HTTP 2xx тул амжилттай гэж үзнэ.
    }
    return true;
  } catch (e) {
    console.error("[sms] sendsms илгээхэд алдаа:", e);
    return false;
  }
}

/**
 * CallPro (messagepro.mn) gateway — хуучин үндсэн gateway, нөөц болгон үлдээв.
 */
async function sendViaCallPro(phone: string, text: string): Promise<boolean> {
  const apiUrl =
    process.env.CALL_PRO_URL ?? "https://api-text.callpro.mn/v1/sms/send";
  const apiKey = process.env.CALL_PRO_API_KEY ?? "10c2f933f9a9af1936b31c6ddcf59847";
  const from = process.env.CALL_PRO_SPECIAL_KEY ?? "72776399";
  if (!apiKey || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[sms] CALL_PRO тохиргоо дутуу — "${text}" -> ${phone} илгээхгүй.`);
    }
    return false;
  }

  const to = normalizePhone(phone);
  if (!to) return false;

  if (process.env.NODE_ENV !== "production") {
    console.debug(`[sms] Илгээх гэж байна (callpro): ${text} -> ${to}`);
  }
  const qs = new URLSearchParams({ from, to, text }).toString();
  try {
    const res = await fetch(`${apiUrl}?${qs}`, {
      method: "GET",
      headers: { "x-api-key": apiKey },
    });
    if (!res.ok) {
      console.error(`[sms] gateway алдаа ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[sms] илгээхэд алдаа:", e);
    return false;
  }
}

export async function sendOtpSms(
  code: string,
  type: OtpType,
  phone: string,
): Promise<boolean> {
  const subject = SUBJECT_BY_TYPE[type];
  return sendSms(phone, `${SMS_BRAND}, ${subject} код ${code}`);
}
