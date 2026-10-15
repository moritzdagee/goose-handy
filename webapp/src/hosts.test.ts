import { beforeEach, describe, expect, it } from "vitest";
import {
  COLLAPSED_KEY,
  HOSTS_KEY,
  KNOWN_HOSTS,
  type SavedHost,
  cardEndpointHint,
  hostLabel,
  hostRank,
  loadCollapsed,
  loadHosts,
  relayRegion,
} from "./hosts";

// Builds a pairing card the way goose does: base64url JSON behind goose+roam://.
function makeCard(json: object, prefix = true): string {
  const b64 = btoa(JSON.stringify(json)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return prefix ? `goose+roam://${b64}` : b64;
}

const MINI = KNOWN_HOSTS[0];
const MACBOOK = KNOWN_HOSTS[1];

beforeEach(() => localStorage.clear());

describe("eingebaute Rechner", () => {
  it("sind Mac Mini zuerst, dann MacBook", () => {
    expect(KNOWN_HOSTS.map((h) => h.name)).toEqual(["Mac Mini", "MacBook"]);
  });

  it("jede Karte zeigt auf genau die hinterlegte Rechner-Kennung", () => {
    for (const h of KNOWN_HOSTS) {
      expect(cardEndpointHint(h.card)).toBe(h.endpointId);
    }
  });

  it("die Kennungen sind verschieden und 64 Hex-Zeichen lang", () => {
    expect(MINI.endpointId).not.toBe(MACBOOK.endpointId);
    for (const h of KNOWN_HOSTS) expect(h.endpointId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("die Karten nennen eine Relay-Region", () => {
    for (const h of KNOWN_HOSTS) expect(relayRegion(h.card)).toBe("usw1-2");
  });
});

describe("cardEndpointHint", () => {
  it("liest die Kennung mit und ohne goose+roam:// Vorsatz", () => {
    expect(cardEndpointHint(makeCard({ endpoint_id: "abc" }))).toBe("abc");
    expect(cardEndpointHint(makeCard({ endpoint_id: "abc" }, false))).toBe("abc");
  });

  it("verzeiht Leerzeichen und Zeilenumbrueche beim Einfuegen", () => {
    expect(cardEndpointHint(`  ${makeCard({ endpoint_id: "abc" })}\n`)).toBe("abc");
  });

  it("dekodiert base64url-Zeichen (- und _)", () => {
    // ">>>" and "???" produce + and / in plain base64
    const card = makeCard({ endpoint_id: ">>>???" });
    expect(card).toMatch(/[-_]/);
    expect(cardEndpointHint(card)).toBe(">>>???");
  });

  it("liefert null bei Muell, fehlender oder falsch getypter Kennung", () => {
    expect(cardEndpointHint("kein base64 !!!")).toBeNull();
    expect(cardEndpointHint(makeCard({ version: 1 }))).toBeNull();
    expect(cardEndpointHint(makeCard({ endpoint_id: 42 }))).toBeNull();
    expect(cardEndpointHint("")).toBeNull();
  });
});

describe("relayRegion", () => {
  it("nimmt die erste Relay-Adresse", () => {
    const card = makeCard({ relay_urls: ["https://euc1-1.relay.example/", "https://use1-1.relay.example/"] });
    expect(relayRegion(card)).toBe("euc1-1");
  });

  it("liefert null ohne Relay oder bei kaputter Karte", () => {
    expect(relayRegion(makeCard({ relay_urls: [] }))).toBeNull();
    expect(relayRegion(makeCard({}))).toBeNull();
    expect(relayRegion(makeCard({ relay_urls: ["ftp://x.y/"] }))).toBeNull();
    expect(relayRegion("%%%")).toBeNull();
  });
});

describe("hostRank und hostLabel", () => {
  it("ordnen eingebaute Rechner fest ein, fremde dahinter", () => {
    expect(hostRank(MINI.endpointId)).toBe(0);
    expect(hostRank(MACBOOK.endpointId)).toBe(1);
    expect(hostRank("fremd")).toBe(KNOWN_HOSTS.length);
    const sorted = ["fremd", MACBOOK.endpointId, MINI.endpointId].sort((a, b) => hostRank(a) - hostRank(b));
    expect(sorted).toEqual([MINI.endpointId, MACBOOK.endpointId, "fremd"]);
  });

  it("zeigt den eingebauten Namen, sonst den mitgegebenen", () => {
    expect(hostLabel(MACBOOK.endpointId, "moritz-mbp")).toBe("MacBook");
    expect(hostLabel("fremd", "Buero-PC")).toBe("Buero-PC");
  });
});

describe("loadHosts (gespeicherte Rechner)", () => {
  it("ohne Speicher: die beiden eingebauten Rechner", () => {
    expect(loadHosts()).toEqual(KNOWN_HOSTS);
  });

  it("gespeicherte zuerst, eingebaute nur ergaenzt und nie doppelt", () => {
    const other: SavedHost = { name: "Buero", card: makeCard({ endpoint_id: "x" }), endpointId: "x" };
    const renamedBook: SavedHost = { ...MACBOOK, name: "alter Name" };
    localStorage.setItem(HOSTS_KEY, JSON.stringify([other, renamedBook]));
    const hosts = loadHosts();
    expect(hosts.map((h) => h.endpointId)).toEqual(["x", MACBOOK.endpointId, MINI.endpointId]);
    // the saved entry wins over the built-in one
    expect(hosts[1].name).toBe("alter Name");
  });

  it("kaputter Speicherinhalt fuehrt nicht zum Absturz", () => {
    localStorage.setItem(HOSTS_KEY, "{kaputt");
    expect(loadHosts()).toEqual(KNOWN_HOSTS);
  });
});

describe("loadCollapsed (zugeklappte Projekte)", () => {
  it("liest die gespeicherte Liste als Menge", () => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(["a", "b", "a"]));
    expect([...loadCollapsed()].sort()).toEqual(["a", "b"]);
  });

  it("leer bei fehlendem oder kaputtem Inhalt", () => {
    expect(loadCollapsed().size).toBe(0);
    localStorage.setItem(COLLAPSED_KEY, "nope");
    expect(loadCollapsed().size).toBe(0);
  });
});
