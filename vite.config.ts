import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const GH_PAGES_URL = "https://ryandavidhartman.github.io/owlbear-star-knights-sheet/";

/**
 * The manifest's icon/background_url are resolved by Owlbear Rodeo's own
 * app before our page ever loads, not by our SDK. We can't be sure it does
 * proper relative-URL resolution against the manifest's location rather
 * than a naive `origin + path` concatenation (the SDK itself does the
 * latter, see src/background/contextMenu.ts), so for the deployed build we
 * rewrite those two fields to fully-qualified URLs to remove the ambiguity.
 * Local dev keeps root-relative paths, which are unambiguously correct
 * there since there's no subpath.
 */
function rewriteManifestForGhPages(): Plugin {
  return {
    name: "rewrite-manifest-for-gh-pages",
    apply: "build",
    closeBundle() {
      const manifestPath = resolve(__dirname, "dist/manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      manifest.icon = new URL("icon.svg", GH_PAGES_URL).href;
      manifest.background_url = new URL("background.html", GH_PAGES_URL).href;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    },
  };
}

export default defineConfig(({ command }) => ({
  // GitHub Pages project sites are served from /<repo-name>/, not the
  // domain root, so build output needs that prefix baked into asset
  // references. The dev server stays at root either way.
  base: command === "build" ? "/owlbear-star-knights-sheet/" : "/",
  plugins: [react(), rewriteManifestForGhPages()],
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
