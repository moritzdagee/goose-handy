// Shown before the app on every start and after a longer pause. Safari only
// runs Face ID from a tap, so each step is one button.
import { useState } from "react";
import { ScanFace } from "lucide-react";
import { GooseMark } from "./ui/Primitives";
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
    <div id="lock-screen" className="flex min-h-dvh items-center justify-center bg-canvas px-8 pt-safe pb-safe text-ink">
      <main className="fade-in flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <GooseMark size={72} />
        <div className="flex flex-col gap-3">
          <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
          <p className="text-[16px] leading-relaxed text-ink-muted">{text}</p>
        </div>
        <button
          id="lock-action"
          type="button"
          disabled={busy}
          onClick={() => void action()}
          className="flex min-h-14 w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-accent px-6 text-[17px] font-semibold text-accent-ink transition-opacity duration-150 active:opacity-80 disabled:opacity-60"
        >
          <ScanFace size={22} aria-hidden />
          <span>{busy ? "Einen Moment…" : label}</span>
        </button>
        {error && (
          <div id="lock-error" role="alert" className="text-[15px] text-danger">
            {error}
          </div>
        )}
        {step === "unlock" && (
          <button id="lock-reset" type="button" onClick={onReset} className="min-h-11 text-[15px] text-ink-muted underline-offset-4 active:underline">
            Passkey verloren? Neu einrichten
          </button>
        )}
        {lock?.mode === "uv" && step === "unlock" && (
          <div className="max-w-xs rounded-xl bg-warn/10 px-4 py-3 text-[13px] leading-snug text-warn">
            Dieses iPhone kann den Schluessel nicht mit dem Passkey verschluesseln. Die Sperre schuetzt die Ansicht, der Schluessel liegt aber lesbar auf dem Geraet.
          </div>
        )}
      </main>
    </div>
  );
}
