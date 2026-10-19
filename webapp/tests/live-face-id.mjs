// LIVE-Messung gegen Moritz' echte Rechner, nicht Teil von npm test. Face-ID-Sperre mit einem
// virtuellen Passkey (Chrome, mit PRF): einrichten, verbinden, neu laden, entsperren.
// Nimmt den Schluessel des Test-Browsers voruebergehend als 'claude-test' an und widerruft ihn am Ende.
// Aufruf: URL=http://localhost:4199/ node webapp/tests/live-face-id.mjs
import { chromium, devices } from "playwright";
import { execFileSync } from "node:child_process";
const M = process.env.HOME + "/.local/bin/claude-macbook-goose-fernzugang";
const mb = (a) => execFileSync(M, a, { encoding: "utf8", timeout: 30000 });
const mini = (a) => execFileSync("ssh", ["mini-fern", "~/.local/bin/claude-mini-goose-fernzugang " + a.map((x) => `'${x}'`).join(" ")], { encoding: "utf8", timeout: 30000 });
const URL = process.env.URL ?? "https://moritzdagee.github.io/goose-handy/";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({ ...devices["iPhone 15 Pro"] });
const page = await ctx.newPage();
const ok = (c, t) => console.log(`${c ? "OK  " : "FEHL"} ${t}`);
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  ok(await page.locator("#lock-screen").isVisible(), "Erster Start: Sperrbildschirm statt App");
  await page.click("#lock-action");
  await page.locator("#lock-action", { hasText: "Mit Face ID bestaetigen" }).waitFor({ timeout: 20000 });
  await page.click("#lock-action");
  await page.locator("#my-card").waitFor({ state: "attached", timeout: 30000 });
  const store = await page.evaluate(() => ({ plain: localStorage.getItem("goose-roam-secret-hex"), lock: JSON.parse(localStorage.getItem("goose-handy-sperre") ?? "null") }));
  ok(store.plain === null && store.lock?.mode === "prf" && !!store.lock.sealed, `Schluessel verschluesselt (Modus ${store.lock?.mode}), kein Klartext`);
  const card = (await page.locator("#my-card").textContent())?.trim();
  mb(["roam", "peers", "accept", card, "claude-test"]); mini(["roam", "peers", "accept", card, "claude-test"]);
  await page.reload({ waitUntil: "domcontentloaded" });
  ok(await page.locator("text=Goose ist gesperrt").waitFor({ timeout: 15000 }).then(() => true, () => false), "Nach Neustart gesperrt");
  ok((await page.$$(".new-chat-btn")).length === 0, "Ohne Face ID keine Verbindung zu den Rechnern");
  await page.click("#lock-action");
  await page.waitForFunction(() => document.querySelectorAll(".new-chat-btn").length >= 2, null, { timeout: 120000 });
  ok(true, "Nach Face ID beide Rechner verbunden, ohne neues Koppeln");
  await page.screenshot({ path: "/tmp/face-id-entsperrt.png" });
} catch (e) { console.log("EXC", e.message); }
finally {
  await browser.close();
  try { mb(["roam", "peers", "revoke", "claude-test"]); mini(["roam", "peers", "revoke", "claude-test"]); console.log("widerrufen"); } catch (e) { console.log("revoke fail", e.message); }
}
