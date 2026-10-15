// LIVE-Messung gegen Moritz' echte Rechner (Mac Mini + MacBook), nicht Teil von npm test.
// Nimmt den Schluessel des Test-Browsers voruebergehend als 'claude-test' an und widerruft ihn am Ende.
// Aufruf: node webapp/tests/live-kaltstart.mjs [URL=http://localhost:4199/] [PAUSE=60]   (braucht playwright, ssh mini-fern)
import { chromium, devices } from "playwright";
import { execFileSync } from "node:child_process";
const M = process.env.HOME + "/.local/bin/claude-macbook-goose-fernzugang";
const mb = (a) => execFileSync(M, a, { encoding: "utf8", timeout: 30000 });
const mini = (a) => execFileSync("ssh", ["mini-fern", "~/.local/bin/claude-mini-goose-fernzugang " + a.map(x => `'${x}'`).join(" ")], { encoding: "utf8", timeout: 30000 });
const URL = process.env.URL ?? "https://moritzdagee.github.io/goose-handy/";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({ ...devices["iPhone 15 Pro"] });
const page = await ctx.newPage();
let t0 = 0; const ev = [];
page.on("console", m => { const t = m.text(); if (/roam:|rejected|connect/.test(t)) ev.push(`${((Date.now()-t0)/1000).toFixed(1)}s ${t.slice(0,90)}`); });
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const card = (await page.locator("#my-card").textContent())?.trim();
  mb(["roam","peers","accept",card,"claude-test"]); mini(["roam","peers","accept",card,"claude-test"]);
  for (let i = 1; i <= 3; i++) {
    ev.length = 0; t0 = Date.now();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".new-chat-btn").first().waitFor({ timeout: 120000 });
    const first = (Date.now()-t0)/1000;
    await page.waitForFunction(() => document.querySelectorAll(".new-chat-btn").length >= 2, null, { timeout: 120000 }).catch(()=>{});
    console.log(`Lauf ${i}: erster Rechner ${first.toFixed(1)}s, beide ${((Date.now()-t0)/1000).toFixed(1)}s`);
    console.log("  " + ev.join("\n  "));
  }
} catch (e) { console.log("EXC", e.message); }
finally {
  await browser.close();
  try { mb(["roam","peers","revoke","claude-test"]); mini(["roam","peers","revoke","claude-test"]); console.log("widerrufen"); } catch (e) { console.log("revoke fail", e.message); }
}
