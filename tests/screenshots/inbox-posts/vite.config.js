import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const harnessRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** Dev server for the screenshot harness only. The app never serves this folder. */
export default defineConfig({
  root: harnessRoot,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5199,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
});
