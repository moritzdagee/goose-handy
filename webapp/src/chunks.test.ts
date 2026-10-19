import { describe, expect, it } from "vitest";
import { continuesBubble, joinChunk } from "./chunks";

describe("continuesBubble", () => {
  it("Agent-Text streamt in Stuecken und bleibt eine Blase", () => {
    expect(continuesBubble("agent", "lo", "agent", "m1", "m1")).toBe(true);
    expect(continuesBubble("agent", "lo", "agent", undefined, undefined)).toBe(true);
  });

  it("drei Nutzer-Nachrichten hintereinander werden drei Blasen (18.10.2026)", () => {
    expect(continuesBubble("user", "Statusbericht", "user", "m1", "m1")).toBe(false);
    expect(continuesBubble("user", "Wtf", "user", undefined, undefined)).toBe(false);
  });

  it("Bild-Platzhalter und Anhang-Hinweis bleiben bei ihrer Nachricht", () => {
    expect(continuesBubble("user", "[image]", "user", "m1", "m1")).toBe(true);
    expect(continuesBubble("user", " [Bild gespeichert unter /x.png]", "user", "m1", "m1")).toBe(true);
  });

  it("neue Nachrichten-Kennung beginnt immer eine neue Blase", () => {
    expect(continuesBubble("agent", "x", "agent", "m2", "m1")).toBe(false);
    expect(continuesBubble("user", "[image]", "user", "m2", "m1")).toBe(false);
  });

  it("Rollenwechsel beginnt eine neue Blase", () => {
    expect(continuesBubble("user", "x", "agent", "m1", "m1")).toBe(false);
    expect(continuesBubble("agent", "x", null, undefined, undefined)).toBe(false);
  });
});

describe("joinChunk", () => {
  it("Agent-Stuecke ohne Trenner, Nutzer-Anhaenge mit Zeilenumbruch", () => {
    expect(joinChunk("agent", "Hal", "lo")).toBe("Hallo");
    expect(joinChunk("user", "Schau", "[image]")).toBe("Schau\n[image]");
    expect(joinChunk("user", "Schau\n", "[image]")).toBe("Schau\n[image]");
  });
});
