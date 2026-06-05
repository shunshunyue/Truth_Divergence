import type { CaseData, ParsedAction, PlayerCaseState } from "@/game/schemas/game";

export type AgentEventChannel = "metadata" | "game" | "agent";
export type AgentEventPriority = "critical" | "normal" | "background";
export type ChatModePayload =
  | { mode: "assistant"; label: string }
  | { mode: "interrogation"; suspectId: string; label: string };

export type ChatSpeaker = "assistant" | "suspect" | "system";

export type ChatMessagePayload = {
  turnId: string;
  messageId: string;
  speaker: ChatSpeaker;
  text?: string;
  suspectId?: string;
  label?: string;
};

export type AgentSessionPayload = {
  sessionId: string;
  caseData: CaseData;
  state: PlayerCaseState;
  resultText?: string;
};

export type AgentPlayerStatePatch = Partial<Omit<PlayerCaseState, "suspectStates">> & {
  suspectStates?: Partial<PlayerCaseState["suspectStates"]>;
};

export type AgentMetadataScope =
  | "case"
  | "currentLocation"
  | "clues"
  | "evidence"
  | "locations"
  | "suspects"
  | "timeline"
  | "relationships"
  | "recommendations";

export type AgentMetadataPatchPayload = {
  sessionId: string;
  scope: AgentMetadataScope;
  mode: "snapshot" | "patch";
  data?: unknown;
  added?: unknown[];
  updated?: unknown[];
  removedIds?: string[];
  summary?: string;
};

export type AgentRuntimeEvent =
  | {
      event: "agent.status";
      channel: "agent";
      payload: { text: string };
    }
  | {
      event: "agent.delta";
      channel: "agent";
      payload: { text: string };
    }
  | {
      event: "agent.hint";
      channel: "agent";
      payload: { text: string; commands?: string[] };
    }
  | {
      event: "agent.error";
      channel: "agent";
      payload: { message: string };
    }
  | {
      event: "agent.refusal";
      channel: "agent";
      payload: {
        turnId: string;
        message: string;
      };
    }
  | {
      event: "chat.mode.changed";
      channel: "agent";
      payload: ChatModePayload;
    }
  | {
      event: "chat.message.started";
      channel: "agent";
      payload: ChatMessagePayload;
    }
  | {
      event: "chat.delta";
      channel: "agent";
      payload: ChatMessagePayload & { text: string };
    }
  | {
      event: "chat.message.finished";
      channel: "agent";
      payload: ChatMessagePayload & { text: string };
    }
  | {
      event: "session.ready";
      channel: "game";
      payload: AgentSessionPayload;
    }
  | {
      event: "game.action.result";
      channel: "game";
      payload: {
        sessionId: string;
        resultText: string;
        parsedAction: ParsedAction;
        unlockedEvidence: CaseData["evidence"];
        unlockedLocations: CaseData["locations"];
        unlockedSuspects: CaseData["suspects"];
      };
    }
  | {
      event: "game.state.patch";
      channel: "game";
      payload: {
        sessionId: string;
        resultText?: string;
        statePatch: AgentPlayerStatePatch;
      };
    }
  | {
      event: "game.command.finished";
      channel: "game";
      payload: {
        sessionId: string;
        resultText?: string;
      };
    }
  | {
      event: "turn.finished";
      channel: "game";
      payload: {
        sessionId: string;
        turnId: string;
      };
    }
  | {
      event: "metadata.patch";
      channel: "metadata";
      payload: AgentMetadataPatchPayload;
    };

export type AgentEventEnvelope = AgentRuntimeEvent & {
  type: "agent.event";
  id: string;
  seq: number;
  sessionId?: string;
  priority: AgentEventPriority;
  scope?: string;
  createdAt: string;
};

export type AgentClientMessage =
  | {
      type: "session.start";
      roomId?: string;
    }
  | {
      type: "player.command";
      sessionId: string;
      input: string;
    }
  | {
      type: "client.ack";
      sessionId?: string;
      lastSeq: number;
    };

export type AgentServerEvent =
  AgentEventEnvelope;

export type AgentEventSender = (event: AgentServerEvent) => void;
