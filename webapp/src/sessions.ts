// Session tagging and project grouping for the consolidated multi-host list.
import type { SessionInfo } from "@agentclientprotocol/sdk";

// A session tagged with the host it lives on. Session ids are only unique
// per host, so every lookup carries (_host, sessionId).
export type TaggedSession = SessionInfo & { _host: string };

// Folder every chat started on the phone lives in, inside the machine's share
// folder (sent as _meta.hostSubdir on session/new). The desktop app groups its
// sidebar by folder, so these chats get their own collapsible section there.
export const PHONE_FOLDER = "Vom iPhone gestartet";

// Name the phone app sends as _meta.client on session/new. goose stores a chat
// opened by a named client as an ordinary "user" chat; without it the chat is
// typed "acp", and the desktop app leaves acp chats out of its sidebar, so the
// "Vom iPhone gestartet" section never showed up there (17.10.2026).
export const PHONE_CLIENT = "goose-handy";

export function newSessionMeta(): { hostSubdir: string; client: string } {
  return { hostSubdir: PHONE_FOLDER, client: PHONE_CLIENT };
}

// Chats, die das iPhone selbst fuehrt (Direkt-Chat mit Mistral, 29.10.2026).
// In den Listen stehen sie wie ein weiterer "Rechner" mit dieser Kennung.
export const IPHONE_HOST = "iphone";
export const IPHONE_GROUP = "Auf dem iPhone";

/** Zusatz eines Direkt-Chats fuer die Listen (Klon-Herkunft, wartende Fragen). */
export type DirektInfo = { herkunft: string | null; wartet: number };

export function isDirekt(s: { _host: string }): boolean {
  return s._host === IPHONE_HOST;
}

// Chats vom Android-Tablet (App Moose beta, 29.10.2026): das Tablet ist kein
// Gastgeber, sie kommen als Kopie aus der Wissensdatenbank (nur lesen, dann
// auf das iPhone klonen). In den Listen wie ein weiterer "Rechner".
export const TABLET_HOST = "tablet";
export const TABLET_GROUP = "Vom Tablet";

export function isTablet(s: { _host: string }): boolean {
  return s._host === TABLET_HOST;
}

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

// "Aktiv | Archiviert | Alle": goose lists archived chats too (with
// _meta.archivedAt); without this second filter the list grows endlessly.
// Kept per device, starts on "active".
export type ArchiveFilter = "active" | "archived" | "all";
export const ARCHIVE_FILTER_KEY = "goose-handy-archive-filter";

export function isArchived(s: { _meta?: unknown }): boolean {
  const meta = s._meta as Record<string, unknown> | null | undefined;
  return typeof meta?.archivedAt === "string" && meta.archivedAt !== "";
}

export function filterByArchive<T extends { _meta?: unknown }>(sessions: T[], filter: ArchiveFilter): T[] {
  if (filter === "all") return sessions;
  return sessions.filter((s) => isArchived(s) === (filter === "archived"));
}

export function loadArchiveFilter(): ArchiveFilter {
  try {
    const v = localStorage.getItem(ARCHIVE_FILTER_KEY);
    return v === "archived" || v === "all" ? v : "active";
  } catch {
    return "active";
  }
}

export function saveArchiveFilter(f: ArchiveFilter): void {
  try {
    localStorage.setItem(ARCHIVE_FILTER_KEY, f);
  } catch {
    // best effort
  }
}

// goose answers session/list in pages (50 on the MacBook, archived chats
// included) with a nextCursor. Reading only the first page hid every chat
// behind the 50 newest (18.10.2026). All pages are read, each with its own
// deadline, so one slow page fails the whole list instead of showing half.
export const MAX_LIST_PAGES = 40;

export async function listAllSessions(
  list: (cursor?: string) => Promise<{ sessions?: SessionInfo[] | null; nextCursor?: string | null }>,
): Promise<SessionInfo[]> {
  const all: SessionInfo[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const res = await list(cursor);
    all.push(...(res.sessions ?? []));
    const next = res.nextCursor ?? undefined;
    if (!next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  return all;
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
  const iphone: TaggedSession[] = [];
  const tablet: TaggedSession[] = [];
  const byProject = new Map<string, TaggedSession[]>();
  for (const s of sessions) {
    const pid = sessionProjectId(s);
    if (isDirekt(s)) {
      iphone.push(s);
    } else if (isTablet(s)) {
      tablet.push(s);
    } else if (!pid) {
      (isPhoneStarted(s) ? phone : loose).push(s);
    } else {
      const key = `${s._host}:${pid}`;
      const g = byProject.get(key);
      if (g) g.push(s);
      else byProject.set(key, [s]);
    }
  }
  const out: SessionGroup[] = [];
  if (iphone.length) out.push({ key: "~iphone", label: IPHONE_GROUP, sessions: iphone });
  if (tablet.length) out.push({ key: "~tablet", label: TABLET_GROUP, sessions: tablet });
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
