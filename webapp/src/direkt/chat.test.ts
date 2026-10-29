import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { alleWartendenSenden, direktSenden, inhaltAlsText, systemAufforderung, verlaufFuerAnbieter, wartendeSenden } from "./chat";
import { _speicherZuruecksetzen, chatAendern, chatLesen, neuerChat } from "./speicher";
import { json, netz, sse, sucheDelta, textDelta } from "./netz.testhilfe";

const MISTRAL = "api.mistral.ai/v1/chat/completions";
const EUROUTER = "api.eurouter.ai/v1/chat/completions";
const KB_SUCHE = "kb.bios.love/api/kb/mcp-tool/kb_search";
const KB_INGEST = "kb.bios.love/api/kb/mcp-tool/kb_ingest_document";
const online = () => true;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _speicherZuruecksetzen();
});

describe("Direkt-Chat mit Mistral", () => {
  it("schickt System-Anlauf und Verlauf, stroemt die Antwort und speichert beides", async () => {
    const chat = await neuerChat("mistral-large-4-0");
    const n = netz({ [MISTRAL]: [sse(textDelta("Hallo"), textDelta(" Moritz"))] });
    const stuecke: string[] = [];
    const fertig = await direktSenden(chat.id, "  Wer bist du?  ", {
      schluessel: { mistral: "m-key" },
      abruf: n.fetch,
      onChunk: (t) => stuecke.push(t),
      online,
    });
    expect(stuecke).toEqual(["Hallo", " Moritz"]);
    expect(fertig.titel).toBe("Wer bist du?");
    expect(fertig.nachrichten.map((x) => [x.rolle, x.text, x.status])).toEqual([
      ["nutzer", "Wer bist du?", undefined],
      ["assistent", "Hallo Moritz", undefined],
    ]);
    expect(fertig.nachrichten[1].modell).toBe("mistral-large-4-0");
    expect(fertig.spiegel).toBe("ausstehend"); // ohne Datenbank-Schluessel wartet die Spiegelung
    const a = n.aufrufe[0];
    expect(a.auth).toBe("Bearer m-key");
    expect(a.body?.stream).toBe(true);
    expect(a.body?.model).toBe("mistral-large-4-0");
    expect(a.body?.tools).toBeUndefined(); // ohne Datenbank kein Such-Werkzeug
    const msgs = a.body?.messages as { role: string; content: string }[];
    expect(msgs[0].role).toBe("system");
    expect(msgs[1]).toEqual({ role: "user", content: "Wer bist du?" });
  });

  it("EUrouter-Chat geht an EUrouter mit dessen Schluessel", async () => {
    const chat = await neuerChat("mistral-small");
    await chatAendern(chat.id, (c) => {
      c.anbieter = "eurouter";
    });
    const n = netz({ [EUROUTER]: [sse(textDelta("ok"))] });
    await direktSenden(chat.id, "hi", { schluessel: { mistral: "m", eurouter: "eu" }, abruf: n.fetch, online });
    expect(n.aufrufe[0].url).toContain("eurouter");
    expect(n.aufrufe[0].auth).toBe("Bearer eu");
  });

  it("mit Datenbank-Schluessel: sucht, nimmt das Gespraech mit (Regel 0p2) und spiegelt danach", async () => {
    const chat = await neuerChat("mistral-large-4-0");
    const n = netz({
      [MISTRAL]: [sse(sucheDelta("Termine morgen")), sse(textDelta("Morgen um 10 Uhr Signicat."))],
      [KB_SUCHE]: [json(200, { ok: true, result: { results: [{ subject: "Termin Signicat", excerpt: "10 Uhr", source: "calendar" }] } })],
      [KB_INGEST]: [json(200, { ok: true, result: { id: 1 } })],
    });
    const runden: number[] = [];
    const fertig = await direktSenden(chat.id, "Was habe ich morgen?", {
      schluessel: { mistral: "m", kb: "kb-key" },
      abruf: n.fetch,
      onRunde: () => runden.push(1),
      online,
    });
    expect(fertig.nachrichten[1].text).toBe("Morgen um 10 Uhr Signicat.");
    expect(fertig.spiegel).toBe("gespiegelt");
    expect(runden.length).toBe(2);
    const erste = n.aufrufe[0].body!;
    expect((erste.tools as unknown[]).length).toBe(1);
    const suche = n.aufrufe.find((x) => x.url.includes("kb_search"))!;
    expect(suche.auth).toBe("Bearer kb-key");
    const args = suche.body!.arguments as Record<string, unknown>;
    expect(args.query).toBe("Termine morgen");
    expect(args.conversation_id).toBe(`goose-handy-iphone-chat-${chat.id}`);
    expect(args.geraet).toBe("iphone");
    expect(args.agent).toBe("goose-handy");
    expect((args.conversation as unknown[]).length).toBeGreaterThan(0);
    const zweite = n.aufrufe.filter((x) => x.url.includes(MISTRAL))[1].body!;
    const tool = (zweite.messages as { role: string; content: string; name?: string }[]).find((m) => m.role === "tool")!;
    expect(tool.content).toContain("Termin Signicat");
    expect(tool.name).toBe("wissensdatenbank_suche");
  });

  it("gescheiterte Suche geht ehrlich ans Modell, die Antwort kommt trotzdem", async () => {
    const chat = await neuerChat("m");
    const n = netz({
      [MISTRAL]: [sse(sucheDelta("x")), sse(textDelta("Die Suche ging nicht."))],
      [KB_SUCHE]: [json(500, {})],
      [KB_INGEST]: [json(200, { ok: true })],
    });
    const fertig = await direktSenden(chat.id, "frage", { schluessel: { mistral: "m", kb: "k" }, abruf: n.fetch, online });
    expect(fertig.nachrichten[1].text).toBe("Die Suche ging nicht.");
    const zweite = n.aufrufe.filter((x) => x.url.includes(MISTRAL))[1].body!;
    expect(JSON.stringify(zweite.messages)).toContain("Suche gescheitert");
  });

  it("offline: Frage bleibt wartend und geht spaeter von selbst raus", async () => {
    const chat = await neuerChat("m");
    const n = netz({ [MISTRAL]: [sse(textDelta("Jetzt ist Netz da."))] });
    await expect(direktSenden(chat.id, "Bist du da?", { schluessel: { mistral: "m" }, abruf: n.fetch, online: () => false })).rejects.toThrow("Kein Netz");
    let c = (await chatLesen(chat.id))!;
    expect(c.nachrichten).toHaveLength(1);
    expect(c.nachrichten[0].status).toBe("wartet");
    expect(n.aufrufe).toHaveLength(0);
    expect(await alleWartendenSenden({ schluessel: { mistral: "m" }, abruf: n.fetch, online })).toBe(1);
    c = (await chatLesen(chat.id))!;
    expect(c.nachrichten.map((x) => [x.rolle, x.status])).toEqual([
      ["nutzer", undefined],
      ["assistent", undefined],
    ]);
  });

  it("Netzfehler unterwegs: wartet; mehrere wartende Fragen gehen in Reihenfolge raus", async () => {
    const chat = await neuerChat("m");
    const weg = netz({ [MISTRAL]: [new TypeError("Failed to fetch")] });
    await expect(direktSenden(chat.id, "eins", { schluessel: { mistral: "m" }, abruf: weg.fetch, online })).rejects.toThrow("nicht erreichbar");
    await expect(direktSenden(chat.id, "zwei", { schluessel: { mistral: "m" }, abruf: weg.fetch, online })).rejects.toThrow();
    const n = netz({ [MISTRAL]: [sse(textDelta("A1")), sse(textDelta("A2"))] });
    expect(await wartendeSenden(chat.id, { schluessel: { mistral: "m" }, abruf: n.fetch, online })).toBe(2);
    const c = (await chatLesen(chat.id))!;
    expect(c.nachrichten.map((x) => x.text)).toEqual(["eins", "A1", "zwei", "A2"]);
    // die zweite Anfrage kennt die erste Antwort
    const msgs = n.aufrufe[1].body!.messages as { role: string; content: string }[];
    expect(msgs.map((m) => m.content).slice(1)).toEqual(["eins", "A1", "zwei"]);
  });

  it("ohne Mistral-Schluessel: wartet mit klarem Grund, kein Netzaufruf", async () => {
    const chat = await neuerChat("m");
    const n = netz({});
    await expect(direktSenden(chat.id, "hi", { schluessel: {}, abruf: n.fetch, online })).rejects.toThrow("Kein Mistral-Schluessel");
    expect((await chatLesen(chat.id))!.nachrichten[0].grund).toContain("Einstellungen");
    expect(n.aufrufe).toHaveLength(0);
  });

  it("abgelehnter Schluessel und Anbieter-Fehler werden verstaendlich gemeldet", async () => {
    const chat = await neuerChat("m");
    const n = netz({ [MISTRAL]: [json(401, { message: "Unauthorized" }), json(400, { message: "Invalid model: xyz" })] });
    await expect(direktSenden(chat.id, "a", { schluessel: { mistral: "m" }, abruf: n.fetch, online })).rejects.toThrow("Schluessel abgelehnt");
    await expect(direktSenden(chat.id, "b", { schluessel: { mistral: "m" }, abruf: n.fetch, online })).rejects.toThrow("Fehler 400: Invalid model: xyz");
    const c = (await chatLesen(chat.id))!;
    expect(c.nachrichten.every((x) => x.status === "wartet")).toBe(true);
  });

  it("leere Nachricht wird nicht gesendet", async () => {
    const chat = await neuerChat("m");
    await expect(direktSenden(chat.id, "   ", { schluessel: { mistral: "m" }, online })).rejects.toThrow("Leere");
  });

  it("schickt dieselbe Frage nie doppelt, waehrend sie laeuft", async () => {
    const chat = await neuerChat("m");
    let loslassen: () => void = () => {};
    const halt = new Promise<void>((r) => (loslassen = r));
    const langsam = (async (_u: RequestInfo | URL, _i?: RequestInit) => {
      await halt;
      return sse(textDelta("fertig"));
    }) as typeof fetch;
    const laeuft = direktSenden(chat.id, "langsam", { schluessel: { mistral: "m" }, abruf: langsam, online });
    await new Promise((r) => setTimeout(r, 5));
    const n = netz({ [MISTRAL]: [sse(textDelta("doppelt"))] });
    expect(await alleWartendenSenden({ schluessel: { mistral: "m" }, abruf: n.fetch, online })).toBe(0);
    loslassen();
    await laeuft;
    expect(n.aufrufe).toHaveLength(0);
    expect((await chatLesen(chat.id))!.nachrichten.map((x) => x.text)).toEqual(["langsam", "fertig"]);
  });
});

describe("Bausteine", () => {
  it("liest nur Text-Bloecke (Mistral Large 4.0 denkt in eigenen Bloecken)", () => {
    expect(inhaltAlsText([{ type: "thinking", thinking: [] }, { type: "text", text: "Antwort" }])).toBe("Antwort");
    expect(inhaltAlsText("x")).toBe("x");
    expect(inhaltAlsText(null)).toBe("");
  });

  it("Verlauf: Hinweise als Nutzer-Notiz, gleiche Rollen zusammengelegt, nur bis zur Frage", () => {
    const v = verlaufFuerAnbieter(
      [
        { id: "s", rolle: "system", text: "Weitergefuehrt vom Mac Mini", zeit: "" },
        { id: "1", rolle: "nutzer", text: "a", zeit: "" },
        { id: "2", rolle: "assistent", text: "b", zeit: "" },
        { id: "3", rolle: "nutzer", text: "c", zeit: "" },
        { id: "4", rolle: "nutzer", text: "d", zeit: "" },
      ],
      "3",
    );
    expect(v).toEqual([
      { role: "user", content: "Hinweis: Weitergefuehrt vom Mac Mini\n\na" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ]);
  });

  it("System-Anlauf nennt iPhone, Datum und die Suche, ohne Gedankenstriche", () => {
    const t = systemAufforderung(new Date("2026-10-29T12:00:00Z"));
    expect(t).toContain("iPhone");
    expect(t).toContain("2026");
    expect(t).toContain("wissensdatenbank_suche");
    expect(t).not.toMatch(/[\u2013\u2014]/);
  });
});
