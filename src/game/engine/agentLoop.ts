import type { CaseData, PlayerCaseState } from "@/game/schemas/game";

export type AgentLoopEvaluation = {
  agentLogEntry: string;
  discoveredKeyEvidence: string[];
  isSolved: boolean;
  knownKeyTimeline: string[];
  phase: PlayerCaseState["phase"];
  truthScore: number;
};

export function evaluateAgentLoop(caseData: CaseData, state: PlayerCaseState): AgentLoopEvaluation {
  const discoveredKeyEvidence = caseData.truth.keyEvidence.filter((evidenceId) =>
    state.discoveredEvidence.includes(evidenceId),
  );
  const knownKeyTimeline = caseData.truth.keyTimeline.filter((timelineId) =>
    state.playerTimeline.some((event) => event.id === timelineId),
  );
  const killerVisible = state.visibleSuspects.includes(caseData.truth.killer);
  const motiveKnown =
    caseData.truth.keyEvidence.length > 0 &&
    caseData.truth.keyEvidence.some((evidenceId) => state.discoveredEvidence.includes(evidenceId));

  const evidenceScore = caseData.truth.keyEvidence.length
    ? Math.round((discoveredKeyEvidence.length / caseData.truth.keyEvidence.length) * 45)
    : Math.min(30, state.discoveredEvidence.length * 8);
  const timelineScore = caseData.truth.keyTimeline.length
    ? Math.round((knownKeyTimeline.length / caseData.truth.keyTimeline.length) * 25)
    : Math.min(20, state.playerTimeline.length * 6);
  const suspectScore = killerVisible ? 15 : 0;
  const motiveScore = motiveKnown ? 15 : 0;
  const truthScore = Math.min(100, evidenceScore + timelineScore + suspectScore + motiveScore);

  const isSolved =
    truthScore >= 90 &&
    killerVisible &&
    motiveKnown &&
    caseData.truth.keyEvidence.length > 0 &&
    caseData.truth.keyEvidence.every((evidenceId) => state.discoveredEvidence.includes(evidenceId));

  const phase: PlayerCaseState["phase"] = isSolved
    ? "solved"
    : truthScore >= 70
      ? "closing"
      : state.actionHistory.length > 0
        ? "investigating"
        : "opening";

  const missingEvidence = caseData.truth.keyEvidence.filter((evidenceId) => !state.discoveredEvidence.includes(evidenceId));
  const agentLogEntry = isSolved
    ? "后台 Agent 已确认关键证据链闭合，案件自动进入结案。"
    : missingEvidence.length
      ? `后台 Agent 正在监控证据链，仍缺少 ${missingEvidence.length} 个关键证据节点。`
      : "后台 Agent 认为证据链接近闭合，等待动机、时间线或嫌疑人状态进一步确认。";

  return {
    phase,
    truthScore,
    isSolved,
    agentLogEntry,
    discoveredKeyEvidence,
    knownKeyTimeline,
  };
}
