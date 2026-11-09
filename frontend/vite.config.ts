/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // The fixtures live in the repo's fixtures/ directory, one level up.
    // They are imported directly (never copied), so the dev server must be
    // allowed to read the repository root. Relative to the project root.
    fs: { allow: [".."] },
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
