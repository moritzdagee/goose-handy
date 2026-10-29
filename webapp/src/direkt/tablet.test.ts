import { beforeEach, describe, expect, it } from "vitest";
import {
  TABLET_LISTE_KEY,
  gemerkteListe,
  gemerkterVerlauf,
  listeMerken,
  tabletAlsSitzungen,
  tabletHinweis,
  tabletListeHolen,
  tabletTitel,
  tabletVerlaufHolen,
  verlaufMerken,
  verlaufZerlegen,
  zeitIso,
} from "./tablet";
import { TABLET_HOST, isDirekt, isTablet } from "../sessions";
import { json, netz } from "./netz.testhilfe";

beforeEach(() => localStorage.clear());

const KB_RECENT = "kb.bios.love/api/kb/mcp-tool/kb_recent";
const KB_DOC = "kb.bios.love/api/kb/mcp-tool/kb_get_document";

// So antwortet die Bruecke (echt gelesen am 29.10.2026, gekuerzt).
const treffer = (id: number, subject: string, ts: string, source = "moose-beta") => ({
  id,
  kind: "conversation",
  source,
  subject,
  excerpt: "Moritz: Moin\n\nMoose beta: Moin Moritz!",
  timestamp: ts,
});
const listeAntwort = (...results: unknown[]) => json(200, { ok: true, result: { count: results.length, results }, tool: "kb_recent" });
const dokAntwort = (doc: Record<string, unknown>) => json(200, { ok: true, result: { document: doc }, tool: "kb_get_document" });

describe("Tablet-Verlauf zerlegen", () => {
  it("trennt an Leerzeile plus Sprecher", () => {
    expect(verlaufZerlegen("Moritz: Moin\n\nMoose beta: Moin Moritz! Wie kann ich helfen?\n\nMoritz: Wetter?")).toEqual([
      { rolle: "nutzer", text: "Moin" },
      { rolle: "assistent", text: "Moin Moritz! Wie kann ich helfen?" },
      { rolle: "nutzer", text: "Wetter?" },
    ]);
  });

  it("behaelt Absaetze innerhalb einer Nachricht", () => {
    const t = "Moritz: Hallo\n\nMoose beta: Erster Absatz.\n\nZweiter Absatz.\n\n- Punkt\n\nMoritz: danke";
    expect(verlaufZerlegen(t)).toEqual([
      { rolle: "nutzer", text: "Hallo" },
      { rolle: "assistent", text: "Erster Absatz.\n\nZweiter Absatz.\n\n- Punkt" },
      { rolle: "nutzer", text: "danke" },
    ]);
  });

  it("'Moritz: ' im Text ohne Leerzeile davor ist keine neue Nachricht", () => {
    const t = "Moritz: Schreib was\n\nMoose beta: Entwurf:\nMoritz: Hallo Team\nMoose beta: (Ende)\n\nMoritz: gut";
    const b = verlaufZerlegen(t);
    expect(b).toHaveLength(3);
    expect(b[1]).toEqual({ rolle: "assistent", text: "Entwurf:\nMoritz: Hallo Team\nMoose beta: (Ende)" });
  });

  it("Sprecher-Zeilen in einem Code-Block trennen nicht, auch mit Leerzeile", () => {
    const t = "Moritz: Format?\n\nMoose beta: So:\n\n```\nMoritz: Frage\n\nMoose beta: Antwort\n```\n\nMoritz: verstanden";
    const b = verlaufZerlegen(t);
    expect(b.map((x) => x.rolle)).toEqual(["nutzer", "assistent", "nutzer"]);
    expect(b[1].text).toContain("```\nMoritz: Frage\n\nMoose beta: Antwort\n```");
    expect(b[2].text).toBe("verstanden");
  });

  it("Moritz' eigener Text darf mit 'Moritz: ' anfangen", () => {
    expect(verlaufZerlegen("Moritz: Moritz: ist das mein Name?")).toEqual([{ rolle: "nutzer", text: "Moritz: ist das mein Name?" }]);
  });

  it("Windows-Zeilenenden, Leerzeilen mit Leerzeichen, Text ohne Sprecher am Anfang, leer", () => {
    expect(verlaufZerlegen("Moritz: a\r\n\r\nMoose beta: b")).toEqual([
      { rolle: "nutzer", text: "a" },
      { rolle: "assistent", text: "b" },
    ]);
    expect(verlaufZerlegen("Moritz: a\n  \nMoose beta: b")).toHaveLength(2);
    expect(verlaufZerlegen("Vorspann\n\nMoritz: a")).toEqual([
      { rolle: "assistent", text: "Vorspann" },
      { rolle: "nutzer", text: "a" },
    ]);
    expect(verlaufZerlegen("")).toEqual([]);
    expect(verlaufZerlegen("Moritz: \n\nMoose beta: b")).toEqual([{ rolle: "assistent", text: "b" }]);
  });
});

describe("Tablet-Chats aus der Wissensdatenbank", () => {
  it("Titel und Zeit", () => {
    expect(tabletTitel("Moose beta (Tablet): Kennung da")).toBe("Kennung da");
    expect(tabletTitel("irgendwas")).toBe("irgendwas");
    expect(tabletTitel("Moose beta (Tablet): ")).toBe("");
    expect(zeitIso("Thu, 29 Oct 2026 10:00:47 GMT")).toBe("2026-10-29T10:00:47.000Z");
    expect(zeitIso("quatsch")).toBeNull();
    expect(zeitIso(undefined)).toBeNull();
  });

  it("fragt exakt nach source moose-beta, liest nur, zeigt keine iPhone-Spiegelungen und keine Doppelten", async () => {
    const n = netz({
      [KB_RECENT]: [
        listeAntwort(
          treffer(441061, "Moose beta (Tablet): Kennung da", "Thu, 29 Oct 2026 10:00:47 GMT"),
          treffer(441171, "Goose iPhone (direkt): test", "Thu, 29 Oct 2026 13:24:18 GMT", "goose-handy"),
          treffer(441061, "Moose beta (Tablet): Kennung da", "Thu, 29 Oct 2026 10:00:47 GMT"),
          treffer(440507, "Moose beta (Tablet): Moin", "Wed, 28 Oct 2026 17:45:17 GMT"),
        ),
      ],
    });
    const liste = await tabletListeHolen("kb-schluessel", n.fetch);
    expect(liste.map((e) => [e.id, e.titel, e.zeit])).toEqual([
      [441061, "Kennung da", "2026-10-29T10:00:47.000Z"],
      [440507, "Moin", "2026-10-28T17:45:17.000Z"],
    ]);
    expect(n.aufrufe).toHaveLength(1);
    expect(n.aufrufe[0].url).toContain("/kb_recent");
    expect(n.aufrufe[0].auth).toBe("Bearer kb-schluessel");
    expect(n.aufrufe[0].body).toEqual({ arguments: { kind: "conversation", source: "moose-beta", limit: 50 } });
  });

  it("Verlauf holen: zerlegt body_plain, merkt source_ref; fremde Quelle wird abgelehnt", async () => {
    const n = netz({
      [KB_DOC]: [
        dokAntwort({
          id: 5,
          source: "moose-beta",
          source_ref: "moose-beta-tablet-chat-5",
          subject: "Moose beta (Tablet): Moin",
          timestamp: "Wed, 28 Oct 2026 13:52:44 GMT",
          body_plain: "Moritz: Moin\n\nMoose beta: Moin Moritz!",
        }),
        dokAntwort({ id: 6, source: "goose-handy", subject: "x", body_plain: "Moritz: a" }),
      ],
    });
    const v = await tabletVerlaufHolen(5, "k", n.fetch);
    expect(v).toMatchObject({ id: 5, ref: "moose-beta-tablet-chat-5", titel: "Moin", zeit: "2026-10-28T13:52:44.000Z" });
    expect(v.beitraege).toEqual([
      { rolle: "nutzer", text: "Moin" },
      { rolle: "assistent", text: "Moin Moritz!" },
    ]);
    expect(n.aufrufe[0].body).toEqual({ arguments: { id: 5 } });
    await expect(tabletVerlaufHolen(6, "k", n.fetch)).rejects.toThrow("kein Tablet-Chat");
  });

  it("ohne Schluessel kein Netzaufruf", async () => {
    const n = netz({});
    await expect(tabletListeHolen("", n.fetch)).rejects.toThrow("Kein Datenbank-Schluessel");
    expect(n.aufrufe).toHaveLength(0);
  });
});

describe("Zwischenspeicher fuer offline", () => {
  it("merkt Liste mit Stand, liest sie wieder, Muell wird ignoriert", () => {
    expect(gemerkteListe()).toEqual({ eintraege: [], stand: null });
    listeMerken([{ id: 1, titel: "A", zeit: "2026-10-29T10:00:00.000Z", auszug: "" }], "2026-10-29T12:00:00.000Z");
    expect(gemerkteListe()).toEqual({
      eintraege: [{ id: 1, titel: "A", zeit: "2026-10-29T10:00:00.000Z", auszug: "" }],
      stand: "2026-10-29T12:00:00.000Z",
    });
    localStorage.setItem(TABLET_LISTE_KEY, "{kaputt");
    expect(gemerkteListe()).toEqual({ eintraege: [], stand: null });
  });

  it("merkt geoeffnete Verlaeufe, hoechstens 15, aelteste fliegen raus", () => {
    for (let i = 1; i <= 17; i++) verlaufMerken({ id: i, ref: `r${i}`, titel: `T${i}`, zeit: null, beitraege: [{ rolle: "nutzer", text: `x${i}` }] });
    expect(gemerkterVerlauf(17)?.beitraege[0].text).toBe("x17");
    expect(gemerkterVerlauf(3)?.titel).toBe("T3");
    expect(gemerkterVerlauf(2)).toBeNull();
    expect(gemerkterVerlauf(1)).toBeNull();
    // erneut geoeffnet: rueckt nach vorne
    verlaufMerken({ id: 3, ref: "r3", titel: "T3", zeit: null, beitraege: [] });
    for (let i = 18; i <= 31; i++) verlaufMerken({ id: i, ref: null, titel: "", zeit: null, beitraege: [] });
    expect(gemerkterVerlauf(3)).not.toBeNull();
    expect(gemerkterVerlauf(4)).toBeNull();
  });
});

describe("Tablet in den Listen", () => {
  it("Eintraege werden Sitzungen des 'Rechners' Tablet, gekennzeichnet als Kopie", () => {
    const s = tabletAlsSitzungen([{ id: 7, titel: "Moin", zeit: "2026-10-28T17:45:17.000Z", auszug: "" }]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ sessionId: "7", _host: TABLET_HOST, title: "Moin", updatedAt: "2026-10-28T17:45:17.000Z" });
    expect(isTablet(s[0])).toBe(true);
    expect(isDirekt(s[0])).toBe(false);
  });

  it("Hinweise: ohne Schluessel, Schluessel noch zu, kaputt, offline mit Stand, Fehler", () => {
    const basis = { kbDa: false, hinterlegt: false, fehlerhaft: false, tresorDa: true, fehler: null, stand: null };
    expect(tabletHinweis(basis)).toMatch(/Datenbank-Schluessel unter Einstellungen/);
    expect(tabletHinweis({ ...basis, hinterlegt: true, tresorDa: false })).toMatch(/Face ID/);
    expect(tabletHinweis({ ...basis, hinterlegt: true, fehlerhaft: true })).toMatch(/laesst sich nicht oeffnen/);
    expect(tabletHinweis({ ...basis, kbDa: true })).toBeNull();
    const offline = tabletHinweis({ ...basis, kbDa: true, fehler: "Wissensdatenbank nicht erreichbar (offline?)", stand: "2026-10-29T12:00:00.000Z" });
    expect(offline).toMatch(/nicht erreichbar/);
    expect(offline).toMatch(/gemerkte Stand/);
    expect(tabletHinweis({ ...basis, kbDa: true, fehler: "Datenbank-Schluessel abgelehnt." })).toMatch(/abgelehnt/);
  });
});
