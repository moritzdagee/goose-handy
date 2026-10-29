// Small building blocks of the Lovable design (Oktober 2026): app mark,
// status dot, connection badge, machine badge, pill, skeleton. Purely
// presentational, no state.
import type { ReactNode } from "react";

export function GooseMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center bg-accent font-bold text-accent-ink"
      style={{ width: size, height: size, borderRadius: size * 0.28, fontSize: size * 0.58, lineHeight: 1 }}
    >
      G
    </span>
  );
}

export type DotTone = "live" | "warn" | "danger" | "faint";
const DOT_TONE: Record<DotTone, string> = {
  live: "bg-live",
  warn: "bg-warn",
  danger: "bg-danger",
  faint: "bg-ink-faint",
};

export function Dot({ tone, pulse, size = 8 }: { tone: DotTone; pulse?: boolean; size?: number }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${DOT_TONE[tone]} ${pulse ? "animate-pulse" : ""}`}
      style={{ width: size, height: size }}
    />
  );
}

/** Mac Mini blue, MacBook teal, iPhone (direct) orange, anything else neutral. */
export function HostBadge({ name }: { name: string }) {
  const cls = /iphone/i.test(name)
    ? "bg-accent/15 text-accent"
    : /mini/i.test(name)
    ? "bg-mini/15 text-mini"
    : /book/i.test(name)
      ? "bg-book/15 text-book"
      : "bg-elevated text-ink-muted";
  return <span className={`host-badge shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-medium ${cls}`}>{name}</span>;
}

export function Pill({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "live" | "warn"; className?: string }) {
  const cls = {
    neutral: "bg-elevated text-ink-muted",
    live: "bg-live/15 text-live",
    warn: "bg-warn/15 text-warn",
  }[tone];
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium ${cls} ${className}`}>{children}</span>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-2xl bg-elevated ${className}`} />;
}

/** "gerade eben", "vor 5 Min.", "vor 3 Std.", "vor 3 Tagen". */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "gerade eben";
  if (secs < 3600) return `vor ${Math.floor(secs / 60)} Min.`;
  if (secs < 86400) return `vor ${Math.floor(secs / 3600)} Std.`;
  const days = Math.floor(secs / 86400);
  return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
}

/** Updated in the last 5 minutes. */
export function isLive(updatedAt: string | null | undefined): boolean {
  return !!updatedAt && Date.now() - new Date(updatedAt).getTime() < 5 * 60 * 1000;
}
