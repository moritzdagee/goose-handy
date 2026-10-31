import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { chatAusSpiegel, chatsWiederherstellen, spiegelVerlaufZerlegen, WIEDERHERSTELLUNG_KEY } from "./wiederherstellen";
import { _speicherZuruecksetzen, alleChats, chatLesen, chatSpeichern } from "./speicher";
import { json, netz } from "./netz.testhilfe";

const RECENT = "kb_recent";
const GETDOC = "kb_get_document";

const DOC_A = {
  id: 11,
  source: "goose-handy",
  source_ref: "goose-handy-iphone-chat-chat-a",
  subject: "Goose iPhone (direkt): Steuern 2026",
  body_plain: "Moritz: Frage\n\nGoose (iPhone): Antwort\n\nMoritz (noch ohne Antwort): noch offen",
  timestamp: "2026-10-30T09:00:00Z",
  metadata: { erstellt: "2026-10-29T18:00:00Z" },
};
const DOC_B = {
  id: 12,
  source: "goose-handy",
  source_ref: "goose-handy-iphone-chat-chat-b",
  subject: "Goose iPhone (direkt): Einkaufen",
  body_plain: "Moritz: Milch\n\nGoose (iPhone): Auf die Liste.",
  timestamp: "2026-10-30T10:00:00Z",
};

function recentHuelle(docs: Array<Record<string, unknown>>) {
  return json(200, {
    ok: true,
    result: { count: docs.length, results: docs.map(({ id, source, subject, timestamp }) => ({ id, source, subject, timestamp })) },
  });
}
function docHuelle(doc: Record<string, unknown>) {
  return json(200, { ok: true, result: { document: doc } });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _speicherZuruecksetzen();
  localStorage.clear();
});

describe("Direkt-Chats aus der Wissensdatenbank wiederherstellen", () => {
  it("zerlegt den gespiegelten Verlauf: Rollen, Wartend-Markierung, Code-Bloecke", () => {
    const b = spiegelVerlaufZerlegen(
      "Moritz: eins\n\nGoose (iPhone): zwei\nmit Umbruch\n\nHinweis: system\n\nMoritz (noch ohne Antwort): offen\n\nGoose (iPhone): ```\nMoritz: im code\n```",
    );
    expect(b.map((x) => x.rolle)).toEqual(["nutzer", "assistent", "system", "nutzer", "assistent"]);
    expect(b[1].text).toBe("zwei\nmit Umbruch");
    expect(b[3].wartet).toBe(true);
    expect(b[4].text).toBe("```\nMoritz: im code\n```");
  });

  it("baut aus einem Eintrag wieder einen DirektChat (Titel ohne Praefix, erstellt aus Metadaten, sonst Zeitstempel)", () => {
    const chat = chatAusSpiegel("chat-a", DOC_A)!;
    expect(chat.id).toBe("chat-a");
    expect(chat.titel).toBe("Steuern 2026");
    expect(chat.erstelltAm).toBe("2026-10-29T18:00:00.000Z");
    expect(chat.geaendertAm).toBe("2026-10-30T09:00:00.000Z");
    expect(chat.spiegel).toBe("gespiegelt");
    expect(chat.nachrichten.map((n) => n.rolle)).toEqual(["nutzer", "assistent", "nutzer"]);
    expect(chat.nachrichten[2].status).toBe("wartet");
    const ohneMeta = chatAusSpiegel("c", { subject: "Ohne Praefix", body_plain: "Moritz: hi", timestamp: "2026-10-30T10:00:00Z" })!;
    expect(ohneMeta.titel).toBe("Ohne Praefix");
    expect(ohneMeta.erstelltAm).toBe("2026-10-30T10:00:00.000Z");
    expect(chatAusSpiegel("leer", { body_plain: "   " })).toBeNull();
  });

  it("stellt fehlende Chats wieder her und vermerkt die Eintraege", async () => {
    const n = netz({ [RECENT]: [recentHuelle([DOC_A, DOC_B])], [GETDOC]: [docHuelle(DOC_A), docHuelle(DOC_B)] });
    const r = await chatsWiederherstellen("kb-key", n.fetch);
    expect(r).toEqual({ wiederhergestellt: 2, gesehen: 2 });
    const chats = await alleChats();
    expect(chats).toHaveLength(2);
    const a = (await chatLesen("chat-a"))!;
    expect(a.titel).toBe("Steuern 2026");
    expect(a.spiegel).toBe("gespiegelt");
    expect(a.nachrichten).toHaveLength(3);
    expect(n.aufrufe[0].auth).toBe("Bearer kb-key");
    expect(localStorage.getItem(WIEDERHERSTELLUNG_KEY)).toContain("11");
  });

  it("ueberschreibt nie lokale Chats und laeuft idempotent", async () => {
    await chatSpeichern({
      id: "chat-a",
      titel: "Mein eigener Titel",
      erstelltAm: "2026-10-01T00:00:00Z",
      geaendertAm: "2026-10-01T00:00:00Z",
      modell: "m",
      nachrichten: [{ id: "1", rolle: "nutzer", text: "lokal", zeit: "" }],
    });
    const n = netz({ [RECENT]: [recentHuelle([DOC_A])], [GETDOC]: [docHuelle(DOC_A)] });
    let r = await chatsWiederherstellen("k", n.fetch);
    expect(r).toEqual({ wiederhergestellt: 0, gesehen: 1 });
    const lokal = (await chatLesen("chat-a"))!;
    expect(lokal.titel).toBe("Mein eigener Titel");
    expect(lokal.nachrichten[0].text).toBe("lokal");
    // Zweiter Lauf: der Eintrag ist vermerkt, das Dokument wird gar nicht mehr abgerufen.
    const leer = netz({ [RECENT]: [recentHuelle([DOC_A])] });
    r = await chatsWiederherstellen("k", leer.fetch);
    expect(r).toEqual({ wiederhergestellt: 0, gesehen: 0 });
    expect(await alleChats()).toHaveLength(1);
  });

  it("ignoriert Eintraege ohne iPhone-Kennung", async () => {
    const fremd = { id: 21, source: "goose-handy", source_ref: "was-anderes-9", subject: "Goose iPhone (direkt): Fremd", body_plain: "Moritz: hi", timestamp: "2026-10-30T09:00:00Z" };
    const n = netz({ [RECENT]: [recentHuelle([fremd])], [GETDOC]: [docHuelle(fremd)] });
    const r = await chatsWiederherstellen("k", n.fetch);
    expect(r).toEqual({ wiederhergestellt: 0, gesehen: 0 });
    expect(await alleChats()).toHaveLength(0);
  });

  it("wirft bei toter Datenbank, legt nichts an und tut ohne Schluessel nichts", async () => {
    const weg = netz({ [RECENT]: [new TypeError("offline")] });
    await expect(chatsWiederherstellen("k", weg.fetch)).rejects.toThrow("nicht erreichbar");
    expect(await alleChats()).toHaveLength(0);
    expect(await chatsWiederherstellen(null)).toEqual({ wiederhergestellt: 0, gesehen: 0 });
  });
});
