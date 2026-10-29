// Segmented filter chips with counts ("Alle 12 | Mac Mini 7 | MacBook 5").
// Tabs keep role="tab" + aria-selected + data-filter: tests and the live
// scripts select them that way.
export type SegmentOption<T extends string> = { key: T; label: string; n: number };

export function Segment<T extends string>({
  label,
  className,
  options,
  value,
  onChange,
  dense = false,
}: {
  label: string;
  /** Narrow places (sidebar): smaller text so "MacBook 3" still fits. */
  dense?: boolean;
  className: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  // Ab 5 Chips (Alle, iPhone, Tablet, Mac Mini, MacBook) wird es auf dem
  // iPhone zu eng: dann seitlich wischen statt Namen abzuschneiden.
  const viele = options.length > 4;
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`${className} flex gap-1 rounded-xl bg-elevated p-1 ${viele ? "no-scrollbar overflow-x-auto" : ""}`}
    >
      {options.map((o) => {
        const on = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={on}
            data-filter={o.key}
            onClick={() => onChange(o.key)}
            className={`flex min-h-9 ${viele ? "flex-none" : options.length > 3 ? "min-w-0 flex-auto" : "min-w-0 flex-1"} items-center justify-center gap-1 truncate rounded-lg transition-colors duration-150 ${dense ? `${viele ? "px-2" : "px-1"} text-[13px]` : `${viele ? "px-2.5" : "px-1.5"} text-[14px]`} ${
              on ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-muted"
            }`}
          >
            <span className="truncate">{o.label}</span>{" "}
            <span className={`tabular-nums ${on ? "text-accent" : "text-ink-faint"}`}>{o.n}</span>
          </button>
        );
      })}
    </div>
  );
}
