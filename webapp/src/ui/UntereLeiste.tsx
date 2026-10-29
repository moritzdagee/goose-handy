// Untere Leiste wie auf dem Tablet (Moose beta), handygerecht: Chats als
// Hauptbereich, dazu Rechner und Einstellungen. Im offenen Chat ausgeblendet,
// damit das Eingabefeld Platz hat.
import { MessagesSquare, Monitor, Settings } from "lucide-react";

export type Bereich = "chats" | "rechner" | "einstellungen";

const EINTRAEGE: { id: Bereich; name: string; Symbol: typeof MessagesSquare }[] = [
  { id: "chats", name: "Chats", Symbol: MessagesSquare },
  { id: "rechner", name: "Rechner", Symbol: Monitor },
  { id: "einstellungen", name: "Einstellungen", Symbol: Settings },
];

export function UntereLeiste({ aktiv, onWahl, hinweis }: { aktiv: Bereich; onWahl: (b: Bereich) => void; hinweis?: Partial<Record<Bereich, boolean>> }) {
  return (
    <nav aria-label="Bereiche" id="untere-leiste" className="grid shrink-0 grid-cols-3 border-t border-line bg-canvas px-2 pt-1 pb-safe">
      {EINTRAEGE.map(({ id, name, Symbol }) => {
        const an = id === aktiv;
        return (
          <button
            key={id}
            id={`nav-${id}`}
            type="button"
            aria-label={name}
            aria-current={an ? "page" : undefined}
            onClick={() => onWahl(id)}
            className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${an ? "text-accent" : "text-ink-muted"}`}
          >
            <span className={`flex h-7 w-12 items-center justify-center rounded-full ${an ? "bg-accent/15" : ""}`}>
              <Symbol size={20} aria-hidden />
            </span>
            {name}
            {hinweis?.[id] && <span aria-hidden className="absolute top-2 right-[calc(50%-18px)] size-2 rounded-full bg-warn" />}
          </button>
        );
      })}
    </nav>
  );
}
