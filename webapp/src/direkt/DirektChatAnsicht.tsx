// Ein Direkt-Chat auf dem iPhone (29.10.2026): Verlauf aus dem iPhone-Speicher,
// Antwort waechst live (Strom), Modellwahl, wartende Fragen mit "Jetzt senden".
// Gleiche Bausteine wie der Rechner-Chat (UserBubble, AgentMessage).
import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, ArrowUp, ChevronLeft, KeyRound, SlidersHorizontal, Smartphone, WifiOff } from "lucide-react";
import { AgentMessage, SystemLine, UserBubble } from "../ui/ChatItems";
import { Dot, Pill } from "../ui/Primitives";
import { STANDARD_MODELL, findeAnbieter, type ModellWahl } from "./anbieter";
import { WartetFehler, direktSenden, laeuftGerade, wartendeSenden } from "./chat";
import { chatAendern, chatArchivieren, chatLesen, type DirektChat } from "./speicher";
import type { SchluesselWerte } from "./tresor";
import { DIREKT_GEAENDERT } from "./useDirekt";
import { herkunftText } from "./liste";

const MAX_HEIGHT = 8 * 24 + 20;

function Hinweis({ id, ton = "warn", children }: { id: string; ton?: "warn" | "danger"; children: React.ReactNode }) {
  const cls = ton === "danger" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn";
  return (
    <div id={id} role={ton === "danger" ? "alert" : "status"} className={`mx-auto mb-2 flex w-full max-w-3xl items-start gap-2 rounded-xl px-3 py-2 text-[13px] leading-snug ${cls}`}>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

export function DirektChatAnsicht({
  chatId,
  schluessel,
  modelle,
  abruf,
  online: onlineProp,
  onBack,
  onEinstellungen,
  onGeaendert,
}: {
  chatId: string;
  schluessel: SchluesselWerte;
  modelle: ModellWahl[];
  abruf?: typeof fetch;
  /** Fuer Tests; Standard navigator.onLine samt Ereignissen. */
  online?: boolean;
  onBack: () => void;
  onEinstellungen: () => void;
  onGeaendert: () => void;
}) {
  const [chat, setChat] = useState<DirektChat | null>(null);
  const [busy, setBusy] = useState(false);
  const [frage, setFrage] = useState<string | null>(null);
  const [strom, setStrom] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ text: string; ton: "warn" | "danger" } | null>(null);
  const [zeigeModell, setZeigeModell] = useState(false);
  const [netz, setNetz] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const online = onlineProp ?? netz;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const neuLaden = useCallback(async () => {
    setChat(await chatLesen(chatId));
  }, [chatId]);

  useEffect(() => {
    void neuLaden();
    const h = () => {
      if (!laeuftGerade(chatId)) void neuLaden();
    };
    window.addEventListener(DIREKT_GEAENDERT, h);
    const an = () => setNetz(true);
    const aus = () => setNetz(false);
    window.addEventListener("online", an);
    window.addEventListener("offline", aus);
    return () => {
      window.removeEventListener(DIREKT_GEAENDERT, h);
      window.removeEventListener("online", an);
      window.removeEventListener("offline", aus);
    };
  }, [chatId, neuLaden]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, strom, frage]);

  const anbieter = findeAnbieter(chat?.anbieter);
  const schluesselFehlt = !schluessel[anbieter.id];
  const wartende = chat?.nachrichten.filter((n) => n.rolle === "nutzer" && n.status === "wartet") ?? [];

  const optionen = {
    schluessel,
    abruf,
    online: () => online,
    onChunk: (t: string) => setStrom((s) => (s ?? "") + t),
    onRunde: () => setStrom(""),
    onStatus: (t: string) => setStatus(t),
  };

  const ausfuehren = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMeldung(null);
    setStrom("");
    try {
      await fn();
    } catch (f) {
      const text = f instanceof Error ? f.message : String(f);
      // "Wartet" steht schon unter der Nachricht (mit Grund): kein zweiter Hinweis.
      setMeldung(f instanceof WartetFehler ? null : { text, ton: "danger" });
    } finally {
      // Erst den gespeicherten Stand laden, dann die Live-Anzeige abbauen:
      // sonst blitzt kurz der alte Stand ("wartet") auf.
      try {
        await neuLaden();
      } finally {
        setBusy(false);
        setFrage(null);
        setStrom(null);
        setStatus(null);
        onGeaendert();
      }
    }
  };

  const senden = () => {
    const el = inputRef.current;
    const text = el?.value.trim() ?? "";
    if (!text || busy) return;
    if (el) {
      el.value = "";
      el.style.height = "auto";
    }
    setFrage(text);
    void ausfuehren(() => direktSenden(chatId, text, optionen));
  };

  const wiederholen = () => {
    if (busy) return;
    void ausfuehren(async () => {
      const n = await wartendeSenden(chatId, optionen);
      if (n === 0) {
        const c = await chatLesen(chatId);
        const grund = c?.nachrichten.find((x) => x.status === "wartet")?.grund;
        if (grund) throw new WartetFehler(grund);
      }
    });
  };

  const modellWert = chat ? `${chat.anbieter ?? "mistral"}|${chat.modell || STANDARD_MODELL}` : "";
  const auswahl = [...modelle];
  if (chat && !auswahl.some((m) => `${m.anbieter}|${m.id}` === modellWert)) {
    auswahl.unshift({ id: chat.modell || STANDARD_MODELL, anbieter: chat.anbieter ?? "mistral", beschriftung: chat.modell || STANDARD_MODELL });
  }
  const herkunft = chat ? herkunftText(chat) : null;

  return (
    <div id="direkt-chat" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line bg-canvas">
        <div className="flex h-12 min-w-0 items-center gap-2 pr-1">
          <button
            id="direkt-zurueck"
            type="button"
            onClick={onBack}
            aria-label="Zurueck zu den Chats"
            className="flex h-11 shrink-0 items-center pr-2 pl-1 text-[16px] text-accent"
          >
            <ChevronLeft size={22} aria-hidden /> Chats
          </button>
          <span id="direkt-titel" className="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {chat?.titel ?? ""}
          </span>
          <span className="host-badge inline-flex shrink-0 items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-[12px] font-medium text-accent">
            <Smartphone size={12} aria-hidden /> iPhone
          </span>
          <button
            id="direkt-modell-knopf"
            type="button"
            aria-label="Modell fuer diesen Chat waehlen"
            aria-expanded={zeigeModell}
            className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${zeigeModell ? "bg-elevated text-ink" : "text-ink-muted"}`}
            onClick={() => setZeigeModell((v) => !v)}
          >
            <SlidersHorizontal size={19} aria-hidden />
          </button>
        </div>
        {zeigeModell && chat && (
          <div className="fade-in flex flex-col gap-2 px-3 pb-3">
            <label className="flex min-w-0 flex-col gap-1 text-[12px] text-ink-faint">
              Modell
              <select
                id="direkt-modell"
                aria-label="Modell"
                className="min-h-11 w-full rounded-lg border border-line bg-surface px-2 text-[14px] text-ink disabled:opacity-50"
                value={modellWert}
                disabled={busy}
                onChange={async (e) => {
                  const [anb, ...rest] = e.target.value.split("|");
                  const id = rest.join("|");
                  await chatAendern(chatId, (c) => {
                    c.modell = id;
                    c.anbieter = anb === "eurouter" ? "eurouter" : "mistral";
                  });
                  await neuLaden();
                  onGeaendert();
                }}
              >
                {auswahl.map((m) => (
                  <option key={`${m.anbieter}|${m.id}`} value={`${m.anbieter}|${m.id}`}>
                    {m.beschriftung}
                  </option>
                ))}
              </select>
            </label>
            <button
              id="direkt-archivieren"
              type="button"
              aria-label={chat.archiviert ? "Chat aus dem Archiv zurueckholen" : "Chat archivieren"}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-elevated text-[14px] text-ink"
              onClick={async () => {
                await chatArchivieren(chatId, !chat.archiviert);
                await neuLaden();
                onGeaendert();
              }}
            >
              {chat.archiviert ? <ArchiveRestore size={16} aria-hidden /> : <Archive size={16} aria-hidden />}
              {chat.archiviert ? "Zurueckholen" : "Archivieren"}
            </button>
          </div>
        )}
      </div>

      <div ref={logRef} id="direkt-log" className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-2">
          {herkunft && (
            <div className="self-center">
              <Pill tone="warn">{herkunft}</Pill>
            </div>
          )}
          {chat && chat.nachrichten.length === 0 && !frage && (
            <div id="direkt-leer" className="px-4 py-10 text-center">
              <div className="text-[16px] text-ink">Direkt auf dem iPhone</div>
              <div className="mt-1 text-[14px] text-ink-muted">
                Antwortet ohne Mac Mini und MacBook, mit {anbieter.name}. Das Gespraech landet in deiner Wissensdatenbank.
              </div>
            </div>
          )}
          {chat?.nachrichten.map((n) => {
            if (n.rolle === "system") return <SystemLine key={n.id} text={n.text} />;
            if (n.rolle === "assistent") return <AgentMessage key={n.id} text={n.text} />;
            // Waehrend gesendet wird, ist "wartet" keine Information mehr.
            const wartet = n.status === "wartet" && !busy;
            return (
              <div key={n.id} className="flex flex-col items-end gap-1">
                <UserBubble text={n.text} />
                {wartet && (
                  <div className="direkt-wartet flex max-w-[85%] items-center gap-1.5 text-right text-[12px] text-warn">
                    <Pill tone="warn">wartet</Pill>
                    <span className="min-w-0">{n.grund && n.grund !== "wird gesendet" ? n.grund : "noch ohne Antwort"}</span>
                  </div>
                )}
              </div>
            );
          })}
          {frage && <UserBubble text={frage} />}
          {busy && strom !== null && strom.length > 0 && <AgentMessage text={strom} />}
          {busy && (
            <div id="direkt-arbeitet" role="status" className="flex items-center gap-2 text-[13px] text-ink-muted">
              <Dot tone="warn" pulse /> {status ?? "Einen Moment…"}
            </div>
          )}
        </div>
      </div>

      <form
        id="direkt-form"
        className="shrink-0 border-t border-line bg-canvas px-3 pt-2 pb-safe"
        onSubmit={(e) => {
          e.preventDefault();
          senden();
        }}
      >
        {schluesselFehlt && (
          <Hinweis id="direkt-schluessel-fehlt">
            Fuer den Direkt-Chat fehlt der {anbieter.name}-Schluessel.{" "}
            <button id="direkt-zu-einstellungen" type="button" className="inline-flex items-center gap-1 font-semibold underline underline-offset-2" onClick={onEinstellungen}>
              <KeyRound size={13} aria-hidden /> Schluessel eintragen
            </button>
          </Hinweis>
        )}
        {!online && (
          <Hinweis id="direkt-offline">
            <span className="inline-flex items-center gap-1">
              <WifiOff size={13} aria-hidden /> Kein Netz. Nachrichten warten und gehen automatisch raus.
            </span>
          </Hinweis>
        )}
        {wartende.length > 0 && !busy && online && !schluesselFehlt && (
          <Hinweis id="direkt-wartende">
            {wartende.length === 1 ? "Eine Nachricht wartet." : `${wartende.length} Nachrichten warten.`}{" "}
            <button id="direkt-wiederholen" type="button" className="font-semibold underline underline-offset-2" onClick={wiederholen}>
              Jetzt senden
            </button>
          </Hinweis>
        )}
        {meldung && (
          <Hinweis id="direkt-meldung" ton={meldung.ton}>
            {meldung.text}
          </Hinweis>
        )}
        <div className="mx-auto flex w-full max-w-3xl items-end gap-1 rounded-[24px] border border-line bg-surface p-1 pl-3 focus-within:border-accent">
          <textarea
            ref={inputRef}
            id="direkt-input"
            rows={1}
            aria-label="Nachricht an Goose auf dem iPhone"
            placeholder={busy ? "Goose antwortet…" : "Nachricht an Goose (direkt)…"}
            className="min-h-11 flex-1 resize-none border-none bg-transparent py-2.5 text-[16px] leading-6 text-ink outline-none placeholder:text-ink-faint focus:ring-0"
            style={{ maxHeight: MAX_HEIGHT }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                senden();
              }
            }}
          />
          <button
            id="direkt-senden"
            type="submit"
            disabled={busy}
            aria-label="senden"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-opacity duration-150 active:opacity-80 disabled:opacity-40"
          >
            <ArrowUp size={21} strokeWidth={2.5} aria-hidden />
          </button>
        </div>
      </form>
    </div>
  );
}
