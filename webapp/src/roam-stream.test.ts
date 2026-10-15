import { describe, expect, it, vi } from "vitest";
import { roamByteStreams } from "./roam-stream";
import type { RoamConnection } from "./wasm/goose_roaming_web.js";

// Stand-in for the wasm iroh connection: hands out queued chunks, records sends.
function fakeConn(chunks: (Uint8Array | null)[]) {
  const sent: Uint8Array[] = [];
  const conn = {
    recv: vi.fn(async () => (chunks.length ? chunks.shift()! : null)),
    send: vi.fn(async (c: Uint8Array) => {
      sent.push(c);
    }),
    close: vi.fn(),
  };
  return { conn, sent, roam: conn as unknown as RoamConnection };
}

const bytes = (s: string) => new TextEncoder().encode(s);

describe("roamByteStreams", () => {
  it("liest alle Stuecke und endet, wenn die Verbindung null liefert", async () => {
    const { roam } = fakeConn([bytes("eins"), bytes("zwei"), null]);
    const { readable } = roamByteStreams(roam);
    const got: string[] = [];
    for await (const c of readable as unknown as AsyncIterable<Uint8Array>) got.push(new TextDecoder().decode(c));
    expect(got).toEqual(["eins", "zwei"]);
  });

  it("ein leeres Stueck beendet den Lesestrom ebenfalls", async () => {
    const { roam } = fakeConn([bytes("a"), new Uint8Array(0), bytes("nie")]);
    const reader = roamByteStreams(roam).readable.getReader();
    expect((await reader.read()).value).toEqual(bytes("a"));
    expect((await reader.read()).done).toBe(true);
  });

  it("schreibt jedes Stueck in Reihenfolge an die Verbindung", async () => {
    const { roam, sent, conn } = fakeConn([]);
    const writer = roamByteStreams(roam).writable.getWriter();
    await writer.write(bytes("x"));
    await writer.write(bytes("y"));
    expect(sent.map((c) => new TextDecoder().decode(c))).toEqual(["x", "y"]);
    await writer.close();
    expect(conn.close).toHaveBeenCalledTimes(1);
  });

  it("Abbruch beim Lesen oder Schreiben schliesst die Verbindung", async () => {
    const a = fakeConn([bytes("a")]);
    await roamByteStreams(a.roam).readable.cancel();
    expect(a.conn.close).toHaveBeenCalled();
    const b = fakeConn([]);
    await roamByteStreams(b.roam).writable.abort();
    expect(b.conn.close).toHaveBeenCalled();
  });
});
