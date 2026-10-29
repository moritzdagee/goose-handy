// Chats vom Android-Tablet (App Moose beta) auf dem iPhone (29.10.2026).
// Das Tablet ist kein Gastgeber, man kann dort nicht live weitermachen. Es
// spiegelt aber jedes Gespraech in die Wissensdatenbank (Moose beta,
// src/lib/gespraechSync.ts): kind conversation, source "moose-beta", Betreff
// "Moose beta (Tablet): <Titel>", Verlauf als Zeilen "Moritz: <text>" und
// "Moose beta: <text>", getrennt durch Leerzeilen. Von dort liest das iPhone
// die Liste und einzelne Verlaeufe (NUR LESEN), zeigt sie als "Kopie aus der
// Datenbank" und kann sie als Direkt-Chat klonen (klonen.ts).
// Offline gilt der gemerkte Stand (localStorage, wie cache.ts).
import type { TaggedSession } from "../sessions";
import { TABLET_HOST } from "../sessions";
import { kbWerkzeug, trefferListe } from "./kb";

export const TABLET_QUELLE = "moose-beta";
export const TABLET_LABEL = "Tablet";
export const TABLET_LISTE_MAX = 50;
export const TABLET_LISTE_KEY = "goose-handy-tablet-liste-v1";
export const TABLET_CHAT_PREFIX = "goose-handy-tablet-chat-v1:";
export const TABLET_CHAT_INDEX_KEY = "goose-handy-tablet-chat-index-v1";
export const TABLET_CHATS_GEMERKT = 15;

const BETREFF_PRAEFIX = "Moose beta (Tablet): ";

export type TabletEintrag = { id: number; titel: string; zeit: string | null; auszug: string };
export type TabletBeitrag = { rolle: "nutzer" | "assistent"; text: string };
export type TabletVerlauf = { id: number; ref: string | null; titel: string; zeit: string | null; beitraege: TabletBeitrag[] };

export function tabletTitel(subject: unknown): string {
  const s = typeof subject === "string" ? subject : "";
  return (s.startsWith(BETREFF_PRAEFIX) ? s.slice(BETREFF_PRAEFIX.length) : s).trim();
}

export function zeitIso(ts: unknown): string | null {
  if (typeof ts !== "string" || !ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Neue Nachricht = Textanfang oder Leerzeile, dann "Moritz: " bzw. "Moose beta: ".
// Eine Sprecher-Zeile ohne Leerzeile davor gehoert zum Text (z. B. ein
// zitierter Entwurf). Innerhalb eines Code-Blocks (```) wird nie getrennt.
// Grenzfall, der bleibt: ein Text mit Leerzeile plus "Moritz: " ausserhalb
// eines Code-Blocks wird als neue Nachricht gelesen; das Tablet-Format
// unterscheidet das nicht.
const GRENZE = /(^|\n[ \t]*\n)(Moritz|Moose beta): /g;

export function verlaufZerlegen(body: string): TabletBeitrag[] {
  const text = (body ?? "").replace(/\r\n?/g, "\n");
  const schnitte: { start: number; inhalt: number; rolle: TabletBeitrag["rolle"] }[] = [];
  let letzterInhalt = 0;
  for (const m of text.matchAll(GRENZE)) {
    const start = m.index ?? 0;
    // Code-Zaeune seit der letzten Grenze: ungerade = wir stehen in einem Block.
    const zaeune = (text.slice(letzterInhalt, start).match(/```/g) ?? []).length;
    if (schnitte.length > 0 && zaeune % 2 === 1) continue;
    const inhalt = start + m[0].length;
    schnitte.push({ start, inhalt, rolle: m[2] === "Moritz" ? "nutzer" : "assistent" });
    letzterInhalt = inhalt;
  }
  const out: TabletBeitrag[] = [];
  const vorspann = text.slice(0, schnitte[0]?.start ?? text.length).trim();
  if (vorspann) out.push({ rolle: "assistent", text: vorspann });
  schnitte.forEach((s, i) => {
    const t = text.slice(s.inhalt, schnitte[i + 1]?.start ?? text.length).trim();
    if (t) out.push({ rolle: s.rolle, text: t });
  });
  return out;
}

/** Die letzten Tablet-Chats (nur lesen). Spiegelungen anderer Geraete fliegen raus. */
export async function tabletListeHolen(schluessel: string, abruf: typeof fetch = fetch): Promise<TabletEintrag[]> {
  const roh = await kbWerkzeug("kb_recent", { kind: "conversation", source: TABLET_QUELLE, limit: TABLET_LISTE_MAX }, schluessel, abruf);
  const gesehen = new Set<number>();
  const out: TabletEintrag[] = [];
  for (const t of trefferListe(roh) as Array<Record<string, unknown>>) {
    const id = Number(t.id);
    if (t.source !== TABLET_QUELLE || !Number.isFinite(id) || gesehen.has(id)) continue;
    gesehen.add(id);
    out.push({ id, titel: tabletTitel(t.subject), zeit: zeitIso(t.timestamp), auszug: typeof t.excerpt === "string" ? t.excerpt : "" });
  }
  return out;
}

/** Einen Tablet-Chat ganz lesen (nur lesen). */
export async function tabletVerlaufHolen(id: number, schluessel: string, abruf: typeof fetch = fetch): Promise<TabletVerlauf> {
  const roh = (await kbWerkzeug("kb_get_document", { id }, schluessel, abruf)) as Record<string, unknown> | null;
  const doc = (roh && typeof roh === "object" && "document" in roh ? roh.document : roh) as Record<string, unknown> | null;
  if (!doc || doc.source !== TABLET_QUELLE) throw new Error("Das ist kein Tablet-Chat (Eintrag nicht gefunden).");
  return {
    id,
    ref: typeof doc.source_ref === "string" && doc.source_ref ? doc.source_ref : null,
    titel: tabletTitel(doc.subject),
    zeit: zeitIso(doc.timestamp),
    beitraege: verlaufZerlegen(typeof doc.body_plain === "string" ? doc.body_plain : ""),
  };
}

// --- Zwischenspeicher (offline) ---------------------------------------------

function lesen<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function schreiben(key: string, wert: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(wert));
    return true;
  } catch {
    return false;
  }
}

export function listeMerken(eintraege: TabletEintrag[], stand: string = new Date().toISOString()): void {
  schreiben(TABLET_LISTE_KEY, { eintraege, stand });
}

export function gemerkteListe(): { eintraege: TabletEintrag[]; stand: string | null } {
  const g = lesen<{ eintraege?: unknown; stand?: unknown }>(TABLET_LISTE_KEY);
  if (!g || !Array.isArray(g.eintraege)) return { eintraege: [], stand: null };
  const eintraege = (g.eintraege as TabletEintrag[]).filter((e) => e && typeof e.id === "number");
  return { eintraege, stand: typeof g.stand === "string" ? g.stand : null };
}

/** Geoeffneten Verlauf merken; die zuletzt geoeffneten bleiben, bei vollem Speicher die aeltesten raus. */
export function verlaufMerken(v: TabletVerlauf): void {
  const key = `${TABLET_CHAT_PREFIX}${v.id}`;
  let index = (lesen<string[]>(TABLET_CHAT_INDEX_KEY) ?? []).filter((k) => k !== key);
  index.unshift(key);
  for (const alt of index.slice(TABLET_CHATS_GEMERKT)) localStorage.removeItem(alt);
  index = index.slice(0, TABLET_CHATS_GEMERKT);
  while (!schreiben(key, v) && index.length > 1) localStorage.removeItem(index.pop() as string);
  schreiben(TABLET_CHAT_INDEX_KEY, index);
}

export function gemerkterVerlauf(id: number): TabletVerlauf | null {
  const v = lesen<TabletVerlauf>(`${TABLET_CHAT_PREFIX}${id}`);
  return v && Array.isArray(v.beitraege) ? v : null;
}

// --- Listen und Hinweise ------------------------------------------------------

export function tabletAlsSitzungen(eintraege: TabletEintrag[]): TaggedSession[] {
  return eintraege.map(
    (e) =>
      ({
        sessionId: String(e.id),
        cwd: "",
        title: e.titel || null,
        updatedAt: e.zeit,
        _host: TABLET_HOST,
      }) as TaggedSession,
  );
}

/** Satz ueber der Tablet-Liste, wenn etwas fehlt; null = alles in Ordnung. */
export function tabletHinweis(z: {
  kbDa: boolean;
  hinterlegt: boolean;
  fehlerhaft: boolean;
  tresorDa: boolean;
  fehler: string | null;
  stand: string | null;
}): string | null {
  if (!z.kbDa) {
    if (z.hinterlegt && z.fehlerhaft) return "Der Datenbank-Schluessel laesst sich nicht oeffnen. Unter Einstellungen neu eintragen, dann erscheinen die Tablet-Chats.";
    if (z.hinterlegt && !z.tresorDa) return "Tablet-Chats kommen nach dem Entsperren mit Face ID.";
    if (z.hinterlegt) return null; // wird gerade geoeffnet
    return "Tablet-Chats kommen aus der Wissensdatenbank. Dafuer einmal den Datenbank-Schluessel unter Einstellungen eintragen.";
  }
  if (!z.fehler) return null;
  const stand = z.stand ? new Date(z.stand).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : null;
  return `${z.fehler}${stand ? ` Gezeigt wird der gemerkte Stand vom ${stand}.` : ""}`;
}
