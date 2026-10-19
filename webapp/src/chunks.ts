// Decides whether a streamed message chunk continues the last bubble or
// starts a new one.
//
// Agent and thought text arrive as token deltas and belong together. User
// text never streams: every user chunk is a whole content block. Several
// prompts sent while a turn was running (steer) or queued while the agent was
// down come back as consecutive user chunks, sometimes under one messageId,
// and used to be glued into one bubble without a gap ("reparie" +
// "Statusbericht" + "Wtf", 18.10.2026). So each user text block is its own
// bubble; only placeholders for non-text blocks ("[image]") and attachment
// notes ("[Bild gespeichert unter ...]") stay with the prompt they belong to.
export type ChunkRole = "user" | "agent" | "thought";

export function continuesBubble(
  role: ChunkRole,
  text: string,
  lastRole: ChunkRole | null,
  messageId: string | undefined,
  lastMessageId: string | undefined,
): boolean {
  if (lastRole !== role) return false;
  if (messageId && lastMessageId && messageId !== lastMessageId) return false;
  if (role !== "user") return true;
  return text.trimStart().startsWith("[");
}

export function joinChunk(role: ChunkRole, prev: string, text: string): string {
  if (role !== "user" || prev === "" || prev.endsWith("\n")) return prev + text;
  return `${prev}\n${text}`;
}
