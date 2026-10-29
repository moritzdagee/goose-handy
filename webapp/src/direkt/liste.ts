// Direkt-Chats in den gemeinsamen Listen (Startseite, Seitenleiste): sie
// erscheinen wie Chats eines weiteren Rechners "iPhone", damit Filter-Chips,
// Aktiv/Archiv und Suche fuer alle gleich funktionieren.
import { IPHONE_HOST, type DirektInfo, type TaggedSession } from "../sessions";
import type { DirektChat } from "./speicher";

export const IPHONE_LABEL = "iPhone";

export function herkunftText(c: Pick<DirektChat, "herkunft">): string | null {
  const h = c.herkunft;
  if (!h) return null;
  return `Klon vom ${h.geraet === "mini" ? "Mac Mini" : h.geraet === "macbook" ? "MacBook" : "Rechner"}`;
}

export function direktAlsSitzungen(chats: DirektChat[]): TaggedSession[] {
  return chats.map((c) => {
    const info: DirektInfo = {
      herkunft: herkunftText(c),
      wartet: c.nachrichten.filter((n) => n.rolle === "nutzer" && n.status === "wartet").length,
    };
    return {
      sessionId: c.id,
      cwd: "",
      title: c.titel,
      updatedAt: c.geaendertAm,
      _host: IPHONE_HOST,
      _meta: c.archiviert ? { archivedAt: c.geaendertAm } : {},
      _direkt: info,
    } as TaggedSession;
  });
}
