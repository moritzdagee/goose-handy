import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { ausstehendeSpiegeln, ausstehendeZahl, conversationId, gespraechSpiegeln, spiegelKoerper } from "./spiegel";
import { _speicherZuruecksetzen, chatAendern, chatLesen, neuerChat } from "./speicher";
import { json, netz } from "./netz.testhilfe";

const INGEST = "kb.bios.love/api/kb/mcp-tool/kb_ingest_document";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _speicherZuruecksetzen();
});

async function chatMitVerlauf(titel = "Steuern 2026") {
  const c = await neuerChat("mistral-large-4-0");
  return chatAendern(c.id, (x) => {
    x.titel = titel;
    x.nachrichten.push(
      { id: "1", rolle: "nutzer", text: "Frage", zeit: "2026-10-29T10:00:00Z" },
      { id: "2", rolle: "assistent", text: "Antwort", zeit: "2026-10-29T10:00:05Z", modell: "mistral-large-4-0" },
    );
  });
}

describe("Gespraech in die Wissensdatenbank spiegeln", () => {
  it("schickt kind conversation mit Quelle, Etiketten und stabiler conversation_id", async () => {
    const c = await chatMitVerlauf();
    const n = netz({ [INGEST]: [json(200, { ok: true, result: { id: 5 } })] });
    expect(await gespraechSpiegeln(c.id, "kb-key", n.fetch)).toBe("gespiegelt");
    const a = n.aufrufe[0];
    expect(a.auth).toBe("Bearer kb-key");
    const d = a.body!.arguments as Record<string, any>;
    expect(d.kind).toBe("conversation");
    expect(d.source).toBe("goose-handy");
    expect(d.source_ref).toBe(conversationId(c.id));
    expect(d.metadata.conversation_id).toBe(`goose-handy-iphone-chat-${c.id}`);
    expect(d.tags).toEqual(expect.arrayContaining(["geraet:iphone", "agent:goose-handy", "modell:mistral-large-4-0"]));
    expect(d.body_plain).toBe("Moritz: Frage\n\nGoose (iPhone): Antwort");
    expect(d.subject).toContain("Steuern 2026");
    const nach = (await chatLesen(c.id))!;
    expect(nach.spiegel).toBe("gespiegelt");
    expect(nach.spiegelStand).toBeTruthy();
  });

  it("zweimal spiegeln schickt dieselbe Kennung (aktualisiert statt doppelt)", async () => {
    const c = await chatMitVerlauf();
    const n = netz({ [INGEST]: [json(200, { ok: true })] });
    await gespraechSpiegeln(c.id, "k", n.fetch);
    await gespraechSpiegeln(c.id, "k", n.fetch);
    const refs = n.aufrufe.map((x) => (x.body!.arguments as Record<string, unknown>).source_ref);
    expect(refs[0]).toBe(refs[1]);
  });

  it("ohne Schluessel, offline oder bei Ablehnung: ausstehend, Chat bleibt nutzbar", async () => {
    const c = await chatMitVerlauf();
    expect(await gespraechSpiegeln(c.id, null)).toBe("ausstehend");
    const weg = netz({ [INGEST]: [new TypeError("offline")] });
    expect(await gespraechSpiegeln(c.id, "k", weg.fetch)).toBe("ausstehend");
    const nein = netz({ [INGEST]: [json(200, { ok: false, error: "nope" })] });
    expect(await gespraechSpiegeln(c.id, "k", nein.fetch)).toBe("ausstehend");
    const kaputt = netz({ [INGEST]: [json(403, {})] });
    expect(await gespraechSpiegeln(c.id, "k", kaputt.fetch)).toBe("ausstehend");
    expect((await chatLesen(c.id))!.spiegel).toBe("ausstehend");
    expect(await ausstehendeZahl()).toBe(1);
  });

  it("holt geparkte Gespraeche nach, sobald Schluessel und Netz da sind", async () => {
    const a = await chatMitVerlauf("A");
    const b = await chatMitVerlauf("B");
    await gespraechSpiegeln(a.id, null);
    await gespraechSpiegeln(b.id, null);
    expect(await ausstehendeSpiegeln(null)).toBe(0);
    const n = netz({ [INGEST]: [json(200, { ok: true })] });
    expect(await ausstehendeSpiegeln("k", n.fetch)).toBe(2);
    expect(await ausstehendeZahl()).toBe(0);
  });

  it("Klon-Herkunft und Klon-Zeilen: Herkunft in den Metadaten, kein Schein-Modell als Etikett", async () => {
    const c = await neuerChat("mistral-large-4-0");
    const x = await chatAendern(c.id, (y) => {
      y.herkunft = { geraet: "mini", sessionId: "s1", titel: "Alt", geklontAm: "2026-10-29T10:00:00Z" };
      y.nachrichten.push({ id: "1", rolle: "nutzer", text: "alt", zeit: "", modell: "Klon (Mac Mini)" });
    });
    const k = spiegelKoerper(x) as Record<string, any>;
    expect(k.metadata.klon_von.geraet).toBe("mini");
    expect(k.tags).toEqual(["agent:goose-handy", "geraet:iphone", "modell:mistral-large-4-0"]);
  });
});
