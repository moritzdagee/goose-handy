// Optische Pruefung des Direkt-Chats (29.10.2026), OHNE echte Rechner und OHNE
// echtes Netz: Mistral, EUrouter und die Wissensdatenbank sind nachgebaut,
// alles andere (Relais, WebSockets) wird blockiert. iPhone-Groesse 390x844,
// virtueller Passkey mit PRF (Face ID). Bildschirmfotos nach /tmp/handy-direkt-*.png.
// Aufruf: (cd webapp && npm run build && npx vite preview --port 5199) und dann
//   URL=http://localhost:5199/ node webapp/tests/direkt-visuell.mjs
import { chromium } from "playwright";

const URL = process.env.URL ?? "http://localhost:5199/";
const OUT = process.env.OUT ?? "/tmp/handy-direkt";
const MINI = "19736644c81a262765fa4dc07f6d265769d45bcd105ba7fee65ec6b5bb9cb893";
const BOOK = "9fd789f25355c67dd38f75be81c76cc5aa01a66cff6bab2a9895d5ee4e921c30";
const MISTRAL_KEY = "test-mistral-schluessel-0815";
const KB_KEY = "test-kb-schluessel-4711";
let fehler = 0;
const ok = (c, t) => {
  if (!c) fehler++;
  console.log(`${c ? "OK  " : "FEHL"} ${t}`);
};

const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
const sse = (...teile) => teile.map((t) => `data: ${JSON.stringify(t)}\n\n`).join("") + "data: [DONE]\n\n";
const text = (t) => ({ choices: [{ delta: { content: t } }] });

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" });
const aufrufe = [];

await ctx.routeWebSocket(/.*/, (ws) => ws.close());
await ctx.route("**/*", async (route) => {
  const req = route.request();
  const url = req.url();
  if (url.startsWith(URL)) return route.continue();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const body = req.postDataJSON?.() ?? null;
  aufrufe.push({ url, auth: req.headers()["authorization"] ?? null, body });
  if (url.startsWith("https://api.mistral.ai/v1/models")) {
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ data: [{ id: "mistral-large-4-0" }, { id: "mistral-medium-3" }, { id: "mistral-embed" }] }) });
  }
  if (url.startsWith("https://api.mistral.ai/v1/chat/completions")) {
    const hatSuche = (body?.messages ?? []).some((m) => m.role === "tool");
    const frage = [...(body?.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";
    let antwort;
    if (body?.tools && !hatSuche && /morgen/i.test(frage)) {
      antwort = sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "wissensdatenbank_suche", arguments: '{"frage":"Termine morgen"}' } }] } }] });
    } else if (hatSuche) {
      antwort = sse(text("Morgen hast du **zwei Termine**:\n\n"), text("- 10:00 Signicat Wochenrunde\n- 15:30 Tangerina Lieferung\n\n"), text("Quelle: deine Wissensdatenbank."));
    } else {
      antwort = sse(text("Hier ist Goose direkt auf dem iPhone. "), text(`Du hast geschrieben: "${String(frage).slice(0, 60)}".`));
    }
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: antwort });
  }
  if (url.startsWith("https://kb.bios.love/api/kb/mcp-tool/kb_search")) {
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ ok: true, result: { results: [{ subject: "Signicat Wochenrunde", excerpt: "morgen 10:00", source: "calendar" }] } }) });
  }
  if (url.startsWith("https://kb.bios.love/api/kb/mcp-tool/kb_ingest_document")) {
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ ok: true, result: { id: 1 } }) });
  }
  return route.abort();
});

// Zwischenspeicher wie nach frueheren Verbindungen: Chats von Mac Mini und
// MacBook, einer davon mit gemerktem Verlauf (fuer "weiterfuehren").
await ctx.addInitScript(
  ([MINI, BOOK, a]) => {
    if (sessionStorage.getItem("vorbereitet")) return;
    sessionStorage.setItem("vorbereitet", "1");
    const s = [
      { sessionId: "m1", cwd: "/Users/x/werkstatt", title: "Speicherplatz auf dem Mini", updatedAt: a[0], _host: MINI },
      { sessionId: "m2", cwd: "/Users/x/werkstatt/Vom iPhone gestartet", title: "Rechnung Signicat Oktober", updatedAt: a[1], _host: MINI },
      { sessionId: "b1", cwd: "/Users/x", title: "Folien fuer Montag", updatedAt: a[2], _host: BOOK },
    ];
    localStorage.setItem("goose-handy-sessions-v1", JSON.stringify(s));
    const items = [
      { kind: "msg", role: "user", text: "Wie viel Platz ist auf dem Mini noch frei?" },
      { kind: "tool", toolCallId: "t1", title: "df -h", status: "success", output: "" },
      { kind: "msg", role: "agent", text: "Auf dem Mini sind noch **120 GB** frei. Der groesste Brocken sind alte Sicherungen (37 GB)." },
      { kind: "msg", role: "user", text: "Welche Sicherungen genau?" },
      { kind: "msg", role: "agent", text: "Zwei doppelte Datenbank-Sicherungen vom September." },
    ];
    localStorage.setItem(`goose-handy-chat-v1:${MINI}|m1`, JSON.stringify(items));
    localStorage.setItem("goose-handy-chat-index-v1", JSON.stringify([`goose-handy-chat-v1:${MINI}|m1`]));
  },
  [MINI, BOOK, [ago(30), ago(180), ago(60 * 26)]],
);

const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("SEITENFEHLER", e.message));
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
});
const foto = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}-${name}.png` });
  console.log(`     Foto ${OUT}-${name}.png`);
};
const entsperren = async (erstes) => {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator("#lock-action").waitFor();
  await page.click("#lock-action");
  if (erstes) {
    await page.locator("#lock-action", { hasText: "Mit Face ID bestaetigen" }).waitFor({ timeout: 20000 });
    await page.click("#lock-action");
  }
  await page.locator("#start-page").waitFor({ timeout: 20000 });
};

try {
  await entsperren(true);
  ok(await page.locator("#new-on-iphone").isVisible(), "Startseite: 'Neuer Chat hier auf dem iPhone' ohne Rechner");
  ok((await page.locator("#direkt-hinweis").textContent())?.includes("Mistral"), "Hinweis: Mistral-Schluessel fehlt");
  await foto("1-start-ohne-schluessel");

  // Schluessel eintragen
  await page.click("#nav-einstellungen");
  await page.fill("#schluessel-mistral", MISTRAL_KEY);
  await page.click("#schluessel-mistral-speichern");
  await page.locator("#schluessel-mistral-stand", { hasText: "hinterlegt" }).waitFor();
  await page.fill("#schluessel-kb", KB_KEY);
  await page.click("#schluessel-kb-speichern");
  await page.locator("#schluessel-kb-stand", { hasText: "hinterlegt" }).waitFor();
  await foto("2-einstellungen");
  const speicher = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))));
  ok(!speicher.includes(MISTRAL_KEY) && !speicher.includes(KB_KEY), "Kein Schluessel im Klartext im Browser-Speicher");
  ok(speicher.includes("goose-handy-tresor-v1"), "Tresor verschluesselt abgelegt");
  ok(aufrufe.some((a) => a.url.includes("/v1/models") && a.auth === `Bearer ${MISTRAL_KEY}`), "Modell-Liste mit dem Schluessel geholt");

  // Neuer Chat: Auswahl
  await page.click("#nav-chats");
  await page.click("#header-new-chat");
  await page.locator("#host-picker").waitFor();
  ok((await page.locator("#pick-iphone").textContent())?.includes("Hier auf dem iPhone (direkt)"), "Neuer Chat fragt zuerst 'Hier auf dem iPhone (direkt)'");
  ok((await page.locator(".pick-offline").count()) === 2, "Mac Mini und MacBook als 'nicht erreichbar' (keine echte Verbindung im Test)");
  await foto("3-neuer-chat-auswahl");
  await page.click("#pick-iphone");
  await page.locator("#direkt-chat").waitFor();
  await foto("4-direkt-leer");

  // Frage mit Suche in der Datenbank
  await page.fill("#direkt-input", "Was steht morgen an?");
  await page.press("#direkt-input", "Enter");
  await page.locator(".msg.agent", { hasText: "Tangerina Lieferung" }).waitFor({ timeout: 15000 });
  await page.locator("#direkt-arbeitet").waitFor({ state: "detached", timeout: 15000 });
  await foto("5-direkt-antwort");
  const suche = aufrufe.find((a) => a.url.includes("kb_search"));
  ok(suche?.auth === `Bearer ${KB_KEY}` && suche.body?.arguments?.geraet === "iphone" && !!suche.body?.arguments?.conversation_id, "Datenbank-Suche mit Gespraech und Herkunft (Regel 0p2)");
  const ablage = aufrufe.filter((a) => a.url.includes("kb_ingest_document")).at(-1);
  const tags = ablage?.body?.arguments?.tags ?? [];
  ok(ablage && tags.includes("geraet:iphone") && tags.includes("agent:goose-handy") && tags.includes("modell:mistral-large-4-0") && ablage.body.arguments.source === "goose-handy", "Gespraech gespiegelt: source goose-handy, Etiketten geraet/agent/modell");

  // Liste mit Chips
  await page.click("#direkt-zurueck");
  await page.locator("#start-page").waitFor();
  const chips = await page.locator("#start-page .host-filter [role=tab]").allTextContents();
  ok(chips.join("|") === "Alle 4|iPhone 1|Mac Mini 2|MacBook 1", `Chips mit Anzahl: ${chips.join(" | ")}`);
  await foto("6-liste");
  await page.click("#sidebar-toggle");
  await foto("7-seitenleiste");
  await page.mouse.click(375, 600); // neben die Seitenleiste tippen

  // Rechner-Chat (Rechner aus) auf dem iPhone weiterfuehren
  await page.locator(".recent-chat", { hasText: "Speicherplatz auf dem Mini" }).click();
  await page.locator("#clone-to-iphone").waitFor({ timeout: 15000 });
  await foto("8-rechner-aus");
  await page.click("#clone-to-iphone");
  await page.locator("#direkt-chat").waitFor();
  ok((await page.locator("#direkt-titel").textContent()) === "Klon: Speicherplatz auf dem Mini", "Klon angelegt");
  await page.fill("#direkt-input", "Kannst du das kurz zusammenfassen?");
  await page.press("#direkt-input", "Enter");
  await page.locator(".msg.agent", { hasText: "Goose direkt" }).waitFor({ timeout: 15000 });
  await page.locator("#direkt-arbeitet").waitFor({ state: "detached", timeout: 15000 });
  const klonAnfrage = aufrufe.filter((a) => a.url.includes("chat/completions")).at(-1);
  ok(JSON.stringify(klonAnfrage?.body?.messages ?? []).includes("120 GB"), "Weitergefuehrter Chat kennt den Verlauf vom Mac Mini");
  await foto("9-klon-weiter");

  // Offline: Nachricht wartet, geht mit Netz von selbst raus
  await ctx.setOffline(true);
  await page.fill("#direkt-input", "Und jetzt ohne Netz?");
  await page.press("#direkt-input", "Enter");
  await page.locator(".direkt-wartet").waitFor({ timeout: 10000 });
  await foto("10-offline-wartet");
  await ctx.setOffline(false);
  await page.locator(".msg.agent", { hasText: "Und jetzt ohne Netz" }).waitFor({ timeout: 20000 });
  await page.locator(".direkt-wartet").waitFor({ state: "detached", timeout: 20000 });
  ok(true, "Wartende Nachricht ging nach Netz-Rueckkehr automatisch raus");
  await foto("11-wieder-online");

  // Neustart: wieder gesperrt, nach Face ID sind Schluessel und Chats da
  await entsperren(false);
  ok((await page.locator("#start-page .host-filter [role=tab][data-filter=iphone]").textContent())?.includes("2"), "Nach Neustart: beide iPhone-Chats noch da");
  await page.click("#nav-einstellungen");
  ok((await page.locator("#schluessel-mistral-stand").textContent()) === "hinterlegt", "Nach Neustart: Schluessel nach Face ID wieder offen");
  ok((await page.locator("#spiegel-stand").textContent())?.includes("Alle Direkt-Chats sind abgelegt"), "Alle Direkt-Chats in der Wissensdatenbank");
  const echte = aufrufe.filter((a) => !/api\.mistral\.ai|kb\.bios\.love/.test(a.url));
  console.log(`     blockiert (Relais u. a.): ${echte.length} Anfragen, nichts davon beantwortet`);
} catch (e) {
  fehler++;
  console.log("EXC", e.message);
  await page.screenshot({ path: `${OUT}-fehler.png` });
} finally {
  await browser.close();
}
console.log(fehler ? `${fehler} FEHLER` : "alles gruen");
process.exit(fehler ? 1 : 0);
