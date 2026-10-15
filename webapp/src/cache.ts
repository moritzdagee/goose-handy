// What the phone remembers between launches and while a machine is out of
// reach: the chat list and the tail of recently opened chats. iOS throws the
// page away often (screen lock, app switch); without this every return started
// from an empty screen and the chat list flickered in host by host.
//
// localStorage only: a few hundred KB at most, read synchronously at start, so
// the first frame already shows the list. Anything unreadable is ignored.
import type { TaggedSession } from "./sessions";

export const SESSIONS_CACHE_KEY = "goose-handy-sessions-v1";
export const CHAT_CACHE_PREFIX = "goose-handy-chat-v1:";
export const CHAT_INDEX_KEY = "goose-handy-chat-index-v1";

// Kept per chat: the last items, each text capped. Chats kept: the most
// recently opened ones.
export const CHAT_ITEMS_KEPT = 60;
export const CHAT_TEXT_MAX = 8000;
export const CHATS_KEPT = 15;

// The serializable part of a chat item. Permission prompts carry a live
// callback and are never stored.
export type CachedItem =
  | { kind: "msg"; role: "user" | "agent" | "thought"; text: string }
  | { kind: "system"; text: string }
  | { kind: "tool"; toolCallId: string; title: string; status: string; output: string }
  | { kind: "plan"; entries: unknown[] };

function cap(text: string): string {
  return text.length > CHAT_TEXT_MAX ? `${text.slice(0, CHAT_TEXT_MAX)}…` : text;
}

export function cacheableItems(items: ReadonlyArray<{ kind: string } & Record<string, unknown>>): CachedItem[] {
  const out: CachedItem[] = [];
  for (const it of items) {
    switch (it.kind) {
      case "msg":
        out.push({ kind: "msg", role: it.role as "user" | "agent" | "thought", text: cap(String(it.text ?? "")) });
        break;
      case "system":
        out.push({ kind: "system", text: String(it.text ?? "") });
        break;
      case "tool":
        out.push({
          kind: "tool",
          toolCallId: String(it.toolCallId ?? ""),
          title: String(it.title ?? ""),
          status: String(it.status ?? ""),
          // Tool output is long and rarely read on the phone; the reload has it.
          output: cap(String(it.output ?? "")).slice(0, 1500),
        });
        break;
      case "plan":
        out.push({ kind: "plan", entries: (it.entries as unknown[]) ?? [] });
        break;
    }
  }
  return out.slice(-CHAT_ITEMS_KEPT);
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// Only the fields the lists need; _meta keeps the project id.
export function saveSessions(sessions: TaggedSession[]): void {
  const slim = sessions.map((s) => ({
    sessionId: s.sessionId,
    cwd: s.cwd,
    title: s.title ?? null,
    updatedAt: s.updatedAt ?? null,
    _host: s._host,
    ...((s as { _meta?: unknown })._meta ? { _meta: (s as { _meta?: unknown })._meta } : {}),
  }));
  writeJson(SESSIONS_CACHE_KEY, slim);
}

export function loadSessions(): TaggedSession[] {
  const list = readJson<TaggedSession[]>(SESSIONS_CACHE_KEY);
  if (!Array.isArray(list)) return [];
  return list.filter((s) => s && typeof s.sessionId === "string" && typeof s._host === "string");
}

function chatKey(host: string, sessionId: string): string {
  return `${CHAT_CACHE_PREFIX}${host}|${sessionId}`;
}

export function loadChat(host: string, sessionId: string): CachedItem[] | null {
  const items = readJson<CachedItem[]>(chatKey(host, sessionId));
  return Array.isArray(items) ? items : null;
}

// Store a chat and move it to the front of the index; chats beyond CHATS_KEPT
// are dropped. When storage is full, the oldest chats go until it fits.
export function saveChat(host: string, sessionId: string, items: CachedItem[]): void {
  const key = chatKey(host, sessionId);
  let index = (readJson<string[]>(CHAT_INDEX_KEY) ?? []).filter((k) => k !== key);
  index.unshift(key);
  for (const old of index.slice(CHATS_KEPT)) localStorage.removeItem(old);
  index = index.slice(0, CHATS_KEPT);
  while (!writeJson(key, items) && index.length > 1) {
    const victim = index.pop() as string;
    localStorage.removeItem(victim);
  }
  writeJson(CHAT_INDEX_KEY, index);
}
