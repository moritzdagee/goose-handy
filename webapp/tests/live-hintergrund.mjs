// LIVE-Messung gegen Moritz echte Rechner, nicht Teil von npm test. Auftrag abschicken, App sofort
// schliessen (wie ein gesperrtes iPhone). Danach auf dem Rechner pruefen, ob die Antwort gespeichert ist
// (Goose-Fernzugang-Patch laeufe-ueberleben, 17.10.2026). Test-Chat danach loeschen.
// Aufruf: HOST=mini|macbook SLEEP=40 [KEEP=1] node webapp/tests/live-hintergrund.mjs
import { chromium, devices } from "playwright";
import { execFileSync } from "node:child_process";
const M = process.env.HOME + "/.local/bin/claude-macbook-goose-fernzugang";
const mb = (a) => execFileSync(M, a, { encoding: "utf8", timeout: 30000 });
const mini = (a) => execFileSync("ssh", ["mini-fern", "~/.local/bin/claude-mini-goose-fernzugang " + a.map((x) => `'${x}'`).join(" ")], { encoding: "utf8", timeout: 30000 });
const URL = process.env.URL ?? "https://moritzdagee.github.io/goose-handy/";
const HOST = process.env.HOST ?? "mini";
const MARK = process.env.MARK ?? "HINTERGRUND-" + Date.now();
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({ ...devices["iPhone 15 Pro"] });
const page = await ctx.newPage();
const T0 = Date.now(); const T = () => ((Date.now() - T0) / 1000).toFixed(0) + "s";
try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const card = (await page.locator("#my-card").textContent())?.trim();
  mb(["roam", "peers", "accept", card, "claude-test"]); mini(["roam", "peers", "accept", card, "claude-test"]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".new-chat-btn").length >= 2, null, { timeout: 120000 });
  await page.click(HOST === "mini" ? "#new-on-mac-mini" : "#new-on-macbook");
  await page.waitForFunction(() => document.querySelector("#log .msg.system")?.textContent?.includes("Neuer Chat"), null, { timeout: 60000 });
  const key = await page.evaluate(() => localStorage.getItem("goose-roam-last-session"));
  console.log(T(), "CHAT", key);
  await page.locator("#prompt-input").fill(`Test fuer Hintergrund-Arbeit. Fuehre im Terminal genau diesen Befehl aus, im Vordergrund und nicht als Hintergrund-Aufgabe: sleep ${process.env.SLEEP ?? 60} && echo ${MARK} > /tmp/claude-hintergrund-test.txt . Antworte danach nur mit: ${MARK}`);
  await page.locator("#send-btn").click();
  if (process.env.KEEP) {
    await page.waitForFunction((m) => [...document.querySelectorAll("#log .msg")].some((e) => !e.classList.contains("user") && e.textContent.includes(m)), MARK, { timeout: 240000 }).catch(() => console.log("keine Antwort im Fenster"));
    console.log(T(), "Antwort im Fenster gesehen");
  } else {
    await page.waitForTimeout(6000);
  }
  console.log(T(), "Browser zu");
  await browser.close();
} catch (e) { console.log("EXC", e.message); try { await browser.close(); } catch {} }
console.log("MARK", MARK);
