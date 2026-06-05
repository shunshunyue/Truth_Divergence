import type { AgentClientMessage, AgentServerEvent } from "@/game/agent/events";

export type AgentSocketHandlers = {
  onEvent: (event: AgentServerEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (message: string) => void;
};

function buildAgentSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/agent`;
}

export function connectAgentSocket(handlers: AgentSocketHandlers) {
  const socket = new WebSocket(buildAgentSocketUrl());

  socket.addEventListener("open", () => handlers.onOpen?.());
  socket.addEventListener("close", () => handlers.onClose?.());
  socket.addEventListener("error", () => handlers.onError?.("Investigation Agent WebSocket 连接失败。"));
  socket.addEventListener("message", (event) => {
    try {
      const parsed = JSON.parse(event.data) as AgentServerEvent;
      handlers.onEvent(parsed);
      if (parsed.type === "agent.event") {
        socket.send(JSON.stringify({ type: "client.ack", sessionId: parsed.sessionId, lastSeq: parsed.seq }));
      }
    } catch {
      handlers.onError?.("Investigation Agent 返回了无法解析的消息。");
    }
  });

  return {
    close() {
      socket.close();
    },
    isOpen() {
      return socket.readyState === WebSocket.OPEN;
    },
    send(message: AgentClientMessage) {
      if (socket.readyState !== WebSocket.OPEN) {
        throw new Error("Investigation Agent WebSocket 尚未连接。");
      }

      socket.send(JSON.stringify(message));
    },
  };
}
