// Strom-Antworten (SSE) fuer den Direkt-Chat: Der Antworttext waechst Wort
// fuer Wort im Chat, statt erst am Ende zu erscheinen. Laeuft ueber fetch mit
// ReadableStream in Safari (Mistral und EUrouter erlauben das per CORS).
// Uebernommen aus Moose beta (src/lib/strom.ts, Stand 29.10.2026).

export interface StromErgebnis {
  status: number;
  ok: boolean;
  // fertige Nachricht wie beim nicht-gestromten Aufruf
  nachricht: { content: unknown; tool_calls?: WerkzeugAufruf[] };
  fehlerKoerper?: string;
}

export interface WerkzeugAufruf {
  id: string;
  function?: { name?: string; arguments?: string };
}

function sseZeilen(puffer: string): { zeilen: string[]; rest: string } {
  const teile = puffer.split('\n');
  const rest = teile.pop() ?? '';
  return { zeilen: teile.filter((z) => z.startsWith('data:')).map((z) => z.slice(5).trim()), rest };
}

// Liest einen SSE-Strom und baut daraus die fertige Nachricht.
export async function stromChatAufruf(
  adresse: string,
  schluessel: string,
  koerper: Record<string, unknown>,
  onChunk: (text: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<StromErgebnis> {
  const antwort = await fetchImpl(adresse, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${schluessel}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...koerper, stream: true }),
  });
  if (!antwort.ok || !antwort.body) {
    let fehlerKoerper = '';
    try {
      fehlerKoerper = await antwort.text();
    } catch {
      // ohne Koerper
    }
    return { status: antwort.status, ok: false, nachricht: { content: '' }, fehlerKoerper };
  }

  const leser = antwort.body.getReader();
  const entzerrer = new TextDecoder();
  let rest = '';
  let text = '';
  let rohPuffer = '';
  let modus: 'sse' | 'json' | null = null; // wird am ersten Stueck erkannt
  const aufrufe: Record<number, WerkzeugAufruf> = {};

  const verarbeite = (zeile: string) => {
    if (!zeile || zeile === '[DONE]') return;
    let daten: {
      choices?: {
        delta?: {
          content?: unknown;
          tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
        };
      }[];
    };
    try {
      daten = JSON.parse(zeile);
    } catch {
      return; // defekte Zeile ueberspringen
    }
    const delta = daten.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content;
      onChunk(delta.content);
    } else if (Array.isArray(delta.content)) {
      // Block-Form im Strom (z. B. Mistral): nur Text-Bloecke anzeigen
      for (const block of delta.content as { type?: string; text?: string }[]) {
        if (block?.type === 'text' && block.text) {
          text += block.text;
          onChunk(block.text);
        }
      }
    }
    for (const aufruf of delta.tool_calls ?? []) {
      const i = aufruf.index ?? 0;
      const bisher = aufrufe[i] ?? { id: '', function: { name: '', arguments: '' } };
      aufrufe[i] = {
        id: aufruf.id ?? bisher.id,
        function: {
          name: aufruf.function?.name ?? bisher.function?.name ?? '',
          arguments: (bisher.function?.arguments ?? '') + (aufruf.function?.arguments ?? ''),
        },
      };
    }
  };

  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    const stueck = entzerrer.decode(value, { stream: true });
    if (modus === null) {
      // Erkennung am Anfang: SSE-Stroeme beginnen mit "data:", sonst klassisches JSON.
      modus = stueck.trimStart().startsWith('data:') ? 'sse' : 'json';
    }
    if (modus === 'json') {
      rohPuffer += stueck;
      continue;
    }
    rest += stueck;
    const { zeilen, rest: neuerRest } = sseZeilen(rest);
    rest = neuerRest;
    zeilen.forEach(verarbeite);
  }
  if (modus === 'json') {
    // Anbieter hat den Strom-Wunsch ignoriert und klassisch geantwortet.
    try {
      const d = JSON.parse(rohPuffer) as { choices?: { message?: { content?: unknown; tool_calls?: WerkzeugAufruf[] } }[] };
      const nachricht = d.choices?.[0]?.message ?? { content: '' };
      const inhalt = typeof nachricht.content === 'string' ? nachricht.content : '';
      if (inhalt) onChunk(inhalt);
      return { status: 200, ok: true, nachricht: { content: nachricht.content ?? '', tool_calls: nachricht.tool_calls } };
    } catch {
      return { status: 200, ok: true, nachricht: { content: '' } };
    }
  }
  if (rest.startsWith('data:')) verarbeite(rest.slice(5).trim());

  const liste = Object.values(aufrufe);
  return {
    status: 200,
    ok: true,
    nachricht: { content: text, ...(liste.length > 0 ? { tool_calls: liste } : {}) },
  };
}
