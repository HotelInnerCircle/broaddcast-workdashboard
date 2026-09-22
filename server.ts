/**
 * Custom Node server: hosts Next.js and Socket.IO on a single port (spec §3.1 / §3.3).
 * The realtime layer is isolated behind lib/realtime so feature code never touches Socket.IO directly.
 */
import { loadEnvConfig } from "@next/env";
import { createServer } from "node:http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { attachRealtime } from "./lib/realtime/socketio";
import { startJobs } from "./lib/jobs";
import { bootstrapPlatform } from "./lib/bootstrap";
import { runStartupChecks } from "./lib/security/startup-checks";

const dev = process.env.NODE_ENV !== "production";
loadEnvConfig(process.cwd(), dev);
runStartupChecks();
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const httpServer = createServer((req, res) => handle(req, res));
  const io = new SocketIOServer(httpServer, {
    path: "/socket.io",
    cors: { origin: process.env.APP_URL ?? `http://localhost:${port}`, credentials: true },
  });
  attachRealtime(io);
  await bootstrapPlatform().catch((e) => console.error("[bootstrap] failed:", e?.message ?? e));
  startJobs();

  httpServer.listen(port, hostname, () => {
    console.log(`> WorkPulse ready on http://localhost:${port} (${dev ? "development" : "production"})`);
  });
}

main().catch((err) => {
  console.error("Fatal: failed to start server", err);
  process.exit(1);
});
