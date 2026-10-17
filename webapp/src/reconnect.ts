// Connection upkeep for a phone. iOS freezes a home-screen web app the moment
// it leaves the screen, and the relay sockets die with it. Nothing tells the
// tab: the old connection just stops answering, and the next message vanishes
// into it. So on every return to the screen (and when the network comes
// back) each host is asked a cheap question with a short deadline; whoever
// does not answer is dropped and dialed again at once.

// A host that does not answer a session list within this time is treated as
// gone. Healthy round trips over the relay take well under a second.
export const PROBE_TIMEOUT_MS = 5000;

// Opening a chat replays its last turns. Even a long tail arrives in a few
// seconds; a load still silent after this is stuck on a half-dead link, and
// without a deadline the screen stayed blank on "Chat wird noch geladen".
export const LOAD_TIMEOUT_MS = 20000;

// Away from the screen for at least this long: check the links on return.
export const RESUME_CHECK_AFTER_MS = 3000;

// Away this long: iOS has almost surely cut the sockets, start over right away
// instead of waiting for a probe to time out.
export const RESUME_REDIAL_AFTER_MS = 10000;

// Pause before redial attempt n (0-based): first at once, then 1, 2, 4, 8 s,
// then every 30 s for a machine that stays away (a MacBook with its lid shut).
export function retryDelay(attempt: number): number {
  if (attempt <= 0) return 0;
  if (attempt <= 4) return 1000 * 2 ** (attempt - 1);
  return 30000;
}

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label}: keine Antwort nach ${ms / 1000} s`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label = "Anfrage"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// The host refused this browser's key: redialing cannot help, pairing can.
export function isPairingError(err: unknown): boolean {
  return String(err).includes("not_allowlisted");
}
