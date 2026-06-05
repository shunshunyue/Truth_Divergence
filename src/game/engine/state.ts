import type { CaseData, PlayerCaseState, SuspectState } from "@/game/schemas/game";

export function createInitialPlayerState(caseData: CaseData, playerId = "local-player"): PlayerCaseState {
  const suspectStates = Object.fromEntries(
    caseData.suspects.map((suspect) => [
      suspect.id,
      {
        pressure: 12,
        trust: 45,
        suspicion: suspect.opportunityLevel > 70 ? 40 : 20,
        exposedContradictions: [],
        usedEvidenceAgainstThem: [],
        currentEmotion: "calm",
        relationshipWithPlayer: "guarded",
      } satisfies SuspectState,
    ]),
  );

  const firstLocation = caseData.locations[0]?.id ?? "";

  return {
    playerId,
    caseId: caseData.id,
    phase: "opening",
    truthScore: 0,
    agentLog: [`开场事件：${caseData.openingEvent.headline}`],
    currentLocation: firstLocation,
    discoveredEvidence: [],
    unlockedLocations: caseData.locations
      .filter((location) => location.unlockConditions.length === 0)
      .map((location) => location.id),
    visibleSuspects: [],
    interviewedSuspects: [],
    suspectStates,
    playerTimeline: [],
    playerRelationships: [],
    notes: ["已接收初始案件通知。详细证据、嫌疑人和时间线需要通过线索逐步确认。"],
    actionHistory: [],
  };
}
