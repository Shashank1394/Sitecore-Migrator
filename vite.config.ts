import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // The renderer is kept with the Electron source rather than at the project root.
  root: "electron/renderer",
  base: "./",

  plugins: [react()],

  server: {
    port: 5173,
    strictPort: true,
  },

  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
  },
});
