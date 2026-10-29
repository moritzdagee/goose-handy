// Chat log entries in the Lovable design (Oktober 2026). Class names
// (.msg.user, .msg.agent .body, .tool, .plan, .perm .perm-actions, ...) are
// the ones tests and the Playwright scripts look for; keep them.
import { useEffect, useState } from "react";
import { ArrowRight, Check, ChevronRight, Lock, Square } from "lucide-react";
import type { PlanEntry } from "@agentclientprotocol/sdk";
import MarkdownContent from "@desktop/components/MarkdownContent";
import type { ToolCallStatus } from "@desktop/components/ToolCallStatusIndicator";
import type { PermOption } from "../items";
import { Dot, type DotTone } from "./Primitives";

export function SystemLine({ text }: { text: string }) {
  const error = /^(Fehler|Konnte|Nachschieben ging nicht)/.test(text);
  return (
    <div className={`msg system self-center px-2 text-center text-[13px] ${error ? "text-danger" : "text-ink-faint"}`}>
      {text}
    </div>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="msg user flex w-full justify-end">
      <div className="body w-fit max-w-[85%] min-w-0 rounded-[20px] rounded-br-md bg-accent px-4 py-2.5 text-[16px] leading-snug whitespace-pre-wrap text-accent-ink [overflow-wrap:anywhere]">
        {text}
      </div>
    </div>
  );
}

export function AgentMessage({ text }: { text: string }) {
  return (
    <div className="msg agent goose-message flex w-full min-w-0 justify-start">
      <div className="body min-w-0 flex-1 leading-relaxed">
        <MarkdownContent content={text} />
      </div>
    </div>
  );
}

export function ThoughtBlock({ text }: { text: string }) {
  return (
    <details className="msg thought group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[14px] text-ink-faint select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight size={15} aria-hidden className="transition-transform duration-150 group-open:rotate-90" />
        Gedanken
      </summary>
      <div className="body border-l-2 border-line pl-3 text-[15px] leading-relaxed whitespace-pre-wrap text-ink-muted italic">
        {text}
      </div>
    </details>
  );
}

const TOOL_DOT: Record<ToolCallStatus, { tone: DotTone; label: string }> = {
  pending: { tone: "faint", label: "wartet" },
  loading: { tone: "warn", label: "laeuft" },
  success: { tone: "live", label: "fertig" },
  error: { tone: "danger", label: "Fehler" },
};

export function ToolRow({ title, status, output }: { title: string; status: ToolCallStatus; output: string }) {
  const [open, setOpen] = useState(false);
  const d = TOOL_DOT[status] ?? TOOL_DOT.pending;
  return (
    <div className="tool w-full overflow-hidden rounded-xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Werkzeug ${title}, ${d.label}, Ausgabe ${open ? "zuklappen" : "zeigen"}`}
        className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left"
      >
        <Dot tone={d.tone} pulse={status === "loading"} />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink-muted">{title}</span>
        <ChevronRight size={16} aria-hidden className={`shrink-0 text-ink-faint transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <pre className="fade-in max-h-80 overflow-auto border-t border-line px-3 py-2 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap text-ink-muted">
          {output || "noch keine Ausgabe"}
        </pre>
      )}
    </div>
  );
}

export function PlanCard({ entries }: { entries: PlanEntry[] }) {
  return (
    <div className="plan rounded-xl border border-line bg-surface p-4">
      <div className="mb-2 text-[13px] font-semibold tracking-wider text-ink-faint uppercase">Plan</div>
      <ul className="flex flex-col gap-2">
        {entries.map((e, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[15px]">
            <span className="mt-0.5 shrink-0">
              {e.status === "completed" ? (
                <Check size={16} className="text-live" aria-label="erledigt" />
              ) : e.status === "in_progress" ? (
                <ArrowRight size={16} className="text-accent" aria-label="laeuft" />
              ) : (
                <Square size={16} className="text-ink-faint" aria-label="offen" />
              )}
            </span>
            <span
              className={
                e.status === "completed"
                  ? "text-ink-faint line-through"
                  : e.status === "in_progress"
                    ? "font-medium text-ink"
                    : "text-ink-muted"
              }
            >
              {e.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PermCard({
  title,
  options,
  chosen,
  onChoose,
}: {
  title: string;
  options: PermOption[];
  chosen: string | null;
  onChoose: (o: PermOption) => void;
}) {
  if (chosen) {
    return <div className="perm text-[14px] text-ink-muted">→ {chosen}</div>;
  }
  const firstAllow = options.find((o) => o.kind.startsWith("allow"))?.optionId;
  return (
    <div role="alertdialog" aria-label={`${title} braucht deine Freigabe`} className="perm rounded-2xl border border-warn/40 bg-warn/10 p-4">
      <div className="flex items-start gap-2 text-[15px] text-ink">
        <Lock size={18} aria-hidden className="mt-0.5 shrink-0 text-warn" />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <span className="font-mono font-semibold">{title}</span> braucht deine Freigabe
        </span>
      </div>
      <div className="perm-actions mt-3 flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.optionId}
            type="button"
            className={`min-h-11 rounded-xl px-4 text-[15px] font-medium active:opacity-80 ${
              o.kind.startsWith("allow") ? "primary" : ""
            } ${o.optionId === firstAllow ? "bg-warn text-accent-ink" : "bg-elevated text-ink"}`}
            onClick={() => onChoose(o)}
          >
            {o.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// Ticking elapsed readout for the working indicator ("12s", "1m 04s").
function LiveElapsed({ startedAt }: { startedAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const label = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
  return (
    <span className="font-mono text-[13px] text-ink-faint tabular-nums" id="turn-elapsed">
      {label}
    </span>
  );
}

export function WorkingIndicator({
  steerable,
  startedAt,
  cancelling,
  onStop,
}: {
  steerable: boolean;
  startedAt: number | null;
  cancelling: boolean;
  onStop: () => void;
}) {
  return (
    <div role="status" className="msg system flex w-full items-center gap-2.5 rounded-xl bg-surface px-3 py-1.5">
      <Dot tone="warn" pulse />
      <span className="min-w-0 flex-1 text-[14px] text-ink-muted">
        {steerable ? "Goose arbeitet, du kannst nachschieben" : "Goose arbeitet…"}
      </span>
      {startedAt && <LiveElapsed startedAt={startedAt} />}
      {startedAt && (
        <button
          id="stop-turn"
          type="button"
          disabled={cancelling}
          onClick={onStop}
          aria-label={cancelling ? "Wird gestoppt" : "Goose stoppen"}
          className="min-h-10 rounded-lg px-3 text-[14px] font-semibold text-danger active:bg-elevated disabled:opacity-60"
        >
          {cancelling ? "stoppe…" : "Stopp"}
        </button>
      )}
    </div>
  );
}

export function RefreshingHint() {
  return (
    <div id="chat-refreshing" role="status" className="msg system flex items-center gap-1.5 self-center rounded-full bg-elevated px-3 py-1 text-[12px] text-ink-muted">
      <Dot tone="warn" pulse size={6} /> aktualisiere…
    </div>
  );
}
