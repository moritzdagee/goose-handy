// Rechner-Chat auf dem iPhone weiterfuehren (wie "Klonen" auf dem Tablet,
// Moose beta src/lib/klonen.ts): ist Mac Mini oder MacBook aus, wird aus dem
// Zwischenspeicher des Handys (cache.ts, Ende des Verlaufs) ein normaler
// Direkt-Chat "Klon: <Titel>"; danach geht es direkt mit Mistral weiter.
// Nur Text-Beitraege von Moritz und Goose; Werkzeug-Zeilen, Plaene und
// Gedanken bleiben weg. Lange Verlaeufe werden vorne gekuerzt.
import type { CachedItem } from "../cache";
import { STANDARD_MODELL } from "./anbieter";
import { chatSpeichern, neueId, type DirektChat, type DirektNachricht, type KlonHerkunft } from "./speicher";

export const KLON_MAX_NACHRICHTEN = 40;
export const KLON_MAX_ZEICHEN = 60000;

type Beitrag = { rolle: "nutzer" | "assistent"; text: string };

export function beitraegeAusZwischenspeicher(items: CachedItem[]): Beitrag[] {
  const out: Beitrag[] = [];
  for (const it of items) {
    if (it.kind !== "msg" || (it.role !== "user" && it.role !== "agent")) continue;
    const text = it.text.trim();
    if (!text) continue;
    const rolle = it.role === "user" ? "nutzer" : "assistent";
    const letzte = out[out.length - 1];
    if (letzte && letzte.rolle === rolle) letzte.text = `${letzte.text}\n\n${text}`;
    else out.push({ rolle, text });
  }
  return out;
}

export function fuerKlonKuerzen(liste: Beitrag[]): { beitraege: Beitrag[]; weggelassen: number } {
  let behalten = liste.slice(-KLON_MAX_NACHRICHTEN);
  let summe = 0;
  let ab = behalten.length;
  while (ab > 0 && summe + behalten[ab - 1].text.length <= KLON_MAX_ZEICHEN) {
    summe += behalten[ab - 1].text.length;
    ab--;
  }
  if (ab === behalten.length && behalten.length > 0) {
    const l = behalten[behalten.length - 1];
    behalten = [{ ...l, text: l.text.slice(-KLON_MAX_ZEICHEN) }];
  } else {
    behalten = behalten.slice(ab);
  }
  return { beitraege: behalten, weggelassen: liste.length - behalten.length };
}

export function geraetVonHost(label: string): KlonHerkunft["geraet"] {
  return /mini/i.test(label) ? "mini" : /book/i.test(label) ? "macbook" : "unbekannt";
}

export async function aufIphoneKlonen(
  titel: string,
  items: CachedItem[],
  herkunft: { hostLabel: string; sessionId: string },
  modell: string = STANDARD_MODELL,
  jetzt: Date = new Date(),
): Promise<DirektChat> {
  const { beitraege, weggelassen } = fuerKlonKuerzen(beitraegeAusZwischenspeicher(items));
  if (beitraege.length === 0) throw new Error("Nichts zum Weiterfuehren: von diesem Chat ist auf dem iPhone kein Verlauf gespeichert.");
  const sauber = titel.trim().replace(/\s+/g, " ").slice(0, 60) || "Ohne Titel";
  const quelle = herkunft.hostLabel || "Rechner";
  const t0 = jetzt.getTime() - (beitraege.length + 2) * 1000;
  let k = 0;
  const zeit = () => new Date(t0 + 1000 * k++).toISOString();
  const nachrichten: DirektNachricht[] = [
    {
      id: neueId(),
      rolle: "system",
      text:
        `Weitergefuehrt vom ${quelle}, Chat "${sauber}".` +
        (weggelassen > 0 ? ` Vorgeschichte gekuerzt: ${weggelassen} aeltere Beitraege nicht uebernommen.` : "") +
        " Der Rechner selbst ist nicht beteiligt, seine Werkzeuge stehen hier nicht zur Verfuegung.",
      zeit: zeit(),
    },
    ...beitraege.map((b) => ({ id: neueId(), rolle: b.rolle, text: b.text, zeit: zeit(), modell: `Klon (${quelle})` })),
  ];
  const chat: DirektChat = {
    id: neueId(),
    titel: `Klon: ${sauber}`,
    erstelltAm: jetzt.toISOString(),
    geaendertAm: jetzt.toISOString(),
    modell,
    herkunft: { geraet: geraetVonHost(quelle), sessionId: herkunft.sessionId, titel: sauber, geklontAm: jetzt.toISOString() },
    nachrichten,
    spiegel: "ausstehend",
  };
  await chatSpeichern(chat);
  return chat;
}
