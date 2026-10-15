// "Alle | Mac Mini | MacBook": which machine's chats the lists show. Shared by
// the start page and the sidebar; the choice is kept on the device.
import type { HostFilter, TaggedSession } from "./sessions";

export type HostChoice = { endpointId: string; label: string };

export function HostFilterBar({
  choices,
  sessions,
  value,
  onChange,
}: {
  choices: HostChoice[];
  sessions: TaggedSession[];
  value: HostFilter;
  onChange: (f: HostFilter) => void;
}) {
  if (choices.length < 2) return null;
  const count = (eid: string) => sessions.filter((s) => s._host === eid).length;
  const options: { key: HostFilter; label: string; n: number }[] = [
    { key: "all", label: "Alle", n: sessions.length },
    ...choices.map((c) => ({ key: c.endpointId, label: c.label, n: count(c.endpointId) })),
  ];
  return (
    <div role="tablist" aria-label="Chats nach Rechner" className="host-filter flex gap-1 rounded-lg bg-background-tertiary p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          role="tab"
          aria-selected={value === o.key}
          data-filter={o.key}
          onClick={() => onChange(o.key)}
          className={`flex-1 min-w-0 truncate rounded-md px-2 py-1 text-[12px] transition-colors ${
            value === o.key
              ? "bg-background-primary text-text-primary font-semibold shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          {o.label} <span className="text-text-tertiary font-normal">{o.n}</span>
        </button>
      ))}
    </div>
  );
}
