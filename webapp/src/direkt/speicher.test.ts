import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  _speicherZuruecksetzen,
  alleChats,
  chatAendern,
  chatArchivieren,
  chatLesen,
  neuerChat,
  titelAusText,
} from "./speicher";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _speicherZuruecksetzen();
});

describe("Direkt-Chats im iPhone-Speicher", () => {
  it("legt Chats an, liest sie wieder und sortiert die neuesten nach vorn", async () => {
    const a = await neuerChat("mistral-large-4-0", new Date("2026-10-01T10:00:00Z"));
    const b = await neuerChat("mistral-small", new Date("2026-10-02T10:00:00Z"));
    expect(a.id).not.toBe(b.id);
    expect((await alleChats()).map((c) => c.id)).toEqual([b.id, a.id]);
    expect((await chatLesen(a.id))?.modell).toBe("mistral-large-4-0");
    expect(await chatLesen("gibt-es-nicht")).toBeNull();
  });

  it("aendert und archiviert", async () => {
    const a = await neuerChat("m");
    await chatAendern(a.id, (c) => {
      c.titel = "Hallo";
      c.nachrichten.push({ id: "1", rolle: "nutzer", text: "Hi", zeit: "2026-10-29T10:00:00Z" });
    });
    await chatArchivieren(a.id, true);
    const c = (await chatLesen(a.id))!;
    expect(c.titel).toBe("Hallo");
    expect(c.archiviert).toBe(true);
    expect(c.nachrichten).toHaveLength(1);
    await expect(chatAendern("weg", () => {})).rejects.toThrow("nicht gefunden");
  });

  it("Titel aus der ersten Frage, gekuerzt", () => {
    expect(titelAusText("  Wie   spaet ist es?  ")).toBe("Wie spaet ist es?");
    expect(titelAusText("")).toBe("Neuer Chat");
    const lang = titelAusText("x".repeat(100));
    expect(lang.length).toBeLessThanOrEqual(48);
    expect(lang.endsWith("…")).toBe(true);
  });
});
