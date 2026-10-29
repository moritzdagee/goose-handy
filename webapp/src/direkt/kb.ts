// Wissensdatenbank ueber die Werkzeug-Bruecke kb.bios.love (wie Moose beta,
// src/lib/kb.ts). Aus Safari moeglich, seit die Bruecke die Herkunft
// https://moritzdagee.github.io zulaesst (assistant_data #617, 29.10.2026).
// Der Bearer-Schluessel bleibt Pflicht.
export const KB_ADRESSE = "https://kb.bios.love/api/kb/mcp-tool";

// Die Bruecke liefert Ergebnisse direkt oder als MCP-Inhaltsblock.
export function auspacken(roh: unknown): unknown {
  if (roh && typeof roh === "object" && "content" in roh) {
    const inhalt = (roh as { content: unknown }).content;
    if (Array.isArray(inhalt) && inhalt[0] && typeof inhalt[0] === "object" && "text" in inhalt[0]) {
      const text = (inhalt[0] as { text: string }).text;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
  }
  return roh;
}

export async function kbWerkzeug(
  name: string,
  argumente: Record<string, unknown>,
  schluessel: string,
  abruf: typeof fetch = fetch,
): Promise<unknown> {
  if (!schluessel) throw new Error("Kein Datenbank-Schluessel hinterlegt.");
  let antwort: Response;
  try {
    antwort = await abruf(`${KB_ADRESSE}/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${schluessel}` },
      body: JSON.stringify({ arguments: argumente }),
    });
  } catch {
    throw new Error("Wissensdatenbank nicht erreichbar (offline?)");
  }
  if (antwort.status === 401 || antwort.status === 403) throw new Error("Datenbank-Schluessel abgelehnt.");
  if (!antwort.ok) throw new Error(`Wissensdatenbank meldet Fehler ${antwort.status}`);
  const huelle = (await antwort.json()) as { ok?: boolean; result?: unknown; error?: string };
  if (huelle?.ok === false) throw new Error(`Wissensdatenbank: ${huelle.error ?? "unbekannter Fehler"}`);
  return auspacken(huelle?.result);
}

export type KbTreffer = { subject?: string; titel?: string; excerpt?: string; source?: string; timestamp?: string };

export function trefferListe(roh: unknown): KbTreffer[] {
  const r = roh as Record<string, unknown> | unknown[] | null;
  const kandidat = Array.isArray(r) ? r : r && typeof r === "object" ? (r.results ?? r.documents ?? r.items) : undefined;
  return Array.isArray(kandidat) ? (kandidat.filter((e) => e && typeof e === "object") as KbTreffer[]) : [];
}
