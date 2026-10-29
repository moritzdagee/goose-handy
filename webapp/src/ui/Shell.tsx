// App frame in the Lovable design (Oktober 2026): top bar, chat sidebar,
// chat title row with settings, machine picker sheet, "verbinde…" screen.
// Purely presentational; App owns all state and passes callbacks. Element
// ids (#status, #header-new-chat, #switch-host, #sidebar-toggle,
// #new-session, #session-list, .session-item, #back-to-matrix, ...) are the
// ones the tests and Playwright scripts use.
import { ChevronDown, ChevronLeft, Laptop, Menu, Monitor, Plus, SlidersHorizontal } from "lucide-react";
import type { ArchiveFilter, HostFilter, SessionGroup, TaggedSession } from "../sessions";
import { ArchiveFilterBar } from "../ArchiveFilterBar";
import { HostFilterBar, type HostChoice } from "../HostFilterBar";
import { Dot, GooseMark, HostBadge, Pill, ago, isLive } from "./Primitives";

export type StatusKind = "idle" | "busy" | "ok" | "err";

/** What the connection badge says: green dot when connected, words otherwise. */
export function connectionView(
  connected: boolean,
  connecting: boolean,
  kind: StatusKind,
  status: string,
): { tone: "live" | "warn" | "danger" | "faint"; text: string | null; label: string; pulse: boolean } {
  if (kind === "err") return { tone: "danger", text: connected ? status : "Verbindung weg", label: status, pulse: false };
  if (!connected && (connecting || kind === "busy")) return { tone: "warn", text: "verbinde…", label: "verbinde", pulse: true };
  if (!connected) return { tone: "faint", text: "nicht verbunden", label: "nicht verbunden", pulse: false };
  return { tone: "live", text: null, label: "verbunden", pulse: false };
}

export function AppHeader({
  connected,
  connecting,
  status,
  statusKind,
  creating,
  hostCount,
  modelName,
  agentId,
  build,
  onToggleSidebar,
  onNew,
  onHosts,
}: {
  connected: boolean;
  connecting: boolean;
  status: string;
  statusKind: StatusKind;
  creating: boolean;
  hostCount: number;
  modelName: string | null;
  agentId: string;
  build: string;
  onToggleSidebar: () => void;
  onNew: () => void;
  onHosts: () => void;
}) {
  const c = connectionView(connected, connecting, statusKind, status);
  const textCls = { live: "text-live", warn: "text-warn", danger: "text-danger", faint: "text-ink-faint" }[c.tone];
  return (
    <header className="shrink-0 border-b border-line bg-canvas pt-safe">
      <div className="flex h-14 items-center gap-1 pr-3 pl-1.5">
        {(connected || connecting) && (
          <button
            id="sidebar-toggle"
            type="button"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-ink active:bg-elevated md:hidden"
            aria-label="Seitenleiste mit Chats oeffnen oder schliessen"
            onClick={onToggleSidebar}
          >
            <Menu size={22} aria-hidden />
          </button>
        )}
        <span className={`flex shrink-0 items-center gap-1.5 ${connected || connecting ? "" : "pl-2"} md:pl-2`}>
          <GooseMark size={26} />
          <span className="text-[17px] font-semibold">Goose</span>
        </span>
        <span id="build-stamp" className="hidden self-end pb-1 pl-1 font-mono text-[10px] text-ink-faint md:inline">
          {build}
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {connected && modelName && (
            <span id="model-badge" className="hidden rounded-full bg-elevated px-2.5 py-0.5 text-[12px] text-ink-muted md:inline">
              {modelName}
            </span>
          )}
          {connected && (
            <span id="agent-badge" className="hidden rounded-full bg-elevated px-2.5 py-0.5 font-mono text-[11px] text-ink-muted md:inline">
              {agentId.slice(0, 12)}
            </span>
          )}
          <span
            id="status"
            role="status"
            aria-label={`Verbindung: ${c.label}`}
            title={status}
            className={`flex min-w-0 items-center gap-1.5 text-[13px] font-medium ${textCls}`}
          >
            <Dot tone={c.tone} pulse={c.pulse} />
            {c.text ? <span className="max-w-[130px] truncate">{c.text}</span> : <span className="sr-only">verbunden</span>}
          </span>
          {connected && (
            <button
              id="switch-host"
              type="button"
              title="Rechner verwalten"
              aria-label={`Rechner verwalten, ${hostCount} verbunden`}
              className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-xl px-2 text-[14px] text-ink-muted active:bg-elevated"
              onClick={onHosts}
            >
              <Monitor size={18} aria-hidden />
              <span className="tabular-nums">{hostCount}</span>
            </button>
          )}
          {connected && (
            <button
              id="header-new-chat"
              type="button"
              disabled={creating}
              onClick={onNew}
              aria-label="Neuen Chat starten"
              className="flex h-11 shrink-0 items-center gap-1 rounded-xl bg-accent px-3 text-[15px] font-semibold text-accent-ink active:opacity-80 disabled:opacity-50"
            >
              <Plus size={18} aria-hidden /> Neu
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

export function Sidebar({
  open,
  onClose,
  creating,
  onNew,
  hostChoices,
  sessions,
  hostFilter,
  onHostFilter,
  archiveFilter,
  onArchiveFilter,
  groups,
  collapsed,
  onToggleGroup,
  activeSessionId,
  activeHostId,
  onOpen,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  creating: boolean;
  onNew: () => void;
  hostChoices: HostChoice[];
  sessions: TaggedSession[];
  hostFilter: HostFilter;
  onHostFilter: (f: HostFilter) => void;
  archiveFilter: ArchiveFilter;
  onArchiveFilter: (f: ArchiveFilter) => void;
  groups: SessionGroup[];
  collapsed: Set<string>;
  onToggleGroup: (key: string) => void;
  activeSessionId: string | null;
  activeHostId: string | null;
  onOpen: (s: TaggedSession) => void;
  footer: string;
}) {
  const label = (eid: string) => hostChoices.find((h) => h.endpointId === eid)?.label ?? eid.slice(0, 6);
  const showHost = hostFilter === "all" && hostChoices.length > 1;
  const empty = groups.every((g) => g.sessions.length === 0);
  return (
    <>
      <button
        type="button"
        aria-label="Seitenleiste schliessen"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
        className={`absolute inset-0 z-20 bg-scrim transition-opacity duration-150 md:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        aria-label="Chats"
        className={`absolute inset-y-0 left-0 z-30 flex w-[320px] max-w-[85vw] min-h-0 flex-col bg-surface shadow-2xl transition-[translate,visibility] duration-150 md:visible md:static md:w-auto md:max-w-none md:translate-x-0 md:border-r md:border-line md:shadow-none ${
          open ? "visible translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        <div className="flex flex-col gap-3 p-4">
          <button
            id="new-session"
            type="button"
            disabled={creating}
            onClick={onNew}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[16px] font-semibold text-accent-ink active:opacity-80 disabled:opacity-50"
          >
            <Plus size={18} aria-hidden /> Neuer Chat
          </button>
          <div className="flex flex-col gap-2">
            <HostFilterBar choices={hostChoices} sessions={sessions} value={hostFilter} onChange={onHostFilter} dense />
            <ArchiveFilterBar sessions={sessions.filter((s) => hostFilter === "all" || s._host === hostFilter)} value={archiveFilter} onChange={onArchiveFilter} dense />
          </div>
        </div>
        <nav id="session-list" aria-label="Chat-Liste" className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain border-t border-line pt-1">
          {empty && <div className="py-10 text-center text-[15px] text-ink-faint">noch keine</div>}
          {groups.map(({ key, label: groupLabel, sessions: group }) => (
            <div key={key} className="flex flex-col">
              {groupLabel !== null && (
                <button
                  type="button"
                  className="project-label flex min-h-11 w-full items-center gap-2 px-4 text-left text-[13px] font-semibold text-ink-muted"
                  onClick={() => onToggleGroup(key)}
                  aria-expanded={!collapsed.has(key)}
                >
                  <ChevronDown size={16} aria-hidden className={`shrink-0 transition-transform duration-150 ${collapsed.has(key) ? "-rotate-90" : ""}`} />
                  <span className="truncate">{groupLabel === "chats" ? "Chats" : groupLabel}</span>
                  <span className="font-normal text-ink-faint">({group.length})</span>
                </button>
              )}
              {(groupLabel === null || !collapsed.has(key)) &&
                group.map((s) => {
                  const active = s.sessionId === activeSessionId && s._host === activeHostId;
                  return (
                    <button
                      key={`${s._host}|${s.sessionId}`}
                      type="button"
                      aria-current={active ? "page" : undefined}
                      className={`session-item relative block min-h-14 w-full border-l-[3px] px-4 py-2 pr-8 text-left transition-colors duration-150 active:bg-elevated ${
                        active ? "border-accent bg-elevated" : "border-transparent"
                      }`}
                      onClick={() => onOpen(s)}
                    >
                      <div className={`truncate text-[15px] ${s.title ? "text-ink" : "italic text-ink-faint"}`}>{s.title || "(ohne Titel)"}</div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-faint">
                        <span className="shrink-0">{ago(s.updatedAt)}</span>
                        {showHost && <HostBadge name={label(s._host)} />}
                      </div>
                      {isLive(s.updatedAt) && (
                        <span className="absolute top-1/2 right-3 -translate-y-1/2" title="in den letzten 5 Minuten aktiv">
                          <Dot tone="live" />
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          ))}
        </nav>
        <div className="truncate px-4 pt-2 pb-safe text-[12px] text-ink-faint">{footer}</div>
      </aside>
    </>
  );
}

export type ConfigSelect = { id: string; name: string; value: string; options: { id: string; name: string }[] };

export function ChatTopBar({
  title,
  hostName,
  live,
  config,
  configDisabled,
  open,
  onToggleConfig,
  onBack,
  onConfig,
}: {
  title: string;
  /** Shown when more than one machine is known. */
  hostName: string | null;
  live: boolean;
  config: ConfigSelect[];
  configDisabled: boolean;
  /** Settings panel shown (App resets it when another chat opens). */
  open: boolean;
  onToggleConfig: () => void;
  onBack: () => void;
  onConfig: (id: string, value: string) => void;
}) {
  return (
    <div className="shrink-0 border-b border-line bg-canvas">
      <div className="flex h-12 min-w-0 items-center gap-2 pr-1">
        <button
          id="back-to-matrix"
          type="button"
          onClick={onBack}
          aria-label="Zurueck zu den Chats"
          className="flex h-11 shrink-0 items-center pr-2 pl-1 text-[16px] text-accent"
        >
          <ChevronLeft size={22} aria-hidden /> Chats
        </button>
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</span>
        {hostName && <HostBadge name={hostName} />}
        {live && (
          <span id="hot-chip" title="in den letzten 5 Minuten aktiv, alle 6 Sekunden geprueft">
            <Pill tone="live">
              <Dot tone="live" size={6} /> live
            </Pill>
          </span>
        )}
        {config.length > 0 ? (
          <button
            id="session-config-btn"
            type="button"
            aria-label="Einstellungen fuer diesen Chat"
            aria-expanded={open}
            title="Modell, Modus, Anbieter"
            className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${open ? "bg-elevated text-ink" : "text-ink-muted"}`}
            onClick={onToggleConfig}
          >
            <SlidersHorizontal size={19} aria-hidden />
          </button>
        ) : (
          <span className="w-2 shrink-0" />
        )}
      </div>
      {open && config.length > 0 && (
        <div id="session-config" className="fade-in grid grid-cols-1 gap-2 px-3 pb-3 min-[360px]:grid-cols-2">
          {config.map((o) => (
            <label key={o.id} className="flex min-w-0 flex-col gap-1 text-[12px] text-ink-faint">
              {o.name}
              <select
                className="min-h-11 w-full rounded-lg border border-line bg-surface px-2 text-[14px] text-ink disabled:opacity-50"
                value={o.value}
                disabled={configDisabled}
                onChange={(e) => onConfig(o.id, e.target.value)}
              >
                {o.options.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function HostPicker({
  hosts,
  creating,
  onPick,
  onCancel,
}: {
  hosts: HostChoice[];
  creating: boolean;
  onPick: (endpointId: string) => void;
  onCancel: () => void;
}) {
  return (
    <div id="host-picker" className="fixed inset-0 z-40 flex items-end justify-center bg-scrim md:items-center" onClick={onCancel}>
      <div
        role="dialog"
        aria-label="Neuer Chat auf welchem Rechner?"
        className="fade-in w-full rounded-t-3xl bg-surface px-5 pt-3 pb-safe shadow-2xl md:w-[380px] md:rounded-3xl md:pb-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line md:hidden" aria-hidden />
        <div className="mb-4 text-center text-[17px] font-semibold">Neuer Chat auf welchem Rechner?</div>
        <div className="flex flex-col gap-3">
          {hosts.map((h) => {
            const Icon = /book/i.test(h.label) ? Laptop : Monitor;
            return (
              <button
                key={h.endpointId}
                type="button"
                disabled={creating}
                onClick={() => onPick(h.endpointId)}
                className="pick-host flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-elevated text-[17px] font-semibold text-ink active:opacity-80 disabled:opacity-50"
              >
                <Icon size={22} aria-hidden className="text-accent" />
                {h.label}
              </button>
            );
          })}
        </div>
        <button type="button" className="mt-2 mb-1 min-h-12 w-full text-[16px] text-ink-muted" onClick={onCancel}>
          abbrechen
        </button>
      </div>
    </div>
  );
}

export function ReconnectPanel({ onChooseOther }: { onChooseOther: () => void }) {
  return (
    <section id="reconnect-panel" role="status" className="fade-in flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <Dot tone="warn" pulse size={14} />
      <div className="text-[18px] font-medium">verbinde…</div>
      <div className="text-[15px] text-ink-muted">mit deinen Rechnern</div>
      <button type="button" className="min-h-11 text-[15px] text-accent" onClick={onChooseOther}>
        anderen Rechner waehlen
      </button>
    </section>
  );
}
