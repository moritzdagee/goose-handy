import { beforeEach, describe, expect, it } from "vitest";
import {
  LOCK_STORAGE_KEY,
  RELOCK_AFTER_MS,
  SECRET_STORAGE_KEY,
  b64url,
  fromB64url,
  loadLock,
  resetLock,
  saveLock,
  sealSecret,
  setUpLock,
  shouldRelock,
  unlock,
  unsealSecret,
  verifyWithPasskey,
} from "./lock";

const prf = (fill: number) => new Uint8Array(32).fill(fill).buffer;
const SECRET = "ab".repeat(32);

beforeEach(() => localStorage.clear());

describe("Verschluesselung mit dem Passkey-Geheimnis", () => {
  it("entschluesselt mit demselben Geheimnis wieder den Schluessel", async () => {
    const sealed = await sealSecret(prf(7), SECRET);
    expect(sealed.ct).not.toContain(SECRET);
    expect(await unsealSecret(prf(7), sealed)).toBe(SECRET);
  });

  it("scheitert mit einem anderen Passkey oder veraenderten Daten", async () => {
    const sealed = await sealSecret(prf(7), SECRET);
    await expect(unsealSecret(prf(8), sealed)).rejects.toThrow();
    const broken = { ...sealed, ct: b64url(fromB64url(sealed.ct).map((b, i) => (i === 0 ? b ^ 1 : b))) };
    await expect(unsealSecret(prf(7), broken)).rejects.toThrow();
  });

  it("b64url hin und zurueck", () => {
    const bytes = new Uint8Array([0, 250, 251, 252, 253, 254, 255]);
    expect([...fromB64url(b64url(bytes))]).toEqual([...bytes]);
    expect(b64url(bytes)).not.toMatch(/[+/=]/);
  });
});

describe("Einrichten und Entsperren", () => {
  it("mit PRF: Schluessel verschluesselt gespeichert, Klartext geloescht", async () => {
    localStorage.setItem(SECRET_STORAGE_KEY, SECRET);
    expect(await setUpLock(SECRET, async () => prf(3), "cred-1")).toBe(SECRET);
    expect(localStorage.getItem(SECRET_STORAGE_KEY)).toBeNull();
    const state = loadLock()!;
    expect(state.mode).toBe("prf");
    expect(JSON.stringify(state)).not.toContain(SECRET);
    expect(await unlock(state, async () => prf(3))).toBe(SECRET);
  });

  it("ohne Face-ID-Geheimnis gibt es den Schluessel nicht", async () => {
    await setUpLock(SECRET, async () => prf(3), "cred-1");
    const state = loadLock()!;
    await expect(unlock(state, async () => null)).rejects.toThrow();
    await expect(unlock(state, async () => prf(4))).rejects.toThrow();
    await expect(
      unlock(state, async () => {
        throw new DOMException("abgebrochen", "NotAllowedError");
      }),
    ).rejects.toThrow("abgebrochen");
  });

  it("ohne PRF (altes iOS): Sperre nur fuer die Ansicht, Schluessel bleibt", async () => {
    await setUpLock(SECRET, async () => null, "cred-2");
    expect(loadLock()?.mode).toBe("uv");
    expect(localStorage.getItem(SECRET_STORAGE_KEY)).toBe(SECRET);
    expect(await unlock(loadLock()!, async () => null)).toBe(SECRET);
  });

  it("verwirft kaputte Sperr-Daten, statt sie zu benutzen", () => {
    localStorage.setItem(LOCK_STORAGE_KEY, "{kaputt");
    expect(loadLock()).toBeNull();
    saveLock({ v: 1, credId: "x", mode: "prf" });
    expect(loadLock()).toBeNull();
  });

  it("Zuruecksetzen loescht Sperre und Schluessel", async () => {
    await setUpLock(SECRET, async () => null, "cred-2");
    resetLock();
    expect(loadLock()).toBeNull();
    expect(localStorage.getItem(SECRET_STORAGE_KEY)).toBeNull();
  });
});

describe("verifyWithPasskey", () => {
  const assertion = (flags: number, prfFirst?: ArrayBuffer) => {
    const authData = new Uint8Array(37);
    authData[32] = flags;
    return {
      rawId: new Uint8Array([1]).buffer,
      response: { authenticatorData: authData.buffer },
      getClientExtensionResults: () => (prfFirst ? { prf: { results: { first: prfFirst } } } : {}),
    };
  };
  const creds = (result: unknown) => {
    const calls: CredentialRequestOptions[] = [];
    return {
      calls,
      api: {
        create: async () => null,
        get: async (o?: CredentialRequestOptions) => {
          calls.push(o!);
          return result as Credential;
        },
      },
    };
  };

  it("verlangt Face ID und den eigenen Passkey, liefert das PRF-Geheimnis", async () => {
    const c = creds(assertion(0x05, prf(9)));
    const out = await verifyWithPasskey(b64url(new Uint8Array([1, 2, 3])), c.api);
    expect(new Uint8Array(out!)[0]).toBe(9);
    const pk = c.calls[0].publicKey!;
    expect(pk.userVerification).toBe("required");
    expect([...new Uint8Array(pk.allowCredentials![0].id as ArrayBuffer)]).toEqual([1, 2, 3]);
  });

  it("lehnt ab, wenn das Geraet Face ID nicht bestaetigt hat", async () => {
    const c = creds(assertion(0x01, prf(9)));
    await expect(verifyWithPasskey(b64url(new Uint8Array([1])), c.api)).rejects.toThrow("nicht bestaetigt");
  });

  it("liefert null, wenn das Geraet kein PRF kann", async () => {
    const c = creds(assertion(0x05));
    expect(await verifyWithPasskey(b64url(new Uint8Array([1])), c.api)).toBeNull();
  });
});

describe("erneut sperren", () => {
  it("nach laengerer Pause, nicht bei kurzem Wegschauen", () => {
    expect(shouldRelock(null, 10_000)).toBe(false);
    expect(shouldRelock(0, RELOCK_AFTER_MS - 1)).toBe(false);
    expect(shouldRelock(0, RELOCK_AFTER_MS)).toBe(true);
  });
});
