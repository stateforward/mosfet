import { defineConfig, type Plugin } from "vite";

import { createCollector } from "./collector/collector.ts";

function otelCollectorPlugin(): Plugin {
  return {
    name: "bot-otel-collector",
    async configureServer(server) {
      const collector = await createCollector();
      server.middlewares.use(collector.middleware);
      const shutdown = (): void => {
        collector.grpcServer.forceShutdown();
      };
      server.httpServer?.once("close", shutdown);
    },
  };
}

export default defineConfig({
  plugins: [otelCollectorPlugin()],
  build: {
    rollupOptions: {
      input: { site: "index.html", workshop: "workshop.html", face: "face.html", playground: "playground.html" },
    },
  },
  server: {
    port: 5173,
    // The playground chat talks to the library through the local bridge in ../playground.
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
