import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE_OUTPUT = path.resolve(here, "../data/output");

/**
 * Serve the pipeline's output (data/output, gitignored) at /data/* in dev,
 * and copy it into the build. Run `npm run pipeline` first to generate it.
 */
function pipelineData(): Plugin {
  return {
    name: "pipeline-data",
    configureServer(server) {
      server.middlewares.use("/data", (req, res, next) => {
        const name = path.basename(decodeURIComponent((req.url ?? "").split("?")[0] ?? ""));
        const file = path.join(PIPELINE_OUTPUT, name);
        if (!name || !existsSync(file)) return next();
        res.setHeader("Content-Type", "application/json");
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      if (!existsSync(PIPELINE_OUTPUT)) return;
      for (const name of readdirSync(PIPELINE_OUTPUT)) {
        this.emitFile({ type: "asset", fileName: `data/${name}`, source: readFileSync(path.join(PIPELINE_OUTPUT, name)) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), pipelineData()],
  // MapLibre 6 loads maplibre-gl-worker.mjs relative to its own module URL;
  // pre-bundling moves the module into .vite/deps and breaks that path.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  build: {
    rollupOptions: {
      output: {
        // Emit the MapLibre worker as .js, not .mjs: static hosts (e.g. S3 console uploads) often
        // lack a MIME type for .mjs, and browsers refuse module workers served as octet-stream.
        assetFileNames: (asset) =>
          asset.names?.some((n) => n.endsWith(".mjs")) ? "assets/[name]-[hash].js" : "assets/[name]-[hash][extname]",
      },
    },
  },
});
