import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The server serves web/dist in production; in dev, Vite proxies /rest to it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/rest": `http://localhost:${process.env.PORT ?? 3000}`,
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});