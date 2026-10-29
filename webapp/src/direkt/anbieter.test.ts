import { beforeEach, describe, expect, it } from "vitest";
import { MODELLE_SPEICHER, alleModelle, findeAnbieter, gemerkteModelle, modellTauglich, modelleMerken } from "./anbieter";
import { json, netz } from "./netz.testhilfe";

beforeEach(() => localStorage.clear());

describe("Anbieter und Modelle", () => {
  it("Mistral ist Standard, unbekannte Anbieter fallen auf Mistral zurueck", () => {
    expect(findeAnbieter(undefined).id).toBe("mistral");
    expect(findeAnbieter("eurouter").id).toBe("eurouter");
    expect(findeAnbieter("quatsch").id).toBe("mistral");
  });

  it("filtert untaugliche Modelle", () => {
    expect(modellTauglich("mistral", { id: "mistral-embed" })).toBe(false);
    expect(modellTauglich("mistral", { id: "mistral-large-4-0" })).toBe(true);
    expect(modellTauglich("eurouter", { id: "x" })).toBe(false);
    expect(modellTauglich("eurouter", { id: "x", supported_parameters: ["tools"] })).toBe(true);
  });

  it("eine Liste aus allen Anbietern mit Schluessel; Fehler einzeln gemeldet", async () => {
    const n = netz({
      "api.mistral.ai/v1/models": [json(200, { data: [{ id: "mistral-large-4-0" }, { id: "mistral-embed" }, { id: "mistral-small" }] })],
      "api.eurouter.ai/v1/models": [json(401, {})],
    });
    const { modelle, fehler } = await alleModelle({ mistral: "m", eurouter: "e" }, n.fetch);
    expect(modelle.map((m) => m.id)).toEqual(["mistral-large-4-0", "mistral-small"]);
    expect(fehler).toEqual(["EUrouter: Schluessel abgelehnt"]);
    expect(n.aufrufe[0].auth).toBe("Bearer m");
    const ohne = await alleModelle({}, n.fetch);
    expect(ohne.modelle).toEqual([]);
  });

  it("merkt sich die Liste fuer offline, verwirft Muell", () => {
    modelleMerken([{ id: "a", anbieter: "mistral", beschriftung: "a" }]);
    expect(gemerkteModelle()).toHaveLength(1);
    localStorage.setItem(MODELLE_SPEICHER, "kaputt");
    expect(gemerkteModelle()).toEqual([]);
  });
});
