// Message input in the Lovable design (Oktober 2026): hint bars, attachment
// chips, then one rounded capsule with paperclip, growing text field and a
// round orange send button. The text field stays uncontrolled (App reads
// inputRef.current.value in send()), exactly as before.
import type { ReactNode, RefObject } from "react";
import { ArrowUp, Paperclip, X } from "lucide-react";
import type { Attachment } from "../attachments";
import { Dot } from "./Primitives";

function Banner({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} role="status" className="mx-auto mb-2 flex w-full max-w-3xl items-start gap-2 rounded-xl bg-warn/10 px-3 py-2 text-[13px] leading-snug text-warn">
      <span className="pt-1">
        <Dot tone="warn" pulse size={7} />
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

// Messages that say "wait, it goes out by itself" are information, not errors.
function isInfo(text: string): boolean {
  return /automatisch raus/.test(text);
}

const MAX_HEIGHT = 8 * 24 + 20;

export function Composer({
  inputRef,
  fileRef,
  linkDownHost,
  externalGuard,
  onSendAnyway,
  pending,
  onRemove,
  attachError,
  onFiles,
  locked,
  steering,
  onSubmit,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  fileRef: RefObject<HTMLInputElement | null>;
  /** Machine whose link is being rebuilt, or null. */
  linkDownHost: string | null;
  /** Another goose (desktop, CLI) drives this chat and the user has not overridden. */
  externalGuard: boolean;
  onSendAnyway: () => void;
  pending: Attachment[];
  onRemove: (index: number) => void;
  attachError: string | null;
  onFiles: (files: File[]) => void;
  /** Input and buttons unusable (a turn without steering, or the guard). */
  locked: boolean;
  /** A run is active: sending queues into it. */
  steering: boolean;
  onSubmit: () => void;
}) {
  const grow = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  };
  const placeholder = externalGuard
    ? "Laeuft in einem anderen Goose, nur zuschauen…"
    : steering
      ? "Laufenden Auftrag ergaenzen…"
      : "Nachricht an Goose…";
  return (
    <form
      id="prompt-form"
      className="shrink-0 border-t border-line bg-canvas px-3 pt-2 pb-safe"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
        requestAnimationFrame(grow);
      }}
    >
      {linkDownHost !== null && (
        <Banner id="link-down">
          Verbindung zu {linkDownHost || "dem Rechner"} wird wiederhergestellt… Goose arbeitet dort weiter.
        </Banner>
      )}
      {externalGuard && (
        <Banner id="external-run-guard">
          Gerade in einem anderen Goose aktiv (Mac oder Terminal). Senden von hier kann einen zweiten Lauf starten.{" "}
          <button
            id="external-run-override"
            type="button"
            className="font-semibold underline underline-offset-2"
            onClick={onSendAnyway}
          >
            trotzdem senden
          </button>
        </Banner>
      )}
      {(pending.length > 0 || attachError) && (
        <div id="attachments" className="mx-auto mb-2 flex w-full max-w-3xl flex-wrap items-center gap-2">
          {pending.map((f, i) => (
            <span key={`${f.name}-${i}`} className="attachment-chip flex h-9 max-w-[240px] items-center gap-1 rounded-full bg-elevated pl-3 text-[14px] text-ink">
              <span className="truncate">📎 {f.name}</span>
              <button
                type="button"
                aria-label={`${f.name} entfernen`}
                className="flex size-9 shrink-0 items-center justify-center text-ink-faint"
                onClick={() => onRemove(i)}
              >
                <X size={15} aria-hidden />
              </button>
            </span>
          ))}
          {attachError && (
            <span role={isInfo(attachError) ? "status" : "alert"} className={`text-[13px] ${isInfo(attachError) ? "text-ink-muted" : "text-danger"}`}>
              {attachError}
            </span>
          )}
        </div>
      )}
      <input
        ref={fileRef}
        id="file-input"
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = "";
          onFiles(list);
        }}
      />
      <div
        className={`mx-auto flex w-full max-w-3xl items-end gap-1 rounded-[24px] border border-line bg-surface p-1 transition-opacity duration-150 focus-within:border-accent ${
          locked ? "opacity-50" : ""
        }`}
      >
        <button
          id="attach-btn"
          type="button"
          aria-label="Datei oder Foto anhaengen"
          disabled={locked}
          onClick={() => fileRef.current?.click()}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted active:bg-elevated"
        >
          <Paperclip size={20} aria-hidden />
        </button>
        <textarea
          ref={inputRef}
          id="prompt-input"
          rows={1}
          aria-label={placeholder}
          disabled={locked}
          className="min-h-11 flex-1 resize-none border-none bg-transparent py-2.5 text-[16px] leading-6 text-ink outline-none placeholder:text-ink-faint focus:ring-0"
          style={{ maxHeight: MAX_HEIGHT }}
          placeholder={placeholder}
          onInput={grow}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
              requestAnimationFrame(grow);
            }
          }}
        />
        <button
          id="send-btn"
          type="submit"
          disabled={locked}
          aria-label={steering ? "nachschieben" : "senden"}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-opacity duration-150 active:opacity-80 disabled:opacity-40"
        >
          <ArrowUp size={21} strokeWidth={2.5} aria-hidden />
          <span className="sr-only">{steering ? "nachschieben" : "senden"}</span>
        </button>
      </div>
    </form>
  );
}
