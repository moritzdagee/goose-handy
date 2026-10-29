// Liste der Tablet-Chats fuer die App (29.10.2026): steht sofort aus dem
// Zwischenspeicher da, wird mit Datenbank-Schluessel und Netz aufgefrischt
// (beim Start, wenn der Schluessel kommt, wenn das Netz wiederkommt, und auf
// Wunsch, z. B. beim Waehlen des Filters "Tablet"). NUR LESEN.
import { useCallback, useEffect, useRef, useState } from "react";
import { gemerkteListe, listeMerken, tabletListeHolen, type TabletEintrag } from "./tablet";

export type TabletZustand = ReturnType<typeof useTablet>;

export function useTablet(kbSchluessel: string | undefined, abruf?: typeof fetch) {
  const [liste, setListe] = useState<{ eintraege: TabletEintrag[]; stand: string | null }>(gemerkteListe);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  const laeuft = useRef(false);

  const neuLaden = useCallback(async () => {
    if (!kbSchluessel || laeuft.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setFehler("Kein Netz.");
      return;
    }
    laeuft.current = true;
    setLaedt(true);
    try {
      const eintraege = await tabletListeHolen(kbSchluessel, abruf);
      const stand = new Date().toISOString();
      listeMerken(eintraege, stand);
      setListe({ eintraege, stand });
      setFehler(null);
    } catch (f) {
      setFehler(f instanceof Error ? f.message : String(f));
    } finally {
      laeuft.current = false;
      setLaedt(false);
    }
  }, [kbSchluessel, abruf]);

  useEffect(() => {
    void neuLaden();
    const h = () => void neuLaden();
    window.addEventListener("online", h);
    return () => window.removeEventListener("online", h);
  }, [neuLaden]);

  return { eintraege: liste.eintraege, stand: liste.stand, fehler: kbSchluessel ? fehler : null, laedt, neuLaden };
}
