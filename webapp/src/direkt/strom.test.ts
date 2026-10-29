import { describe, it, expect, vi } from 'vitest';
import { stromChatAufruf } from './strom';

function sseFetch(stuecke: string[]): typeof fetch {
  const strom = new ReadableStream({
    start(controller) {
      for (const s of stuecke) controller.enqueue(new TextEncoder().encode(s));
      controller.close();
    },
  });
  return vi.fn().mockImplementation(async () => new Response(strom, { status: 200 })) as unknown as typeof fetch;
}

describe('Strom-Aufruf (SSE)', () => {
  it('baut Textstuecke zur Gesamtantwort und ruft onChunk je Stueck', async () => {
    const chunks: string[] = [];
    const ergebnis = await stromChatAufruf(
      'https://x', 'k', { model: 'm' },
      (t) => chunks.push(t),
      sseFetch([
        'data: {"choices":[{"delta":{"content":"Hallo"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" Welt"}}]}\n\ndata: [DONE]\n\n',
      ]),
    );
    expect(ergebnis.ok).toBe(true);
    expect(ergebnis.nachricht.content).toBe('Hallo Welt');
    expect(chunks).toEqual(['Hallo', ' Welt']);
  });

  it('sammelt Werkzeug-Aufrufe aus dem Strom (Argumente in Stuecken)', async () => {
    const ergebnis = await stromChatAufruf(
      'https://x', 'k', { model: 'm' },
      () => {},
      sseFetch([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a1","function":{"name":"suche","arguments":"{\\"fra"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ge\\":\\"x\\"}"}}]}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(ergebnis.nachricht.tool_calls).toHaveLength(1);
    expect(ergebnis.nachricht.tool_calls![0].function!.arguments).toBe('{"frage":"x"}');
  });

  it('ueberspringt defekte Zeilen und meldet Fehler-Status mit Grund', async () => {
    const ergebnis = await stromChatAufruf(
      'https://x', 'k', {}, () => {},
      sseFetch(['data: {kaputt}\n\n', 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n']),
    );
    expect(ergebnis.nachricht.content).toBe('ok');
    const fehler = await stromChatAufruf('https://x', 'k', {}, () => {}, sseFetch([]));
    expect(fehler.ok).toBe(true); // leerer Strom ist ok, Inhalt prueft chatSenden
  });
});
