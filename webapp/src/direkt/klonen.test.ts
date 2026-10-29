import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import type { CachedItem } from "../cache";
import { KLON_MAX_NACHRICHTEN, aufIphoneKlonen, beitraegeAusZwischenspeicher, fuerKlonKuerzen, geraetVonHost, tabletChatKlonen } from "./klonen";
import { herkunftText } from "./liste";
import type { TabletVerlauf } from "./tablet";
import { _speicherZuruecksetzen, alleChats, chatLesen } from "./speicher";
import { direktSenden } from "./chat";
import { netz, sse, textDelta } from "./netz.testhilfe";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _speicherZuruecksetzen();
});

const VERLAUF: CachedItem[] = [
  { kind: "system", text: "Neuer Chat auf Mac Mini" },
  { kind: "msg", role: "user", text: "Wie viel Platz hat der Mini?" },
  { kind: "tool", toolCallId: "t", title: "shell df -h", status: "success", output: "..." },
  { kind: "msg", role: "thought", text: "denke" },
  { kind: "msg", role: "agent", text: "Noch 120 GB frei." },
  { kind: "msg", role: "agent", text: "Soll ich aufraeumen?" },
  { kind: "plan", entries: [] },
];

describe("Rechner-Chat auf dem iPhone weiterfuehren", () => {
  it("nimmt nur Text von Moritz und Goose, legt gleiche Rollen zusammen", () => {
    expect(beitraegeAusZwischenspeicher(VERLAUF)).toEqual([
      { rolle: "nutzer", text: "Wie viel Platz hat der Mini?" },
      { rolle: "assistent", text: "Noch 120 GB frei.\n\nSoll ich aufraeumen?" },
    ]);
  });

  it("legt einen Direkt-Chat 'Klon: <Titel>' mit Herkunft und Hinweis an", async () => {
    const c = await aufIphoneKlonen("  Platz   auf dem Mini ", VERLAUF, { hostLabel: "Mac Mini", sessionId: "sess-9" });
    expect(c.titel).toBe("Klon: Platz auf dem Mini");
    expect(c.herkunft).toMatchObject({ geraet: "mini", sessionId: "sess-9", titel: "Platz auf dem Mini" });
    expect(c.nachrichten[0].rolle).toBe("system");
    expect(c.nachrichten[0].text).toContain("Mac Mini");
    expect(c.nachrichten.slice(1).map((n) => n.rolle)).toEqual(["nutzer", "assistent"]);
    // Zeiten streng aufsteigend
    const zeiten = c.nachrichten.map((n) => n.zeit);
    expect([...zeiten].sort()).toEqual(zeiten);
    expect(c.spiegel).toBe("ausstehend");
    expect((await alleChats()).map((x) => x.id)).toEqual([c.id]);
  });

  it("danach geht es direkt weiter, mit dem Verlauf des Rechners als Grundlage", async () => {
    const c = await aufIphoneKlonen("Platz", VERLAUF, { hostLabel: "MacBook", sessionId: "s" });
    expect(c.herkunft?.geraet).toBe("macbook");
    const n = netz({ "api.mistral.ai": [sse(textDelta("Dann raeume ich nichts auf."))] });
    await direktSenden(c.id, "Nein danke", { schluessel: { mistral: "m" }, abruf: n.fetch, online: () => true });
    const msgs = n.aufrufe[0].body!.messages as { role: string; content: string }[];
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(msgs[1].content).toContain("Hinweis: Weitergefuehrt vom MacBook");
    expect(msgs[2].content).toContain("120 GB");
    expect((await chatLesen(c.id))!.nachrichten.at(-1)!.text).toBe("Dann raeume ich nichts auf.");
  });

  it("kuerzt lange Verlaeufe vorne und sagt es", async () => {
    const lang: CachedItem[] = [];
    for (let i = 0; i < KLON_MAX_NACHRICHTEN + 10; i++) lang.push({ kind: "msg", role: i % 2 ? "agent" : "user", text: `Nr ${i}` });
    const { beitraege, weggelassen } = fuerKlonKuerzen(beitraegeAusZwischenspeicher(lang));
    expect(beitraege).toHaveLength(KLON_MAX_NACHRICHTEN);
    expect(weggelassen).toBe(10);
    expect(beitraege.at(-1)!.text).toBe(`Nr ${KLON_MAX_NACHRICHTEN + 9}`);
    const c = await aufIphoneKlonen("lang", lang, { hostLabel: "Mac Mini", sessionId: "s" });
    expect(c.nachrichten[0].text).toContain("10 aeltere");
    const riesig = fuerKlonKuerzen([{ rolle: "nutzer", text: "x".repeat(70000) }]);
    expect(riesig.beitraege[0].text.length).toBe(60000);
  });

  it("ohne gespeicherten Verlauf: klare Meldung, kein leerer Chat", async () => {
    await expect(aufIphoneKlonen("x", [{ kind: "system", text: "nur System" }], { hostLabel: "Mac Mini", sessionId: "s" })).rejects.toThrow(
      "kein Verlauf",
    );
    expect(await alleChats()).toEqual([]);
  });

  it("erkennt das Geraet am Namen", () => {
    expect(geraetVonHost("Mac Mini")).toBe("mini");
    expect(geraetVonHost("MacBook")).toBe("macbook");
    expect(geraetVonHost("host abc")).toBe("unbekannt");
  });
});

describe("Tablet-Chat auf das iPhone klonen", () => {
  const VERLAUF_TABLET: TabletVerlauf = {
    id: 439849,
    ref: "moose-beta-tablet-chat-5",
    titel: "Moin",
    zeit: "2026-10-28T13:52:44.000Z",
    beitraege: [
      { rolle: "nutzer", text: "Moin" },
      { rolle: "assistent", text: "Moin Moritz!" },
      { rolle: "nutzer", text: "Wie ist die Lage?" },
      { rolle: "assistent", text: "Ruhiger Tag." },
    ],
  };

  it("legt 'Klon: <Titel>' mit Herkunft Tablet an, Anzeige 'Klon vom Tablet'", async () => {
    const c = await tabletChatKlonen(VERLAUF_TABLET);
    expect(c.titel).toBe("Klon: Moin");
    expect(c.herkunft).toMatchObject({ geraet: "tablet", sessionId: "moose-beta-tablet-chat-5", titel: "Moin" });
    expect(herkunftText(c)).toBe("Klon vom Tablet");
    expect(c.nachrichten[0].rolle).toBe("system");
    expect(c.nachrichten[0].text).toContain("Tablet");
    expect(c.nachrichten[0].text).toContain("Wissensdatenbank");
    expect(c.nachrichten.slice(1).map((n) => [n.rolle, n.text])).toEqual(VERLAUF_TABLET.beitraege.map((b) => [b.rolle, b.text]));
    expect(c.nachrichten.slice(1).every((n) => n.modell === "Klon (Tablet)")).toBe(true);
    expect(c.spiegel).toBe("ausstehend");
    expect((await chatLesen(c.id))!.titel).toBe("Klon: Moin");
  });

  it("ohne source_ref: Kennung aus der Datenbank-Nummer", async () => {
    const c = await tabletChatKlonen({ ...VERLAUF_TABLET, ref: null });
    expect(c.herkunft?.sessionId).toBe("kb-439849");
  });

  it("kuerzt wie beim Rechner-Klon und sagt es", async () => {
    const beitraege = Array.from({ length: KLON_MAX_NACHRICHTEN + 4 }, (_, i) => ({ rolle: (i % 2 ? "assistent" : "nutzer") as "nutzer" | "assistent", text: `Nr ${i}` }));
    const c = await tabletChatKlonen({ ...VERLAUF_TABLET, beitraege });
    expect(c.nachrichten).toHaveLength(KLON_MAX_NACHRICHTEN + 1);
    expect(c.nachrichten[0].text).toContain("4 aeltere");
  });

  it("danach geht es direkt mit Mistral weiter, mit dem Tablet-Verlauf als Grundlage", async () => {
    const c = await tabletChatKlonen(VERLAUF_TABLET);
    const n = netz({ "api.mistral.ai": [sse(textDelta("Weiter gehts."))] });
    await direktSenden(c.id, "und jetzt?", { schluessel: { mistral: "m" }, abruf: n.fetch, online: () => true });
    const msgs = n.aufrufe[0].body!.messages as { role: string; content: string }[];
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "user", "assistant", "user"]);
    expect(msgs[1].content).toContain("Weitergefuehrt vom Tablet");
    expect(msgs[4].content).toBe("Ruhiger Tag.");
  });

  it("leerer Tablet-Chat: klare Meldung, kein leerer Klon", async () => {
    await expect(tabletChatKlonen({ ...VERLAUF_TABLET, beitraege: [] })).rejects.toThrow("leer");
    expect(await alleChats()).toEqual([]);
  });
});
