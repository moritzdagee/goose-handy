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
});
