import { randomUUID } from "crypto";
import type { CaseData, PlayerCaseState } from "@/game/schemas/game";
import type { CaseVisualManifest } from "@/game/schemas/visuals";

export type SessionChatMessage = {
  role: "user" | "assistant";
  speaker: "user" | "assistant" | "suspect" | "system";
  text: string;
  label?: string;
  suspectId?: string;
  at: string;
};

export type GameSession = {
  sessionId: string;
  cacheRecordId?: string;
  activatedAt?: string;
  caseData: CaseData;
  state: PlayerCaseState;
  visualManifest?: CaseVisualManifest;
  chatHistory: SessionChatMessage[];
  createdAt: string;
  updatedAt: string;
};

const globalStore = globalThis as typeof globalThis & {
  truthDivergenceSessions?: Map<string, GameSession>;
};

const sessions = globalStore.truthDivergenceSessions ?? new Map<string, GameSession>();
globalStore.truthDivergenceSessions = sessions;

export function createSession(payload: Omit<GameSession, "sessionId" | "createdAt" | "updatedAt" | "chatHistory"> & {
  chatHistory?: SessionChatMessage[];
}) {
  const now = new Date().toISOString();
  const session: GameSession = {
    ...payload,
    chatHistory: payload.chatHistory ?? [],
    sessionId: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };

  sessions.set(session.sessionId, session);
  return session;
}

export function getSession(sessionId: string) {
  return sessions.get(sessionId);
}

export function updateSession(sessionId: string, patch: Partial<Omit<GameSession, "sessionId" | "createdAt">>) {
  const previous = sessions.get(sessionId);
  if (!previous) return undefined;

  const next: GameSession = {
    ...previous,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  sessions.set(sessionId, next);
  return next;
}

export function appendSessionChatMessage(sessionId: string, message: Omit<SessionChatMessage, "at">) {
  const previous = sessions.get(sessionId);
  if (!previous) return undefined;

  const next = updateSession(sessionId, {
    chatHistory: [
      ...previous.chatHistory,
      {
        ...message,
        at: new Date().toISOString(),
      },
    ].slice(-30),
  });

  return next;
}
