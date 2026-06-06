import { appendFile, mkdir } from "fs/promises";
import path from "path";
import type { AgentClientMessage, AgentEventEnvelope } from "@/game/agent/events";

const startedAt = Date.now();
let writeQueue = Promise.resolve();
let ensureDirPromise: Promise<void> | undefined;

function isEnabled() {
  return process.env.AGENT_EVENT_LOG !== "0";
}

function logFilePath() {
  return process.env.AGENT_EVENT_LOG_FILE?.trim() || path.join(process.cwd(), "agent-events.log");
}

function maxContentChars() {
  const configured = Number(process.env.AGENT_EVENT_LOG_MAX_CHARS);
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  return 2400;
}

function compact(value: unknown, limit = maxContentChars()) {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const text = (raw ?? "").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...[truncated ${text.length - limit} chars]`;
}

function formatField(key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  return `${key}=${JSON.stringify(compact(value))}`;
}

function appendLogLine(fields: Record<string, unknown>) {
  if (!isEnabled()) return;

  const now = Date.now();
  const filePath = logFilePath();
  const lineFields = {
    time: new Date(now).toISOString(),
    elapsedMs: now - startedAt,
    ...fields,
  };
  const line = Object.entries(lineFields)
    .map(([key, value]) => formatField(key, value))
    .filter(Boolean)
    .join(" | ");

  writeQueue = writeQueue
    .then(async () => {
      ensureDirPromise ??= mkdir(path.dirname(filePath), { recursive: true }).then(() => undefined);
      await ensureDirPromise;
      await appendFile(filePath, `${line}\n`, "utf8");
    })
    .catch((error) => {
      console.error("[agent:event-log] write failed", error);
    });
}

function describeEnvelope(envelope: AgentEventEnvelope) {
  const base = {
    kind: "event.enqueue",
    seq: envelope.seq,
    event: envelope.event,
    channel: envelope.channel,
    sessionId: envelope.sessionId,
    priority: envelope.priority,
    scope: envelope.scope,
  };

  if (envelope.event === "agent.status") {
    return { ...base, text: envelope.payload.text };
  }

  if (envelope.event === "agent.delta") {
    return { ...base, textLength: envelope.payload.text.length, text: envelope.payload.text };
  }

  if (envelope.event === "agent.hint") {
    return { ...base, text: envelope.payload.text, commands: envelope.payload.commands };
  }

  if (envelope.event === "agent.error") {
    return { ...base, message: envelope.payload.message };
  }

  if (envelope.event === "agent.refusal") {
    return { ...base, turnId: envelope.payload.turnId, message: envelope.payload.message };
  }

  if (envelope.event === "chat.mode.changed") {
    return { ...base, mode: envelope.payload.mode, label: envelope.payload.label };
  }

  if (envelope.event === "chat.message.started") {
    return {
      ...base,
      turnId: envelope.payload.turnId,
      messageId: envelope.payload.messageId,
      speaker: envelope.payload.speaker,
      suspectId: envelope.payload.suspectId,
      label: envelope.payload.label,
    };
  }

  if (envelope.event === "chat.delta") {
    return {
      ...base,
      turnId: envelope.payload.turnId,
      messageId: envelope.payload.messageId,
      speaker: envelope.payload.speaker,
      suspectId: envelope.payload.suspectId,
      label: envelope.payload.label,
      textLength: envelope.payload.text.length,
      text: envelope.payload.text,
    };
  }

  if (envelope.event === "chat.message.finished") {
    return {
      ...base,
      turnId: envelope.payload.turnId,
      messageId: envelope.payload.messageId,
      speaker: envelope.payload.speaker,
      suspectId: envelope.payload.suspectId,
      label: envelope.payload.label,
      textLength: envelope.payload.text.length,
      text: envelope.payload.text,
    };
  }

  if (envelope.event === "session.ready") {
    return {
      ...base,
      caseTitle: envelope.payload.caseData.title,
      phase: envelope.payload.state.phase,
      resultText: envelope.payload.resultText,
    };
  }

  if (envelope.event === "game.action.result") {
    const { parsedAction } = envelope.payload;
    return {
      ...base,
      resultText: envelope.payload.resultText,
      intent: parsedAction.intent,
      targetLocation: parsedAction.targetLocation,
      targetObject: parsedAction.targetObject,
      targetEvidence: parsedAction.targetEvidence,
      targetSuspect: parsedAction.targetSuspect,
      unlockedEvidence: envelope.payload.unlockedEvidence.length,
      unlockedLocations: envelope.payload.unlockedLocations.length,
      unlockedSuspects: envelope.payload.unlockedSuspects.length,
    };
  }

  if (envelope.event === "game.state.patch") {
    return {
      ...base,
      resultText: envelope.payload.resultText,
      statePatchKeys: Object.keys(envelope.payload.statePatch),
    };
  }

  if (envelope.event === "game.command.finished") {
    return { ...base, resultText: envelope.payload.resultText };
  }

  if (envelope.event === "turn.finished") {
    return { ...base, turnId: envelope.payload.turnId };
  }

  if (envelope.event === "metadata.patch") {
    return {
      ...base,
      metadataScope: envelope.payload.scope,
      mode: envelope.payload.mode,
      summary: envelope.payload.summary,
      added: envelope.payload.added?.length,
      updated: envelope.payload.updated?.length,
      removedIds: envelope.payload.removedIds?.length,
      data: envelope.payload.data,
    };
  }

  return base;
}

export function writeAgentEventLog(envelope: AgentEventEnvelope) {
  appendLogLine(describeEnvelope(envelope));
}

export function writeAgentDispatchLog(envelope: AgentEventEnvelope, subscriberCount: number) {
  appendLogLine({
    kind: "event.flush",
    seq: envelope.seq,
    event: envelope.event,
    channel: envelope.channel,
    sessionId: envelope.sessionId,
    priority: envelope.priority,
    scope: envelope.scope,
    subscriberCount,
  });
}

export function writeAgentClientMessageLog(message: AgentClientMessage) {
  if (message.type === "client.ack") return;

  appendLogLine({
    kind: "client.message",
    type: message.type,
    roomId: message.type === "session.start" || message.type === "session.resume" ? message.roomId : undefined,
    sessionId: message.type === "player.command" || message.type === "session.resume" ? message.sessionId : undefined,
    input: message.type === "player.command" ? message.input : undefined,
  });
}
