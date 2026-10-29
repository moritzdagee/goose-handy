import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LockScreen } from "./LockScreen";
import { SECRET_STORAGE_KEY, loadLock } from "./lock";

const SECRET = "cd".repeat(32);
const prf = () => new Uint8Array(32).fill(5).buffer;

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

const click = () => fireEvent.click(document.getElementById("lock-action")!);

describe("LockScreen", () => {
  it("richtet die Sperre in zwei Face-ID-Schritten ein und behaelt den gekoppelten Schluessel", async () => {
    localStorage.setItem(SECRET_STORAGE_KEY, SECRET);
    const onUnlocked = vi.fn();
    const newSecret = vi.fn(() => "neu");
    render(<LockScreen newSecret={newSecret} onUnlocked={onUnlocked} create={async () => "cred"} verify={async () => prf()} />);
    expect(screen.getByText("Passkey anlegen")).toBeTruthy();
    click();
    await screen.findByText("Mit Face ID bestaetigen");
    click();
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledWith(SECRET));
    expect(newSecret).not.toHaveBeenCalled();
    expect(loadLock()?.mode).toBe("prf");
    expect(localStorage.getItem(SECRET_STORAGE_KEY)).toBeNull();
  });

  it("neues iPhone ohne Schluessel bekommt einen neuen", async () => {
    const onUnlocked = vi.fn();
    render(<LockScreen newSecret={() => "frisch"} onUnlocked={onUnlocked} create={async () => "cred"} verify={async () => prf()} />);
    click();
    await screen.findByText("Mit Face ID bestaetigen");
    click();
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledWith("frisch"));
  });

  it("entsperrt beim naechsten Start nur mit Face ID", async () => {
    localStorage.setItem(SECRET_STORAGE_KEY, SECRET);
    const first = render(<LockScreen newSecret={() => "x"} onUnlocked={() => {}} create={async () => "cred"} verify={async () => prf()} />);
    click();
    await screen.findByText("Mit Face ID bestaetigen");
    click();
    await waitFor(() => expect(loadLock()).not.toBeNull());
    first.unmount();

    const onUnlocked = vi.fn();
    const verify = vi.fn(async () => prf());
    render(<LockScreen newSecret={() => "x"} onUnlocked={onUnlocked} verify={verify} />);
    expect(screen.getByText("Goose ist gesperrt")).toBeTruthy();
    expect(onUnlocked).not.toHaveBeenCalled();
    click();
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledWith(SECRET));
    expect(verify).toHaveBeenCalledWith("cred");
  });

  it("abgebrochenes Face ID: verstaendlicher Hinweis, App bleibt zu", async () => {
    localStorage.setItem(SECRET_STORAGE_KEY, SECRET);
    const setup = render(<LockScreen newSecret={() => "x"} onUnlocked={() => {}} create={async () => "cred"} verify={async () => prf()} />);
    click();
    await screen.findByText("Mit Face ID bestaetigen");
    click();
    await waitFor(() => expect(loadLock()).not.toBeNull());
    setup.unmount();

    const onUnlocked = vi.fn();
    render(
      <LockScreen
        newSecret={() => "x"}
        onUnlocked={onUnlocked}
        verify={async () => {
          throw new DOMException("x", "NotAllowedError");
        }}
      />,
    );
    click();
    expect((await screen.findByText(/Face ID abgebrochen/)).id).toBe("lock-error");
    expect(onUnlocked).not.toHaveBeenCalled();
  });
});

describe("LockScreen: Tresor-Schluessel fuer den Direkt-Chat", () => {
  it("liefert nach Face ID einen nicht auslesbaren Tresor-Schluessel, vor dem Entsperren", async () => {
    localStorage.setItem(SECRET_STORAGE_KEY, SECRET);
    const calls: string[] = [];
    const onVault = vi.fn((k: CryptoKey | null) => calls.push(k ? "tresor" : "kein"));
    const onUnlocked = vi.fn(() => calls.push("offen"));
    render(<LockScreen newSecret={() => "x"} onUnlocked={onUnlocked} onVault={onVault} create={async () => "cred"} verify={async () => prf()} />);
    click();
    await screen.findByText("Mit Face ID bestaetigen");
    click();
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledWith(SECRET));
    expect(calls).toEqual(["tresor", "offen"]);
    const key = onVault.mock.calls[0][0] as CryptoKey;
    expect(key.extractable).toBe(false);
    cleanup();
    // naechster Start
    const onVault2 = vi.fn();
    render(<LockScreen newSecret={() => "x"} onUnlocked={() => {}} onVault={onVault2} verify={async () => prf()} />);
    click();
    await waitFor(() => expect(onVault2).toHaveBeenCalled());
    expect(onVault2.mock.calls[0][0]).not.toBeNull();
  });

  it("ohne PRF (altes iOS): kein Tresor-Schluessel", async () => {
    const onVault = vi.fn();
    render(<LockScreen newSecret={() => "x"} onUnlocked={() => {}} onVault={onVault} create={async () => "cred"} verify={async () => null} />);
    click();
    await screen.findByText("Mit Face ID bestaetigen");
    click();
    await waitFor(() => expect(onVault).toHaveBeenCalledWith(null));
  });
});
