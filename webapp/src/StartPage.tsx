// Front page: start a new chat on a chosen machine, or pick up a recent one.
// Replaces the session constellation as the landing view: on a phone the
// first thing wanted is almost always "ask something new".
// Look: Lovable design (Oktober 2026), one big orange action per machine.
import { Laptop, Monitor, Smartphone } from "lucide-react";
import { filterByArchive, filterByHost, isPhoneStarted, type ArchiveFilter, type HostFilter, type TaggedSession } from "./sessions";
import { ArchiveFilterBar } from "./ArchiveFilterBar";
import { HostFilterBar, type HostChoice } from "./HostFilterBar";
import { Dot, HostBadge, Pill, Skeleton, ago, isLive } from "./ui/Primitives";

export function StartPage({
  hosts,
  sessions,
  creating,
  onNew,
  onOpen,
  filterChoices = hosts,
  filter = "all",
  onFilter = () => {},
  archiveFilter = "active",
  onArchiveFilter = () => {},
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
  archiveFilter?: ArchiveFilter;
  onArchiveFilter?: (f: ArchiveFilter) => void;
}) {
  const label = (eid: string) =>
    filterChoices.find((h) => h.endpointId === eid)?.label ??
    hosts.find((h) => h.endpointId === eid)?.label ??
    eid.slice(0, 6);
  const onHost = filterByHost(sessions, filter);
  const recent = filterByArchive(onHost, archiveFilter)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, 40);
  const showHost = filter === "all" && filterChoices.length > 1;
  return (
    <div id="start-page" className="fade-in flex-1 overflow-y-auto overscroll-contain pb-safe">
      <div className="mx-auto flex w-full max-w-xl flex-col">
        <section aria-label="Neuen Chat starten" className="flex flex-col gap-3 px-4 pt-5">
          {hosts.map((h, i) => {
            const Icon = /book/i.test(h.label) ? Laptop : Monitor;
            return (
              <button
                key={h.endpointId}
                id={`new-on-${h.label.replace(/\s+/g, "-").toLowerCase()}`}
                type="button"
                disabled={creating}
                onClick={() => onNew(h.endpointId)}
                className={`new-chat-btn flex min-h-16 w-full items-center gap-3 rounded-2xl px-5 text-[17px] font-semibold transition-opacity duration-150 active:opacity-80 disabled:opacity-50 ${
                  i === 0 ? "bg-accent text-accent-ink" : "border-2 border-accent bg-surface text-ink"
                }`}
              >
                <Icon size={22} aria-hidden />
                <span className="flex-1 text-left">Neuer Chat auf {h.label}</span>
                <Dot tone="live" />
              </button>
            );
          })}
          {hosts.length === 0 && (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-16" />
              <Skeleton className="h-16 opacity-60" />
              <div id="start-connecting" role="status" className="flex items-center justify-center gap-2 pt-1 text-[15px] text-ink-muted">
                <Dot tone="warn" pulse /> Verbinde mit deinen Rechnern…
              </div>
            </div>
          )}
          {creating && (
            <div role="status" className="flex items-center justify-center gap-2 text-[14px] text-ink-muted">
              <Dot tone="warn" pulse />
              <span>Chat wird angelegt…</span>
            </div>
          )}
        </section>

        <section aria-label="Letzte Chats" className="mt-8">
          <h2 className="px-4 pb-3 text-[13px] font-semibold uppercase tracking-wider text-ink-faint">Letzte Chats</h2>
          <div className="flex flex-col gap-2 px-4 pb-3">
            <HostFilterBar choices={filterChoices} sessions={sessions} value={filter} onChange={onFilter} />
            <ArchiveFilterBar sessions={onHost} value={archiveFilter} onChange={onArchiveFilter} />
          </div>
          {recent.length === 0 && (
            <div className="px-4 py-10 text-center">
              <div className="text-[15px] text-ink-muted">noch keine</div>
              <div className="mt-1 text-[13px] text-ink-faint">Starte oben einen neuen Chat.</div>
            </div>
          )}
          <div className="divide-y divide-line/60">
            {recent.map((s) => {
              const live = isLive(s.updatedAt);
              return (
                <button
                  key={`${s._host}|${s.sessionId}`}
                  type="button"
                  onClick={() => onOpen(s)}
                  className="recent-chat relative block min-h-14 w-full px-4 py-2.5 pr-9 text-left transition-colors duration-150 active:bg-elevated"
                >
                  <div className={`truncate text-[16px] ${s.title ? "text-ink" : "italic text-ink-faint"}`}>{s.title || "(ohne Titel)"}</div>
                  <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-ink-faint">
                    <span className="shrink-0">{ago(s.updatedAt)}</span>
                    {showHost && (
                      <>
                        <span aria-hidden>·</span> <HostBadge name={label(s._host)} />
                      </>
                    )}
                    {isPhoneStarted(s) && (
                      <>
                        <span aria-hidden>·</span>{" "}
                        <Pill>
                          <Smartphone size={11} aria-hidden />
                          vom iPhone
                        </Pill>
                      </>
                    )}
                  </div>
                  {live && (
                    <span className="absolute right-4 top-1/2 -translate-y-1/2" title="in den letzten 5 Minuten aktiv">
                      <Dot tone="live" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
