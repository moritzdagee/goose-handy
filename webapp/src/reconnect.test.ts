import { afterEach, describe, expect, it, vi } from "vitest";
import { TimeoutError, isPairingError, retryDelay, withTimeout } from "./reconnect";

describe("retryDelay", () => {
  it("redials at once, then backs off 1, 2, 4, 8 s", () => {
    expect([0, 1, 2, 3, 4].map(retryDelay)).toEqual([0, 1000, 2000, 4000, 8000]);
  });

  it("settles at 30 s for a host that stays away", () => {
    expect(retryDelay(5)).toBe(30000);
    expect(retryDelay(500)).toBe(30000);
  });

  it("treats negative attempts like the first", () => {
    expect(retryDelay(-1)).toBe(0);
  });
});

describe("withTimeout", () => {
  afterEach(() => vi.useRealTimers());

  it("passes a timely result through", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
  });

  it("passes a timely failure through unchanged", async () => {
    const boom = new Error("boom");
    await expect(withTimeout(Promise.reject(boom), 1000)).rejects.toBe(boom);
  });

  it("rejects with a TimeoutError when the answer never comes", async () => {
    vi.useFakeTimers();
    const never = new Promise<number>(() => {});
    const p = withTimeout(never, 5000, "Mac Mini");
    vi.advanceTimersByTime(5000);
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
    await expect(p).rejects.toThrow("Mac Mini: keine Antwort nach 5 s");
  });

  it("does not fire the deadline after an early answer", async () => {
    vi.useFakeTimers();
    let settle!: (v: string) => void;
    const p = withTimeout(new Promise<string>((r) => (settle = r)), 5000);
    settle("ok");
    await expect(p).resolves.toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("isPairingError", () => {
  it("recognises the host refusing this browser", () => {
    expect(isPairingError(new Error("rejected by host: not_allowlisted"))).toBe(true);
  });

  it("does not mistake network trouble for a pairing problem", () => {
    expect(isPairingError(new Error("connect: timed out"))).toBe(false);
    expect(isPairingError(undefined)).toBe(false);
  });
});
