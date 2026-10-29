import { describe, expect, it } from "vitest";
import {
  type TaggedSession,
  HOST_FILTER_KEY,
  PHONE_FOLDER,
  PHONE_CLIENT,
  newSessionMeta,
  filterByHost,
  groupSessions,
  isPhoneStarted,
  loadHostFilter,
  ARCHIVE_FILTER_KEY,
  filterByArchive,
  isArchived,
  listAllSessions,
  loadArchiveFilter,
  saveArchiveFilter,
  mergeHostLists,
  saveHostFilter,
  sessionProjectId,
} from "./sessions";

const s = (id: string, host: string, meta?: Record<string, unknown>): TaggedSession =>
  ({ sessionId: id, cwd: "/", _host: host, ...(meta ? { _meta: meta } : {}) }) as TaggedSession;

describe("sessionProjectId", () => {
  it("liest projectId und project_id", () => {
    expect(sessionProjectId(s("1", "h", { projectId: "p1" }))).toBe("p1");
    expect(sessionProjectId(s("1", "h", { project_id: "p2" }))).toBe("p2");
  });

  it("null ohne Projekt, bei leerem Text oder falschem Typ", () => {
    expect(sessionProjectId(s("1", "h"))).toBeNull();
    expect(sessionProjectId(s("1", "h", { projectId: "" }))).toBeNull();
    expect(sessionProjectId(s("1", "h", { projectId: 7 }))).toBeNull();
  });
});

describe("groupSessions", () => {
  it("lose Chats zuerst als 'chats', dann Projekte alphabetisch", () => {
    const groups = groupSessions(
      [
        s("a", "mini", { projectId: "zeta" }),
        s("b", "mini"),
        s("c", "mini", { projectId: "alpha" }),
        s("d", "book"),
      ],
      { "mini:zeta": "Zeta Projekt", "mini:alpha": "Alpha Projekt" },
    );
    expect(groups.map((g) => g.label)).toEqual(["chats", "Alpha Projekt", "Zeta Projekt"]);
    expect(groups[0]).toMatchObject({ key: "~" });
    expect(groups[0].sessions.map((x) => x.sessionId)).toEqual(["b", "d"]);
  });

  it("gleiches Projekt-Kuerzel auf zwei Rechnern bleibt getrennt", () => {
    const groups = groupSessions(
      [s("1", "mini", { projectId: "web" }), s("2", "book", { projectId: "web" })],
      { "mini:web": "Web (Mini)", "book:web": "Web (Book)" },
    );
    expect(groups.map((g) => [g.key, g.sessions.map((x) => x.sessionId)])).toEqual([
      ["book:web", ["2"]],
      ["mini:web", ["1"]],
    ]);
  });

  it("Reihenfolge innerhalb einer Gruppe bleibt wie vom Rechner geliefert", () => {
    const groups = groupSessions(
      [s("neu", "h", { projectId: "p" }), s("mittel", "h", { projectId: "p" }), s("alt", "h", { projectId: "p" })],
      {},
    );
    expect(groups[0].sessions.map((x) => x.sessionId)).toEqual(["neu", "mittel", "alt"]);
  });

  it("ohne Projekttitel wird das Kuerzel gezeigt, auch mit Doppelpunkt darin", () => {
    const groups = groupSessions([s("1", "h", { projectId: "kunde:2026" })], {});
    expect(groups[0]).toMatchObject({ key: "h:kunde:2026", label: "kunde:2026" });
  });

  it("keine Chats: keine Gruppen", () => {
    expect(groupSessions([], {})).toEqual([]);
  });
});

describe("Handy-Rubrik und Rechner-Filter", () => {
  const at = (id: string, host: string, cwd: string): TaggedSession =>
    ({ sessionId: id, cwd, _host: host }) as TaggedSession;

  it("erkennt Chats im Ordner 'Vom iPhone gestartet', auch mit Schraegstrich am Ende", () => {
    expect(isPhoneStarted({ cwd: `/Users/m/${PHONE_FOLDER}` })).toBe(true);
    expect(isPhoneStarted({ cwd: `/home/m/werkstatt/${PHONE_FOLDER}/` })).toBe(true);
    expect(isPhoneStarted({ cwd: "/Users/m" })).toBe(false);
    expect(isPhoneStarted({ cwd: `/Users/m/${PHONE_FOLDER}/unter` })).toBe(false);
    expect(isPhoneStarted({})).toBe(false);
  });

  it("Handy-Chats bilden eine eigene Gruppe direkt nach 'chats'", () => {
    const groups = groupSessions(
      [
        at("a", "mini", `/w/${PHONE_FOLDER}`),
        at("b", "mini", "/w"),
        { ...at("c", "mini", "/w"), _meta: { projectId: "p" } } as TaggedSession,
        at("d", "book", `/Users/m/${PHONE_FOLDER}`),
      ],
      { "mini:p": "Projekt" },
    );
    expect(groups.map((g) => g.label)).toEqual(["chats", PHONE_FOLDER, "Projekt"]);
    expect(groups[1].sessions.map((x) => x.sessionId)).toEqual(["a", "d"]);
  });

  it("filterByHost zeigt alle oder nur einen Rechner", () => {
    const list = [at("1", "mini", "/"), at("2", "book", "/"), at("3", "mini", "/")];
    expect(filterByHost(list, "all")).toHaveLength(3);
    expect(filterByHost(list, "mini").map((x) => x.sessionId)).toEqual(["1", "3"]);
    expect(filterByHost(list, "unbekannt")).toEqual([]);
  });

  it("Filter wird auf dem Geraet gemerkt, Standard ist 'all'", () => {
    localStorage.removeItem(HOST_FILTER_KEY);
    expect(loadHostFilter()).toBe("all");
    saveHostFilter("book");
    expect(loadHostFilter()).toBe("book");
  });

  it("mergeHostLists: ein Rechner ohne Antwort behaelt seine alten Chats", () => {
    const prev = [at("alt-mini", "mini", "/"), at("alt-book", "book", "/")];
    const fresh = new Map<string, TaggedSession[] | null>([
      ["mini", [at("neu-mini", "mini", "/")]],
      ["book", null],
    ]);
    expect(mergeHostLists(prev, fresh).map((x) => x.sessionId)).toEqual(["neu-mini", "alt-book"]);
  });

  it("mergeHostLists: Rechner, die gerade nicht verbunden sind, bleiben sichtbar", () => {
    const prev = [at("x", "book", "/")];
    const fresh = new Map<string, TaggedSession[] | null>([["mini", [at("y", "mini", "/")]]]);
    expect(mergeHostLists(prev, fresh).map((x) => x.sessionId)).toEqual(["y", "x"]);
  });
});

describe("newSessionMeta", () => {
  it("asks for the phone folder and names the client, so the desktop app lists the chat", () => {
    expect(newSessionMeta()).toEqual({ hostSubdir: PHONE_FOLDER, client: PHONE_CLIENT });
    expect(PHONE_CLIENT.trim()).not.toBe("");
  });
});

describe("Archiv-Filter", () => {
  const s = (id: string, archivedAt?: string | null) =>
    ({ sessionId: id, _host: "h", _meta: archivedAt === undefined ? {} : { archivedAt } }) as never;

  it("erkennt archivierte Chats am Zeitstempel von goose", () => {
    expect(isArchived(s("a", "2026-10-17T16:10:00Z"))).toBe(true);
    expect(isArchived(s("b"))).toBe(false);
    expect(isArchived(s("c", null))).toBe(false);
    expect(isArchived(s("d", ""))).toBe(false);
    expect(isArchived({ sessionId: "e" } as never)).toBe(false);
  });

  it("zeigt aktiv, archiviert oder alle", () => {
    const list = [s("a", "2026-10-17T16:10:00Z"), s("b"), s("c")];
    const ids = (xs: { sessionId: string }[]) => xs.map((x) => x.sessionId);
    expect(ids(filterByArchive(list, "active"))).toEqual(["b", "c"]);
    expect(ids(filterByArchive(list, "archived"))).toEqual(["a"]);
    expect(ids(filterByArchive(list, "all"))).toEqual(["a", "b", "c"]);
  });

  it("merkt sich die Wahl und startet auf aktiv", () => {
    localStorage.removeItem(ARCHIVE_FILTER_KEY);
    expect(loadArchiveFilter()).toBe("active");
    saveArchiveFilter("archived");
    expect(loadArchiveFilter()).toBe("archived");
    localStorage.setItem(ARCHIVE_FILTER_KEY, "quatsch");
    expect(loadArchiveFilter()).toBe("active");
  });
});

describe("listAllSessions", () => {
  const page = (ids: string[], nextCursor?: string) => ({
    sessions: ids.map((id) => ({ sessionId: id, cwd: "/" })) as never,
    nextCursor,
  });

  it("liest alle Seiten, nicht nur die ersten 50", async () => {
    const pages: Record<string, ReturnType<typeof page>> = {
      "": page(["a", "b"], "p2"),
      p2: page(["c"], "p3"),
      p3: page(["d"]),
    };
    const asked: (string | undefined)[] = [];
    const all = await listAllSessions(async (cursor) => {
      asked.push(cursor);
      return pages[cursor ?? ""];
    });
    expect(all.map((s) => s.sessionId)).toEqual(["a", "b", "c", "d"]);
    expect(asked).toEqual([undefined, "p2", "p3"]);
  });

  it("haengt nicht, wenn der Rechner denselben Zeiger wiederholt", async () => {
    let calls = 0;
    const all = await listAllSessions(async () => {
      calls++;
      return page(["x"], "immer");
    });
    expect(calls).toBe(2);
    expect(all).toHaveLength(2);
  });

  it("gibt einen Fehler weiter, damit die alte Liste stehen bleibt", async () => {
    await expect(
      listAllSessions(async (cursor) => {
        if (cursor) throw new Error("keine Antwort");
        return page(["a"], "p2");
      }),
    ).rejects.toThrow("keine Antwort");
  });
});

describe("Direkt-Chats in den Gruppen", () => {
  it("stehen als eigene Gruppe 'Auf dem iPhone' ganz oben", async () => {
    const { groupSessions, IPHONE_HOST } = await import("./sessions");
    const groups = groupSessions(
      [
        { sessionId: "a", cwd: "/x", _host: "mini" } as never,
        { sessionId: "d", cwd: "", _host: IPHONE_HOST } as never,
      ],
      {},
    );
    expect(groups.map((g) => g.label)).toEqual(["Auf dem iPhone", "chats"]);
    expect(groups[0].sessions.map((s) => s.sessionId)).toEqual(["d"]);
  });
});

describe("Tablet-Chats (Kopie aus der Datenbank) in den Gruppen", () => {
  it("eigene Gruppe 'Vom Tablet' nach dem iPhone, vor den Rechner-Chats", async () => {
    const { groupSessions, IPHONE_HOST, TABLET_HOST, isTablet, isDirekt, filterByHost } = await import("./sessions");
    const alle = [
      { sessionId: "a", cwd: "/x", _host: "mini" } as never,
      { sessionId: "7", cwd: "", _host: TABLET_HOST } as never,
      { sessionId: "d", cwd: "", _host: IPHONE_HOST } as never,
    ];
    const groups = groupSessions(alle, {});
    expect(groups.map((g) => g.label)).toEqual(["Auf dem iPhone", "Vom Tablet", "chats"]);
    expect(groups[1].sessions.map((s) => s.sessionId)).toEqual(["7"]);
    expect(isTablet({ _host: TABLET_HOST })).toBe(true);
    expect(isDirekt({ _host: TABLET_HOST })).toBe(false);
    expect(filterByHost(alle as { _host: string }[], TABLET_HOST)).toHaveLength(1);
  });
});
