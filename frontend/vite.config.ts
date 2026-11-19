/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// The app's version, shown on the home page: package.json is the one place to change it.
import { version } from "./package.json";

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    // The fixtures live in the repo's fixtures/ directory, one level up.
    // They are imported directly (never copied), so the dev server must be
    // allowed to read the repository root. Relative to the project root.
    fs: { allow: [".."] },
    // The API service (python3 -m backend) listens on 127.0.0.1:8000. Proxying /api
    // keeps the page and the API on one origin, so the backend needs no CORS in development.
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: {
    // Monaco is bundled locally (no CDN) and is most of the bundle (~4 MB minified).
    // That is expected for an editor page, so the default 500 kB warning is raised.
    chunkSizeWarningLimit: 5000,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
