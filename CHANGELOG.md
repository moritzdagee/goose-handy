# CHANGELOG goose-handy

## 2026-10-31 Wiederherstellung der iPhone-Chats und Icon ohne Alpha (Zweig feat/direkt-wiederherstellung)

- Neu `webapp/src/direkt/wiederherstellen.ts`: stellt Direkt-Chats aus der Wissensdatenbank wieder
  her, wenn der iPhone-Speicher weg war (z.B. nach neuem Home-Bildschirm-Lesezeichen). Liest die
  gespiegelten Eintraege (kb_recent, Quelle `goose-handy`, Etikett `agent:goose-handy`, dann
  kb_get_document je Eintrag, Kennung source_ref `goose-handy-iphone-chat-<id>`) und wandelt sie
  zurueck: Rolle aus dem Zeilen-Praefix ("Moritz" / "Goose (iPhone)" / "Hinweis"), Titel ohne
  Betreff-Praefix, erstellt aus metadata.erstellt (sonst Zeitstempel des Eintrags). NUR LESEND:
  bestehende lokale Chats werden nie ueberschrieben, wiederhergestellte bekommen spiegel
  "gespiegelt". Entschiedene Eintraege bleiben in localStorage vermerkt (laeuft idempotent, faellt
  mit dem Speicher weg). Laeuft beim Start mit (useDirekt `nachholen`) und per Knopf
  "Aus Datenbank laden" in den Direkt-Einstellungen samt Hinweis "X Chats wiederhergestellt".
- `spiegel.ts`: Praefix als `SPIEGEL_REF_PRAEFIX` exportiert (Spiegeln und Wiederherstellen teilen
  sich die Kennung).
- Icon: `apple-touch-icon.png` und `icon-512.png` jetzt deckend (kein Alpha-Kanal mehr), ganze
  Flaeche dunkles Lila #5C2CB4, weisse Gans mittig in der Sicherheitszone; Quelle
  `icon-quadrat.svg`. `manifest.webmanifest`: icon-512 mit purpose "any maskable". Grund: auf dem
  iPhone erschien das Icon grau/weiss statt lila (iOS fuellt transparente Flaechen selbst).
- Tests: 6 neue Faelle in `wiederherstellen.test.ts` (Zerlegen mit Code-Bloecken, Umwandlung,
  Wiederherstellung, kein Ueberschreiben + idempotent, fremde Kennung, offline).

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
