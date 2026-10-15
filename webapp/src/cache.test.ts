import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHATS_KEPT,
  CHAT_INDEX_KEY,
  CHAT_ITEMS_KEPT,
  CHAT_TEXT_MAX,
  SESSIONS_CACHE_KEY,
  cacheableItems,
  loadChat,
  loadSessions,
  saveChat,
  saveSessions,
} from "./cache";
import type { TaggedSession } from "./sessions";

beforeEach(() => localStorage.clear());

describe("cacheableItems", () => {
  it("nimmt Nachrichten, Hinweise, Werkzeuge und Plan, aber keine Rueckfragen", () => {
    const out = cacheableItems([
      { kind: "msg", id: 1, role: "user", text: "hallo" },
      { kind: "system", id: 2, text: "Neuer Chat" },
      { kind: "tool", id: 3, toolCallId: "t1", title: "ls", status: "success", output: "a\nb" },
      { kind: "plan", id: 4, entries: [{ content: "x", status: "pending" }] },
      { kind: "perm", id: 5, title: "rm", options: [], chosen: null, resolve: () => {} },
    ]);
    expect(out.map((x) => x.kind)).toEqual(["msg", "system", "tool", "plan"]);
    expect(out[0]).toEqual({ kind: "msg", role: "user", text: "hallo" });
    expect(JSON.stringify(out)).not.toContain('"id"');
  });

  it("kuerzt lange Texte und behaelt nur das Ende des Chats", () => {
    const long = "x".repeat(CHAT_TEXT_MAX + 50);
    const many = Array.from({ length: CHAT_ITEMS_KEPT + 10 }, (_, i) => ({
      kind: "msg",
      role: "agent",
      text: i === CHAT_ITEMS_KEPT + 9 ? long : `m${i}`,
    }));
    const out = cacheableItems(many);
    expect(out).toHaveLength(CHAT_ITEMS_KEPT);
    expect((out[0] as { text: string }).text).toBe("m10");
    expect((out[out.length - 1] as { text: string }).text).toHaveLength(CHAT_TEXT_MAX + 1);
  });
});

describe("Chat-Liste", () => {
  it("speichert nur die noetigen Felder und liest sie wieder", () => {
    saveSessions([
      { sessionId: "s1", cwd: "/w", title: "T", updatedAt: "2026-10-15T10:00:00Z", _host: "mini", _meta: { projectId: "p" }, extra: "weg" } as unknown as TaggedSession,
    ]);
    const back = loadSessions();
    expect(back).toEqual([
      { sessionId: "s1", cwd: "/w", title: "T", updatedAt: "2026-10-15T10:00:00Z", _host: "mini", _meta: { projectId: "p" } },
    ]);
  });

  it("kaputter oder fremder Inhalt ergibt eine leere Liste", () => {
    localStorage.setItem(SESSIONS_CACHE_KEY, "{kaputt");
    expect(loadSessions()).toEqual([]);
    localStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify([{ foo: 1 }, { sessionId: "a", _host: "h" }]));
    expect(loadSessions().map((s) => s.sessionId)).toEqual(["a"]);
  });
});

describe("Chat-Verlaeufe", () => {
  it("speichert pro Rechner und Chat getrennt", () => {
    saveChat("mini", "1", [{ kind: "system", text: "mini" }]);
    saveChat("book", "1", [{ kind: "system", text: "book" }]);
    expect(loadChat("mini", "1")).toEqual([{ kind: "system", text: "mini" }]);
    expect(loadChat("book", "1")).toEqual([{ kind: "system", text: "book" }]);
    expect(loadChat("mini", "2")).toBeNull();
  });

  it("behaelt nur die zuletzt geoeffneten Chats", () => {
    for (let i = 0; i < CHATS_KEPT + 3; i++) saveChat("h", `c${i}`, [{ kind: "system", text: `${i}` }]);
    expect(loadChat("h", "c0")).toBeNull();
    expect(loadChat("h", "c2")).toBeNull();
    expect(loadChat("h", "c3")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(CHAT_INDEX_KEY) as string)).toHaveLength(CHATS_KEPT);
  });

  it("erneut geoeffneter Chat rueckt nach vorn und bleibt erhalten", () => {
    saveChat("h", "alt", [{ kind: "system", text: "a" }]);
    for (let i = 0; i < CHATS_KEPT - 1; i++) saveChat("h", `c${i}`, []);
    saveChat("h", "alt", [{ kind: "system", text: "a2" }]);
    saveChat("h", "neu", []);
    expect(loadChat("h", "alt")).toEqual([{ kind: "system", text: "a2" }]);
    expect(loadChat("h", "c0")).toBeNull();
  });

  it("Speicher voll: aelteste Chats weichen, der neue wird gespeichert", () => {
    saveChat("h", "a", [{ kind: "system", text: "a" }]);
    saveChat("h", "b", [{ kind: "system", text: "b" }]);
    const real = localStorage.setItem.bind(localStorage);
    let fails = 1;
    vi.spyOn(localStorage, "setItem").mockImplementation((k: string, v: string) => {
      if (k.endsWith("|c") && fails-- > 0) throw new DOMException("voll", "QuotaExceededError");
      real(k, v);
    });
    saveChat("h", "c", [{ kind: "system", text: "c" }]);
    expect(loadChat("h", "c")).toEqual([{ kind: "system", text: "c" }]);
    expect(loadChat("h", "a")).toBeNull();
    expect(loadChat("h", "b")).not.toBeNull();
  });
});
