// "Aktiv | Archiviert | Alle" under the machine filter. Counts follow the
// list it filters (already narrowed to the chosen machine).
import { filterByArchive, type ArchiveFilter, type TaggedSession } from "./sessions";

const OPTIONS: { key: ArchiveFilter; label: string }[] = [
  { key: "active", label: "Aktiv" },
  { key: "archived", label: "Archiviert" },
  { key: "all", label: "Alle" },
];

export function ArchiveFilterBar({
  sessions,
  value,
  onChange,
}: {
  sessions: TaggedSession[];
  value: ArchiveFilter;
  onChange: (f: ArchiveFilter) => void;
}) {
  return (
    <div role="tablist" aria-label="Aktive oder archivierte Chats" className="archive-filter flex gap-1 rounded-lg bg-background-tertiary p-0.5">
      {OPTIONS.map((o) => (
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
          {o.label} <span className="text-text-tertiary font-normal">{filterByArchive(sessions, o.key).length}</span>
        </button>
      ))}
    </div>
  );
}
