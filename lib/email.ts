import "server-only";

import nodemailer from "nodemailer";

/**
 * Имейл илгээх — infosystems.mn / macs.mn-тэй ижил тохиргоо: нэг no_reply SMTP
 * данс (smtp.mail.mn:465, SSL), nodemailer, хурдан timeout. Тохиргоо дутуу бол
 * илгээхгүй, `{ ok: false }` буцаана — дуудагч UI дээр «имейл тохируулаагүй»
 * гэж харуулна.
 *
 * Env:
 *   SMTP_HOST          - ж: smtp.mail.mn
 *   SMTP_PORT          - 465 (SSL) эсвэл 587 (STARTTLS); default 465
 *   SMTP_SECURE        - "true"/"false"; өгөөгүй бол port === 465
 *   SMTP_USER          - ж: no_reply@infosystems.mn
 *   SMTP_PASS          - нууц үг (хуучин нэр SMTP_PASSWORD мөн ажиллана)
 *   SMTP_FROM          - ж: "Carservice <no_reply@infosystems.mn>" (default: SMTP_USER)
 *   EMAIL_REDIRECT_TO  - (түр/тест) тохируулсан бол БҮХ имейл зөвхөн энэ хаяг руу
 *                        очно; жинхэнэ хүлээн авагч гарчиг/эхэнд бичигдэнэ.
 */

function smtpPass(): string | undefined {
  return process.env.SMTP_PASS || process.env.SMTP_PASSWORD || undefined;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && smtpPass());
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT) || 465;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: { user: process.env.SMTP_USER, pass: smtpPass() },
    // nodemailer-ийн default нь холболтод 2 мин, зогссон socket-д 10 мин хүлээдэг —
    // SMTP унасан үед хүсэлт гацахгүйн тулд хурдан бууна.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

/** Тест/түр горим: бүх имейлийг нэг хаяг руу чиглүүлнэ (жинхэнэ хүлээн авагчийг тэмдэглэнэ). */
export function applyEmailRedirect(input: { to: string; subject: string; text: string }): {
  to: string;
  subject: string;
  text: string;
} {
  const redirect = process.env.EMAIL_REDIRECT_TO?.trim();
  if (!redirect) return input;
  return {
    to: redirect,
    subject: `[→ ${input.to}] ${input.subject}`,
    text: `(Тест горим: жинхэнэ хүлээн авагч — ${input.to})\n\n${input.text}`,
  };
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isEmailConfigured()) {
    console.info(`[email] SMTP тохируулаагүй; "${input.subject}" → ${input.to} илгээгдсэнгүй`);
    return { ok: false, error: "Имейл (SMTP) тохируулаагүй байна." };
  }
  const msg = applyEmailRedirect(input);
  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
    });
    return { ok: true };
  } catch (e) {
    // SMTP алдаа сервер/хостын мэдээлэл агуулж болох тул зөвхөн лог руу.
    console.error("[email] илгээхэд алдаа:", e);
    return { ok: false, error: "Имейл илгээхэд алдаа гарлаа." };
  }
}
