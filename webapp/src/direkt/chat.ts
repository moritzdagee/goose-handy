// Direkt-Chat: das iPhone fragt Mistral (oder EUrouter) selbst, ohne Mac
// Mini und MacBook. Ablauf wie auf dem Tablet (Moose beta, src/lib/chat.ts):
// System-Anlauf, Verlauf, Such-Werkzeug fuer die Wissensdatenbank (nur mit
// Datenbank-Schluessel), Antwort als Strom. Scheitert etwas (kein Netz,
// Anbieter weg), bleibt die Frage als "wartet" im Chat stehen und geht
// spaeter von selbst raus (wartendeSenden, alleWartendenSenden).
import { findeAnbieter, STANDARD_MODELL } from "./anbieter";
import { kbWerkzeug, trefferListe } from "./kb";
import { gespraechSpiegeln, conversationId } from "./spiegel";
import { chatAendern, chatLesen, neueId, titelAusText, alleChats, type DirektChat, type DirektNachricht } from "./speicher";
import { stromChatAufruf, type WerkzeugAufruf } from "./strom";
import type { SchluesselWerte } from "./tresor";

export function systemAufforderung(jetzt: Date = new Date()): string {
  const datum = jetzt.toLocaleDateString("de-DE", { dateStyle: "full" });
  return [
    `Du bist Goose, der KI-Assistent auf Moritz Cremers iPhone. Heute ist ${datum}.`,
    "Antworte auf Deutsch, klar und knapp; Moritz liest auf dem Handy.",
    "Moritz arbeitet im Vertrieb bei Signicat, betreibt das Second-Hand-Geschaeft Tangerina",
    "und baut das Startup TrustAI. Er lebt in Brasilien.",
    "Fuer alles, was seine Mails, Termine, Chats, Dokumente, Projekte oder Kontakte betrifft,",
    "nutze ZUERST das Werkzeug wissensdatenbank_suche, sofern es angeboten wird, und antworte auf seiner Grundlage.",
    "Erfinde keine Fakten ueber seine Welt. Wenn die Suche nichts findet oder nicht verfuegbar ist, sag das ehrlich.",
    "Keine Gedankenstriche (weder lang noch mittellang) im Text.",
  ].join(" ");
}

export const WERKZEUG_SUCHE = {
  type: "function",
  function: {
    name: "wissensdatenbank_suche",
    description:
      "Durchsucht Moritz' Wissensdatenbank (Mails, Chats, Kalender, Dokumente, Notizen). Immer benutzen, wenn die Frage seine Welt betrifft.",
    parameters: {
      type: "object",
      properties: { frage: { type: "string", description: "Die Suchfrage in wenigen Worten" } },
      required: ["frage"],
    },
  },
};

const MAX_WERKZEUG_RUNDEN = 4;
const ENDRUNDEN_HINWEIS = "Beantworte die Frage jetzt mit dem Gesammelten, ohne weitere Suche.";

type ApiNachricht = {
  role: string;
  content?: string | null;
  tool_calls?: WerkzeugAufruf[];
  tool_call_id?: string;
  name?: string;
};

export type DirektOptionen = {
  schluessel: SchluesselWerte;
  abruf?: typeof fetch;
  /** Sichtbarer Fortschritt ("Sende an Mistral..."). */
  onStatus?: (text: string) => void;
  /** Jedes Textstueck der Antwort sofort. */
  onChunk?: (text: string) => void;
  /** Neue Runde beginnt (nach einer Suche): bisher gestroemten Text verwerfen. */
  onRunde?: () => void;
  /** Netz-Zustand; Standard navigator.onLine. */
  online?: () => boolean;
};

export class WartetFehler extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WartetFehler";
  }
}

// Mistral Large 4.0 antwortet teils mit Bloecken (Denken + Text): nur Text zeigen.
export function inhaltAlsText(inhalt: unknown): string {
  if (typeof inhalt === "string") return inhalt;
  if (Array.isArray(inhalt)) {
    return inhalt
      .filter((b) => b && typeof b === "object" && (b as { type?: string }).type === "text")
      .map((b) => String((b as { text?: unknown }).text ?? ""))
      .join("\n");
  }
  return "";
}

/** Verlauf bis einschliesslich der Frage, gleiche Rollen hintereinander zusammengelegt. */
export function verlaufFuerAnbieter(nachrichten: DirektNachricht[], bisId: string): ApiNachricht[] {
  const ende = nachrichten.findIndex((n) => n.id === bisId);
  const teil = ende < 0 ? nachrichten : nachrichten.slice(0, ende + 1);
  const out: ApiNachricht[] = [];
  for (const n of teil) {
    if (!n.text.trim()) continue;
    const role = n.rolle === "assistent" ? "assistant" : "user";
    const content = n.rolle === "system" ? `Hinweis: ${n.text}` : n.text;
    const letzte = out[out.length - 1];
    if (letzte && letzte.role === role) letzte.content = `${letzte.content}\n\n${content}`;
    else out.push({ role, content });
  }
  return out;
}

async function suche(frage: string, chat: DirektChat, kb: string, abruf: typeof fetch): Promise<string> {
  // Regel 0p2: jede Datenbank-Abfrage nimmt das laufende Gespraech mit.
  const conversation = chat.nachrichten.slice(-12).map((n) => ({
    role: n.rolle === "assistent" ? "assistant" : "user",
    content: n.text.slice(0, 4000),
    ...(n.modell ? { modell: n.modell } : {}),
  }));
  const roh = await kbWerkzeug(
    "kb_search",
    {
      query: frage,
      limit: 8,
      conversation,
      conversation_id: conversationId(chat.id),
      geraet: "iphone",
      agent: "goose-handy",
      modell: chat.modell,
    },
    kb,
    abruf,
  );
  return JSON.stringify(
    trefferListe(roh)
      .slice(0, 5)
      .map((t) => ({ betreff: t.subject ?? t.titel ?? "", auszug: t.excerpt ?? "", quelle: t.source ?? "", zeit: t.timestamp ?? "" })),
  );
}

async function wartetMerken(chatId: string, nachrichtId: string, grund: string): Promise<void> {
  await chatAendern(chatId, (c) => {
    const n = c.nachrichten.find((x) => x.id === nachrichtId);
    if (n) {
      n.status = "wartet";
      n.grund = grund;
    }
  });
}

// Chats, in denen gerade eine Antwort laeuft: das Nachholen wartender Fragen
// (Netz kommt zurueck) darf dieselbe Frage nicht ein zweites Mal schicken.
const laufend = new Set<string>();

export function laeuftGerade(chatId: string): boolean {
  return laufend.has(chatId);
}

/**
 * Holt die Antwort auf eine (schon gespeicherte) Frage und setzt sie direkt
 * dahinter. Scheitert es, bleibt die Frage "wartet" und der Fehler fliegt.
 */
export async function antwortHolen(chatId: string, nachrichtId: string, opt: DirektOptionen): Promise<DirektChat> {
  if (laufend.has(chatId)) throw new Error("In diesem Chat laeuft schon eine Antwort.");
  laufend.add(chatId);
  try {
    return await antwortHolenOhneSperre(chatId, nachrichtId, opt);
  } finally {
    laufend.delete(chatId);
  }
}

async function antwortHolenOhneSperre(chatId: string, nachrichtId: string, opt: DirektOptionen): Promise<DirektChat> {
  const abruf = opt.abruf ?? fetch.bind(globalThis);
  const sagen = opt.onStatus ?? (() => {});
  const chat = await chatLesen(chatId);
  if (!chat) throw new Error("Chat nicht gefunden");
  const anbieter = findeAnbieter(chat.anbieter);
  const schluessel = opt.schluessel[anbieter.id];
  if (!schluessel) {
    const grund = `Kein ${anbieter.name}-Schluessel hinterlegt. In den Einstellungen eintragen.`;
    await wartetMerken(chatId, nachrichtId, grund);
    throw new WartetFehler(grund);
  }
  const online = opt.online ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  if (!online()) {
    const grund = "Kein Netz. Die Nachricht geht automatisch raus, sobald wieder Netz da ist.";
    await wartetMerken(chatId, nachrichtId, grund);
    throw new WartetFehler(grund);
  }
  const modell = chat.modell || STANDARD_MODELL;
  const kb = opt.schluessel.kb ?? null;
  const werkzeuge = kb ? [WERKZEUG_SUCHE] : [];
  const lauf: ApiNachricht[] = [{ role: "system", content: systemAufforderung() }, ...verlaufFuerAnbieter(chat.nachrichten, nachrichtId)];

  let antwort = "";
  try {
    for (let runde = 1; ; runde++) {
      const letzte = runde > MAX_WERKZEUG_RUNDEN;
      if (letzte) lauf.push({ role: "user", content: ENDRUNDEN_HINWEIS });
      opt.onRunde?.();
      sagen(runde === 1 ? `Frage ${anbieter.name}...` : `Frage ${anbieter.name} (Runde ${runde})...`);
      const angebot = letzte ? [] : werkzeuge;
      let strom;
      try {
        strom = await stromChatAufruf(
          anbieter.chatAdresse,
          schluessel,
          { model: modell, messages: lauf, ...(angebot.length ? { tools: angebot, tool_choice: "auto" } : {}) },
          opt.onChunk ?? (() => {}),
          abruf,
        );
      } catch {
        throw new WartetFehler(`${anbieter.name} nicht erreichbar (Netz weg?). Die Nachricht wartet.`);
      }
      if (strom.status === 401 || strom.status === 403) throw new Error(`${anbieter.name}: Schluessel abgelehnt. In den Einstellungen pruefen.`);
      if (!strom.ok) {
        let grund = "";
        try {
          const f = JSON.parse(strom.fehlerKoerper ?? "") as { message?: string };
          if (f.message) grund = `: ${String(f.message).slice(0, 150)}`;
        } catch {
          // ohne Details
        }
        throw new Error(`${anbieter.name} meldet Fehler ${strom.status}${grund}`);
      }
      const text = inhaltAlsText(strom.nachricht.content);
      const aufrufe = strom.nachricht.tool_calls ?? [];
      if (!letzte && angebot.length && aufrufe.length) {
        lauf.push({ role: "assistant", ...(text ? { content: text } : {}), tool_calls: aufrufe });
        for (const a of aufrufe) {
          let ergebnis: string;
          try {
            const args = JSON.parse(a.function?.arguments || "{}") as { frage?: string };
            sagen(`Durchsuche die Wissensdatenbank: "${args.frage ?? ""}"`);
            ergebnis = await suche(String(args.frage ?? ""), chat, kb as string, abruf);
          } catch (f) {
            ergebnis = `Suche gescheitert: ${f instanceof Error ? f.message : String(f)}`;
          }
          lauf.push({ role: "tool", tool_call_id: a.id, name: a.function?.name || "wissensdatenbank_suche", content: ergebnis });
        }
        continue;
      }
      if (!text.trim() && !letzte) {
        runde = MAX_WERKZEUG_RUNDEN; // naechste Runde ohne Werkzeuge
        continue;
      }
      antwort = text.trim();
      break;
    }
    if (!antwort) throw new Error("Antwort des Anbieters war leer");
  } catch (f) {
    const grund = f instanceof Error ? f.message : String(f);
    await wartetMerken(chatId, nachrichtId, grund);
    throw f;
  }

  const fertig = await chatAendern(chatId, (c) => {
    const i = c.nachrichten.findIndex((x) => x.id === nachrichtId);
    const frage = c.nachrichten[i];
    if (frage) {
      delete frage.status;
      delete frage.grund;
    }
    const neu: DirektNachricht = { id: neueId(), rolle: "assistent", text: antwort, zeit: new Date().toISOString(), modell };
    c.nachrichten.splice(i < 0 ? c.nachrichten.length : i + 1, 0, neu);
    c.geaendertAm = neu.zeit;
    c.spiegel = "ausstehend";
  });
  if (kb) {
    sagen("Spiegle das Gespraech in die Wissensdatenbank...");
    const stand = await gespraechSpiegeln(chatId, kb, abruf);
    sagen(stand === "gespiegelt" ? "Gespraech ist in der Wissensdatenbank." : "Spiegeln wartet (Netz?), wird nachgeholt.");
    return (await chatLesen(chatId)) ?? fertig;
  }
  return fertig;
}

/** Neue Frage speichern und beantworten lassen. */
export async function direktSenden(chatId: string, text: string, opt: DirektOptionen): Promise<DirektChat> {
  const sauber = text.trim();
  if (!sauber) throw new Error("Leere Nachricht wird nicht gesendet");
  const id = neueId();
  await chatAendern(chatId, (c) => {
    if (c.titel === "Neuer Chat" && !c.nachrichten.some((n) => n.rolle === "nutzer")) c.titel = titelAusText(sauber);
    const zeit = new Date().toISOString();
    // Bis die Antwort da ist, gilt die Frage als wartend: stirbt die App
    // mittendrin (iOS wirft sie weg), geht sie beim naechsten Start raus.
    c.nachrichten.push({ id, rolle: "nutzer", text: sauber, zeit, status: "wartet", grund: "wird gesendet" });
    c.geaendertAm = zeit;
  });
  return antwortHolen(chatId, id, opt);
}

/** Wartende Fragen eines Chats der Reihe nach; stoppt beim ersten Fehler. */
export async function wartendeSenden(chatId: string, opt: DirektOptionen): Promise<number> {
  if (laufend.has(chatId)) return 0;
  let n = 0;
  for (;;) {
    const c = await chatLesen(chatId);
    const naechste = c?.nachrichten.find((x) => x.rolle === "nutzer" && x.status === "wartet");
    if (!naechste) return n;
    try {
      await antwortHolen(chatId, naechste.id, opt);
      n++;
    } catch {
      return n;
    }
  }
}

export async function alleWartendenSenden(opt: DirektOptionen): Promise<number> {
  let n = 0;
  for (const c of await alleChats()) {
    if (c.archiviert || !c.nachrichten.some((x) => x.status === "wartet")) continue;
    n += await wartendeSenden(c.id, opt);
  }
  return n;
}
