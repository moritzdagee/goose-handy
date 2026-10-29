// Ein Tablet-Chat (Moose beta) auf dem iPhone (29.10.2026): Kopie aus der
// Wissensdatenbank, nur lesen. Das Tablet ist kein Gastgeber; weiter geht es
// mit "Auf dieses iPhone klonen" als Direkt-Chat. Offline zeigt die Ansicht
// den gemerkten Stand (tablet.ts), ohne Schluessel einen Weg zu den Einstellungen.
import { useEffect, useState } from "react";
import { ChevronLeft, Copy, KeyRound, Smartphone, Tablet } from "lucide-react";
import { AgentMessage, UserBubble } from "../ui/ChatItems";
import { Dot, Pill } from "../ui/Primitives";
import { tabletChatKlonen } from "./klonen";
import { gemerkterVerlauf, tabletVerlaufHolen, verlaufMerken, type TabletVerlauf } from "./tablet";

export function TabletChatAnsicht({
  eintrag,
  kbSchluessel,
  abruf,
  online: onlineProp,
  klonVon = () => null,
  onBack,
  onGeklont,
  onEinstellungen,
}: {
  eintrag: { id: number; titel: string };
  kbSchluessel?: string;
  abruf?: typeof fetch;
  /** Fuer Tests; Standard navigator.onLine. */
  online?: boolean;
  /** Id eines schon vorhandenen Klons auf dem iPhone, sonst null. */
  klonVon?: (ref: string) => string | null;
  onBack: () => void;
  /** Klon angelegt (oder vorhandener gewaehlt): Direkt-Chat oeffnen. */
  onGeklont: (chatId: string) => void;
  onEinstellungen: () => void;
}) {
  const [verlauf, setVerlauf] = useState<TabletVerlauf | null>(() => gemerkterVerlauf(eintrag.id));
  const [laedt, setLaedt] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [klont, setKlont] = useState(false);
  const [klonFehler, setKlonFehler] = useState<string | null>(null);
  const online = onlineProp ?? (typeof navigator === "undefined" ? true : navigator.onLine !== false);

  useEffect(() => {
    let aus = false;
    const gemerkt = gemerkterVerlauf(eintrag.id);
    setVerlauf(gemerkt);
    setHinweis(null);
    if (!kbSchluessel) return;
    if (!online) {
      setHinweis(gemerkt ? "Kein Netz. Gezeigt wird der gemerkte Stand." : "Kein Netz, und dieser Tablet-Chat wurde auf dem iPhone noch nie geoeffnet.");
      return;
    }
    setLaedt(true);
    tabletVerlaufHolen(eintrag.id, kbSchluessel, abruf)
      .then((v) => {
        if (aus) return;
        verlaufMerken(v);
        setVerlauf(v);
      })
      .catch((f) => {
        if (aus) return;
        const text = f instanceof Error ? f.message : String(f);
        setHinweis(gemerkt ? `${text} Gezeigt wird der gemerkte Stand.` : text);
      })
      .finally(() => {
        if (!aus) setLaedt(false);
      });
    return () => {
      aus = true;
    };
  }, [eintrag.id, kbSchluessel, abruf, online]);

  const ref = verlauf ? (verlauf.ref ?? `kb-${verlauf.id}`) : null;
  const vorhanden = ref ? klonVon(ref) : null;
  const titel = verlauf?.titel || eintrag.titel || "(ohne Titel)";
  const ohneSchluessel = !kbSchluessel && !verlauf;
  const ohneNetzLeer = !!kbSchluessel && !online && !verlauf;

  const klonen = async () => {
    if (!verlauf || klont) return;
    setKlont(true);
    setKlonFehler(null);
    try {
      const c = await tabletChatKlonen(verlauf);
      onGeklont(c.id);
    } catch (f) {
      setKlonFehler(f instanceof Error ? f.message : String(f));
    } finally {
      setKlont(false);
    }
  };

  return (
    <div id="tablet-chat" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line bg-canvas">
        <div className="flex h-12 min-w-0 items-center gap-2 pr-3">
          <button
            id="tablet-zurueck"
            type="button"
            onClick={onBack}
            aria-label="Zurueck zu den Chats"
            className="flex h-11 shrink-0 items-center pr-2 pl-1 text-[16px] text-accent"
          >
            <ChevronLeft size={22} aria-hidden /> Chats
          </button>
          <span id="tablet-titel" className="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {titel}
          </span>
          <span className="host-badge inline-flex shrink-0 items-center gap-1 rounded-md bg-elevated px-1.5 py-0.5 text-[12px] font-medium text-ink-muted">
            <Tablet size={12} aria-hidden /> Tablet
          </span>
        </div>
      </div>

      <div id="tablet-log" className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-2">
          <div className="flex flex-col items-center gap-1 text-center">
            <Pill tone="warn">
              <Copy size={11} aria-hidden />
              Kopie aus der Datenbank
            </Pill>
            <div className="text-[12px] text-ink-faint">Gefuehrt auf dem Tablet. Hier nur lesen; zum Weiterschreiben auf dieses iPhone klonen.</div>
          </div>
          {ohneSchluessel && (
            <div id="tablet-ohne-schluessel" className="px-4 py-8 text-center">
              <div className="text-[15px] text-ink">Tablet-Chats kommen aus deiner Wissensdatenbank.</div>
              <div className="mt-1 text-[14px] text-ink-muted">Dafuer einmal den Datenbank-Schluessel eintragen.</div>
              <button
                id="tablet-zu-einstellungen"
                type="button"
                onClick={onEinstellungen}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-elevated px-4 text-[15px] font-semibold text-ink"
              >
                <KeyRound size={16} aria-hidden /> Datenbank-Schluessel eintragen
              </button>
            </div>
          )}
          {laedt && !verlauf && (
            <div role="status" className="flex items-center justify-center gap-2 text-[14px] text-ink-muted">
              <Dot tone="warn" pulse /> Lade aus der Wissensdatenbank…
            </div>
          )}
          {verlauf && verlauf.beitraege.length === 0 && <div className="py-6 text-center text-[14px] text-ink-faint">Dieser Tablet-Chat ist leer.</div>}
          {verlauf?.beitraege.map((b, i) =>
            b.rolle === "nutzer" ? <UserBubble key={i} text={b.text} /> : <AgentMessage key={i} text={b.text} />,
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-canvas px-3 pt-2 pb-safe">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 pb-2">
          {(hinweis || ohneNetzLeer) && (
            <div id="tablet-hinweis" role="status" className="rounded-xl bg-warn/10 px-3 py-2 text-[13px] leading-snug text-warn">
              {hinweis ?? "Kein Netz, und dieser Tablet-Chat wurde auf dem iPhone noch nie geoeffnet."}
            </div>
          )}
          {klonFehler && (
            <div id="tablet-klon-fehler" role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-[13px] leading-snug text-danger">
              {klonFehler}
            </div>
          )}
          {vorhanden && (
            <button
              id="tablet-klon-oeffnen"
              type="button"
              onClick={() => onGeklont(vorhanden)}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent text-[16px] font-semibold text-accent-ink active:opacity-80"
            >
              <Smartphone size={18} aria-hidden /> Klon auf dem iPhone oeffnen
            </button>
          )}
          <button
            id="tablet-klonen"
            type="button"
            disabled={!verlauf || verlauf.beitraege.length === 0 || klont}
            onClick={() => void klonen()}
            className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-[16px] font-semibold active:opacity-80 disabled:opacity-40 ${
              vorhanden ? "border-2 border-accent bg-surface text-ink" : "bg-accent text-accent-ink"
            }`}
          >
            <Smartphone size={18} aria-hidden /> {klont ? "Klone…" : vorhanden ? "Nochmal klonen" : "Auf dieses iPhone klonen"}
          </button>
        </div>
      </div>
    </div>
  );
}
