// Unit tests (npm test). Kept apart from vite.config.ts so the tests do not
// pull in the Tailwind build step. The Playwright scripts in tests/ are
// separate and need a running dev server.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@aaif/goose-sdk": fileURLToPath(new URL("./src/vendor/goose-sdk/index.ts", import.meta.url)),
      "@desktop": fileURLToPath(new URL("./src/vendor/desktop", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
    restoreMocks: true,
    // Default 5000 ms reichte am 30.10.2026 nicht mehr: chat.test.ts und
    // ui.test.tsx liefen mit fake-indexeddb + jsdom knapp darueber und timed
    // out. 15 s Puffer, damit echte Logikfehler sichtbar bleiben.
    testTimeout: 15000,
  },
});
