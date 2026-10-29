import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlProvider } from "react-intl";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { DirektChatAnsicht } from "./DirektChatAnsicht";
import { DirektEinstellungen } from "./DirektEinstellungen";
import { useDirekt } from "./useDirekt";
import { direktAlsSitzungen } from "./liste";
import { _speicherZuruecksetzen, chatAendern, chatLesen, neuerChat } from "./speicher";
import { schluesselSpeichern } from "./tresor";
import { vaultKey } from "../lock";
import { json, netz, sse, textDelta } from "./netz.testhilfe";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _speicherZuruecksetzen();
  localStorage.clear();
});
afterEach(() => cleanup());

const MISTRAL = "api.mistral.ai/v1/chat/completions";

function ansicht(chatId: string, props: Partial<Parameters<typeof DirektChatAnsicht>[0]> = {}) {
  const onBack = vi.fn();
  const onEinstellungen = vi.fn();
  const onGeaendert = vi.fn();
  render(
    <IntlProvider locale="de" defaultLocale="de" messages={{}}>
    <DirektChatAnsicht
      chatId={chatId}
      schluessel={{ mistral: "m" }}
      modelle={[]}
      online
      onBack={onBack}
      onEinstellungen={onEinstellungen}
      onGeaendert={onGeaendert}
      {...props}
    />
    </IntlProvider>,
  );
  return { onBack, onEinstellungen, onGeaendert };
}

const tippen = (text: string) => {
  const el = document.getElementById("direkt-input") as HTMLTextAreaElement;
  el.value = text;
  fireEvent.submit(document.getElementById("direkt-form")!);
};

describe("Direkt-Chat-Ansicht", () => {
  it("leerer Chat erklaert sich; Frage und gestroemte Antwort erscheinen", async () => {
    const c = await neuerChat("mistral-large-4-0");
    const n = netz({ [MISTRAL]: [sse(textDelta("Hallo "), textDelta("Moritz"))] });
    const { onGeaendert } = ansicht(c.id, { abruf: n.fetch });
    await screen.findByText("Direkt auf dem iPhone");
    tippen("Hi");
    await waitFor(() => expect(document.querySelectorAll(".msg.agent").length).toBe(1));
    await waitFor(() => expect(document.getElementById("direkt-arbeitet")).toBeNull());
    expect(document.querySelector(".msg.user")!.textContent).toBe("Hi");
    expect(document.querySelector(".msg.agent")!.textContent).toContain("Hallo Moritz");
    expect(document.getElementById("direkt-titel")!.textContent).toBe("Hi");
    expect(onGeaendert).toHaveBeenCalled();
    expect((await chatLesen(c.id))!.nachrichten).toHaveLength(2);
  });

  it("ohne Schluessel: Hinweis mit Weg zu den Einstellungen, Frage wartet", async () => {
    const c = await neuerChat("m");
    const { onEinstellungen } = ansicht(c.id, { schluessel: {} });
    await screen.findByText(/fehlt der Mistral-Schluessel/);
    fireEvent.click(document.getElementById("direkt-zu-einstellungen")!);
    expect(onEinstellungen).toHaveBeenCalled();
    tippen("geht das?");
    await waitFor(() => expect(document.querySelector(".direkt-wartet")).not.toBeNull());
    expect(document.querySelector(".direkt-wartet")!.textContent).toContain("Kein Mistral-Schluessel");
    // kein doppelter Hinweis, kein Alarm
    expect(document.getElementById("direkt-meldung")).toBeNull();
  });

  it("offline: Hinweis, Frage wartet; mit Netz 'Jetzt senden' holt die Antwort", async () => {
    const c = await neuerChat("m");
    ansicht(c.id, { online: false });
    await screen.findByText(/Kein Netz/);
    tippen("Bist du da?");
    await waitFor(() => expect(document.querySelector(".direkt-wartet")).not.toBeNull());
    cleanup();
    const n = netz({ [MISTRAL]: [sse(textDelta("Ja."))] });
    ansicht(c.id, { abruf: n.fetch });
    fireEvent.click(await screen.findByText("Jetzt senden"));
    await waitFor(() => expect(document.querySelector(".msg.agent")?.textContent).toContain("Ja."));
    await waitFor(() => expect(document.getElementById("direkt-arbeitet")).toBeNull());
    expect(document.querySelector(".direkt-wartet")).toBeNull();
    expect(document.getElementById("direkt-wartende")).toBeNull();
  });

  it("Fehler des Anbieters als Alarm sichtbar", async () => {
    const c = await neuerChat("m");
    const n = netz({ [MISTRAL]: [json(401, {})] });
    ansicht(c.id, { abruf: n.fetch });
    await screen.findByText("Direkt auf dem iPhone");
    tippen("x");
    const m = await screen.findByText(/Schluessel abgelehnt/);
    expect(m.closest("[role]")!.getAttribute("role")).toBe("alert");
  });

  it("Modell wechseln und archivieren", async () => {
    const c = await neuerChat("mistral-large-4-0");
    ansicht(c.id, {
      modelle: [
        { id: "mistral-large-4-0", anbieter: "mistral", beschriftung: "mistral-large-4-0" },
        { id: "gpt-x", anbieter: "eurouter", beschriftung: "EUrouter: gpt-x" },
      ],
    });
    await screen.findByText("Direkt auf dem iPhone");
    fireEvent.click(screen.getByLabelText("Modell fuer diesen Chat waehlen"));
    fireEvent.change(screen.getByLabelText("Modell"), { target: { value: "eurouter|gpt-x" } });
    await waitFor(async () => expect((await chatLesen(c.id))!.anbieter).toBe("eurouter"));
    expect((await chatLesen(c.id))!.modell).toBe("gpt-x");
    // EUrouter ohne Schluessel: Hinweis nennt EUrouter
    await screen.findByText(/fehlt der EUrouter-Schluessel/);
    fireEvent.click(screen.getByLabelText("Chat archivieren"));
    await waitFor(async () => expect((await chatLesen(c.id))!.archiviert).toBe(true));
    await screen.findByLabelText("Chat aus dem Archiv zurueckholen");
  });

  it("Klon zeigt seine Herkunft, Zurueck meldet sich", async () => {
    const c = await neuerChat("m");
    await chatAendern(c.id, (x) => {
      x.herkunft = { geraet: "mini", sessionId: "s", titel: "t", geklontAm: "" };
    });
    const { onBack } = ansicht(c.id);
    await screen.findByText("Klon vom Mac Mini");
    fireEvent.click(document.getElementById("direkt-zurueck")!);
    expect(onBack).toHaveBeenCalled();
  });
});

describe("Einstellungen fuer die Schluessel", () => {
  function seite(props: Partial<Parameters<typeof DirektEinstellungen>[0]> = {}) {
    const onSpeichern = vi.fn(async () => {});
    const onEntfernen = vi.fn();
    const onNachholen = vi.fn();
    render(
      <DirektEinstellungen
        tresorDa
        hinterlegt={[]}
        fehlerhaft={[]}
        ausstehend={0}
        onSpeichern={onSpeichern}
        onEntfernen={onEntfernen}
        onNachholen={onNachholen}
        {...props}
      />,
    );
    return { onSpeichern, onEntfernen, onNachholen };
  }

  it("Schluessel eintragen: geht verschluesselt weg, Feld wird geleert, nie angezeigt", async () => {
    const { onSpeichern } = seite();
    const feld = screen.getByLabelText("Mistral-Schluessel eintragen") as HTMLInputElement;
    expect(feld.type).toBe("password");
    fireEvent.change(feld, { target: { value: "geheim-123" } });
    fireEvent.click(document.getElementById("schluessel-mistral-speichern")!);
    await screen.findByText("Gespeichert und verschluesselt.");
    expect(onSpeichern).toHaveBeenCalledWith("mistral", "geheim-123");
    expect(feld.value).toBe("");
    expect(document.body.textContent).not.toContain("geheim-123");
  });

  it("Stand je Fach, Entfernen nach Rueckfrage", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onEntfernen } = seite({ hinterlegt: ["mistral"], fehlerhaft: ["kb"] });
    expect(document.getElementById("schluessel-mistral-stand")!.textContent).toBe("hinterlegt");
    expect(document.getElementById("schluessel-eurouter-stand")!.textContent).toBe("fehlt");
    expect(document.getElementById("schluessel-kb-stand")!.textContent).toBe("laesst sich nicht oeffnen");
    fireEvent.click(document.getElementById("schluessel-mistral-entfernen")!);
    expect(onEntfernen).toHaveBeenCalledWith("mistral");
  });

  it("Fehler beim Speichern sichtbar", async () => {
    seite({ onSpeichern: async () => { throw new Error("Der Schluessel enthaelt Leerzeichen."); } });
    fireEvent.change(screen.getByLabelText("Mistral-Schluessel eintragen"), { target: { value: "a b" } });
    fireEvent.click(document.getElementById("schluessel-mistral-speichern")!);
    expect((await screen.findByRole("alert")).textContent).toContain("Leerzeichen");
  });

  it("ohne Verschluesselung (altes iOS): Felder gesperrt, ehrlicher Hinweis", () => {
    seite({ tresorDa: false });
    expect(document.getElementById("tresor-fehlt")).not.toBeNull();
    expect((document.getElementById("schluessel-mistral") as HTMLInputElement).disabled).toBe(true);
  });

  it("wartende Ablage: Zahl und 'Jetzt ablegen' nur mit Datenbank-Schluessel", () => {
    const { onNachholen } = seite({ ausstehend: 2, hinterlegt: ["kb"] });
    expect(document.getElementById("spiegel-stand")!.textContent).toContain("2 Chats warten");
    fireEvent.click(document.getElementById("spiegel-nachholen")!);
    expect(onNachholen).toHaveBeenCalled();
    cleanup();
    seite({ ausstehend: 1 });
    expect(document.getElementById("spiegel-stand")!.textContent).toContain("Datenbank-Schluessel fehlt");
    expect(document.getElementById("spiegel-nachholen")).toBeNull();
  });
});

describe("useDirekt", () => {
  it("oeffnet den Tresor nach Face ID, holt Modelle und schickt Wartendes, wenn Netz kommt", async () => {
    const key = await vaultKey(new Uint8Array(32).fill(2).buffer);
    await schluesselSpeichern(key, "mistral", "m-key");
    const c = await neuerChat("m");
    await chatAendern(c.id, (x) => {
      x.nachrichten.push({ id: "1", rolle: "nutzer", text: "offline gefragt", zeit: "2026-10-29T10:00:00Z", status: "wartet" });
    });
    const n = netz({
      "api.mistral.ai/v1/models": [json(200, { data: [{ id: "mistral-large-4-0" }] })],
      [MISTRAL]: [sse(textDelta("nachgeholt"))],
    });
    const { result } = renderHook(() => useDirekt(key, n.fetch));
    await waitFor(() => expect(result.current.schluessel.mistral).toBe("m-key"));
    await waitFor(() => expect(result.current.modelle.map((m) => m.id)).toEqual(["mistral-large-4-0"]));
    await waitFor(async () => expect((await chatLesen(c.id))!.nachrichten.at(-1)!.text).toBe("nachgeholt"));
    await waitFor(() => expect(result.current.chats[0]?.nachrichten).toHaveLength(2));
    // neuer Schluessel ueber die Einstellungen
    await act(async () => {
      await result.current.speichern("kb", "kb-key");
    });
    expect(result.current.hinterlegt).toEqual(["mistral", "kb"]);
    act(() => result.current.entfernen("kb"));
    expect(result.current.schluessel.kb).toBeUndefined();
  });

  it("ohne Tresor (kein PRF) laesst sich nichts speichern", async () => {
    const { result } = renderHook(() => useDirekt(null));
    await expect(result.current.speichern("mistral", "x")).rejects.toThrow("Face-ID");
  });
});

describe("Direkt-Chats in der Liste", () => {
  it("als 'iPhone' mit Archiv, Klon-Herkunft und wartenden Fragen", async () => {
    const c = await neuerChat("m");
    const x = await chatAendern(c.id, (y) => {
      y.archiviert = true;
      y.herkunft = { geraet: "macbook", sessionId: "s", titel: "t", geklontAm: "" };
      y.nachrichten.push({ id: "1", rolle: "nutzer", text: "a", zeit: "", status: "wartet" });
    });
    const [s] = direktAlsSitzungen([x]);
    expect(s._host).toBe("iphone");
    expect((s._meta as { archivedAt?: string }).archivedAt).toBeTruthy();
    expect((s as unknown as { _direkt: { herkunft: string; wartet: number } })._direkt).toEqual({ herkunft: "Klon vom MacBook", wartet: 1 });
  });
});
