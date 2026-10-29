// "Aktiv | Archiviert | Alle" under the machine filter. Counts follow the
// list it filters (already narrowed to the chosen machine).
import { filterByArchive, type ArchiveFilter, type TaggedSession } from "./sessions";
import { Segment } from "./ui/Segment";

const OPTIONS: { key: ArchiveFilter; label: string }[] = [
  { key: "active", label: "Aktiv" },
  { key: "archived", label: "Archiviert" },
  { key: "all", label: "Alle" },
];

export function ArchiveFilterBar({
  sessions,
  value,
  onChange,
  dense,
}: {
  sessions: TaggedSession[];
  value: ArchiveFilter;
  onChange: (f: ArchiveFilter) => void;
  dense?: boolean;
}) {
  return (
    <Segment<ArchiveFilter>
      label="Aktive oder archivierte Chats"
      className="archive-filter"
      value={value}
      onChange={onChange}
      dense={dense}
      options={OPTIONS.map((o) => ({ ...o, n: filterByArchive(sessions, o.key).length }))}
    />
  );
}
