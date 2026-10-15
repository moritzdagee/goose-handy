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
und die Startseite (`StartPage.tsx`). Netz, Verbindungs-Baustein und Bildverarbeitung des Browsers
werden dabei nachgestellt. Die Playwright-Skripte in `webapp/tests/` sind davon getrennt und
brauchen einen laufenden Entwicklungs-Server.

## Sicherheit

Die App selbst enthaelt keine Geheimnisse. Jeder Browser erzeugt beim ersten Start einen eigenen
Schluessel; ein Rechner laesst ihn erst zu, wenn er dort angenommen wurde
(`koppeln.py` in vibe-suite). Die eingebauten Verbindungs-Karten sagen nur, wo die Rechner
erreichbar sind.
