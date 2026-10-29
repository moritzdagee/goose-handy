// Nachgebautes Netz fuer die Direkt-Chat-Tests: nie echte Aufrufe.
import { vi } from "vitest";

export type Aufruf = { url: string; init: RequestInit; body: Record<string, unknown> | null; auth: string | null };

export function sse(...stuecke: unknown[]): Response {
  const text = stuecke.map((s) => `data: ${typeof s === "string" ? s : JSON.stringify(s)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(text));
        c.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

export const textDelta = (t: string) => ({ choices: [{ delta: { content: t } }] });
export const sucheDelta = (frage: string, id = "a1") => ({
  choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name: "wissensdatenbank_suche", arguments: JSON.stringify({ frage }) } }] } }],
});

export function json(status: number, daten: unknown): Response {
  return new Response(JSON.stringify(daten), { status, headers: { "Content-Type": "application/json" } });
}

/** fetch-Ersatz: Antworten nach Adresse aus Warteschlangen; protokolliert jeden Aufruf. */
export function netz(routen: Record<string, Array<Response | (() => Response) | Error>>) {
  const aufrufe: Aufruf[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    let body: Record<string, unknown> | null = null;
    try {
      body = init.body ? JSON.parse(String(init.body)) : null;
    } catch {
      body = null;
    }
    const headers = (init.headers ?? {}) as Record<string, string>;
    aufrufe.push({ url, init, body, auth: headers.Authorization ?? null });
    const key = Object.keys(routen).find((k) => url.includes(k));
    const q = key ? routen[key] : undefined;
    const next = q && q.length > 1 ? q.shift() : q?.[0];
    if (!next) throw new TypeError(`unerwarteter Aufruf ${url}`);
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next.clone();
  });
  return { fetch: f as unknown as typeof fetch, aufrufe };
}
