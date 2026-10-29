// The connect/hosts panel: saved-host rows, the add-host form with QR scan,
// onboarding copy, and the pairing card. Purely presentational — all state
// and actions live in App and arrive as props.
import type { RefObject } from "react";
import { Camera, ChevronDown, ChevronLeft, ChevronRight, Copy, Laptop, Monitor, Plus, Share } from "lucide-react";
import type { SavedHost } from "./hosts";
import { hostLabel } from "./hosts";
import { Dot } from "./ui/Primitives";

type ConnectPanelProps = {
  hosts: SavedHost[];
  addingHost: boolean;
  connected: boolean;
  busy: boolean;
  card: string;
  hostName: string;
  canScan: boolean;
  pairOpen: boolean;
  scanning: boolean;
  myCard: string;
  myId: string;
  isHostLive: (endpointId: string) => boolean;
  setShowHosts: (v: boolean) => void;
  setAddingHost: (v: boolean) => void;
  setCard: (v: string) => void;
  setHostName: (v: string) => void;
  setPairOpen: (v: boolean) => void;
  connect: (cardText?: string) => Promise<void>;
  startScan: () => Promise<void>;
  stopScan: () => void;
  videoRef: RefObject<HTMLVideoElement | null>;
};

export function ConnectPanel({
  hosts,
  addingHost,
  connected,
  busy,
  card,
  hostName,
  canScan,
  pairOpen,
  scanning,
  myCard,
  myId,
  isHostLive,
  setShowHosts,
  setAddingHost,
  setCard,
  setHostName,
  setPairOpen,
  connect,
  startScan,
  stopScan,
  videoRef,
}: ConnectPanelProps) {
  const backBtn = "flex size-11 shrink-0 items-center justify-center rounded-xl text-accent active:bg-elevated";
  return (
    <section id="connect-panel" className="flex-1 overflow-y-auto overscroll-contain bg-canvas px-4 pt-4 pb-safe">
      <div className="fade-in mx-auto w-full max-w-[480px] min-w-0">
        {hosts.length > 0 && !addingHost ? (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="flex items-center gap-1 px-2 pt-2">
              {connected && (
                <button type="button" aria-label="Zurueck zu den Chats" className={backBtn} onClick={() => setShowHosts(false)}>
                  <ChevronLeft size={22} aria-hidden />
                </button>
              )}
              <h2 className={`text-[19px] font-semibold ${connected ? "" : "pl-2"}`}>Deine Rechner</h2>
            </div>
            <p className="px-4 pt-1 pb-3 text-[14px] text-ink-muted">
              {connected
                ? "Verbundene Rechner teilen sich eine Chat-Liste. Tippen zum Verbinden."
                : "Tippen zum Verbinden."}
            </p>
            <div className="divide-y divide-line border-t border-line">
              {hosts.map((h) => {
                const live = isHostLive(h.endpointId);
                const name = hostLabel(h.endpointId, h.name);
                const Icon = /book/i.test(name) ? Laptop : Monitor;
                return (
                  <button
                    key={h.endpointId}
                    type="button"
                    className="host-row flex min-h-16 w-full items-center gap-3 px-4 text-left transition-colors active:bg-elevated disabled:cursor-default"
                    disabled={busy || live}
                    aria-label={`${name}, ${live ? "verbunden" : "verbinden"}`}
                    onClick={() => {
                      setCard(h.card);
                      void connect(h.card);
                    }}
                  >
                    <Icon size={22} aria-hidden className="shrink-0 text-ink-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] font-medium">{name}</span>
                      <span className="block truncate font-mono text-[12px] text-ink-faint">{h.endpointId.slice(0, 16)}</span>
                    </span>
                    {live ? (
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-live">
                        <Dot tone="live" /> verbunden
                      </span>
                    ) : busy ? (
                      <Dot tone="warn" pulse />
                    ) : (
                      <ChevronRight size={18} aria-hidden className="shrink-0 text-ink-faint" />
                    )}
                  </button>
                );
              })}
            </div>
            <button
              id="add-host"
              type="button"
              className="flex min-h-12 w-full items-center justify-center gap-1.5 border-t border-line text-[15px] text-accent active:bg-elevated"
              onClick={() => setAddingHost(true)}
            >
              <Plus size={17} aria-hidden /> Weiteren Rechner hinzufuegen
            </button>
          </div>
        ) : (
          <div className="px-1">
            <div className="flex items-center gap-1">
              {hosts.length > 0 && (
                <button type="button" aria-label="Zurueck zu den Rechnern" className={`${backBtn} -ml-3`} onClick={() => setAddingHost(false)}>
                  <ChevronLeft size={22} aria-hidden />
                </button>
              )}
              <h2 className="text-[24px] font-semibold tracking-tight">Rechner hinzufuegen</h2>
            </div>
            <ol className="mt-4 flex flex-col gap-2.5">
              {[
                <>Auf dem Rechner: <code className="font-mono text-[13px] text-ink">goose roam share --qr</code></>,
                <>QR-Code scannen oder die Karte unten einfuegen.</>,
                <>Beim ersten Mal dieses iPhone dort annehmen (siehe unten).</>,
              ].map((t, i) => (
                <li key={i} className="flex gap-3 text-[15px] text-ink-muted">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[13px] font-semibold text-accent">{i + 1}</span>
                  <span className="min-w-0">{t}</span>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-col gap-3">
              <input
                id="host-name"
                type="text"
                aria-label="Name des Rechners, freiwillig"
                className="min-h-12 w-full rounded-xl border border-line bg-surface px-4 text-ink outline-none placeholder:text-ink-faint focus:border-accent"
                placeholder="Name (freiwillig), z.B. Laptop"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
              />
              <textarea
                id="card-input"
                rows={3}
                aria-label="Verbindungskarte des Rechners"
                className="w-full resize-none rounded-xl border border-line bg-surface px-4 py-3 font-mono text-[14px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
                placeholder="goose+roam://… (Karte des Rechners)"
                value={card}
                onChange={(e) => setCard(e.target.value)}
              />
              <div className="flex gap-3">
                {canScan && (
                  <button
                    id="scan-card"
                    type="button"
                    className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-elevated text-[15px] font-medium text-ink"
                    onClick={() => void startScan()}
                  >
                    <Camera size={18} aria-hidden /> QR-Code scannen
                  </button>
                )}
                <button
                  id="connect-btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void connect()}
                  className="min-h-12 flex-1 rounded-xl bg-accent text-[16px] font-semibold text-accent-ink disabled:opacity-40"
                >
                  {busy ? "Einen Moment…" : "Verbinden"}
                </button>
              </div>
            </div>
            <details
              className="group mt-6 overflow-hidden rounded-2xl border border-line bg-surface"
              open={pairOpen}
              onToggle={(e) => setPairOpen((e.target as HTMLDetailsElement).open)}
            >
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-[15px] select-none [&::-webkit-details-marker]:hidden">
                Zum ersten Mal? Dieses iPhone mit dem Rechner koppeln
                <ChevronDown size={18} aria-hidden className="shrink-0 text-ink-faint transition-transform duration-150 group-open:rotate-180" />
              </summary>
              <div className="flex flex-col gap-3 border-t border-line p-4 text-[13px] text-ink-muted">
                <span>Schick die Karte dieses iPhones an den Rechner und nimm sie dort einmal an:</span>
                <code
                  id="my-card"
                  className="block min-w-0 truncate rounded-lg bg-elevated px-3 py-2 font-mono text-[13px] text-ink"
                >
                  {myCard}
                </code>
                <div className="flex gap-2">
                  <button
                    id="copy-card"
                    type="button"
                    className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-elevated text-[14px] text-ink"
                    onClick={() => navigator.clipboard?.writeText(myCard)}
                  >
                    <Copy size={16} aria-hidden /> Kopieren
                  </button>
                  {"share" in navigator && (
                    <button
                      id="share-card"
                      type="button"
                      className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-elevated text-[14px] text-ink"
                      onClick={() => void navigator.share({ text: myCard }).catch(() => {})}
                    >
                      <Share size={16} aria-hidden /> Teilen
                    </button>
                  )}
                </div>
                <span>Auf dem Rechner im Terminal:</span>
                <code className="block overflow-x-auto rounded-lg bg-elevated px-3 py-2 font-mono text-[12px] break-all text-ink">
                  goose roam peers accept '&lt;Karte&gt;'
                </code>
                <span className="font-mono text-[12px] break-all text-ink-faint">
                  Schluessel <code id="my-endpoint-id" className="font-mono">{myId}</code>
                </span>
              </div>
            </details>
          </div>
        )}
      </div>
      {scanning && (
        <div
          role="button"
          tabIndex={0}
          aria-label="QR-Scan abbrechen"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-black/90 px-8 pt-safe pb-safe"
          onClick={() => stopScan()}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Enter") stopScan();
          }}
        >
          <div className="relative w-full max-w-[320px]">
            <video ref={videoRef} className="aspect-square w-full rounded-3xl object-cover" playsInline muted />
            {["top-0 left-0 border-t-4 border-l-4 rounded-tl-3xl", "top-0 right-0 border-t-4 border-r-4 rounded-tr-3xl", "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-3xl", "bottom-0 right-0 border-b-4 border-r-4 rounded-br-3xl"].map((c) => (
              <span key={c} aria-hidden className={`pointer-events-none absolute size-12 border-accent ${c}`} />
            ))}
          </div>
          <div className="max-w-[260px] text-center text-[16px] leading-relaxed text-white">
            Auf den QR-Code des Rechners halten. Tippen zum Abbrechen.
          </div>
        </div>
      )}
    </section>
  );
}
