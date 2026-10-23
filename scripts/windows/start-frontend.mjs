import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
export const frontendAddress = Object.freeze({ host: "127.0.0.1", port: 3000 });

/** Keep the normal project plugins, but never fall back to another port or LAN. */
export function frontendConfig() {
  return {
    root: projectRoot,
    configFile: resolve(projectRoot, "vite.config.ts"),
    server: { ...frontendAddress, strictPort: true, open: false },
    plugins: [{
      name: "orbis-local-installer",
      enforce: "post",
      config: {
        order: "post",
        handler(config) {
          Object.assign(config.server ??= {}, frontendAddress, { strictPort: true, open: false });
        },
      },
      configResolved(config) {
        if (config.server.host !== frontendAddress.host ||
            config.server.port !== frontendAddress.port ||
            config.server.strictPort !== true) {
          throw new Error("O frontend precisa usar exclusivamente 127.0.0.1:3000.");
        }
      },
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url !== "/__orbis/health" || request.method !== "GET") return next();
          response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          response.end(JSON.stringify({ status: "ok", api: "orbis-local-frontend" }));
        });
      },
    }],
  };
}

/** The injected factory lets the official gate verify startup without a socket. */
export async function startFrontend(createServer) {
  const factory = createServer ?? (await import("vite")).createServer;
  const server = await factory(frontendConfig());
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string" ||
        address.address !== frontendAddress.host || address.port !== frontendAddress.port) {
      throw new Error("O frontend abriu um endereço inesperado; encerrando por segurança.");
    }
    return server;
  } catch (error) {
    await server.close();
    throw error;
  }
}

async function main() {
  process.chdir(projectRoot);
  const server = await startFrontend();
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    try {
      await server.close();
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  console.log("Orbis Scientia: http://127.0.0.1:3000 (somente neste computador)");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
