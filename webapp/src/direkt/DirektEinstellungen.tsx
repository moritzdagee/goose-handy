// Einstellungen fuer den Direkt-Chat: Schluessel fuer Mistral, EUrouter und
// die Wissensdatenbank einmal eintragen. Sie werden sofort mit dem
// Face-ID-Passkey verschluesselt (tresor.ts); angezeigt wird nie ein Schluessel,
// nur ob er hinterlegt ist.
import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Pill } from "../ui/Primitives";
import type { SchluesselSlot } from "./tresor";

const FAECHER: { slot: SchluesselSlot; name: string; hilfe: string }[] = [
  { slot: "mistral", name: "Mistral", hilfe: "Pflicht fuer den Direkt-Chat. Zu finden unter console.mistral.ai, API Keys." },
  { slot: "eurouter", name: "EUrouter", hilfe: "Freiwillig: weitere Modelle als zweite Quelle." },
  { slot: "kb", name: "Wissensdatenbank", hilfe: "Freiwillig: Suche in deinen Daten und Gespraeche dort ablegen." },
];

function Fach({
  slot,
  name,
  hilfe,
  hinterlegt,
  kaputt,
  gesperrt,
  onSpeichern,
  onEntfernen,
}: {
  slot: SchluesselSlot;
  name: string;
  hilfe: string;
  hinterlegt: boolean;
  kaputt: boolean;
  gesperrt: boolean;
  onSpeichern: (slot: SchluesselSlot, wert: string) => Promise<void>;
  onEntfernen: (slot: SchluesselSlot) => void;
}) {
  const [wert, setWert] = useState("");
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);
  return (
    <section aria-label={`${name}-Schluessel`} className="flex flex-col gap-2 rounded-2xl bg-surface p-4">
      <div className="flex items-center gap-2">
        <KeyRound size={18} aria-hidden className="text-accent" />
        <h3 className="flex-1 text-[16px] font-semibold">{name}</h3>
        <span id={`schluessel-${slot}-stand`}>
          {kaputt ? <Pill tone="warn">laesst sich nicht oeffnen</Pill> : hinterlegt ? <Pill tone="live">hinterlegt</Pill> : <Pill>fehlt</Pill>}
        </span>
      </div>
      <p className="text-[13px] leading-snug text-ink-muted">{hilfe}</p>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!wert.trim()) return;
          setBusy(true);
          setMeldung(null);
          try {
            await onSpeichern(slot, wert);
            setWert("");
            setMeldung({ text: "Gespeichert und verschluesselt.", fehler: false });
          } catch (f) {
            setMeldung({ text: f instanceof Error ? f.message : String(f), fehler: true });
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          id={`schluessel-${slot}`}
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={`${name}-Schluessel ${hinterlegt ? "ersetzen" : "eintragen"}`}
          placeholder={hinterlegt ? "neuen Schluessel einfuegen" : "Schluessel einfuegen"}
          disabled={gesperrt || busy}
          value={wert}
          onChange={(e) => setWert(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 text-[16px] text-ink outline-none focus:border-accent disabled:opacity-50"
        />
        <button
          id={`schluessel-${slot}-speichern`}
          type="submit"
          disabled={gesperrt || busy || !wert.trim()}
          className="min-h-11 shrink-0 rounded-xl bg-accent px-4 text-[15px] font-semibold text-accent-ink active:opacity-80 disabled:opacity-40"
        >
          Speichern
        </button>
      </form>
      {(hinterlegt || kaputt) && (
        <button
          id={`schluessel-${slot}-entfernen`}
          type="button"
          className="min-h-11 self-start text-[14px] text-ink-muted underline-offset-4 active:underline"
          onClick={() => {
            if (window.confirm(`${name}-Schluessel von diesem iPhone loeschen?`)) onEntfernen(slot);
          }}
        >
          Schluessel entfernen
        </button>
      )}
      {meldung && (
        <div role={meldung.fehler ? "alert" : "status"} className={`text-[13px] ${meldung.fehler ? "text-danger" : "text-live"}`}>
          {meldung.text}
        </div>
      )}
    </section>
  );
}

export function DirektEinstellungen({
  tresorDa,
  hinterlegt,
  fehlerhaft,
  ausstehend,
  onSpeichern,
  onEntfernen,
  onNachholen,
}: {
  tresorDa: boolean;
  hinterlegt: SchluesselSlot[];
  fehlerhaft: SchluesselSlot[];
  ausstehend: number;
  onSpeichern: (slot: SchluesselSlot, wert: string) => Promise<void>;
  onEntfernen: (slot: SchluesselSlot) => void;
  onNachholen: () => void;
}) {
  return (
    <div id="einstellungen" className="fade-in flex-1 overflow-y-auto overscroll-contain pb-safe">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-5 pb-6">
        <h2 className="text-[22px] font-semibold tracking-tight">Direkt-Chat</h2>
        <div className="flex items-start gap-2 rounded-2xl bg-elevated p-4 text-[14px] leading-snug text-ink-muted">
          <ShieldCheck size={20} aria-hidden className="mt-0.5 shrink-0 text-live" />
          <span>
            Mit diesen Schluesseln chattet das iPhone selbst, auch wenn Mac Mini und MacBook aus sind. Sie liegen nur verschluesselt auf
            diesem iPhone und oeffnen sich nur nach Face ID.
          </span>
        </div>
        {!tresorDa && (
          <div id="tresor-fehlt" role="alert" className="rounded-2xl bg-warn/10 p-4 text-[14px] leading-snug text-warn">
            Dieses iPhone kann mit dem Passkey nichts verschluesseln (aelteres iOS). Schluessel werden deshalb nicht gespeichert.
          </div>
        )}
        {FAECHER.map((f) => (
          <Fach
            key={f.slot}
            {...f}
            hinterlegt={hinterlegt.includes(f.slot)}
            kaputt={fehlerhaft.includes(f.slot)}
            gesperrt={!tresorDa}
            onSpeichern={onSpeichern}
            onEntfernen={onEntfernen}
          />
        ))}
        <section aria-label="Spiegelung in die Wissensdatenbank" className="flex flex-col gap-2 rounded-2xl bg-surface p-4">
          <h3 className="text-[16px] font-semibold">Ablage in der Wissensdatenbank</h3>
          <p id="spiegel-stand" className="text-[14px] text-ink-muted">
            {ausstehend === 0
              ? "Alle Direkt-Chats sind abgelegt."
              : `${ausstehend === 1 ? "Ein Chat wartet" : `${ausstehend} Chats warten`} auf die Ablage${hinterlegt.includes("kb") ? "." : " (Datenbank-Schluessel fehlt)."}`}
          </p>
          {ausstehend > 0 && hinterlegt.includes("kb") && (
            <button id="spiegel-nachholen" type="button" onClick={onNachholen} className="min-h-11 self-start rounded-xl bg-elevated px-4 text-[14px] text-ink">
              Jetzt ablegen
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
