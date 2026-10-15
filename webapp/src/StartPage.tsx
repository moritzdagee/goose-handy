// Front page: start a new chat on a chosen machine, or pick up a recent one.
// Replaces the session constellation as the landing view: on a phone the
// first thing wanted is almost always "ask something new".
import { Plus } from "lucide-react";
import { filterByHost, isPhoneStarted, type HostFilter, type TaggedSession } from "./sessions";
import { HostFilterBar, type HostChoice } from "./HostFilterBar";

function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "gerade eben";
  if (secs < 3600) return `vor ${Math.floor(secs / 60)} Min.`;
  if (secs < 86400) return `vor ${Math.floor(secs / 3600)} Std.`;
  return `vor ${Math.floor(secs / 86400)} Tagen`;
}

export function StartPage({
  hosts,
  sessions,
  creating,
  onNew,
  onOpen,
  filterChoices = hosts,
  filter = "all",
  onFilter = () => {},
}: {
  /** Machines connected right now: one "new chat" button each. */
  hosts: HostChoice[];
  sessions: TaggedSession[];
  creating: boolean;
  onNew: (hostId: string) => void;
  onOpen: (s: TaggedSession) => void;
  /** Every known machine, also the ones out of reach: filter and labels. */
  filterChoices?: HostChoice[];
  filter?: HostFilter;
  onFilter?: (f: HostFilter) => void;
}) {
  const label = (eid: string) =>
    filterChoices.find((h) => h.endpointId === eid)?.label ??
    hosts.find((h) => h.endpointId === eid)?.label ??
    eid.slice(0, 6);
  const recent = filterByHost(sessions, filter)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, 40);
  return (
    <div id="start-page" className="flex-1 overflow-y-auto px-4 py-5">
      <div className="max-w-xl mx-auto w-full flex flex-col gap-6">
        <div className="flex flex-col gap-2.5">
          {hosts.map((h) => (
            <button
              key={h.endpointId}
              id={`new-on-${h.label.replace(/\s+/g, "-").toLowerCase()}`}
              disabled={creating}
              onClick={() => onNew(h.endpointId)}
              className="new-chat-btn w-full inline-flex items-center justify-center gap-2 bg-background-inverse text-text-inverse text-base font-semibold rounded-xl px-4 py-3.5 hover:brightness-110 disabled:opacity-50"
            >
              <Plus className="w-5 h-5" /> Neuer Chat auf {h.label}
            </button>
          ))}
          {hosts.length === 0 && (
            <div id="start-connecting" className="text-sm text-text-secondary self-center py-3">
              Verbinde mit deinen Rechnern…
            </div>
          )}
          {creating && <div className="text-xs text-text-secondary self-center">Chat wird angelegt…</div>}
        </div>
        <div className="flex flex-col">
          <div className="text-[11px] uppercase tracking-wide text-text-tertiary px-1 pb-1.5">Letzte Chats</div>
          <div className="pb-2">
            <HostFilterBar choices={filterChoices} sessions={sessions} value={filter} onChange={onFilter} />
          </div>
          {recent.length === 0 && <div className="text-sm text-text-secondary px-1">noch keine</div>}
          {recent.map((s) => (
            <button
              key={`${s._host}|${s.sessionId}`}
              onClick={() => onOpen(s)}
              className="recent-chat text-left w-full px-3 py-2.5 rounded-lg hover:bg-background-secondary"
            >
              <div className="text-[14px] truncate">{s.title || "(ohne Titel)"}</div>
              <div className="text-[11px] text-text-tertiary mt-0.5">
                {ago(s.updatedAt)}
                {filter === "all" && filterChoices.length > 1 && (
                  <span className="text-text-info"> · {label(s._host)}</span>
                )}
                {isPhoneStarted(s) && <span className="text-text-tertiary"> · vom iPhone</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
