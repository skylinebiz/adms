import { config } from "./config";
import { appLogger as logger } from "./logger";
import { seedBootstrapAdmin } from "./admin/seed";
import { buildApp } from "./app";

async function main() {
  await seedBootstrapAdmin();

  const app = buildApp();

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, "ADMS server listening");
  });

  // Socket-level visibility, beneath Express entirely: a client that opens
  // TCP but never sends a parseable HTTP request (garbage bytes, or - the
  // classic device misconfiguration - a TLS/HTTPS handshake against this
  // plain-HTTP port) never reaches any middleware, so the [req] logging
  // above can't see it. These two hooks make even that show up.
  //
  // Note: with docker-compose port publishing, remoteAddress is Docker's
  // proxy/gateway IP for every client, not the device's real LAN IP - the
  // value here is seeing THAT something connected, not who.
  server.on("connection", (socket) => {
    console.log(`[tcp] connection from ${socket.remoteAddress}:${socket.remotePort}`);
  });
  server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
    console.log(
      `[tcp] client error: ${err.code ?? err.message} - connection sent something that isn't valid HTTP for this port (TLS/HTTPS against plain HTTP? raw garbage?)`
    );
    // Per Node docs: attaching a clientError listener takes over closing
    // the socket - reply with a minimal 400 if still possible, never leak it.
    if (err.code !== "ECONNRESET" && socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    } else {
      socket.destroy();
    }
  });
}

main().catch((err) => {
  logger.error({ err }, "server failed to start");
  process.exit(1);
});
