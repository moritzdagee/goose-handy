// Chat-Anbieter des Direkt-Chats, wie auf dem Tablet (Moose beta,
// src/lib/anbieter.ts): Mistral direkt ist der Standard, EUrouter der
// Verteiler als zweite Quelle. Beide erlauben Aufrufe aus dem Browser (CORS).
import type { SchluesselWerte } from "./tresor";

export type AnbieterId = "mistral" | "eurouter";

export type AnbieterDef = {
  id: AnbieterId;
  name: string;
  chatAdresse: string;
  modelleAdresse: string;
};

export const ANBIETER: AnbieterDef[] = [
  {
    id: "mistral",
    name: "Mistral",
    chatAdresse: "https://api.mistral.ai/v1/chat/completions",
    modelleAdresse: "https://api.mistral.ai/v1/models",
  },
  {
    id: "eurouter",
    name: "EUrouter",
    chatAdresse: "https://api.eurouter.ai/v1/chat/completions",
    modelleAdresse: "https://api.eurouter.ai/v1/models",
  },
];

// Festes Standard-Modell (Moritz' Entscheidung 27.10.2026): Mistral Large 4.0.
export const STANDARD_MODELL = "mistral-large-4-0";
export const STANDARD_ANBIETER: AnbieterId = "mistral";

export function findeAnbieter(id: string | undefined | null): AnbieterDef {
  return ANBIETER.find((a) => a.id === id) ?? ANBIETER[0];
}

export type ModellAntwort = { id: string; supported_parameters?: string[] };

// EUrouter: nur Modelle mit Werkzeug-Faehigkeit (fuer die Datenbank-Suche).
// Mistral: Einbettungs-, Pruef- und Texterkennungs-Modelle fallen raus.
export function modellTauglich(anbieter: AnbieterId, m: ModellAntwort): boolean {
  if (typeof m?.id !== "string" || m.id.length === 0) return false;
  if (anbieter === "eurouter") return Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools");
  return !/embed|moderation|ocr/i.test(m.id);
}

export async function modelleLaden(anbieter: AnbieterDef, schluessel: string, abruf: typeof fetch = fetch): Promise<string[]> {
  let antwort: Response;
  try {
    antwort = await abruf(anbieter.modelleAdresse, { headers: { Authorization: `Bearer ${schluessel}` } });
  } catch {
    throw new Error(`${anbieter.name} nicht erreichbar (offline?)`);
  }
  if (antwort.status === 401 || antwort.status === 403) throw new Error(`${anbieter.name}: Schluessel abgelehnt`);
  if (!antwort.ok) throw new Error(`${anbieter.name} meldet Fehler ${antwort.status}`);
  const daten = (await antwort.json()) as { data?: ModellAntwort[] };
  if (!Array.isArray(daten?.data)) throw new Error(`${anbieter.name}: Modell-Liste in unerwartetem Format`);
  return [...new Set(daten.data.filter((m) => modellTauglich(anbieter.id, m)).map((m) => m.id))].sort();
}

export type ModellWahl = { id: string; anbieter: AnbieterId; beschriftung: string };

/** Eine Liste aus allen Anbietern, deren Schluessel entsperrt ist. */
export async function alleModelle(
  schluessel: SchluesselWerte,
  abruf: typeof fetch = fetch,
): Promise<{ modelle: ModellWahl[]; fehler: string[] }> {
  const modelle: ModellWahl[] = [];
  const fehler: string[] = [];
  for (const a of ANBIETER) {
    const k = schluessel[a.id];
    if (!k) continue;
    try {
      for (const id of await modelleLaden(a, k, abruf)) {
        modelle.push({ id, anbieter: a.id, beschriftung: a.id === "eurouter" ? `EUrouter: ${id}` : id });
      }
    } catch (f) {
      fehler.push(f instanceof Error ? f.message : String(f));
    }
  }
  return { modelle, fehler };
}

// Zuletzt geladene Liste, damit die Auswahl auch offline etwas zeigt.
export const MODELLE_SPEICHER = "goose-handy-direkt-modelle-v1";

export function gemerkteModelle(): ModellWahl[] {
  try {
    const l = JSON.parse(localStorage.getItem(MODELLE_SPEICHER) ?? "[]") as ModellWahl[];
    return Array.isArray(l) ? l.filter((m) => typeof m?.id === "string" && (m.anbieter === "mistral" || m.anbieter === "eurouter")) : [];
  } catch {
    return [];
  }
}

export function modelleMerken(l: ModellWahl[]): void {
  try {
    localStorage.setItem(MODELLE_SPEICHER, JSON.stringify(l));
  } catch {
    // voll: egal, Liste kommt beim naechsten Mal wieder
  }
}
