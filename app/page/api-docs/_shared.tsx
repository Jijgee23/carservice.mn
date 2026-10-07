import type { ReactNode } from "react";
import { Chip, TagChip } from "@/app/_components/landing-ops-ui";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Auth = "public" | "bearer";

export const METHOD_TONE: Record<Method, "ok" | "accent" | "danger" | "warn"> = {
  GET: "ok",
  POST: "accent",
  PUT: "warn",
  PATCH: "warn",
  DELETE: "danger",
};

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-[var(--oc-ink)] mb-3">{title}</h2>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

export function Code({ children }: { children: string }) {
  return (
    <pre className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-carbon)] p-4 overflow-x-auto">
      <code className="font-plex-mono text-[12.5px] leading-relaxed text-[var(--oc-ink2)] whitespace-pre">
        {children}
      </code>
    </pre>
  );
}

export function Endpoint({
  method,
  path,
  auth,
  bearerLabel = "Bearer (Account)",
  tags,
  title,
  children,
}: {
  method: Method;
  path: string;
  auth: Auth;
  bearerLabel?: string;
  tags?: string[];
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
      <div className="flex items-center gap-2 flex-wrap">
        <Chip tone={METHOD_TONE[method]} bordered>
          {method}
        </Chip>
        <code className="font-plex-mono text-[13px] text-[var(--oc-ink)]">{path}</code>
        <TagChip>{auth === "bearer" ? bearerLabel : "Public"}</TagChip>
        {tags?.map((tag) => <TagChip key={tag}>{tag}</TagChip>)}
      </div>
      <p className="mt-2.5 text-sm text-[var(--oc-muted)]">{title}</p>
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </div>
  );
}
