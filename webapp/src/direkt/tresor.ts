// Schluessel-Tresor fuer den Direkt-Chat (29.10.2026): Mistral-, EUrouter-
// und Datenbank-Schluessel liegen nur verschluesselt im Browser-Speicher
// (AES-GCM). Der Schluessel dazu entsteht beim Entsperren mit Face ID aus
// dem Passkey (lock.ts, vaultKey) und lebt nur im Arbeitsspeicher der
// geoeffneten App; er ist nicht auslesbar. Ohne Face ID: kein Klartext.
import { TRESOR_STORAGE_KEY, b64url, fromB64url, type Sealed } from "../lock";

export type SchluesselSlot = "mistral" | "eurouter" | "kb";
export const SCHLUESSEL_SLOTS: SchluesselSlot[] = ["mistral", "eurouter", "kb"];

export type SchluesselWerte = Partial<Record<SchluesselSlot, string>>;

type TresorDaten = { v: 1; eintraege: Partial<Record<SchluesselSlot, Sealed>> };

function lesen(): TresorDaten {
  try {
    const roh = localStorage.getItem(TRESOR_STORAGE_KEY);
    const d = roh ? (JSON.parse(roh) as TresorDaten) : null;
    if (d?.v === 1 && d.eintraege && typeof d.eintraege === "object") return d;
  } catch {
    // kaputt: wie leer behandeln
  }
  return { v: 1, eintraege: {} };
}

function schreiben(d: TresorDaten): void {
  localStorage.setItem(TRESOR_STORAGE_KEY, JSON.stringify(d));
}

// Der Fach-Name ist Zusatzdaten der Verschluesselung: ein Mistral-Eintrag
// laesst sich nicht als Datenbank-Schluessel unterschieben.
function zusatz(slot: SchluesselSlot): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`goose-handy-tresor:${slot}`) as Uint8Array<ArrayBuffer>;
}

export async function verschluesseln(key: CryptoKey, slot: SchluesselSlot, wert: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: zusatz(slot) },
    key,
    new TextEncoder().encode(wert),
  );
  return { iv: b64url(iv), ct: b64url(ct) };
}

export async function entschluesseln(key: CryptoKey, slot: SchluesselSlot, sealed: Sealed): Promise<string> {
  const klar = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(sealed.iv), additionalData: zusatz(slot) },
    key,
    fromB64url(sealed.ct),
  );
  return new TextDecoder().decode(klar);
}

/** Speichert einen Schluessel verschluesselt; Leerzeichen am Rand fallen weg. */
export async function schluesselSpeichern(key: CryptoKey, slot: SchluesselSlot, wert: string): Promise<string> {
  const sauber = wert.trim();
  if (!sauber) throw new Error("Leerer Schluessel wird nicht gespeichert.");
  if (/\s/.test(sauber)) throw new Error("Der Schluessel enthaelt Leerzeichen. Bitte nur den Schluessel einfuegen.");
  const d = lesen();
  d.eintraege[slot] = await verschluesseln(key, slot, sauber);
  schreiben(d);
  return sauber;
}

export function schluesselEntfernen(slot: SchluesselSlot): void {
  const d = lesen();
  delete d.eintraege[slot];
  schreiben(d);
}

export function hinterlegteSlots(): SchluesselSlot[] {
  const d = lesen();
  return SCHLUESSEL_SLOTS.filter((s) => !!d.eintraege[s]);
}

/**
 * Alle hinterlegten Schluessel entschluesseln. Ein Eintrag, der sich nicht
 * oeffnen laesst (anderer Passkey, veraendert), steht in `fehler` statt die
 * anderen mitzureissen.
 */
export async function alleSchluesselLesen(key: CryptoKey): Promise<{ werte: SchluesselWerte; fehler: SchluesselSlot[] }> {
  const d = lesen();
  const werte: SchluesselWerte = {};
  const fehler: SchluesselSlot[] = [];
  for (const slot of SCHLUESSEL_SLOTS) {
    const e = d.eintraege[slot];
    if (!e) continue;
    try {
      werte[slot] = await entschluesseln(key, slot, e);
    } catch {
      fehler.push(slot);
    }
  }
  return { werte, fehler };
}
