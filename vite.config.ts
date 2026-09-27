import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "enforce-worker-engine-boundary",
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== "chunk") continue;
          for (const id of Object.keys(output.modules)) {
            if (/node_modules\/@myanlex\/(application|core)\//.test(id)) {
              this.error(
                "MyanLex runtime entered the main-thread module graph: " + id,
              );
            }
          }
        }
      },
    },
  ],
  worker: { format: "es" },
  build: { manifest: true, sourcemap: false, target: "es2022" },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
