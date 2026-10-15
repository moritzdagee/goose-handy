import { describe, expect, it } from "vitest";
import { type TaggedSession, groupSessions, sessionProjectId } from "./sessions";

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
