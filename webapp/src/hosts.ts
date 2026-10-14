// Saved-host bookkeeping: localStorage keys, card parsing helpers, and the
// shapes for saved hosts and live connections.
import type { GooseClient } from "@aaif/goose-sdk";
import type { RoamConnection } from "./wasm/goose_roaming_web.js";

export const HOST_CARD_KEY = "goose-roam-last-host-card";
export const HOSTS_KEY = "goose-roam-hosts";

// Kept most-recently-used-first by the connect path (unshift on reconnect).
export type SavedHost = { name: string; card: string; endpointId: string };

// One live roam connection. The tab holds several at once — each saved host
// gets its own iroh duplex + GooseClient, and the session list is the merge.
export type HostConn = {
  endpointId: string;
  name: string;
  agent: GooseClient;
  /** Held to keep the QUIC connection alive for the life of the entry. */
  conn: RoamConnection;
  relay: string | null;
};

export function relayRegion(cardText: string): string | null {
  try {
    const b64 = cardText.trim().replace(/^goose\+roam:\/\//, "");
    const json = JSON.parse(atob(b64.replace(/-/g, "+").replace(/_/g, "/")));
    const url: string | undefined = json.relay_urls?.[0];
    const m = url?.match(/^https?:\/\/([a-z0-9-]+)\./i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// Moritz' two machines, built in so the phone needs no card pasting. A card
// only says where a host is reachable; access still requires that the host
// has accepted this browser's key. Mini first: it runs around the clock,
// the MacBook sleeps with the lid closed.
export const KNOWN_HOSTS: SavedHost[] = [
  {
    name: "Mac Mini",
    endpointId: "19736644c81a262765fa4dc07f6d265769d45bcd105ba7fee65ec6b5bb9cb893",
    card: "goose+roam://eyJ2ZXJzaW9uIjoxLCJlbmRwb2ludF9pZCI6IjE5NzM2NjQ0YzgxYTI2Mjc2NWZhNGRjMDdmNmQyNjU3NjlkNDViY2QxMDViYTdmZWU2NWVjNmI1YmI5Y2I4OTMiLCJyZWxheV91cmxzIjpbImh0dHBzOi8vdXN3MS0yLnJlbGF5Lm1pY2hhZWxuZWFsZS5tZXNoLWxsbS5pcm9oLmxpbmsuLyIsImh0dHBzOi8vdXNlMS0xLnJlbGF5Lm1pY2hhZWxuZWFsZS5tZXNoLWxsbS5pcm9oLmxpbmsuLyIsImh0dHBzOi8vZXVjMS0xLnJlbGF5Lm1pY2hhZWxuZWFsZS5tZXNoLWxsbS5pcm9oLmxpbmsuLyIsImh0dHBzOi8vYXBzMS0xLnJlbGF5Lm1pY2hhZWxuZWFsZS5tZXNoLWxsbS5pcm9oLmxpbmsuLyJdfQ",
  },
  {
    name: "MacBook",
    endpointId: "9fd789f25355c67dd38f75be81c76cc5aa01a66cff6bab2a9895d5ee4e921c30",
    card: "goose+roam://eyJ2ZXJzaW9uIjoxLCJlbmRwb2ludF9pZCI6IjlmZDc4OWYyNTM1NWM2N2RkMzhmNzViZTgxYzc2Y2M1YWEwMWE2NmNmZjZiYWIyYTk4OTVkNWVlNGU5MjFjMzAiLCJyZWxheV91cmxzIjpbImh0dHBzOi8vdXN3MS0yLnJlbGF5Lm1pY2hhZWxuZWFsZS5tZXNoLWxsbS5pcm9oLmxpbmsuLyIsImh0dHBzOi8vdXNlMS0xLnJlbGF5Lm1pY2hhZWxuZWFsZS5tZXNoLWxsbS5pcm9oLmxpbmsuLyIsImh0dHBzOi8vZXVjMS0xLnJlbGF5Lm1pY2hhZWxuZWFsZS5tZXNoLWxsbS5pcm9oLmxpbmsuLyIsImh0dHBzOi8vYXBzMS0xLnJlbGF5Lm1pY2hhZWxuZWFsZS5tZXNoLWxsbS5pcm9oLmxpbmsuLyJdfQ",
  },
];

// Sort key for host lists: built-in machines in their fixed order, others after.
export function hostRank(endpointId: string): number {
  const i = KNOWN_HOSTS.findIndex((h) => h.endpointId === endpointId);
  return i < 0 ? KNOWN_HOSTS.length : i;
}

export function hostLabel(endpointId: string, fallback: string): string {
  return KNOWN_HOSTS.find((h) => h.endpointId === endpointId)?.name ?? fallback;
}

export function loadHosts(): SavedHost[] {
  let saved: SavedHost[] = [];
  try {
    saved = JSON.parse(localStorage.getItem(HOSTS_KEY) ?? "[]");
  } catch {
    saved = [];
  }
  const known = KNOWN_HOSTS.filter((k) => !saved.some((h) => h.endpointId === k.endpointId));
  return [...saved, ...known];
}

// Endpoint id straight out of the card JSON — for keying reconnect attempts
// when the dial itself failed (no RoamConnection to ask).
export function cardEndpointHint(cardText: string): string | null {
  try {
    const b64 = cardText.trim().replace(/^goose\+roam:\/\//, "");
    const json = JSON.parse(atob(b64.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.endpoint_id === "string" ? json.endpoint_id : null;
  } catch {
    return null;
  }
}

// Last-open session is remembered per host: "<endpointId>|<sessionId>".
export const SESSION_KEY = "goose-roam-last-session";

// Collapsed project groups persist per device.
export const COLLAPSED_KEY = "goose-roam-collapsed-projects";

export function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // ignore malformed state
  }
  return new Set();
}