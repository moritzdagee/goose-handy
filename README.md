# goose-handy

Moritz' eigene Fassung der Goose-Web-App fuer das iPhone. Grundlage ist der offizielle
Browser-Client von Goose (`aaif-goose/goose-mobile`, Ordner `mobile-web`, Zweig
`mobile-web-client`, Stand 7cfa161 vom 20.08.2026). Die Original-Beschreibung steht in
`README.upstream.md`.

Adresse: https://moritzdagee.github.io/goose-handy/ (in Safari oeffnen, "Teilen" -> "Zum
Home-Bildschirm").

## Was anders ist als im Original

| Original | Hier |
|---|---|
| Beim Oeffnen springt die App in den zuletzt offenen Chat | Startseite mit "Neuer Chat auf Mac Mini / MacBook" und den letzten Chats |
| "Zurueck" und "Neuer Chat" gesperrt, solange ein Chat arbeitet oder nachlaedt | nie gesperrt; der alte Chat laeuft auf dem Rechner weiter |
| Knopf "Neu" nur in der Seitenleiste | "+ Neu" immer oben rechts, bei zwei Rechnern mit Auswahl |
| nur ein Rechner wird beim Start verbunden | alle bekannten Rechner (Mac Mini und MacBook sind eingebaut) |
| nur Text | Bueroklammer: Fotos und Dateien anhaengen (Bilder als Bild, alles andere als Datei) |
| eine gemischte Chat-Liste | Filter "Alle / Mac Mini / MacBook" (Startseite und Seitenleiste, mit Anzahl, auf dem Geraet gemerkt) |
| neue Chats im Arbeitsordner des Rechners | neue Chats im Unterordner "Vom iPhone gestartet"; die Mac-App zeigt ihn als eigene, aufklappbare Rubrik, die Handy-App als eigene Gruppe |
| Chat-Liste und Verlauf nur aus der Verbindung | Chat-Liste und die letzten 15 geoeffneten Chats bleiben auf dem Handy gespeichert und stehen nach dem Oeffnen sofort da |
| Oberflaeche der Desktop-App, englisch, klein | eigene Gestaltung aus Lovable (Oktober 2026): dunkel als Standard, orange Akzentfarbe, grosse Tippflaechen, alles Deutsch |

Gestaltung (seit 28.10.2026): entworfen im Lovable-Projekt "Goose iPhone Assistant"
(https://lovable.dev/projects/905d7037-aa4a-4e12-b5c8-4ae24ce0b870, nur Beispieldaten) und von Hand
in die bestehenden Bausteine uebernommen: `webapp/src/ui/` (Kopfleiste, Seitenleiste, Chat-Eintraege,
Eingabefeld, Rechner-Auswahl), Farben als Variablen in `theme.css` (hell folgt der Systemeinstellung).
Verbindung, Zwischenspeicher, Anhaenge und Face-ID-Sperre sind unveraendert; Kennungen und Klassen
fuer Tests und Playwright-Skripte (`#prompt-input`, `.recent-chat`, `.msg.agent`, ...) sind geblieben.

Verbindung (seit 15.10.2026): iOS friert die App ein, sobald sie vom Bildschirm verschwindet, und
die Verbindungen sterben dabei, ohne dass die App es merkt. Beim Zurueckkehren (und wenn das Netz
wiederkommt) fragt die App jeden Rechner mit 5 Sekunden Frist; nach mehr als 10 Sekunden Pause
baut sie gleich alles neu auf, inklusive eines frischen Verbindungs-Bausteins (`RoamClient.reset()`
im wasm-Teil: nach einem Netzausfall kamen ueber den alten zwar Verbindungen zustande, aber keine
Daten). Der offene Chat bleibt stehen, wird nach dem Wiederverbinden neu geladen, und eine in der
Zwischenzeit getippte Nachricht geht automatisch raus. Gemessen (Chrome ohne Fenster, iPhone-Ansicht,
Netz 10 bzw. 60 s weg): Antwort 14 bis 20 s nach der Rueckkehr, vorher ging die Nachricht verloren.
Kaltstart: erster Rechner 2 bis 3 s, beide 4 s.

Zwischenspeicher (seit 15.10.2026, `cache.ts`): die Chat-Liste und das Ende der 15 zuletzt
geoeffneten Chats (je 60 Eintraege) liegen im Browser-Speicher des Handys. Nach dem Oeffnen oder wenn
iOS die App weggeworfen hat, steht die Liste sofort da, noch vor jeder Verbindung (gemessen 0,2 s,
vorher 2 bis 4 s "connecting"); ein geoeffneter Chat zeigt sofort den gemerkten Stand und wird im
Hintergrund aufgefrischt ("aktualisiere..."). Antwortet ein Rechner nicht, bleiben seine Chats in der
Liste stehen, statt zu verschwinden. Das Nachladen eines Chats, den gerade ein anderes Geraet
weiterfuehrt, leert den Bildschirm nicht mehr (das war das Flackern alle paar Sekunden). Waehrend
ein Chat laedt, kann man schon tippen; die Nachricht geht raus, sobald er geladen ist.

Ordner "Vom iPhone gestartet": ein neuer Chat schickt `_meta.hostSubdir` mit; der Fernzugang legt den
Ordner im Arbeitsordner des Rechners an (MacBook `~/Vom iPhone gestartet`, Mini
`~/werkstatt/Vom iPhone gestartet`). Das braucht den Patch `handy-ordner.patch` im Fernzugang-Bau
(vibe-suite `agenten-umgebung/goose-fernzugang`); ohne ihn wird der Hinweis ignoriert. Derselbe Patch
sorgt dafuer, dass ein Chat beim Oeffnen vom Handy in seinem Ordner bleibt (vorher wanderte er in den
Arbeitsordner des Fernzugangs und verschwand aus seiner Rubrik in der Mac-App).

Anhaenge: der Goose-Bau auf MacBook und Mac Mini (vibe-suite
`agenten-umgebung/goose-fernzugang`, Patch `anhaenge-speichern`) speichert jede angehaengte
Datei und legt eine Kopie nach `~/in-die-datenbank/goose/`, von dort kommt sie in die
Wissensdatenbank. Grosse Fotos und HEIC werden auf dem Handy zu JPEG (laengste Kante 2400
Pixel) umgerechnet, Dateien bis 25 MB.

## Bauen und veroeffentlichen

    bash build-web.sh                       # Verbindungs-Baustein (wasm), braucht rustup 1.96.1 + brew llvm
    cd webapp && npm install && npm run build
    bash veroeffentlichen.sh                # legt webapp/dist auf den Zweig gh-pages

GitHub Pages liefert den Zweig `gh-pages` aus (ohne eigene Workflow-Datei).

## Tests

    cd webapp && npm ci && npm test       # Vitest, rund 20 Sekunden, ohne Netz und ohne Rechner
    cd webapp && npm run typecheck        # braucht den Verbindungs-Baustein in src/wasm (build-web.sh)

Die Tests liegen neben dem Code (`webapp/src/*.test.ts(x)`) und pruefen vor allem die Teile dieser
Fassung: eingebaute Rechner und Verbindungs-Karten (`hosts.ts`), Anhaenge und Foto-Umrechnung
(`attachments.ts`), Chat-Gruppen (`sessions.ts`), den Datenstrom zur Verbindung (`roam-stream.ts`)
die Startseite mit Rechner-Filter (`StartPage.tsx`) und den Zwischenspeicher (`cache.ts`). Netz, Verbindungs-Baustein und Bildverarbeitung des Browsers
werden dabei nachgestellt. Die Playwright-Skripte in `webapp/tests/` sind davon getrennt und
brauchen einen laufenden Entwicklungs-Server. Live gegen die echten Rechner: `tests/live-kaltstart.mjs`,
`tests/live-pause.mjs`, `tests/live-filter-speicher.mjs` (Filter, Zwischenspeicher, neuer Chat im
Handy-Ordner mit `NEU=macbook`).

## Sicherheit

Die App selbst enthaelt keine Geheimnisse. Jeder Browser erzeugt beim ersten Start einen eigenen
Schluessel; ein Rechner laesst ihn erst zu, wenn er dort angenommen wurde
(`koppeln.py` in vibe-suite). Die eingebauten Verbindungs-Karten sagen nur, wo die Rechner
erreichbar sind.

## Face-ID-Sperre (seit 18.10.2026)

Die App oeffnet sich nur nach Face ID. Beim ersten Start legt sie einen eigenen Passkey an (iCloud-Schluesselbund,
Seite moritzdagee.github.io) und verschluesselt damit den Zugangsschluessel, den MacBook und Mac Mini kennen
(WebAuthn mit PRF, AES-GCM, `webapp/src/lock.ts`). Ohne Face ID kann die App sich also gar nicht verbinden.
Nach mehr als 2 Minuten im Hintergrund sperrt sie sich wieder; ein laufender Auftrag arbeitet auf dem Rechner weiter.
Ohne PRF (altes iOS) sperrt der Passkey nur die Ansicht. Passkey verloren: "Neu einrichten" auf dem Sperrbildschirm,
danach das iPhone neu koppeln (vibe-suite `agenten-umgebung/goose-fernzugang/koppeln.py`).
Live-Pruefung mit virtuellem Passkey: `URL=http://localhost:4199/ node webapp/tests/live-face-id.mjs`.
