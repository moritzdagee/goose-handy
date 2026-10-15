// Session tagging and project grouping for the consolidated multi-host list.
import type { SessionInfo } from "@agentclientprotocol/sdk";

// A session tagged with the host it lives on. Session ids are only unique
// per host, so every lookup carries (_host, sessionId).
export type TaggedSession = SessionInfo & { _host: string };

// Folder every chat started on the phone lives in, inside the machine's share
// folder (sent as _meta.hostSubdir on session/new). The desktop app groups its
// sidebar by folder, so these chats get their own collapsible section there.
export const PHONE_FOLDER = "Vom iPhone gestartet";

export function isPhoneStarted(s: { cwd?: string | null }): boolean {
  const parts = (s.cwd ?? "").replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] === PHONE_FOLDER;
}

export function sessionProjectId(s: SessionInfo): string | null {
  const meta = (s as { _meta?: Record<string, unknown> })._meta;
  const pid = meta?.["projectId"] ?? meta?.["project_id"];
  return typeof pid === "string" && pid ? pid : null;
}

// Which machine's chats to show: "all" or one endpoint id. Kept per device.
export type HostFilter = "all" | string;
export const HOST_FILTER_KEY = "goose-handy-host-filter";

export function loadHostFilter(): HostFilter {
  try {
    return localStorage.getItem(HOST_FILTER_KEY) || "all";
  } catch {
    return "all";
  }
}

export function saveHostFilter(f: HostFilter): void {
  try {
    localStorage.setItem(HOST_FILTER_KEY, f);
  } catch {
    // best effort
  }
}

export function filterByHost<T extends { _host: string }>(sessions: T[], filter: HostFilter): T[] {
  return filter === "all" ? sessions : sessions.filter((s) => s._host === filter);
}

// New per-host lists merged into what is on screen. A host whose list could
// not be fetched (null) keeps its previous entries instead of vanishing: a
// slow answer after the phone wakes up must not empty the sidebar.
export function mergeHostLists(
  prev: TaggedSession[],
  fresh: Map<string, TaggedSession[] | null>,
): TaggedSession[] {
  const out: TaggedSession[] = [];
  const seen = new Set<string>();
  for (const [host, list] of fresh) {
    seen.add(host);
    out.push(...(list ?? prev.filter((s) => s._host === host)));
  }
  out.push(...prev.filter((s) => !seen.has(s._host)));
  return out;
}

// Bucket sessions under their project (server order — most recent first —
// preserved within each bucket). Projectless sessions form a global "chats"
// group that leads (recency matters most), then the phone-started chats,
// then projects sorted alphabetically. Every group folds, including "chats".
// Project titles are looked up per host — slugs are only unique per machine.
export type SessionGroup = { key: string; label: string | null; sessions: TaggedSession[] };

export function groupSessions(
  sessions: TaggedSession[],
  projects: Record<string, string>,
): SessionGroup[] {
  const loose: TaggedSession[] = [];
  const phone: TaggedSession[] = [];
  const byProject = new Map<string, TaggedSession[]>();
  for (const s of sessions) {
    const pid = sessionProjectId(s);
    if (!pid) {
      (isPhoneStarted(s) ? phone : loose).push(s);
    } else {
      const key = `${s._host}:${pid}`;
      const g = byProject.get(key);
      if (g) g.push(s);
      else byProject.set(key, [s]);
    }
  }
  const out: SessionGroup[] = [];
  if (loose.length) out.push({ key: "~", label: "chats", sessions: loose });
  if (phone.length) out.push({ key: "~phone", label: PHONE_FOLDER, sessions: phone });
  const named = [...byProject.entries()].map(([key, group]) => ({
    key,
    label: projects[key] ?? key.split(":").slice(1).join(":"),
    sessions: group,
  }));
  named.sort((a, b) => a.label.localeCompare(b.label));
  out.push(...named);
  return out;
}
