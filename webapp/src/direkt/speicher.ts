// Direkt-Chats auf dem iPhone (29.10.2026): jeder Chat ein Eintrag in
// IndexedDB ("goose-handy-direkt", Ablage "chats"), mit allen Nachrichten.
// Bleibt auf dem Geraet, auch wenn iOS die Seite wegwirft. Keine Schluessel
// hier drin (die liegen verschluesselt im Tresor, tresor.ts).

export type DirektRolle = "nutzer" | "assistent" | "system";

export type DirektNachricht = {
  id: string;
  rolle: DirektRolle;
  text: string;
  zeit: string;
  modell?: string;
  /** Nutzer-Nachricht noch ohne Antwort: geht beim naechsten Netz raus. */
  status?: "wartet";
  grund?: string;
};

export type KlonHerkunft = {
  geraet: "mini" | "macbook" | "tablet" | "unbekannt";
  sessionId: string;
  titel: string;
  geklontAm: string;
};

export type DirektChat = {
  id: string;
  titel: string;
  erstelltAm: string;
  geaendertAm: string;
  modell: string;
  /** Wer antwortet; fehlt = Mistral. */
  anbieter?: "mistral" | "eurouter";
  archiviert?: boolean;
  herkunft?: KlonHerkunft;
  nachrichten: DirektNachricht[];
  /** Spiegelung in die Wissensdatenbank: steht aus, bis sie geklappt hat. */
  spiegel?: "ausstehend" | "gespiegelt";
  spiegelStand?: string;
};

export const DB_NAME = "goose-handy-direkt";
const STORE = "chats";

let offen: Promise<IDBDatabase> | null = null;

function oeffnen(): Promise<IDBDatabase> {
  if (offen) return offen;
  offen = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Eine neuere Fassung in einem anderen Tab will umbauen: Platz machen.
      db.onversionchange = () => {
        db.close();
        offen = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      offen = null;
      reject(req.error ?? new Error("Speicher auf dem iPhone nicht verfuegbar"));
    };
  });
  return offen;
}

async function anfrage<T>(modus: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await oeffnen();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, modus);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? new Error("Speichern abgebrochen"));
  });
}

export function neueId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function alleChats(): Promise<DirektChat[]> {
  const liste = await anfrage<DirektChat[]>("readonly", (s) => s.getAll() as IDBRequest<DirektChat[]>);
  return liste.sort((a, b) => b.geaendertAm.localeCompare(a.geaendertAm));
}

export async function chatLesen(id: string): Promise<DirektChat | null> {
  const c = await anfrage<DirektChat | undefined>("readonly", (s) => s.get(id) as IDBRequest<DirektChat | undefined>);
  return c ?? null;
}

export async function chatSpeichern(chat: DirektChat): Promise<void> {
  await anfrage("readwrite", (s) => s.put(chat));
}

export async function neuerChat(modell: string, jetzt: Date = new Date()): Promise<DirektChat> {
  const chat: DirektChat = {
    id: neueId(),
    titel: "Neuer Chat",
    erstelltAm: jetzt.toISOString(),
    geaendertAm: jetzt.toISOString(),
    modell,
    nachrichten: [],
  };
  await chatSpeichern(chat);
  return chat;
}

/** Liest, aendert und schreibt einen Chat in einem Zug. */
export async function chatAendern(id: string, fn: (c: DirektChat) => DirektChat | void): Promise<DirektChat> {
  const c = await chatLesen(id);
  if (!c) throw new Error("Chat nicht gefunden");
  const neu = fn(c) ?? c;
  await chatSpeichern(neu);
  return neu;
}

export async function chatArchivieren(id: string, archiviert: boolean): Promise<DirektChat> {
  return chatAendern(id, (c) => {
    c.archiviert = archiviert;
  });
}

/** Titel aus der ersten Frage, wie die Rechner es machen. */
export function titelAusText(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "Neuer Chat";
  return t.length > 48 ? `${t.slice(0, 47).trimEnd()}…` : t;
}

/** Nur fuer Tests: Verbindung vergessen, damit eine frische Datenbank greift. */
export function _speicherZuruecksetzen(): void {
  offen = null;
}
