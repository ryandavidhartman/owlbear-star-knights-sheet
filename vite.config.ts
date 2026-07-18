import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
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
});
