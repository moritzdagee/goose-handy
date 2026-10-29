// React entry for the roam web client.
//
// Reuses goose's reference clients, vendored under src/vendor/:
//  - @aaif/goose-sdk (vendor/goose-sdk): GooseClient over the roam byte-duplex
//  - @desktop (vendor/desktop): desktop components (MarkdownContent,
//    ToolCallStatusIndicator, Button) + the desktop Tailwind theme
//
// Still fully stateless + CDN-hostable: no backend, all state in the tab,
// all traffic browser ⇄ relay ⇄ roam host.
import "./shim";
import "./theme.css";
// CRITICAL: the desktop's main.css only *registers* token names for Tailwind;
// the actual color values are applied at runtime by applyThemeTokens() (the
// desktop calls this in renderer.tsx before first paint). Without it every
// semantic token (--color-text-primary, …) is undefined and the UI renders
// washed out. It's browser-safe: localStorage + matchMedia only.
import { applyThemeTokens, getResolvedTheme } from "@desktop/theme/theme-tokens";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { IntlProvider } from "react-intl";
import initWasm, { RoamClient } from "./wasm/goose_roaming_web.js";
import { App } from "./App";
import { LockScreen } from "./LockScreen";
import { shouldRelock } from "./lock";

// Face-ID-Sperre: the app (and the roam key the Macs accept) only after Face
// ID. Back on screen after a longer pause, the page reloads into the lock
// screen; a turn already sent keeps running on the Mac meanwhile.
function Gate() {
  const [roam, setRoam] = useState<RoamClient | null>(null);
  // Key for the vault of the direct chat's secrets (Mistral, Datenbank):
  // only in memory, only after Face ID, gone with the next lock.
  const [vault, setVault] = useState<CryptoKey | null>(null);
  useEffect(() => {
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (shouldRelock(hiddenAt, Date.now())) {
        location.reload();
      } else {
        hiddenAt = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  if (!roam) {
    return (
      <LockScreen
        newSecret={() => new RoamClient(undefined).secretHex()}
        onVault={setVault}
        onUnlocked={(secret) => setRoam(new RoamClient(secret))}
      />
    );
  }
  return <App roam={roam} tresor={vault} />;
}

async function boot() {
  // Apply the desktop theme (token values + .dark class) before first paint,
  // exactly like the desktop's renderer.tsx + ThemeContext do.
  const resolved = getResolvedTheme();
  applyThemeTokens(resolved);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      const t = e.matches ? "dark" : "light";
      applyThemeTokens(t);
      document.documentElement.classList.toggle("dark", t === "dark");
    });

  await initWasm();

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <IntlProvider locale="en" defaultLocale="en" messages={{}}>
        <Gate />
      </IntlProvider>
    </React.StrictMode>,
  );
}

void boot();
