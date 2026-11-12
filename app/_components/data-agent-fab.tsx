"use client";

// Super admin-ий «AI туслах» — /system layout-д байрлах floating action button.
// Layout хуудас солигдоход unmount болдоггүй тул яриа/санал хадгалагдана;
// самбар хаагдсан үед ч state-ийг алдахгүйн тулд DOM-оос хасахгүй, нууна.

import { useEffect, useRef, useState, useTransition } from "react";
import { applyDataAgentProposalsAction, sendDataAgentMessageAction } from "@/app/_actions/system-data-agent";
import { useToast } from "@/app/_components/toast";
import type { AgentTurn, DataProposal } from "@/lib/ai/data-agent";

const KIND_LABEL: Record<DataProposal["kind"], string> = {
  catalogItem: "Нэгдсэн сан",
  serviceKey: "Системийн ангилал",
  systemCategory: "Сэлбэгийн ангилал",
  branchTag: "Салбарын шошго",
};

const EXAMPLES = [
  "Дараах ажлуудыг нэгдсэн санд нэмэх санал бэлд: тос солих 25000₮ 30 мин, тормозны колодк солих 40000₮ 1 цаг, дугуй тэнцвэржүүлэх 15000₮",
  "Сэлбэгийн ангилал ямар ямар байгааг харуулж, дутуу байгаа түгээмэл ангиллуудыг санал болго",
  "Энэ Excel-ээс хуулсан үнийн жагсаалтыг цэгцэлж GOODS болгож санал болго:\n",
];

const BTN_PRIMARY =
  "rounded-lg bg-[var(--oc-accent)] px-4 py-2 text-sm font-medium text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)] disabled:opacity-60";

function SparkIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  );
}

function proposalLine(p: DataProposal): { title: string; meta: string } {
  if (p.kind !== "catalogItem") return { title: p.name, meta: p.description ?? "" };
  const parts = [
    p.type === "LABOR" ? "Ажил" : "Сэлбэг",
    `${Number(p.price).toLocaleString()}₮ / ${p.unitName}`,
    p.code ? `код ${p.code}` : null,
    p.barcode ? `баркод ${p.barcode}` : null,
    p.category ? `ангилал: ${p.category}` : null,
    p.durationValue ? `${p.durationValue} ${p.durationUnitName ?? ""}` : null,
  ];
  return { title: p.name, meta: parts.filter(Boolean).join(" · ") };
}

export function DataAgentFab({ configured }: { configured: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"chat" | "draft">("chat");
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [draft, setDraft] = useState<DataProposal[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const [applying, startApply] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open && tab === "chat") bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns, sending, open, tab]);

  function openPanel() {
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function send() {
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    const history = turns;
    setTurns([...history, { role: "user", text }]);
    setInput("");
    startSend(async () => {
      const res = await sendDataAgentMessageAction(history, text, draft);
      if (!res.ok) {
        setError(res.message);
        setTurns(history); // илгээгээгүй мэт буцаана
        setInput(text);
        return;
      }
      setTurns([...history, { role: "user", text }, { role: "assistant", text: res.reply }]);
      if (res.proposals.length > 0) {
        setDraft((d) => [...d, ...res.proposals]);
        toast.info(`${res.proposals.length} шинэ санал нэмэгдлээ`);
      }
    });
  }

  function apply() {
    if (draft.length === 0 || applying) return;
    startApply(async () => {
      const res = await applyDataAgentProposalsAction(draft);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const { created, skipped } = res.result;
      setDraft([]);
      setTab("chat");
      const summary =
        `Хэрэгжүүллээ: ${created} бүртгэл үүслээ` +
        (skipped.length ? `, ${skipped.length} алгаслаа (${skipped.map((s) => `${s.name}: ${s.reason}`).join("; ")})` : "") +
        ".";
      setTurns((t) => [...t, { role: "assistant", text: summary }]);
      if (skipped.length) toast.warning(`${created} үүсч, ${skipped.length} алгаслаа`);
      else toast.success(`${created} бүртгэл үүслээ`);
    });
  }

  return (
    <>
      {/* Floating action button */}
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-label={open ? "AI туслахыг хаах" : "AI туслах нээх"}
        aria-expanded={open}
        className={`fixed bottom-5 right-5 z-[60] h-14 w-14 rounded-full bg-[var(--oc-accent)] text-[var(--oc-on-accent)] shadow-lg shadow-black/30 hover:bg-[var(--oc-accent-hi)] flex items-center justify-center transition-transform ${
          open ? "scale-0 pointer-events-none sm:scale-100 sm:pointer-events-auto" : ""
        }`}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <SparkIcon />
        )}
        {sending ? (
          <span className="absolute inset-0 rounded-full border-2 border-[var(--oc-on-accent)]/40 border-t-transparent animate-spin" />
        ) : null}
        {draft.length > 0 && !open ? (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-semibold flex items-center justify-center">
            {draft.length > 99 ? "99+" : draft.length}
          </span>
        ) : null}
      </button>

      {/* Самбар — хаагдсан ч DOM-д үлдэж state хадгална */}
      <section
        role="dialog"
        aria-label="AI туслах"
        aria-hidden={!open}
        className={`fixed z-[70] inset-x-0 bottom-0 top-12 sm:top-auto sm:inset-x-auto sm:right-5 sm:bottom-24 sm:w-[420px] sm:h-[min(680px,calc(100vh-8rem))] rounded-t-2xl sm:rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] shadow-2xl shadow-black/40 flex flex-col overflow-hidden transition-all duration-200 origin-bottom-right ${
          open ? "opacity-100 translate-y-0 sm:scale-100" : "opacity-0 translate-y-4 sm:scale-95 pointer-events-none invisible"
        }`}
      >
        {/* Толгой */}
        <header className="flex items-center gap-2 px-4 py-3 border-b border-[var(--oc-line)]">
          <span className="text-[var(--oc-accent)]">
            <SparkIcon size={18} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-[var(--oc-ink)]">AI туслах</h2>
            <p className="text-[11px] text-[var(--oc-muted)] truncate">Нэгдсэн сан, ангилал, шошго — «Хэрэгжүүлэх» хүртэл бичихгүй</p>
          </div>
          {turns.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setTurns([]);
                setError(null);
              }}
              disabled={sending}
              className="text-xs text-[var(--oc-muted)] hover:text-[var(--oc-ink)] px-1"
              title="Шинэ яриа (саналууд хэвээр үлдэнэ)"
            >
              Шинэ яриа
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Хаах"
            className="text-[var(--oc-muted)] hover:text-[var(--oc-ink)] p-1"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {!configured ? (
          <div className="p-5 text-sm text-[var(--oc-muted)]">
            Серверийн <code className="font-plex-mono">.env</code>-д <code className="font-plex-mono">ANTHROPIC_API_KEY</code>{" "}
            тохируулаад апп-аа дахин эхлүүлнэ үү.
          </div>
        ) : (
          <>
            {/* Таб */}
            <div className="flex border-b border-[var(--oc-line)] text-sm">
              {(
                [
                  ["chat", "Чат"],
                  ["draft", `Санал (${draft.length})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`flex-1 py-2 border-b-2 -mb-px ${
                    tab === key
                      ? "border-[var(--oc-accent)] text-[var(--oc-ink)] font-medium"
                      : "border-transparent text-[var(--oc-muted)] hover:text-[var(--oc-ink)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "chat" ? (
              <>
                <div className="flex-1 overflow-auto p-3 space-y-3">
                  {turns.length === 0 ? (
                    <div className="text-sm text-[var(--oc-muted)] space-y-2">
                      <p>Жишээ:</p>
                      {EXAMPLES.map((ex) => (
                        <button
                          key={ex}
                          type="button"
                          onClick={() => {
                            setInput(ex);
                            inputRef.current?.focus();
                          }}
                          className="block w-full text-left rounded-lg border border-[var(--oc-line)] px-3 py-2 text-[13px] hover:border-[var(--oc-accent)] whitespace-pre-line"
                        >
                          {ex.trim()}
                        </button>
                      ))}
                    </div>
                  ) : (
                    turns.map((t, i) => (
                      <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
                        <div
                          className={`max-w-[88%] rounded-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
                            t.role === "user"
                              ? "bg-[var(--oc-accent)] text-[var(--oc-on-accent)]"
                              : "border border-[var(--oc-line)] text-[var(--oc-ink)]"
                          }`}
                        >
                          {t.text}
                        </div>
                      </div>
                    ))
                  )}
                  {sending ? <p className="text-xs text-[var(--oc-muted)]">Claude шалгаж байна… (хэдэн секундээс минут орчим)</p> : null}
                  <div ref={bottomRef} />
                </div>

                <div className="border-t border-[var(--oc-line)] p-3">
                  {error ? <p className="mb-2 text-sm text-red-400 light:text-red-700">{error}</p> : null}
                  <div className="flex gap-2 items-end">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      rows={2}
                      maxLength={20000}
                      placeholder="Тайлбар эсвэл хүснэгтээ буулгана уу… (Ctrl+Enter)"
                      className="auth-input w-full resize-none min-h-[56px] max-h-40 text-[13px]"
                    />
                    <button type="button" onClick={send} disabled={sending || !input.trim()} className={BTN_PRIMARY}>
                      {sending ? "…" : "Илгээх"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <ul className="flex-1 overflow-auto divide-y divide-[var(--oc-line)]">
                  {draft.length === 0 ? (
                    <li className="px-4 py-6 text-sm text-[var(--oc-muted)]">Одоогоор санал алга. Чатаар юу нэмэхээ бичнэ үү.</li>
                  ) : (
                    draft.map((p, i) => {
                      const { title, meta } = proposalLine(p);
                      return (
                        <li key={i} className="px-4 py-2.5 flex gap-2 items-start">
                          <div className="flex-1 min-w-0">
                            <div className="font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)]">
                              {KIND_LABEL[p.kind]}
                            </div>
                            <div className="text-sm text-[var(--oc-ink)] break-words">{title}</div>
                            {meta ? <div className="text-xs text-[var(--oc-muted)] break-words">{meta}</div> : null}
                          </div>
                          <button
                            type="button"
                            aria-label="Хасах"
                            onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                            disabled={applying}
                            className="text-[var(--oc-muted)] hover:text-red-400 px-1"
                          >
                            ×
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
                <div className="border-t border-[var(--oc-line)] p-3 flex gap-2">
                  {draft.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setDraft([])}
                      disabled={applying}
                      className="rounded-lg border border-[var(--oc-line)] px-3 py-2 text-sm text-[var(--oc-muted)] hover:text-[var(--oc-ink)]"
                    >
                      Цуцлах
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={apply}
                    disabled={applying || sending || draft.length === 0}
                    className={`flex-1 ${BTN_PRIMARY}`}
                  >
                    {applying ? "Бичиж байна…" : `Хэрэгжүүлэх (${draft.length})`}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </section>
    </>
  );
}
