// Spiegelt einen Direkt-Chat in die Wissensdatenbank (Regel 0p2: ALLE
// Gespraeche, auf jedem Geraet), mit denselben Konventionen wie das Tablet
// (Moose beta, src/lib/gespraechSync.ts): kind conversation, stabile
// conversation_id, Etiketten modell/agent/geraet. Fester source_ref: erneutes
// Spiegeln aktualisiert denselben Eintrag statt ihn zu doppeln.
// Ohne Datenbank-Schluessel oder ohne Netz bleibt der Chat "ausstehend" und
// wird spaeter nachgeholt; das Chatten selbst wartet nie darauf.
import { KB_ADRESSE } from "./kb";
import { alleChats, chatAendern, chatLesen, type DirektChat } from "./speicher";

export const SPIEGEL_QUELLE = "goose-handy";
export const SPIEGEL_AGENT = "goose-handy";
export const SPIEGEL_GERAET = "iphone";

export function conversationId(chatId: string): string {
  return `goose-handy-iphone-chat-${chatId}`;
}

function sprecher(rolle: string): string {
  return rolle === "nutzer" ? "Moritz" : rolle === "assistent" ? "Goose (iPhone)" : "Hinweis";
}

export function spiegelKoerper(chat: DirektChat): Record<string, unknown> {
  const nachrichten = chat.nachrichten;
  const modelle = [...new Set(nachrichten.map((n) => n.modell).filter((m): m is string => !!m && !m.startsWith("Klon")))];
  const modell = modelle[modelle.length - 1] ?? chat.modell;
  const tags = ["agent:goose-handy", "geraet:iphone", ...(modelle.length ? modelle : [modell]).map((m) => `modell:${m}`)];
  return {
    kind: "conversation",
    subject: `Goose iPhone (direkt): ${chat.titel}`,
    body_plain: nachrichten
      .map((n) => `${sprecher(n.rolle)}${n.status === "wartet" ? " (noch ohne Antwort)" : ""}: ${n.text}`)
      .join("\n\n"),
    source: SPIEGEL_QUELLE,
    source_ref: conversationId(chat.id),
    tags,
    metadata: {
      conversation_id: conversationId(chat.id),
      nachrichten: nachrichten.length,
      beitraege_moritz: nachrichten.filter((n) => n.rolle === "nutzer").length,
      geraet: SPIEGEL_GERAET,
      agent: SPIEGEL_AGENT,
      modell,
      modelle,
      erstellt: chat.erstelltAm,
      ...(chat.herkunft ? { klon_von: chat.herkunft } : {}),
    },
  };
}

export async function gespraechSpiegeln(
  chatId: string,
  kbSchluessel: string | null | undefined,
  abruf: typeof fetch = fetch,
): Promise<"gespiegelt" | "ausstehend"> {
  const chat = await chatLesen(chatId);
  if (!chat || chat.nachrichten.length === 0) return "ausstehend";
  const merken = (stand: "gespiegelt" | "ausstehend") =>
    chatAendern(chatId, (c) => {
      c.spiegel = stand;
      if (stand === "gespiegelt") c.spiegelStand = new Date().toISOString();
    });
  if (!kbSchluessel) {
    await merken("ausstehend");
    return "ausstehend";
  }
  try {
    const antwort = await abruf(`${KB_ADRESSE}/kb_ingest_document`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${kbSchluessel}` },
      body: JSON.stringify({ arguments: spiegelKoerper(chat) }),
    });
    if (!antwort.ok) throw new Error(`Datenbank meldet Fehler ${antwort.status}`);
    const daten = (await antwort.json()) as { ok?: boolean };
    if (daten?.ok === false) throw new Error("Datenbank hat das Gespraech abgelehnt");
    await merken("gespiegelt");
    return "gespiegelt";
  } catch {
    await merken("ausstehend");
    return "ausstehend";
  }
}

export async function ausstehendeZahl(): Promise<number> {
  return (await alleChats()).filter((c) => c.spiegel === "ausstehend").length;
}

/** Alle geparkten Gespraeche nachholen (Start mit Schluessel, Netz wieder da). */
export async function ausstehendeSpiegeln(kbSchluessel: string | null | undefined, abruf: typeof fetch = fetch): Promise<number> {
  if (!kbSchluessel) return 0;
  let n = 0;
  for (const c of await alleChats()) {
    if (c.spiegel !== "ausstehend") continue;
    if ((await gespraechSpiegeln(c.id, kbSchluessel, abruf)) === "gespiegelt") n++;
    else break; // Netz oder Datenbank weg: nicht jeden Chat einzeln scheitern lassen
  }
  return n;
}
