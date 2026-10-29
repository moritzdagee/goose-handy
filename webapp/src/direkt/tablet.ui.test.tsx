import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlProvider } from "react-intl";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { TabletChatAnsicht } from "./TabletChatAnsicht";
import { useTablet } from "./useTablet";
import { _speicherZuruecksetzen, alleChats, chatLesen } from "./speicher";
import { gemerkteListe, gemerkterVerlauf, listeMerken, verlaufMerken } from "./tablet";
import { json, netz } from "./netz.testhilfe";
import { StartPage } from "../StartPage";
import { TABLET_HOST, type TaggedSession } from "../sessions";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _speicherZuruecksetzen();
  localStorage.clear();
});
afterEach(() => cleanup());

const KB_RECENT = "/kb_recent";
const KB_DOC = "/kb_get_document";

const dok = (id: number, body: string, titel = "Moin") =>
  json(200, {
    ok: true,
    result: {
      document: {
        id,
        source: "moose-beta",
        source_ref: `moose-beta-tablet-chat-${id}`,
        subject: `Moose beta (Tablet): ${titel}`,
        timestamp: "Wed, 28 Oct 2026 13:52:44 GMT",
        body_plain: body,
      },
    },
  });

function ansicht(props: Partial<Parameters<typeof TabletChatAnsicht>[0]> = {}) {
  const onBack = vi.fn();
  const onGeklont = vi.fn();
  const onEinstellungen = vi.fn();
  render(
    <IntlProvider locale="de" defaultLocale="de" messages={{}}>
      <TabletChatAnsicht
        eintrag={{ id: 5, titel: "Moin" }}
        kbSchluessel="kb"
        online
        onBack={onBack}
        onGeklont={onGeklont}
        onEinstellungen={onEinstellungen}
        {...props}
      />
    </IntlProvider>,
  );
  return { onBack, onGeklont, onEinstellungen };
}

describe("Tablet-Chat lesen und klonen", () => {
  it("liest den Verlauf, kennzeichnet ihn als Kopie, klont ihn als Direkt-Chat", async () => {
    const n = netz({ [KB_DOC]: [dok(5, "Moritz: Moin\n\nMoose beta: Moin Moritz!\n\nMoritz: Lage?\n\nMoose beta: Ruhig.")] });
    const { onGeklont } = ansicht({ abruf: n.fetch });
    await waitFor(() => expect(document.querySelectorAll(".msg.agent").length).toBe(2));
    expect([...document.querySelectorAll(".msg.user")].map((e) => e.textContent)).toEqual(["Moin", "Lage?"]);
    expect(screen.getByText("Kopie aus der Datenbank")).toBeTruthy();
    expect(document.getElementById("tablet-titel")!.textContent).toBe("Moin");
    // nur lesen: kein Eingabefeld
    expect(document.querySelector("textarea")).toBeNull();
    // gemerkt fuer offline
    expect(gemerkterVerlauf(5)?.beitraege).toHaveLength(4);
    fireEvent.click(document.getElementById("tablet-klonen")!);
    await waitFor(() => expect(onGeklont).toHaveBeenCalledTimes(1));
    const id = onGeklont.mock.calls[0][0] as string;
    const c = (await chatLesen(id))!;
    expect(c.titel).toBe("Klon: Moin");
    expect(c.herkunft).toMatchObject({ geraet: "tablet", sessionId: "moose-beta-tablet-chat-5" });
    expect(c.nachrichten.slice(1).map((m) => m.text)).toEqual(["Moin", "Moin Moritz!", "Lage?", "Ruhig."]);
    // es wurde nur gelesen
    expect(n.aufrufe.every((a) => a.url.endsWith("/kb_get_document"))).toBe(true);
  });

  it("gibt es schon einen Klon: 'Klon oeffnen' statt eines zweiten", async () => {
    const n = netz({ [KB_DOC]: [dok(5, "Moritz: a\n\nMoose beta: b")] });
    const { onGeklont } = ansicht({ abruf: n.fetch, klonVon: (ref) => (ref === "moose-beta-tablet-chat-5" ? "chat-x" : null) });
    await waitFor(() => expect(document.getElementById("tablet-klon-oeffnen")).not.toBeNull());
    fireEvent.click(document.getElementById("tablet-klon-oeffnen")!);
    expect(onGeklont).toHaveBeenCalledWith("chat-x");
    expect(await alleChats()).toEqual([]);
    expect(document.getElementById("tablet-klonen")!.textContent).toContain("Nochmal klonen");
  });

  it("offline: zeigt den gemerkten Verlauf ohne Netzaufruf und klont ihn trotzdem", async () => {
    verlaufMerken({ id: 5, ref: "moose-beta-tablet-chat-5", titel: "Moin", zeit: null, beitraege: [{ rolle: "nutzer", text: "gemerkt" }] });
    const n = netz({});
    const { onGeklont } = ansicht({ abruf: n.fetch, online: false });
    await screen.findByText("gemerkt");
    expect(document.getElementById("tablet-hinweis")!.textContent).toMatch(/Kein Netz/);
    expect(n.aufrufe).toHaveLength(0);
    fireEvent.click(document.getElementById("tablet-klonen")!);
    await waitFor(() => expect(onGeklont).toHaveBeenCalled());
  });

  it("offline ohne gemerkten Stand: Hinweis, Klonen gesperrt", async () => {
    ansicht({ abruf: netz({}).fetch, online: false });
    await screen.findByText(/noch nie geoeffnet/);
    expect((document.getElementById("tablet-klonen") as HTMLButtonElement).disabled).toBe(true);
  });

  it("ohne Datenbank-Schluessel: verstaendlicher Hinweis mit Weg zu den Einstellungen, kein Fehler", async () => {
    const n = netz({});
    const { onEinstellungen } = ansicht({ kbSchluessel: undefined, abruf: n.fetch });
    await screen.findByText(/kommen aus deiner Wissensdatenbank/);
    expect(document.querySelector("[role=alert]")).toBeNull();
    fireEvent.click(document.getElementById("tablet-zu-einstellungen")!);
    expect(onEinstellungen).toHaveBeenCalled();
    expect(n.aufrufe).toHaveLength(0);
  });

  it("Datenbank meldet Fehler: Meldung, gemerkter Stand bleibt stehen", async () => {
    verlaufMerken({ id: 5, ref: null, titel: "Moin", zeit: null, beitraege: [{ rolle: "assistent", text: "alt" }] });
    const n = netz({ [KB_DOC]: [json(500, {})] });
    ansicht({ abruf: n.fetch });
    await waitFor(() => expect(document.getElementById("tablet-hinweis")?.textContent).toMatch(/Fehler 500/));
    expect(screen.getByText("alt")).toBeTruthy();
  });
});

describe("useTablet: Liste aus der Datenbank, offline aus dem Zwischenspeicher", () => {
  const liste = (...ids: number[]) =>
    json(200, {
      ok: true,
      result: {
        results: ids.map((id) => ({ id, source: "moose-beta", subject: `Moose beta (Tablet): Chat ${id}`, timestamp: "Wed, 28 Oct 2026 13:52:44 GMT" })),
      },
    });

  it("holt die Liste mit Schluessel und merkt sie", async () => {
    const n = netz({ [KB_RECENT]: [liste(1, 2)] });
    const { result } = renderHook(() => useTablet("kb", n.fetch));
    await waitFor(() => expect(result.current.eintraege.map((e) => e.id)).toEqual([1, 2]));
    expect(result.current.fehler).toBeNull();
    expect(gemerkteListe().eintraege).toHaveLength(2);
  });

  it("ohne Schluessel: gemerkte Liste, kein Netzaufruf", async () => {
    listeMerken([{ id: 9, titel: "alt", zeit: null, auszug: "" }], "2026-10-29T08:00:00.000Z");
    const n = netz({});
    const { result } = renderHook(() => useTablet(undefined, n.fetch));
    expect(result.current.eintraege.map((e) => e.id)).toEqual([9]);
    await act(async () => {
      await result.current.neuLaden();
    });
    expect(n.aufrufe).toHaveLength(0);
  });

  it("Netz weg: gemerkte Liste bleibt, Fehler wird gemeldet; mit Netz wieder frisch", async () => {
    listeMerken([{ id: 9, titel: "alt", zeit: null, auszug: "" }], "2026-10-29T08:00:00.000Z");
    const n = netz({ [KB_RECENT]: [new TypeError("offline"), liste(3)] });
    const { result } = renderHook(() => useTablet("kb", n.fetch));
    await waitFor(() => expect(result.current.fehler).toMatch(/nicht erreichbar/));
    expect(result.current.eintraege.map((e) => e.id)).toEqual([9]);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(result.current.eintraege.map((e) => e.id)).toEqual([3]));
    expect(result.current.fehler).toBeNull();
  });
});

describe("Startseite mit Tablet", () => {
  const tab = (id: string, title: string): TaggedSession => ({ sessionId: id, cwd: "", _host: TABLET_HOST, title, updatedAt: null }) as TaggedSession;
  const mini = (id: string): TaggedSession => ({ sessionId: id, cwd: "/", _host: "mini", title: `M${id}`, updatedAt: null }) as TaggedSession;
  const CHOICES = [
    { endpointId: "iphone", label: "iPhone" },
    { endpointId: TABLET_HOST, label: "Tablet" },
    { endpointId: "mini", label: "Mac Mini" },
  ];

  it("Filter 'Tablet' mit Anzahl; Eintraege als Kopie gekennzeichnet; Antippen meldet den Eintrag", () => {
    const onOpen = vi.fn();
    const onFilter = vi.fn();
    render(
      <StartPage
        hosts={[]}
        sessions={[tab("1", "Moin"), tab("2", "Lage"), mini("3")]}
        creating={false}
        onNew={() => {}}
        onOpen={onOpen}
        filterChoices={CHOICES}
        filter={TABLET_HOST}
        onFilter={onFilter}
      />,
    );
    const chip = document.querySelector(`[data-filter="${TABLET_HOST}"]`)!;
    expect(chip.textContent).toContain("Tablet");
    expect(chip.textContent).toContain("2");
    const eintraege = [...document.querySelectorAll(".recent-chat")];
    expect(eintraege).toHaveLength(2);
    expect(eintraege[0].textContent).toContain("Kopie aus der Datenbank");
    fireEvent.click(eintraege[0]);
    expect(onOpen.mock.calls[0][0]).toMatchObject({ _host: TABLET_HOST, sessionId: "1" });
    fireEvent.click(document.querySelector('[data-filter="mini"]')!);
    expect(onFilter).toHaveBeenCalledWith("mini");
  });

  it("Hinweis ohne Schluessel steht nur im Tablet-Filter; leere Liste sagt es passend", () => {
    const hinweis = "Tablet-Chats kommen aus der Wissensdatenbank. Dafuer einmal den Datenbank-Schluessel unter Einstellungen eintragen.";
    const { rerender } = render(
      <StartPage hosts={[]} sessions={[]} creating={false} onNew={() => {}} onOpen={() => {}} filterChoices={CHOICES} filter={TABLET_HOST} tabletHinweis={hinweis} />,
    );
    expect(document.getElementById("tablet-listen-hinweis")!.textContent).toBe(hinweis);
    expect(screen.getByText("noch keine Tablet-Chats")).toBeTruthy();
    rerender(<StartPage hosts={[]} sessions={[]} creating={false} onNew={() => {}} onOpen={() => {}} filterChoices={CHOICES} filter="all" tabletHinweis={hinweis} />);
    expect(document.getElementById("tablet-listen-hinweis")).toBeNull();
  });
});
