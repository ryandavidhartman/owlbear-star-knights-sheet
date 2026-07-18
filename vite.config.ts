import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ command }) => ({
  // GitHub Pages project sites are served from /<repo-name>/, not the
  // domain root, so build output needs that prefix baked into asset
  // references. The dev server stays at root either way.
  base: command === "build" ? "/owlbear-star-knights-sheet/" : "/",
  plugins: [react()],
  server: {
    cors: true,
  },
  build: {
    rollupOptions: {
      input: {
        background: resolve(__dirname, "background.html"),
        sheet: resolve(__dirname, "sheet.html"),
      },
    },
  },
}));
