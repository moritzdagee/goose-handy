// LIVE-Messung gegen Moritz' echte Rechner (Mac Mini + MacBook), nicht Teil von npm test.
// Nimmt den Schluessel des Test-Browsers voruebergehend als 'claude-test' an und widerruft ihn am Ende.
// Aufruf: node webapp/tests/live-pause.mjs [URL=http://localhost:4199/] [PAUSE=60]   (braucht playwright, ssh mini-fern)
import { chromium, devices } from "playwright";
import { execFileSync } from "node:child_process";
const M = process.env.HOME + "/.local/bin/claude-macbook-goose-fernzugang";
const mb = (a) => execFileSync(M, a, { encoding: "utf8", timeout: 30000 });
const mini = (a) => execFileSync("ssh", ["mini-fern", "~/.local/bin/claude-mini-goose-fernzugang " + a.map(x => `'${x}'`).join(" ")], { encoding: "utf8", timeout: 30000 });
const URL = process.env.URL ?? "https://moritzdagee.github.io/goose-handy/";
const PAUSE = Number(process.env.PAUSE ?? 40);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({ ...devices["iPhone 15 Pro"] });
const page = await ctx.newPage();
let t0 = Date.now(); const ev = [];
page.on("console", m => { const t = m.text(); ev.push(`${((Date.now()-t0)/1000).toFixed(1)}s ${m.type()} ${t.slice(0,110)}`); });
const setHidden = (h) => page.evaluate((h) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => h ? "hidden" : "visible" });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
  document.dispatchEvent(new Event("visibilitychange"));
}, h);
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const card = (await page.locator("#my-card").textContent())?.trim();
  mb(["roam","peers","accept",card,"claude-test"]); mini(["roam","peers","accept",card,"claude-test"]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".new-chat-btn", { hasText: "Mac Mini" }).click({ timeout: 90000 });
  await page.locator("#prompt-input").waitFor({ timeout: 60000 });
  console.log("Chat offen. Pause (offline + versteckt)", PAUSE, "s");
  await setHidden(true); await ctx.setOffline(true);
  await page.waitForTimeout(PAUSE * 1000);
  await ctx.setOffline(false); await setHidden(false);
  t0 = Date.now(); ev.length = 0;
  // like the user: type and send right away, retry until an answer comes
  let ok = false;
  await page.locator("#prompt-input").fill("Antworte nur mit: WIEDER-DA");
  await page.locator("#send-btn").click();
  while (Date.now() - t0 < 120000 && !ok) {
    await page.waitForTimeout(500);
    ok = (await page.locator(".msg.agent .body").allTextContents()).some(x => /WIEDER-DA/.test(x));
  }
  await page.screenshot({path:"/tmp/gm-test/p2.png"}); console.log(ev.filter(l=>!/    at /.test(l)).slice(0,25).join("\n"));
  console.log(`Antwort nach der Pause: ${ok ? ((Date.now()-t0)/1000).toFixed(1) + "s" : "KEINE in 120s"}`);
  console.log(ev.filter(l => /roam|lost|reconnect|error|closed|fail/i.test(l)).slice(0, 15).join("\n"));
  await page.screenshot({ path: "/tmp/gm-test/pause.png" });
} catch (e) { console.log("EXC", e.message); }
finally {
  await browser.close();
  try { mb(["roam","peers","revoke","claude-test"]); mini(["roam","peers","revoke","claude-test"]); console.log("widerrufen"); } catch {}
}
