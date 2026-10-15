// LIVE-Messung gegen Moritz' echte Rechner (Mac Mini + MacBook), nicht Teil von npm test.
// Prueft Rechner-Filter, gemerkte Chat-Liste und gemerkten Chat nach einem Neuladen
// (so wirft iOS die App oft weg) und optional einen neuen Chat im Ordner "Vom iPhone gestartet".
// Nimmt den Schluessel des Test-Browsers voruebergehend als 'claude-test' an und widerruft ihn am Ende.
// Aufruf: URL=http://localhost:4199/ NEU=macbook node webapp/tests/live-filter-speicher.mjs
//   NEU=macbook|mini legt dort einen Test-Chat an und gibt seine Kennung aus (danach loeschen).
import { chromium, devices } from "playwright";
import { execFileSync } from "node:child_process";
const M = process.env.HOME + "/.local/bin/claude-macbook-goose-fernzugang";
const mb = (a) => execFileSync(M, a, { encoding: "utf8", timeout: 30000 });
const mini = (a) => execFileSync("ssh", ["mini-fern", "~/.local/bin/claude-mini-goose-fernzugang " + a.map((x) => `'${x}'`).join(" ")], { encoding: "utf8", timeout: 30000 });
const URL = process.env.URL ?? "https://moritzdagee.github.io/goose-handy/";
const NEU = process.env.NEU ?? "";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({ ...devices["iPhone 15 Pro"] });
const page = await ctx.newPage();
const ok = (cond, text) => console.log(`${cond ? "OK  " : "FEHL"} ${text}`);
const tabs = () => page.$$eval("#start-page .host-filter [role=tab]", (els) => els.map((e) => e.textContent.trim()));
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const card = (await page.locator("#my-card").textContent())?.trim();
  mb(["roam", "peers", "accept", card, "claude-test"]);
  mini(["roam", "peers", "accept", card, "claude-test"]);

  // 1. Erster Start: beide Rechner, Filter-Leiste mit Anzahl.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".new-chat-btn").length >= 2, null, { timeout: 120000 });
  // Beide Listen abwarten (das MacBook antwortet oft ein paar Sekunden spaeter).
  await page.waitForFunction(() => [...document.querySelectorAll("#start-page .host-filter [role=tab]")].slice(1).every((t) => !t.textContent.trim().endsWith(" 0")), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const t1 = await tabs();
  console.log("Filter:", t1.join(" | "));
  ok(t1.length === 3 && t1[0].startsWith("Alle"), "Filter-Leiste Alle / Mac Mini / MacBook");

  // 2. Filter MacBook: nur MacBook-Chats, Auswahl bleibt nach Neuladen.
  await page.click("#start-page .host-filter [role=tab]:nth-child(3)");
  const nBook = await page.$$eval(".recent-chat", (els) => els.length);
  const t1Book = Number(t1[2].split(" ").pop());
  ok(nBook === Math.min(40, t1Book), `MacBook-Filter zeigt ${nBook} Chats (erwartet ${Math.min(40, t1Book)})`);

  // 3. Neuladen = iOS hat die App weggeworfen. Liste muss sofort da sein, vor jeder Verbindung.
  const t0 = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".recent-chat").first().waitFor({ timeout: 30000 });
  const listMs = Date.now() - t0;
  const connectedYet = await page.$$eval(".new-chat-btn", (els) => els.length);
  ok(listMs < 2500, `Chat-Liste nach Neuladen in ${listMs} ms da (Rechner verbunden: ${connectedYet})`);
  const sel = await page.$eval("#start-page .host-filter [aria-selected=true]", (e) => e.textContent.trim());
  ok(sel.startsWith("MacBook"), `Filter gemerkt: ${sel}`);

  // 4. Chat oeffnen, zurueck, Neuladen, wieder oeffnen: Verlauf sofort aus dem Speicher.
  await page.waitForFunction(() => document.querySelectorAll(".new-chat-btn").length >= 1, null, { timeout: 120000 });
  await page.locator(".recent-chat").first().click();
  await page.waitForFunction(() => document.querySelectorAll("#log .msg").length > 0 && !document.getElementById("chat-refreshing"), null, { timeout: 120000 });
  const firstCount = await page.$$eval("#log .msg, #log .tool", (els) => els.length);
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".recent-chat").first().waitFor({ timeout: 30000 });
  const t2 = Date.now();
  await page.locator(".recent-chat").first().click();
  await page.waitForFunction(() => document.querySelectorAll("#log .msg, #log .tool").length > 0, null, { timeout: 120000 });
  const chatMs = Date.now() - t2;
  ok(chatMs < 1500, `Gemerkter Chat nach Neuladen in ${chatMs} ms sichtbar (${firstCount} Eintraege beim ersten Laden)`);
  await page.waitForFunction(() => !document.getElementById("chat-refreshing"), null, { timeout: 120000 });
  console.log(`  frisch geladen nach ${Date.now() - t2} ms`);

  // 5. Optional: neuer Chat landet im Ordner "Vom iPhone gestartet".
  if (NEU) {
    await page.click("#back-to-matrix");
    const btn = NEU === "mini" ? "#new-on-mac-mini" : "#new-on-macbook";
    await page.click(btn);
    await page.waitForFunction(() => document.querySelector("#log .msg.system")?.textContent?.includes("Neuer Chat"), null, { timeout: 60000 });
    const key = await page.evaluate(() => localStorage.getItem("goose-roam-last-session"));
    console.log("NEUER_CHAT", key);
  }
} catch (e) {
  console.log("EXC", e.message);
} finally {
  await browser.close();
  try {
    mb(["roam", "peers", "revoke", "claude-test"]);
    mini(["roam", "peers", "revoke", "claude-test"]);
    console.log("widerrufen");
  } catch (e) {
    console.log("revoke fail", e.message);
  }
}
