import { createServer } from "http";
import { config } from "dotenv";
import { networkInterfaces } from "os";
import next from "next";
import { createAgentWebSocketServer } from "@/game/agent/webSocketServer";

config({ path: ".env.local", quiet: true });

const dev = process.argv.includes("--prod") ? false : process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const agentWs = createAgentWebSocketServer();

function getLanAddresses() {
  return Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}

app.prepare().then(() => {
  const server = createServer((request, response) => {
    handle(request, response);
  });

  const nextUpgradeHandler = app.getUpgradeHandler();

  server.on("upgrade", (request, socket, head) => {
    const pathname = request.url ? new URL(request.url, `http://${request.headers.host ?? "localhost"}`).pathname : "";

    if (pathname === "/ws/agent") {
      agentWs.handleUpgrade(request, socket, head);
      return;
    }

    nextUpgradeHandler(request, socket, head);
  });

  server.listen(port, hostname, () => {
    console.log(`Truth Divergence ready on http://${hostname}:${port}`);
    console.log(`Investigation Agent WebSocket ready on ws://${hostname}:${port}/ws/agent`);
    getLanAddresses().forEach((address) => {
      console.log(`LAN access ready on http://${address}:${port}`);
    });
  });
});
