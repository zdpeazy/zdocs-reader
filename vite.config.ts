import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error Local development plugin is authored as a Node ESM module.
import { larkApiPlugin } from "./server/vite-lark-plugin.mjs";

export default defineConfig({
  plugins: [react(), larkApiPlugin()],
  server: { port: 4173 },
});
