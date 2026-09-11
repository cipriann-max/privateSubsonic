import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    reporters: "default",
  },
  resolve: {
    // Vitest understands TS sources directly; .js extension imports resolve
    // to the .ts files via this alias-free native behavior in NodeNext + tsx.
    alias: {},
  },
  esbuild: {
    target: "es2022",
  },
  root: path.dirname(new URL(import.meta.url).pathname),
});