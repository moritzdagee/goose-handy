// Shown before the app on every start and after a longer pause. Safari only
// runs Face ID from a tap, so each step is one button.
import { useState } from "react";
import {
  createPasskey,
  loadLock,
  resetLock,
  setUpLock,
  unlock,
  verifyWithPasskey,
  SECRET_STORAGE_KEY,
} from "./lock";

type Step = "unlock" | "create" | "confirm";

export function LockScreen({
  newSecret,
  onUnlocked,
  create = createPasskey,
  verify = verifyWithPasskey,
}: {
  /** Fresh identity for a phone that has none yet (or after a reset). */
  newSecret: () => string;
  onUnlocked: (secret: string) => void;
  create?: () => Promise<string>;
  verify?: (credId: string) => Promise<ArrayBuffer | null>;
}) {
  const [step, setStep] = useState<Step>(() => (loadLock() ? "unlock" : "create"));
  const [credId, setCredId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = loadLock();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const name = (err as { name?: string })?.name;
      setError(name === "NotAllowedError" ? "Face ID abgebrochen. Bitte nochmal tippen." : String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const onUnlock = () =>
    run(async () => {
      if (!lock) return setStep("create");
      onUnlocked(await unlock(lock, verify));
    });
  const onCreate = () =>
    run(async () => {
      setCredId(await create());
      setStep("confirm");
    });
  const onConfirm = () =>
    run(async () => {
      if (!credId) return setStep("create");
      const secret = localStorage.getItem(SECRET_STORAGE_KEY) ?? newSecret();
      onUnlocked(await setUpLock(secret, verify, credId));
    });
  const onReset = () => {
    if (!window.confirm("Sperre und Zugangsschluessel auf diesem iPhone loeschen? Danach muss das iPhone neu mit MacBook und Mac Mini gekoppelt werden.")) return;
    resetLock();
    setCredId(null);
    setStep("create");
  };

  const title = step === "unlock" ? "Goose ist gesperrt" : "Face-ID-Sperre einrichten";
  const text =
    step === "unlock"
      ? "Entsperre mit Face ID, dann verbindet sich die App mit deinen Rechnern."
      : step === "create"
        ? "Goose hat Zugriff auf deine Rechner und deine Datenbank. Die App legt dafuer einen eigenen Passkey an und oeffnet sich danach nur noch mit Face ID."
        : "Passkey angelegt. Einmal mit Face ID bestaetigen, dann ist die Sperre aktiv.";
  const action = step === "unlock" ? onUnlock : step === "create" ? onCreate : onConfirm;
  const label = step === "unlock" ? "Mit Face ID entsperren" : step === "create" ? "Passkey anlegen" : "Mit Face ID bestaetigen";

  return (
    <div id="lock-screen" className="min-h-dvh flex items-center justify-center px-6 bg-background-primary text-text-primary">
      <div className="max-w-sm w-full flex flex-col gap-4 text-center">
        <div className="text-xl font-semibold">{title}</div>
        <div className="text-sm text-text-secondary">{text}</div>
        {lock?.mode === "uv" && step === "unlock" && (
          <div className="text-xs text-text-tertiary">
            Dieses iPhone kann den Schluessel nicht mit dem Passkey verschluesseln. Die Sperre schuetzt die Ansicht, der Schluessel liegt aber lesbar auf dem Geraet.
          </div>
        )}
        <button
          id="lock-action"
          disabled={busy}
          onClick={() => void action()}
          className="w-full bg-background-inverse text-text-inverse text-base font-semibold rounded-xl px-4 py-3.5 disabled:opacity-50"
        >
          {busy ? "Einen Moment…" : label}
        </button>
        {error && (
          <div id="lock-error" className="text-sm text-text-danger">
            {error}
          </div>
        )}
        {step === "unlock" && (
          <button id="lock-reset" onClick={onReset} className="text-xs text-text-tertiary underline">
            Passkey verloren? Neu einrichten
          </button>
        )}
      </div>
    </div>
  );
}
