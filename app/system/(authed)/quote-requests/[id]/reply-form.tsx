"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { replyQuoteRequestAction, type QuoteAdminActionState } from "@/app/_actions/quote-requests";
import { useToast } from "@/app/_components/toast";

// lib/sms.ts-ийн анхдагч дээд урт (SEND_SMS_MAX_LENGHT) — давбал SMS таслагдана.
const SMS_MAX = 159;

export function QuoteReplyForm({
  id,
  hasEmail,
  emailConfigured,
  defaultSubject,
  defaultBody,
}: {
  id: string;
  hasEmail: boolean;
  emailConfigured: boolean;
  defaultSubject: string;
  defaultBody: string;
}) {
  const toast = useToast();
  const [state, formAction, pending] = useActionState<QuoteAdminActionState, FormData>(
    replyQuoteRequestAction,
    null,
  );
  const handled = useRef<QuoteAdminActionState>(null);
  const emailAvailable = hasEmail && emailConfigured;
  const [sms, setSms] = useState(true);
  const [email, setEmail] = useState(emailAvailable);
  const [body, setBody] = useState(defaultBody);
  const [subject, setSubject] = useState(defaultSubject);

  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (state.ok) toast.success(state.message ?? "Илгээгдлээ.");
    else toast.error(state.message ?? "Алдаа гарлаа.");
  }, [state, toast]);

  const emailHint = !hasEmail ? "хүсэлтэд имейл алга" : !emailConfigured ? "SMTP тохируулаагүй" : null;

  return (
    <form
      id="reply"
      action={formAction}
      className="mt-6 flex flex-col gap-3 border-t border-[var(--oc-line2)] pt-5 scroll-mt-20"
    >
      <input type="hidden" name="id" value={id} />
      <div className="text-sm font-semibold text-[var(--oc-ink)]">Хариу илгээх</div>

      <div className="flex flex-wrap gap-4 text-sm text-[var(--oc-muted)]">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            name="channels"
            value="SMS"
            checked={sms}
            onChange={(e) => setSms(e.target.checked)}
            className="accent-[var(--oc-accent)]"
          />
          SMS
        </label>
        <label className={`inline-flex items-center gap-2 ${emailAvailable ? "cursor-pointer" : "opacity-50"}`}>
          <input
            type="checkbox"
            name="channels"
            value="EMAIL"
            checked={email}
            disabled={!emailAvailable}
            onChange={(e) => setEmail(e.target.checked)}
            className="accent-[var(--oc-accent)]"
          />
          Имейл
          {emailHint ? <span className="text-[11px] text-[var(--oc-muted3)]">({emailHint})</span> : null}
        </label>
      </div>

      {email ? (
        <label className="text-xs text-[var(--oc-muted)]">
          Имейлийн гарчиг
          <input
            name="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={150}
            className="auth-input mt-1 w-full"
          />
        </label>
      ) : null}

      <label className="text-xs text-[var(--oc-muted)]">
        Мессеж
        <textarea
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          rows={4}
          maxLength={2000}
          className="auth-input mt-1 w-full resize-none"
        />
        {sms ? (
          <span
            className={`mt-1 block text-right tabular-nums ${body.length > SMS_MAX ? "text-[var(--oc-warn)]" : "text-[var(--oc-muted3)]"}`}
          >
            {body.length}/{SMS_MAX}
            {body.length > SMS_MAX ? " — SMS-д таслагдана" : ""}
          </span>
        ) : null}
      </label>

      <button
        type="submit"
        disabled={pending || (!sms && !email)}
        className="self-end rounded-lg bg-[var(--oc-accent)] px-4 py-2 text-sm font-medium text-[var(--oc-on-accent)] transition-colors hover:bg-[var(--oc-accent-hi)] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {pending ? "Илгээж байна..." : "Илгээх"}
      </button>
    </form>
  );
}
