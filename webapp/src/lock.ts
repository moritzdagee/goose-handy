// Face-ID-Sperre (18.10.2026). The phone's roam identity (the key the Macs
// accept, see main.tsx) is sealed with a passkey: WebAuthn with user
// verification (Face ID on the iPhone) and the PRF extension, which hands out
// a secret only after Face ID succeeds. Without Face ID the app cannot even
// dial a machine, so nobody holding the unlocked phone reaches the agents or
// the knowledge base behind them. The passkey lives in iCloud Keychain.
//
// Where PRF is missing (old iOS), the passkey still gates the screen ("uv"
// mode) but the key stays readable on the device; the lock screen says so.

export const SECRET_STORAGE_KEY = "goose-roam-secret-hex";
export const LOCK_STORAGE_KEY = "goose-handy-sperre";
// Back on screen after this long: lock again (iOS keeps the app in memory).
export const RELOCK_AFTER_MS = 2 * 60_000;

const PRF_LABEL = "goose-handy-schluessel-v1";
const HKDF_INFO = "goose-handy-roam-schluessel";

export type Sealed = { iv: string; ct: string };
export type LockState = { v: 1; credId: string; mode: "prf" | "uv"; sealed?: Sealed };

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function prfSalt(): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(PRF_LABEL));
}

async function aesKey(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode(HKDF_INFO) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealSecret(prfOutput: ArrayBuffer, secret: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(prfOutput), new TextEncoder().encode(secret));
  return { iv: b64url(iv), ct: b64url(ct) };
}

/** Throws when the passkey's secret does not match (other passkey, tampered data). */
export async function unsealSecret(prfOutput: ArrayBuffer, sealed: Sealed): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(sealed.iv) },
    await aesKey(prfOutput),
    fromB64url(sealed.ct),
  );
  return new TextDecoder().decode(plain);
}

export function loadLock(): LockState | null {
  try {
    const raw = localStorage.getItem(LOCK_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as LockState;
    if (s?.v !== 1 || typeof s.credId !== "string" || (s.mode !== "prf" && s.mode !== "uv")) return null;
    if (s.mode === "prf" && !s.sealed) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveLock(state: LockState): void {
  localStorage.setItem(LOCK_STORAGE_KEY, JSON.stringify(state));
}

export function shouldRelock(hiddenAt: number | null, now: number, after = RELOCK_AFTER_MS): boolean {
  return hiddenAt !== null && now - hiddenAt >= after;
}

type Credentials = Pick<CredentialsContainer, "create" | "get">;

export async function createPasskey(creds: Credentials = navigator.credentials): Promise<string> {
  const cred = (await creds.create({
    publicKey: {
      rp: { id: location.hostname, name: "Goose (Moritz)" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "goose-handy", displayName: "Goose auf dem iPhone" },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey wurde nicht angelegt.");
  return b64url(cred.rawId);
}

/** Face ID with the app's passkey. Returns the PRF secret, or null where the device has no PRF. */
export async function verifyWithPasskey(credId: string, creds: Credentials = navigator.credentials): Promise<ArrayBuffer | null> {
  const cred = (await creds.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: fromB64url(credId) }],
      userVerification: "required",
      extensions: { prf: { eval: { first: await prfSalt() } } } as AuthenticationExtensionsClientInputs,
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Face ID abgebrochen.");
  const flags = new Uint8Array((cred.response as AuthenticatorAssertionResponse).authenticatorData)[32] ?? 0;
  if ((flags & 0x04) === 0) throw new Error("Face ID wurde nicht bestaetigt.");
  const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: BufferSource } } };
  const first = ext.prf?.results?.first;
  if (!first) return null;
  return first instanceof ArrayBuffer ? first : (first as ArrayBufferView).buffer.slice(0) as ArrayBuffer;
}

/**
 * First use: make the passkey, confirm it with Face ID and seal the existing
 * key (the Macs already accept it, so no new pairing). Returns the key.
 */
export async function setUpLock(
  secret: string,
  confirm: (credId: string) => Promise<ArrayBuffer | null>,
  credId: string,
): Promise<string> {
  const prf = await confirm(credId);
  if (prf) {
    saveLock({ v: 1, credId, mode: "prf", sealed: await sealSecret(prf, secret) });
    localStorage.removeItem(SECRET_STORAGE_KEY);
  } else {
    localStorage.setItem(SECRET_STORAGE_KEY, secret);
    saveLock({ v: 1, credId, mode: "uv" });
  }
  return secret;
}

/** Every start: Face ID, then the key. */
export async function unlock(state: LockState, verify: (credId: string) => Promise<ArrayBuffer | null>): Promise<string> {
  const prf = await verify(state.credId);
  if (state.mode === "prf") {
    if (!prf || !state.sealed) throw new Error("Der Passkey liefert keinen Schluessel.");
    return unsealSecret(prf, state.sealed);
  }
  const plain = localStorage.getItem(SECRET_STORAGE_KEY);
  if (!plain) throw new Error("Kein Schluessel auf dem Geraet.");
  return plain;
}

/** Last resort when the passkey is gone: forget everything, new identity, pair again. */
export function resetLock(): void {
  localStorage.removeItem(LOCK_STORAGE_KEY);
  localStorage.removeItem(SECRET_STORAGE_KEY);
}
