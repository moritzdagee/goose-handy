// Wiederherstellung der iPhone-Direkt-Chats aus der Wissensdatenbank
// (31.10.2026): loescht Moritz das Home-Bildschirm-Lesezeichen und legt es
// neu an, wirft Safari den lokalen Speicher weg und alle Direkt-Chats sind
// verloren. Die Spiegelung (spiegel.ts) hat jeden Chat mit fester Kennung
// source_ref "goose-handy-iphone-chat-<id>" abgelegt. Dieses Modul liest
// diese Eintraege (NUR LESEN) und legt fehlende Chats wieder lokal an.
// Bestehende lokale Chats werden nie ueberschrieben; wiederhergestellte
// Chats bekommen spiegel "gespiegelt", damit sie nicht erneut rausgehen.
// Die Liste der schon entschiedenen Eintraege liegt in localStorage; sie
// faellt mit dem Speicher zusammen weg und baut sich dann einmalig neu auf.
import { STANDARD_MODELL } from "./anbieter";
import { kbWerkzeug, trefferListe } from "./kb";
import { alleChats, chatSpeichern, neueId, type DirektChat, type DirektNachricht, type DirektRolle } from "./speicher";
import { SPIEGEL_QUELLE, SPIEGEL_REF_PRAEFIX } from "./spiegel";

export const WIEDERHERSTELLUNG_LIMIT = 100;
export const WIEDERHERSTELLUNG_KEY = "goose-handy-wiederherstellung-v1";
const BETREFF_PRAEFIX = "Goose iPhone (direkt): ";

// Zeilenanfang einer Nachricht im gespiegelten Verlauf (spiegel.ts baut ihn
// so): "Moritz: ...", "Moritz (noch ohne Antwort): ...", "Goose (iPhone): ..."
// oder "Hinweis: ...", Nachrichten durch Leerzeilen getrennt.
const GRENZE = /(^|\n[ \t]*\n)(Moritz|Goose \(iPhone\)|Hinweis)( \(noch ohne Antwort\))?: /g;

export type SpiegelDokument = {
  subject?: unknown;
  body_plain?: unknown;
  timestamp?: unknown;
  source_ref?: unknown;
  metadata?: unknown;
  tags?: unknown;
};

export type GespiegelterBeitrag = { rolle: DirektRolle; text: string; wartet: boolean };

function isoOderNull(ts: unknown): string | null {
  if (typeof ts !== "string" || !ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function titelAusBetreff(subject: unknown): string {
  const s = typeof subject === "string" ? subject : "";
  return (s.startsWith(BETREFF_PRAEFIX) ? s.slice(BETREFF_PRAEFIX.length) : s).trim();
}

/** Betreff und Verlauf eines gespielten Eintrags wieder in einen DirektChat verwandeln. */
export function spiegelVerlaufZerlegen(body: string): GespiegelterBeitrag[] {
  const text = (body ?? "").replace(/\r\n?/g, "\n");
  const schnitte: { start: number; inhalt: number; rolle: DirektRolle; wartet: boolean }[] = [];
  let letzterInhalt = 0;
  for (const m of text.matchAll(GRENZE)) {
    const start = m.index ?? 0;
    // Code-Zaeune seit der letzten Grenze: ungerade = wir stehen in einem Block.
    const zaeune = (text.slice(letzterInhalt, start).match(/```/g) ?? []).length;
    if (schnitte.length > 0 && zaeune % 2 === 1) continue;
    const inhalt = start + m[0].length;
    const rolle: DirektRolle = m[2] === "Moritz" ? "nutzer" : m[2] === "Hinweis" ? "system" : "assistent";
    schnitte.push({ start, inhalt, rolle, wartet: !!m[3] });
    letzterInhalt = inhalt;
  }
  const out: GespiegelterBeitrag[] = [];
  const vorspann = text.slice(0, schnitte[0]?.start ?? text.length).trim();
  if (vorspann) out.push({ rolle: "assistent", text: vorspann, wartet: false });
  schnitte.forEach((s, i) => {
    const t = text.slice(s.inhalt, schnitte[i + 1]?.start ?? text.length).trim();
    if (t) out.push({ rolle: s.rolle, text: t, wartet: s.wartet });
  });
  return out;
}

/** Reine Umwandlung: ein Datenbank-Eintrag wird wieder ein DirektChat. */
export function chatAusSpiegel(chatId: string, doc: SpiegelDokument): DirektChat | null {
  const beitraege = spiegelVerlaufZerlegen(typeof doc.body_plain === "string" ? doc.body_plain : "");
  if (beitraege.length === 0) return null;
  const metadata = doc.metadata && typeof doc.metadata === "object" ? (doc.metadata as Record<string, unknown>) : {};
  const erstellt = isoOderNull(metadata.erstellt) ?? isoOderNull(doc.timestamp) ?? new Date().toISOString();
  const geaendert = isoOderNull(doc.timestamp) ?? erstellt;
  const nachrichten: DirektNachricht[] = beitraege.map((b) => ({
    id: neueId(),
    rolle: b.rolle,
    text: b.text,
    zeit: "",
    ...(b.wartet ? { status: "wartet" as const } : {}),
  }));
  return {
    id: chatId,
    titel: titelAusBetreff(doc.subject) || "Neuer Chat",
    erstelltAm: erstellt,
    geaendertAm: geaendert,
    modell: STANDARD_MODELL,
    nachrichten,
    spiegel: "gespiegelt",
    spiegelStand: geaendert,
  };
}

// --- Vermerk, welche Eintraege schon entschieden sind -----------------------

function vermerkLesen(): Set<number> {
  try {
    const raw = localStorage.getItem(WIEDERHERSTELLUNG_KEY);
    const g = raw ? (JSON.parse(raw) as { verarbeitet?: unknown }) : null;
    return new Set(Array.isArray(g?.verarbeitet) ? (g!.verarbeitet as number[]).filter((x) => Number.isFinite(x)) : []);
  } catch {
    return new Set();
  }
}

function vermerkSchreiben(ids: Set<number>): void {
  try {
    localStorage.setItem(WIEDERHERSTELLUNG_KEY, JSON.stringify({ verarbeitet: [...ids].slice(-1000) }));
  } catch {
    // voller Speicher: dann laeuft die Pruefung eben beim naechsten Mal wieder
  }
}

/**
 * Fehlende Direkt-Chats aus der Wissensdatenbank ergaenzen.
 * Nur lesend gegenueber der Datenbank und nie ueberschreibend gegenueber
 * lokalen Chats. Wirft, wenn die Datenbank nicht erreichbar ist (der Aufrufer
 * faengt das und versucht es spaeter erneut).
 */
export async function chatsWiederherstellen(
  schluessel: string | null | undefined,
  abruf: typeof fetch = fetch,
): Promise<{ wiederhergestellt: number; gesehen: number }> {
  if (!schluessel) return { wiederhergestellt: 0, gesehen: 0 };
  const roh = await kbWerkzeug(
    "kb_recent",
    { kind: "conversation", source: SPIEGEL_QUELLE, tag: "agent:goose-handy", limit: WIEDERHERSTELLUNG_LIMIT },
    schluessel,
    abruf,
  );
  const liste = trefferListe(roh) as Array<Record<string, unknown>>;
  const vorhanden = new Set((await alleChats()).map((c) => c.id));
  const verarbeitet = vermerkLesen();
  let gesehen = 0;
  let wiederhergestellt = 0;
  for (const t of liste) {
    if (t.source !== SPIEGEL_QUELLE) continue;
    const id = Number(t.id);
    if (!Number.isFinite(id) || verarbeitet.has(id)) continue;
    const rohDoc = (await kbWerkzeug("kb_get_document", { id }, schluessel, abruf)) as Record<string, unknown> | null;
    const doc = (rohDoc && typeof rohDoc === "object" && "document" in rohDoc ? rohDoc.document : rohDoc) as SpiegelDokument | null;
    const ref = typeof doc?.source_ref === "string" ? doc.source_ref : "";
    if (ref.startsWith(SPIEGEL_REF_PRAEFIX)) {
      gesehen++;
      const chatId = ref.slice(SPIEGEL_REF_PRAEFIX.length);
      if (chatId && !vorhanden.has(chatId)) {
        const chat = chatAusSpiegel(chatId, doc!);
        if (chat) {
          await chatSpeichern(chat);
          vorhanden.add(chatId);
          wiederhergestellt++;
        }
      }
    }
    // Jede Entscheidung (hergestellt, schon lokal da, fremde Kennung) bleibt
    // vermerkt; nur Fehler oben lassen den Eintrag offen fuer den naechsten Lauf.
    verarbeitet.add(id);
    vermerkSchreiben(verarbeitet);
  }
  return { wiederhergestellt, gesehen };
}
