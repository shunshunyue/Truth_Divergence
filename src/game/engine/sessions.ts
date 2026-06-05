import { randomUUID } from "crypto";
import type { CaseData, PlayerCaseState } from "@/game/schemas/game";

export type GameSession = {
  sessionId: string;
  caseData: CaseData;
  state: PlayerCaseState;
  createdAt: string;
  updatedAt: string;
};

const globalStore = globalThis as typeof globalThis & {
  truthDivergenceSessions?: Map<string, GameSession>;
};

const sessions = globalStore.truthDivergenceSessions ?? new Map<string, GameSession>();
globalStore.truthDivergenceSessions = sessions;

export function createSession(payload: Omit<GameSession, "sessionId" | "createdAt" | "updatedAt">) {
  const now = new Date().toISOString();
  const session: GameSession = {
    ...payload,
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
