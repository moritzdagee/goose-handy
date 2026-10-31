# CHANGELOG goose-handy

## 2026-10-31 - vitest: Worker begrenzt gegen Sammellauf-Last (tests-taeglich 31.10.2026)

- Anlass: tests-taeglich 31.10.2026 meldete goose-handy rot: 184 Tests bestanden,
  aber 3 von 18 forks-Workern konnten in der frischen /tmp-Kopie unter Volllast
  nicht starten ("Timeout waiting for worker to respond", Import 142 s).
- `webapp/vitest.config.ts`: `pool: forks` mit `maxForks: 4`, damit Last im
  Sammellauf nicht als rote Testdateien gewertet wird. Lokal `npm test`: 241/241
  bestanden in 2,4 s.


## 2026-10-29 Direkt-Chat auf dem iPhone (Zweig feat/direkt-chat)

- Neu `webapp/src/direkt/`: Direkt-Chat mit Mistral (EUrouter optional) ohne Mac Mini und MacBook,
  Chats in IndexedDB, Strom-Antworten, Modellwahl, Warteschlange offline (`chat.ts`, `strom.ts`,
  `anbieter.ts`, `speicher.ts`), Schluessel-Tresor mit AES-GCM und Face-ID-Passkey (`tresor.ts`),
  Spiegelung in die Wissensdatenbank (`spiegel.ts`, source `goose-handy`, Etiketten
  `geraet:iphone`, `agent:goose-handy`, `modell:<id>`), Rechner-Chat auf dem iPhone weiterfuehren
  (`klonen.ts`), Oberflaeche `DirektChatAnsicht.tsx`, `DirektEinstellungen.tsx`, `useDirekt.ts`.
- `lock.ts`: `vaultKey`, `unlockWithPrf`, `setUpLockWithPrf`; `resetLock` loescht den Tresor mit.
  `LockScreen` liefert den Tresor-Schluessel ueber `onVault` (nur im Arbeitsspeicher).
- Rahmen wie Moose beta: untere Leiste (Chats, Rechner, Einstellungen), "Neu" fragt iPhone / Mac
  Mini / MacBook, Chips "Alle / iPhone / Mac Mini / MacBook" mit Anzahl, Suche, Seitenleiste mit
  Gruppe "Auf dem iPhone". Ohne erreichbaren Rechner bleibt die Chat-Liste die Hauptansicht (vorher
  Verbinden-Seite).
- Abhaengigkeit (nur Tests): `fake-indexeddb`.
- Tests: 210 (vorher 144), dazu `webapp/tests/direkt-visuell.mjs` (Playwright, Netz nachgebaut).
- Gegenstueck: assistant_data #617 (CORS-Freigabe fuer https://moritzdagee.github.io auf kb.bios.love).
