import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StartPage } from "./StartPage";
import type { TaggedSession } from "./sessions";

const NOW = new Date("2026-10-15T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const sess = (id: string, host: string, title: string | null, updatedAt: string | null): TaggedSession =>
  ({ sessionId: id, cwd: "/", _host: host, title, updatedAt }) as TaggedSession;

const MINI = { endpointId: "mini-id", label: "Mac Mini" };
const BOOK = { endpointId: "book-id", label: "MacBook" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function setup(props: Partial<Parameters<typeof StartPage>[0]> = {}) {
  const onNew = vi.fn();
  const onOpen = vi.fn();
  render(<StartPage hosts={[MINI, BOOK]} sessions={[]} creating={false} onNew={onNew} onOpen={onOpen} {...props} />);
  return { onNew, onOpen };
}

const recentTitles = () =>
  [...document.querySelectorAll(".recent-chat")].map((el) => el.querySelector("div")!.textContent);

describe("StartPage", () => {
  it("zeigt 'Verbinde…' statt leerer Knoepfe, solange kein Rechner verbunden ist", () => {
    setup({ hosts: [] });
    expect(document.getElementById("start-connecting")?.textContent).toContain("Verbinde");
    expect(document.querySelectorAll(".new-chat-btn")).toHaveLength(0);
  });

  it("blendet 'Verbinde…' aus, sobald ein Rechner da ist", () => {
    setup({ hosts: [MINI] });
    expect(document.getElementById("start-connecting")).toBeNull();
  });

  it("je verbundenem Rechner ein Knopf 'Neuer Chat', der den richtigen Rechner meldet", () => {
    const { onNew } = setup();
    fireEvent.click(screen.getByText("Neuer Chat auf MacBook"));
    fireEvent.click(screen.getByText("Neuer Chat auf Mac Mini"));
    expect(onNew.mock.calls).toEqual([["book-id"], ["mini-id"]]);
    expect(document.getElementById("new-on-mac-mini")).not.toBeNull();
  });

  it("waehrend ein Chat angelegt wird: Knoepfe gesperrt und Hinweis sichtbar", () => {
    const { onNew } = setup({ creating: true });
    const btn = screen.getByText("Neuer Chat auf Mac Mini").closest("button")!;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onNew).not.toHaveBeenCalled();
    expect(screen.getByText("Chat wird angelegt…")).toBeTruthy();
  });

  it("ohne Chats: 'noch keine'", () => {
    setup();
    expect(screen.getByText("noch keine")).toBeTruthy();
  });

  it("letzte Chats neueste zuerst, Chats ohne Datum ans Ende", () => {
    setup({
      sessions: [
        sess("1", "mini-id", "alt", minsAgo(600)),
        sess("2", "book-id", "ohne Datum", null),
        sess("3", "mini-id", "neu", minsAgo(1)),
      ],
    });
    expect(recentTitles()).toEqual(["neu", "alt", "ohne Datum"]);
  });

  it("zeigt hoechstens 40 Chats", () => {
    const many = Array.from({ length: 45 }, (_, i) => sess(String(i), "mini-id", `Chat ${i}`, minsAgo(i)));
    setup({ sessions: many });
    expect(document.querySelectorAll(".recent-chat")).toHaveLength(40);
    expect(recentTitles()[0]).toBe("Chat 0");
  });

  it("Zeitangaben auf Deutsch", () => {
    setup({
      sessions: [
        sess("a", "mini-id", "A", minsAgo(0.5)),
        sess("b", "mini-id", "B", minsAgo(5)),
        sess("c", "mini-id", "C", minsAgo(180)),
        sess("d", "mini-id", "D", minsAgo(3 * 1440)),
      ],
    });
    const text = document.getElementById("start-page")!.textContent!;
    for (const t of ["gerade eben", "vor 5 Min.", "vor 3 Std.", "vor 3 Tagen"]) expect(text).toContain(t);
  });

  it("Rechnername nur bei zwei Rechnern, unbekannter Rechner als Kurzkennung", () => {
    setup({ sessions: [sess("1", "mini-id", "X", minsAgo(1)), sess("2", "abcdef123456", "Y", minsAgo(2))] });
    const text = document.getElementById("start-page")!.textContent!;
    expect(text).toContain("· Mac Mini");
    expect(text).toContain("· abcdef");
    cleanup();
    setup({ hosts: [MINI], sessions: [sess("1", "mini-id", "X", minsAgo(1))] });
    expect(document.getElementById("start-page")!.textContent).not.toContain("· Mac Mini");
  });

  it("Klick auf einen Chat oeffnet genau diesen, ohne Titel steht '(ohne Titel)'", () => {
    const target = sess("7", "book-id", null, minsAgo(1));
    const { onOpen } = setup({ sessions: [target] });
    fireEvent.click(screen.getByText("(ohne Titel)"));
    expect(onOpen).toHaveBeenCalledWith(target);
  });

  describe("Rechner-Filter", () => {
    const list = [
      sess("m1", "mini-id", "Mini eins", minsAgo(1)),
      sess("b1", "book-id", "Book eins", minsAgo(2)),
      { ...sess("p1", "book-id", "Vom Handy", minsAgo(3)), cwd: "/Users/m/Vom iPhone gestartet" } as TaggedSession,
    ];

    it("Alle, Mac Mini, MacBook mit Anzahl; Auswahl meldet den Rechner", () => {
      const onFilter = vi.fn();
      setup({ sessions: list, filterChoices: [MINI, BOOK], onFilter });
      const tabs = [...document.querySelectorAll(".host-filter [role=tab]")].map((t) => t.textContent);
      expect(tabs).toEqual(["Alle 3", "Mac Mini 1", "MacBook 2"]);
      fireEvent.click(document.querySelector('[data-filter="book-id"]')!);
      expect(onFilter).toHaveBeenCalledWith("book-id");
    });

    it("gefiltert erscheinen nur Chats des gewaehlten Rechners, ohne Rechner-Zusatz", () => {
      setup({ sessions: list, filterChoices: [MINI, BOOK], filter: "mini-id" });
      expect(recentTitles()).toEqual(["Mini eins"]);
      expect(document.querySelector(".recent-chat")!.textContent).not.toContain("Mac Mini");
    });

    it("Chats eines gerade nicht verbundenen Rechners tragen trotzdem seinen Namen", () => {
      setup({ hosts: [MINI], sessions: list, filterChoices: [MINI, BOOK] });
      const rows = [...document.querySelectorAll(".recent-chat")].map((el) => el.textContent);
      expect(rows[1]).toContain("MacBook");
    });

    it("vom iPhone gestartete Chats sind markiert", () => {
      setup({ sessions: list, filterChoices: [MINI, BOOK] });
      const rows = [...document.querySelectorAll(".recent-chat")].map((el) => el.textContent);
      expect(rows[2]).toContain("vom iPhone");
      expect(rows[0]).not.toContain("vom iPhone");
    });

    it("nur ein Rechner bekannt: keine Filter-Leiste", () => {
      setup({ hosts: [MINI], sessions: list, filterChoices: [MINI] });
      expect(document.querySelector(".host-filter")).toBeNull();
    });
  });
});

describe("StartPage Archiv-Filter", () => {
  const archived = (id: string, host: string, title: string) =>
    ({ ...sess(id, host, title, minsAgo(5)), _meta: { archivedAt: minsAgo(1) } }) as TaggedSession;

  it("zeigt standardmaessig nur aktive Chats, Zahlen je Reiter", () => {
    setup({ sessions: [sess("1", "mini-id", "Offen", minsAgo(2)), archived("2", "mini-id", "Alt")] });
    expect(recentTitles()).toEqual(["Offen"]);
    const tabs = [...document.querySelectorAll(".archive-filter [role=tab]")].map((t) => t.textContent);
    expect(tabs).toEqual(["Aktiv 1", "Archiviert 1", "Alle 2"]);
  });

  it("zeigt archivierte Chats, wenn so gewaehlt, und meldet die Wahl", () => {
    const onArchiveFilter = vi.fn();
    setup({
      sessions: [sess("1", "mini-id", "Offen", minsAgo(2)), archived("2", "mini-id", "Alt")],
      archiveFilter: "archived",
      onArchiveFilter,
    });
    expect(recentTitles()).toEqual(["Alt"]);
    fireEvent.click(document.querySelector('.archive-filter [data-filter="all"]')!);
    expect(onArchiveFilter).toHaveBeenCalledWith("all");
  });

  it("zaehlt nur Chats des gewaehlten Rechners", () => {
    setup({
      sessions: [sess("1", "mini-id", "Mini", minsAgo(2)), archived("2", "book-id", "Book alt")],
      filterChoices: [MINI, BOOK],
      filter: "mini-id",
    });
    const tabs = [...document.querySelectorAll(".archive-filter [role=tab]")].map((t) => t.textContent);
    expect(tabs).toEqual(["Aktiv 1", "Archiviert 0", "Alle 1"]);
  });
});

describe("StartPage mit Direkt-Chat auf dem iPhone", () => {
  const IPHONE = { endpointId: "iphone", label: "iPhone" };
  const direkt = (id: string, title: string, extra: Record<string, unknown> = {}) =>
    ({ sessionId: id, cwd: "", _host: "iphone", title, updatedAt: minsAgo(1), _meta: {}, ...extra }) as unknown as TaggedSession;

  it("erster Knopf 'hier auf dem iPhone', auch ohne verbundenen Rechner", () => {
    const onNewDirekt = vi.fn();
    setup({ hosts: [], onNewDirekt, direktHinweis: "Einmal den Mistral-Schluessel eintragen." });
    fireEvent.click(document.getElementById("new-on-iphone")!);
    expect(onNewDirekt).toHaveBeenCalled();
    expect(document.getElementById("direkt-hinweis")!.textContent).toContain("Mistral");
    expect(document.getElementById("start-connecting")).not.toBeNull();
    expect(document.querySelectorAll(".new-chat-btn")).toHaveLength(0);
  });

  it("Chips iPhone, Mac Mini, MacBook mit Anzahl; iPhone-Chats tragen Abzeichen, Klon und 'wartet'", () => {
    const sessions = [
      direkt("d1", "Direkt eins", { _direkt: { herkunft: "Klon vom Mac Mini", wartet: 1 } }),
      sess("1", "mini-id", "Mini eins", minsAgo(5)),
      sess("2", "book-id", "Book eins", minsAgo(6)),
    ];
    setup({ sessions, filterChoices: [IPHONE, MINI, BOOK], onNewDirekt: () => {} });
    const tabs = [...document.querySelectorAll(".host-filter [role=tab]")].map((t) => t.textContent);
    expect(tabs).toEqual(["Alle 3", "iPhone 1", "Mac Mini 1", "MacBook 1"]);
    const row = document.querySelector(".recent-chat")!.textContent!;
    expect(row).toContain("iPhone");
    expect(row).toContain("Klon vom Mac Mini");
    expect(row).toContain("wartet");
  });

  it("Filter iPhone zeigt nur die eigenen Chats", () => {
    setup({ sessions: [direkt("d1", "Direkt"), sess("1", "mini-id", "Mini", minsAgo(2))], filterChoices: [IPHONE, MINI, BOOK], filter: "iphone" });
    expect(recentTitles()).toEqual(["Direkt"]);
  });

  it("Suche filtert nach Titel, ohne Treffer 'nichts gefunden'", () => {
    setup({ sessions: [direkt("d1", "Steuern 2026"), sess("1", "mini-id", "Server Platz", minsAgo(2))], search: true, filterChoices: [IPHONE, MINI] });
    fireEvent.change(screen.getByLabelText("Chats durchsuchen"), { target: { value: "steuer" } });
    expect(recentTitles()).toEqual(["Steuern 2026"]);
    fireEvent.change(screen.getByLabelText("Chats durchsuchen"), { target: { value: "xyz" } });
    expect(screen.getByText("nichts gefunden")).toBeTruthy();
  });

  it("ohne Suchfeld-Wunsch kein Suchfeld (bisheriges Verhalten)", () => {
    setup();
    expect(document.getElementById("chat-search")).toBeNull();
    expect(document.getElementById("new-on-iphone")).toBeNull();
  });
});
