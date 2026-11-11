import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ command }) => ({
  root: fileURLToPath(new URL("./frontend", import.meta.url)),
  // Read VITE_API_BASE_URL from the repo-root .env, the same file the API uses.
  envDir: repoRoot,
  plugins: [react()],
  base: command === "serve" ? "/" : "/static/build/",
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/media": "http://127.0.0.1:8000",
      "/static/uploads": "http://127.0.0.1:8000",
      "/privacy": "http://127.0.0.1:8000",
      "/terms": "http://127.0.0.1:8000",
      "/docs": "http://127.0.0.1:8000",
      "/openapi.json": "http://127.0.0.1:8000",
    },
  },
  build: {
    outDir: "static/build",
    emptyOutDir: true,
  },
}));
