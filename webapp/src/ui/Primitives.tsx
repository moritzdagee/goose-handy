// Small building blocks of the Lovable design (Oktober 2026): app mark,
// status dot, connection badge, machine badge, pill, skeleton. Purely
// presentational, no state.
import type { ReactNode } from "react";

export function GooseMark({ size = 32 }: { size?: number }) {
  // Weisse Gans auf lila Grund, wie das App-Icon (public/icon-quadrat.svg).
  const d =
    "M4.6 15.2c2.4-.9 4.1-2.6 5.3-5.1.6-1.3 1.5-2.2 2.6-2.6-.3 1.5-1 2.9-2 4.1 1.5-.2 3-.9 4.3-2.1-.6 1.8-1.9 3.3-3.6 4.2 2 .1 3.9-.4 5.5-1.4-1.3 2.4-3.7 4.1-6.5 4.6 1.2 1 2.7 1.6 4.3 1.8-2.1 1.5-4.7 2-7.3 1.6l-1.9 3.4c-.2.4-.8.4-1 0l-1.6-2.9c-.3-.6-.2-1.3.3-1.8Z";
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className="shrink-0"
      style={{ borderRadius: size * 0.28 }}
    >
      <rect width="24" height="24" rx="6.7" fill="#5C2CB4" />
      <path d={d} fill="#fff" />
    </svg>
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
