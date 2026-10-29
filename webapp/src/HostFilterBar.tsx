// "Alle | Mac Mini | MacBook": which machine's chats the lists show. Shared by
// the start page and the sidebar; the choice is kept on the device.
import type { HostFilter, TaggedSession } from "./sessions";
import { Segment } from "./ui/Segment";

export type HostChoice = { endpointId: string; label: string };

export function HostFilterBar({
  choices,
  sessions,
  value,
  onChange,
  dense,
}: {
  choices: HostChoice[];
  sessions: TaggedSession[];
  value: HostFilter;
  onChange: (f: HostFilter) => void;
  dense?: boolean;
}) {
  if (choices.length < 2) return null;
  const count = (eid: string) => sessions.filter((s) => s._host === eid).length;
  return (
    <Segment<HostFilter>
      label="Chats nach Rechner"
      className="host-filter"
      value={value}
      onChange={onChange}
      dense={dense}
      options={[
        { key: "all", label: "Alle", n: sessions.length },
        ...choices.map((c) => ({ key: c.endpointId, label: c.label, n: count(c.endpointId) })),
      ]}
    />
  );
}
