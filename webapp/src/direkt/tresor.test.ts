import { beforeEach, describe, expect, it } from "vitest";
import { TRESOR_STORAGE_KEY, resetLock, setUpLockWithPrf, unlockWithPrf, loadLock, vaultKey } from "../lock";
import { alleSchluesselLesen, hinterlegteSlots, schluesselEntfernen, schluesselSpeichern } from "./tresor";

const prf = (fill: number) => new Uint8Array(32).fill(fill).buffer;
const MISTRAL = "mistral-geheim-1234567890";
const KB = "kb-geheim-abcdef";

beforeEach(() => localStorage.clear());

describe("Schluessel-Tresor", () => {
  it("speichert nur verschluesselt, nie Klartext im Browser-Speicher", async () => {
    const key = await vaultKey(prf(9));
    await schluesselSpeichern(key, "mistral", `  ${MISTRAL}\n`);
    await schluesselSpeichern(key, "kb", KB);
    const roh = localStorage.getItem(TRESOR_STORAGE_KEY)!;
    expect(roh).not.toContain(MISTRAL);
    expect(roh).not.toContain(KB);
    for (let i = 0; i < localStorage.length; i++) {
      const wert = localStorage.getItem(localStorage.key(i)!)!;
      expect(wert).not.toContain(MISTRAL);
    }
    expect(hinterlegteSlots()).toEqual(["mistral", "kb"]);
    const { werte, fehler } = await alleSchluesselLesen(key);
    expect(werte).toEqual({ mistral: MISTRAL, kb: KB });
    expect(fehler).toEqual([]);
  });

  it("anderer Passkey kann nichts lesen", async () => {
    await schluesselSpeichern(await vaultKey(prf(1)), "mistral", MISTRAL);
    const { werte, fehler } = await alleSchluesselLesen(await vaultKey(prf(2)));
    expect(werte).toEqual({});
    expect(fehler).toEqual(["mistral"]);
  });

  it("ein Eintrag laesst sich nicht in ein anderes Fach umhaengen", async () => {
    const key = await vaultKey(prf(4));
    await schluesselSpeichern(key, "mistral", MISTRAL);
    const d = JSON.parse(localStorage.getItem(TRESOR_STORAGE_KEY)!);
    d.eintraege.kb = d.eintraege.mistral;
    localStorage.setItem(TRESOR_STORAGE_KEY, JSON.stringify(d));
    const { werte, fehler } = await alleSchluesselLesen(key);
    expect(werte.mistral).toBe(MISTRAL);
    expect(werte.kb).toBeUndefined();
    expect(fehler).toEqual(["kb"]);
  });

  it("lehnt leere oder zerstueckelte Eingaben ab", async () => {
    const key = await vaultKey(prf(4));
    await expect(schluesselSpeichern(key, "mistral", "   ")).rejects.toThrow("Leerer");
    await expect(schluesselSpeichern(key, "mistral", "abc def")).rejects.toThrow("Leerzeichen");
    expect(hinterlegteSlots()).toEqual([]);
  });

  it("Entfernen und Neu-Einrichten der Sperre leeren den Tresor", async () => {
    const key = await vaultKey(prf(4));
    await schluesselSpeichern(key, "mistral", MISTRAL);
    await schluesselSpeichern(key, "eurouter", "eu-123");
    schluesselEntfernen("eurouter");
    expect(hinterlegteSlots()).toEqual(["mistral"]);
    resetLock();
    expect(localStorage.getItem(TRESOR_STORAGE_KEY)).toBeNull();
    expect(hinterlegteSlots()).toEqual([]);
  });

  it("kaputte Tresor-Daten gelten als leer", async () => {
    localStorage.setItem(TRESOR_STORAGE_KEY, "{kaputt");
    expect(hinterlegteSlots()).toEqual([]);
    expect((await alleSchluesselLesen(await vaultKey(prf(1)))).werte).toEqual({});
  });

  it("Tresor-Schluessel kommt nur ueber Face ID und ist nicht auslesbar", async () => {
    const r = await setUpLockWithPrf("ab".repeat(32), async () => prf(6), "cred");
    expect(r.prf).not.toBeNull();
    const key = await vaultKey(r.prf!);
    expect(key.extractable).toBe(false);
    await schluesselSpeichern(key, "mistral", MISTRAL);
    // naechster Start: Face ID liefert dasselbe Geheimnis, Tresor geht auf
    const wieder = await unlockWithPrf(loadLock()!, async () => prf(6));
    const { werte } = await alleSchluesselLesen(await vaultKey(wieder.prf!));
    expect(werte.mistral).toBe(MISTRAL);
    // ohne PRF (altes iOS) gibt es keinen Tresor-Schluessel
    localStorage.clear();
    const ohne = await setUpLockWithPrf("ab".repeat(32), async () => null, "cred");
    expect(ohne.prf).toBeNull();
  });

  it("Tresor-Schluessel unterscheidet sich vom Schluessel der Rechner-Verbindung", async () => {
    // gleicher Passkey, anderer Zweck: ein mit dem Tresor verschluesselter
    // Wert laesst sich mit dem Verbindungs-Entschluesseln nicht oeffnen
    const { unsealSecret } = await import("../lock");
    const key = await vaultKey(prf(3));
    await schluesselSpeichern(key, "mistral", MISTRAL);
    const d = JSON.parse(localStorage.getItem(TRESOR_STORAGE_KEY)!);
    await expect(unsealSecret(prf(3), d.eintraege.mistral)).rejects.toThrow();
  });
});
