// Rechner-Chat auf dem iPhone weiterfuehren (wie "Klonen" auf dem Tablet,
// Moose beta src/lib/klonen.ts): ist Mac Mini oder MacBook aus, wird aus dem
// Zwischenspeicher des Handys (cache.ts, Ende des Verlaufs) ein normaler
// Direkt-Chat "Klon: <Titel>"; danach geht es direkt mit Mistral weiter.
// Nur Text-Beitraege von Moritz und Goose; Werkzeug-Zeilen, Plaene und
// Gedanken bleiben weg. Lange Verlaeufe werden vorne gekuerzt.
// Tablet-Chats (Moose beta) kommen als Kopie aus der Wissensdatenbank
// (tablet.ts) und werden genauso geklont: tabletChatKlonen.
import type { CachedItem } from "../cache";
import { STANDARD_MODELL } from "./anbieter";
import { chatSpeichern, neueId, type DirektChat, type DirektNachricht, type KlonHerkunft } from "./speicher";
import type { TabletVerlauf } from "./tablet";

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
  const quelle = herkunft.hostLabel || "Rechner";
  return klonAnlegen({
    titel,
    beitraege: beitraegeAusZwischenspeicher(items),
    quelle,
    geraet: geraetVonHost(quelle),
    sessionId: herkunft.sessionId,
    leer: "Nichts zum Weiterfuehren: von diesem Chat ist auf dem iPhone kein Verlauf gespeichert.",
    einleitung: (t) => `Weitergefuehrt vom ${quelle}, Chat "${t}".`,
    schluss: " Der Rechner selbst ist nicht beteiligt, seine Werkzeuge stehen hier nicht zur Verfuegung.",
    modell,
    jetzt,
  });
}

/** Tablet-Chat (Kopie aus der Wissensdatenbank) als Direkt-Chat auf dem iPhone. */
export async function tabletChatKlonen(
  verlauf: TabletVerlauf,
  modell: string = STANDARD_MODELL,
  jetzt: Date = new Date(),
): Promise<DirektChat> {
  return klonAnlegen({
    titel: verlauf.titel,
    beitraege: verlauf.beitraege.map((b) => ({ ...b })),
    quelle: "Tablet",
    geraet: "tablet",
    sessionId: verlauf.ref ?? `kb-${verlauf.id}`,
    leer: "Nichts zu klonen: der Tablet-Chat ist leer.",
    einleitung: (t) => `Weitergefuehrt vom Tablet (Moose beta), Chat "${t}", Kopie aus der Wissensdatenbank.`,
    schluss: " Das Tablet selbst ist nicht beteiligt.",
    modell,
    jetzt,
  });
}

async function klonAnlegen(a: {
  titel: string;
  beitraege: Beitrag[];
  quelle: string;
  geraet: KlonHerkunft["geraet"];
  sessionId: string;
  leer: string;
  einleitung: (titel: string) => string;
  schluss: string;
  modell: string;
  jetzt: Date;
}): Promise<DirektChat> {
  const { beitraege, weggelassen } = fuerKlonKuerzen(a.beitraege);
  if (beitraege.length === 0) throw new Error(a.leer);
  const sauber = a.titel.trim().replace(/\s+/g, " ").slice(0, 60) || "Ohne Titel";
  const jetzt = a.jetzt;
  const t0 = jetzt.getTime() - (beitraege.length + 2) * 1000;
  let k = 0;
  const zeit = () => new Date(t0 + 1000 * k++).toISOString();
  const nachrichten: DirektNachricht[] = [
    {
      id: neueId(),
      rolle: "system",
      text:
        a.einleitung(sauber) +
        (weggelassen > 0 ? ` Vorgeschichte gekuerzt: ${weggelassen} aeltere Beitraege nicht uebernommen.` : "") +
        a.schluss,
      zeit: zeit(),
    },
    ...beitraege.map((b) => ({ id: neueId(), rolle: b.rolle, text: b.text, zeit: zeit(), modell: `Klon (${a.quelle})` })),
  ];
  const chat: DirektChat = {
    id: neueId(),
    titel: `Klon: ${sauber}`,
    erstelltAm: jetzt.toISOString(),
    geaendertAm: jetzt.toISOString(),
    modell: a.modell,
    herkunft: { geraet: a.geraet, sessionId: a.sessionId, titel: sauber, geklontAm: jetzt.toISOString() },
    nachrichten,
    spiegel: "ausstehend",
  };
  await chatSpeichern(chat);
  return chat;
}
