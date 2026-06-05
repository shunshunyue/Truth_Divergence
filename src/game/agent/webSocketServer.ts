import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, type WebSocket } from "ws";
import { getOrCreateRoomAgent } from "@/game/agent/roomAgentRuntime";
import { writeAgentClientMessageLog } from "@/game/agent/eventLog";
import type { AgentClientMessage, AgentServerEvent } from "@/game/agent/events";

function parseClientMessage(raw: WebSocket.RawData): AgentClientMessage {
  const parsed = JSON.parse(raw.toString("utf8")) as Partial<AgentClientMessage>;

  if (parsed.type === "session.start") {
    return {
      type: "session.start",
      roomId: typeof parsed.roomId === "string" ? parsed.roomId : undefined,
    };
  }

  if (parsed.type === "player.command") {
    return {
      type: "player.command",
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : "",
      input: typeof parsed.input === "string" ? parsed.input : "",
    };
  }

  if (parsed.type === "client.ack") {
    return {
      type: "client.ack",
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
      lastSeq: Math.max(0, Math.floor(Number(parsed.lastSeq) || 0)),
    };
  }

  throw new Error("未知 Agent WebSocket 消息。");
}

function sendJson(socket: WebSocket, event: AgentServerEvent) {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(event));
}

export function createAgentWebSocketServer() {
  const server = new WebSocketServer({ noServer: true });

  server.on("connection", (socket) => {
    const send = (event: AgentServerEvent) => sendJson(socket, event);
    let roomAgent = getOrCreateRoomAgent("default");
    let unsubscribe = roomAgent.subscribe(send);

    socket.on("message", (raw) => {
      Promise.resolve()
        .then(async () => {
          const message = parseClientMessage(raw);
          writeAgentClientMessageLog(message);
          console.log(`[agent:ws] received ${message.type}`);

          if (message.type === "session.start") {
            const nextRoomAgent = getOrCreateRoomAgent(message.roomId ?? "default");
            if (nextRoomAgent !== roomAgent) {
              unsubscribe();
              roomAgent = nextRoomAgent;
              unsubscribe = roomAgent.subscribe(send);
            }
            await roomAgent.start();
            return;
          }

          if (message.type === "client.ack") {
            roomAgent.ack(message.lastSeq);
            return;
          }

          console.log(`[agent:ws] player.command session=${message.sessionId} input=${message.input}`);
          await roomAgent.command(message.sessionId, message.input);
        })
        .catch((error) => {
          console.error("[agent:ws] failed", error);
          roomAgent.reportError(error instanceof Error ? error.message : "Agent WebSocket 处理失败。");
        });
    });

    socket.on("close", () => {
      unsubscribe();
    });
  });

  return {
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
      server.handleUpgrade(request, socket, head, (client) => {
        server.emit("connection", client, request);
      });
    },
  };
}
