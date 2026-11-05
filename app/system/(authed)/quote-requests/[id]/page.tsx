import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/system";
import { isEmailConfigured } from "@/lib/email";
import { MODULE_LIMIT_CODES, PLAN_LIMIT_META } from "@/lib/plan-limits";
import { formatPhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_QUOTE_REPLY_SUBJECT,
  QUOTE_CHANNEL_LABEL,
  QUOTE_STATUS_LABEL,
  defaultQuoteReplyMessage,
} from "@/lib/quote-requests";
import { QUOTE_STATUS_BADGE, fmtDateTime } from "../shared";
import { QuoteReplyForm } from "./reply-form";
import { QuoteStatusForm } from "./status-form";

export const metadata = { title: "Үнийн саналын хүсэлт" };

export const dynamic = "force-dynamic";

export default async function SystemQuoteRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSuperAdmin();
  const { id } = await params;

  const req = await prisma.quoteRequest.findUnique({
    where: { id },
    include: {
      tenant: { select: { id: true, name: true, plan: true } },
      replies: {
        orderBy: { createdAt: "desc" },
        include: { sentBy: { select: { firstName: true, lastName: true } } },
      },
    },
  });
  if (!req) notFound();

  const chosen = MODULE_LIMIT_CODES.filter((c) => req.modules.includes(c));

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto w-full">
      <Link href="/system/quote-requests" className="text-sm text-[var(--oc-muted3)] hover:text-[var(--oc-muted)]">
        ← Үнийн саналын хүсэлт рүү буцах
      </Link>

      <div className="rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6 mt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[var(--oc-ink)]">{req.orgName}</h1>
            <div className="mt-0.5 text-xs text-[var(--oc-muted3)] tabular-nums">{fmtDateTime(req.createdAt)}</div>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${QUOTE_STATUS_BADGE[req.status]}`}>
            {QUOTE_STATUS_LABEL[req.status]}
          </span>
        </div>

        <dl className="mt-5 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-[var(--oc-muted3)]">Холбогдох хүн</dt>
          <dd className="text-[var(--oc-ink2)]">{req.contactName}</dd>
          <dt className="text-[var(--oc-muted3)]">Утас</dt>
          <dd className="font-plex-mono text-[var(--oc-ink2)]">
            <a href={`tel:${req.phone}`} className="hover:underline">
              {formatPhone(req.phone)}
            </a>
          </dd>
          <dt className="text-[var(--oc-muted3)]">Имейл</dt>
          <dd className="text-[var(--oc-ink2)] break-all">
            {req.email ? (
              <a href={`mailto:${req.email}`} className="hover:underline">
                {req.email}
              </a>
            ) : (
              "—"
            )}
          </dd>
          <dt className="text-[var(--oc-muted3)]">Салбарын тоо</dt>
          <dd className="text-[var(--oc-ink2)]">{req.branchCount ?? "—"}</dd>
          <dt className="text-[var(--oc-muted3)]">Бүртгэл</dt>
          <dd className="text-[var(--oc-ink2)]">
            {req.tenant ? (
              <Link href={`/system/tenants/${req.tenant.id}`} className="text-[var(--oc-accent)] hover:underline">
                {req.tenant.name} ({req.tenant.plan}) — subscription үүсгэх →
              </Link>
            ) : (
              "Бүртгэлгүй (нүүр хуудаснаас)"
            )}
          </dd>
        </dl>

        <div className="mt-5">
          <div className="text-xs text-[var(--oc-muted3)] mb-2">Сонгосон модуль ({chosen.length})</div>
          <ul className="flex flex-wrap gap-1.5">
            {chosen.map((c) => (
              <li
                key={c}
                className="rounded-md border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-2 py-1 text-xs text-[var(--oc-ink2)]"
              >
                {PLAN_LIMIT_META[c].label}
              </li>
            ))}
          </ul>
        </div>

        {req.message ? (
          <p className="mt-5 whitespace-pre-wrap rounded-xl border border-[var(--oc-line2)] bg-[var(--oc-panel2)] p-4 text-sm text-[var(--oc-ink2)]">
            {req.message}
          </p>
        ) : null}

        <QuoteReplyForm
          id={req.id}
          hasEmail={Boolean(req.email)}
          emailConfigured={isEmailConfigured()}
          defaultSubject={DEFAULT_QUOTE_REPLY_SUBJECT}
          defaultBody={defaultQuoteReplyMessage(req.contactName)}
        />

        {req.replies.length > 0 ? (
          <div className="mt-6 border-t border-[var(--oc-line2)] pt-5">
            <div className="text-xs text-[var(--oc-muted3)] mb-2">Илгээсэн хариу</div>
            <ul className="flex flex-col gap-2">
              {req.replies.map((r) => (
                <li key={r.id} className="rounded-lg border border-[var(--oc-line2)] p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--oc-muted3)]">
                    <span className="font-medium text-[var(--oc-ink2)]">{QUOTE_CHANNEL_LABEL[r.channel]}</span>
                    <span>→ {r.recipient}</span>
                    <span className="tabular-nums">{fmtDateTime(r.createdAt)}</span>
                    {r.sentBy ? (
                      <span>
                        · {r.sentBy.lastName} {r.sentBy.firstName}
                      </span>
                    ) : null}
                    <span className={r.ok ? "text-[var(--oc-ok)]" : "text-red-400 light:text-red-700"}>
                      {r.ok ? "✓ илгээгдсэн" : `✗ ${r.error ?? "амжилтгүй"}`}
                    </span>
                  </div>
                  {r.subject ? <div className="mt-1 text-[var(--oc-ink2)]">{r.subject}</div> : null}
                  <p className="mt-1 whitespace-pre-wrap text-[var(--oc-muted)]">{r.body}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <QuoteStatusForm id={req.id} status={req.status} adminNote={req.adminNote ?? ""} />
      </div>
    </div>
  );
}
