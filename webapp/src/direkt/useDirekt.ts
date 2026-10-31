// Zustand des Direkt-Chats fuer die App: Chat-Liste aus dem iPhone-Speicher,
// entschluesselte Schluessel (nur im Arbeitsspeicher), Modell-Liste, und das
// Nachholen im Hintergrund (wartende Fragen, ausstehende Spiegelungen), sobald
// Netz und Schluessel da sind.
import { useCallback, useEffect, useRef, useState } from "react";
import { alleModelle, gemerkteModelle, modelleMerken, type ModellWahl } from "./anbieter";
import { alleWartendenSenden } from "./chat";
import { alleChats, type DirektChat } from "./speicher";
import { ausstehendeSpiegeln } from "./spiegel";
import { chatsWiederherstellen } from "./wiederherstellen";
import {
  alleSchluesselLesen,
  hinterlegteSlots,
  schluesselEntfernen,
  schluesselSpeichern,
  type SchluesselSlot,
  type SchluesselWerte,
} from "./tresor";

// Andere Teile (offene Chat-Ansicht) hoeren darauf und laden neu.
export const DIREKT_GEAENDERT = "goose-handy-direkt-geaendert";

export function direktGeaendertMelden(): void {
  window.dispatchEvent(new Event(DIREKT_GEAENDERT));
}

export type DirektZustand = ReturnType<typeof useDirekt>;

export function useDirekt(tresor: CryptoKey | null, abruf?: typeof fetch) {
  const [chats, setChats] = useState<DirektChat[]>([]);
  const [schluessel, setSchluessel] = useState<SchluesselWerte>({});
  const [hinterlegt, setHinterlegt] = useState<SchluesselSlot[]>(hinterlegteSlots);
  const [fehlerhaft, setFehlerhaft] = useState<SchluesselSlot[]>([]);
  const [modelle, setModelle] = useState<ModellWahl[]>(gemerkteModelle);
  const [modellFehler, setModellFehler] = useState<string[]>([]);
  const [speicherFehler, setSpeicherFehler] = useState<string | null>(null);
  const [wiederhergestellt, setWiederhergestellt] = useState(0);
  const schluesselRef = useRef(schluessel);
  schluesselRef.current = schluessel;

  const neuLaden = useCallback(async () => {
    try {
      setChats(await alleChats());
      setSpeicherFehler(null);
    } catch (f) {
      setSpeicherFehler(`Speicher auf dem iPhone nicht lesbar: ${f instanceof Error ? f.message : String(f)}`);
    }
  }, []);

  useEffect(() => {
    void neuLaden();
    const h = () => void neuLaden();
    window.addEventListener(DIREKT_GEAENDERT, h);
    return () => window.removeEventListener(DIREKT_GEAENDERT, h);
  }, [neuLaden]);

  // Tresor oeffnen, sobald Face ID den Schluessel geliefert hat.
  useEffect(() => {
    if (!tresor) return;
    let aus = false;
    void alleSchluesselLesen(tresor).then(({ werte, fehler }) => {
      if (aus) return;
      setSchluessel(werte);
      setFehlerhaft(fehler);
    });
    return () => {
      aus = true;
    };
  }, [tresor]);

  const nachholen = useCallback(async () => {
    const s = schluesselRef.current;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    let geaendert = 0;
    if (s.mistral || s.eurouter) geaendert += await alleWartendenSenden({ schluessel: s, abruf });
    if (s.kb) {
      geaendert += await ausstehendeSpiegeln(s.kb, abruf);
      // Fehlende Chats aus der Datenbank ergaenzen (z.B. nach neuem
      // Home-Bildschirm-Lesezeichen); schlaegt offline fehl, ohne aufzuhalten.
      try {
        const w = await chatsWiederherstellen(s.kb, abruf);
        if (w.wiederhergestellt > 0) {
          setWiederhergestellt((v) => v + w.wiederhergestellt);
          geaendert += w.wiederhergestellt;
        }
      } catch {
        // Datenbank nicht erreichbar: beim naechsten Netz erneut versuchen
      }
    }
    if (geaendert) {
      await neuLaden();
      direktGeaendertMelden();
    }
  }, [abruf, neuLaden]);

  // Knopf in den Einstellungen: fehlende Chats sofort aus der Datenbank holen.
  const laden = useCallback(async (): Promise<number> => {
    const s = schluesselRef.current;
    if (!s.kb) return 0;
    const w = await chatsWiederherstellen(s.kb, abruf);
    if (w.wiederhergestellt > 0) {
      setWiederhergestellt((v) => v + w.wiederhergestellt);
      await neuLaden();
      direktGeaendertMelden();
    }
    return w.wiederhergestellt;
  }, [abruf, neuLaden]);

  // Mit neuen Schluesseln: Modelle holen, Liegengebliebenes nachholen.
  useEffect(() => {
    if (!schluessel.mistral && !schluessel.eurouter && !schluessel.kb) return;
    void nachholen();
    if (!schluessel.mistral && !schluessel.eurouter) return;
    let aus = false;
    void alleModelle(schluessel, abruf).then(({ modelle: l, fehler }) => {
      if (aus) return;
      setModellFehler(fehler);
      if (l.length) {
        setModelle(l);
        modelleMerken(l);
      }
    });
    return () => {
      aus = true;
    };
  }, [schluessel, abruf, nachholen]);

  // Netz wieder da: wartende Fragen raus, Spiegelungen nach.
  useEffect(() => {
    const h = () => void nachholen();
    window.addEventListener("online", h);
    return () => window.removeEventListener("online", h);
  }, [nachholen]);

  const speichern = useCallback(
    async (slot: SchluesselSlot, wert: string) => {
      if (!tresor) throw new Error("Ohne Face-ID-Passkey mit Verschluesselung lassen sich keine Schluessel speichern.");
      const sauber = await schluesselSpeichern(tresor, slot, wert);
      setSchluessel((s) => ({ ...s, [slot]: sauber }));
      setHinterlegt(hinterlegteSlots());
      setFehlerhaft((f) => f.filter((x) => x !== slot));
    },
    [tresor],
  );

  const entfernen = useCallback((slot: SchluesselSlot) => {
    schluesselEntfernen(slot);
    setSchluessel((s) => {
      const n = { ...s };
      delete n[slot];
      return n;
    });
    setHinterlegt(hinterlegteSlots());
    setFehlerhaft((f) => f.filter((x) => x !== slot));
  }, []);

  return {
    tresorDa: !!tresor,
    chats,
    schluessel,
    hinterlegt,
    fehlerhaft,
    modelle,
    modellFehler,
    speicherFehler,
    wiederhergestellt,
    neuLaden,
    nachholen,
    laden,
    speichern,
    entfernen,
  };
}
