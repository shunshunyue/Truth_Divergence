import { randomUUID } from "crypto";
import type {
  ActionResult,
  CaseData,
  Evidence,
  LocationData,
  ParsedAction,
  PlayerCaseState,
  SuspectProfile,
} from "@/game/schemas/game";
import { parseAction } from "@/game/engine/parseAction";
import { evaluateAgentLoop } from "@/game/engine/agentLoop";

function cloneState(state: PlayerCaseState): PlayerCaseState {
  // 引擎以“传入旧状态，返回新状态”的方式工作，避免直接修改 React 客户端持有的对象引用。
  return structuredClone(state);
}

function conditionMet(condition: string, state: PlayerCaseState) {
  // unlockConditions 目前允许引用三类状态：已发现证据、已解锁地点、已审讯嫌疑人。
  // 后续如果增加“章节进度/多人共享事件”，也可以统一扩展到这里。
  return (
    state.discoveredEvidence.includes(condition) ||
    state.unlockedLocations.includes(condition) ||
    state.interviewedSuspects.includes(condition)
  );
}

function areUnlockConditionsMet(conditions: string[], state: PlayerCaseState) {
  return conditions.every((condition) => conditionMet(condition, state));
}

function unlockEvidence(caseData: CaseData, state: PlayerCaseState, evidenceIds: string[]) {
  const unlocked: Evidence[] = [];

  for (const evidenceId of evidenceIds) {
    const evidence = caseData.evidence.find((item) => item.id === evidenceId);
    if (!evidence) continue;
    if (state.discoveredEvidence.includes(evidence.id)) continue;
    if (!areUnlockConditionsMet(evidence.unlockConditions, state)) continue;

    state.discoveredEvidence.push(evidence.id);
    unlocked.push(evidence);

    // 证据被发现后，自动把它关联的时间线事件放入玩家时间线。
    // 玩家看到的是“线索逐步拼出来”，系统内部仍然保留完整真实时间线。
    for (const timelineId of evidence.relatedTimeline) {
      const event = caseData.timeline.find((item) => item.id === timelineId);
      if (event && !state.playerTimeline.some((item) => item.id === event.id)) {
        state.playerTimeline.push(event);
      }
    }
  }

  return unlocked;
}

function unlockSuspects(caseData: CaseData, state: PlayerCaseState, suspectIds: string[]) {
  const unlocked: SuspectProfile[] = [];

  for (const suspectId of suspectIds) {
    const suspect = caseData.suspects.find((item) => item.id === suspectId);
    if (!suspect) continue;
    if (state.visibleSuspects.includes(suspect.id)) continue;

    state.visibleSuspects.push(suspect.id);
    unlocked.push(suspect);
  }

  return unlocked;
}

function unlockSpecificLocations(caseData: CaseData, state: PlayerCaseState, locationIds: string[]) {
  const unlocked: LocationData[] = [];

  for (const locationId of locationIds) {
    const location = caseData.locations.find((item) => item.id === locationId);
    if (!location) continue;
    if (state.unlockedLocations.includes(location.id)) continue;
    if (!areUnlockConditionsMet(location.unlockConditions, state)) continue;

    state.unlockedLocations.push(location.id);
    unlocked.push(location);
  }

  return unlocked;
}

function unlockLocations(caseData: CaseData, state: PlayerCaseState) {
  const unlocked: LocationData[] = [];

  // 地点解锁不只发生在 GO_TO_LOCATION，也可能由证据、审讯或关系图推进触发。
  // 所以每次行动结束后都会统一跑一遍地点解锁检查。
  for (const location of caseData.locations) {
    if (state.unlockedLocations.includes(location.id)) continue;
    if (!areUnlockConditionsMet(location.unlockConditions, state)) continue;
    state.unlockedLocations.push(location.id);
    unlocked.push(location);
  }

  return unlocked;
}

function applyInterrogation(caseData: CaseData, state: PlayerCaseState, action: ParsedAction) {
  const suspectId = action.targetSuspect ?? caseData.suspects[0]?.id;
  if (!suspectId) return "当前没有可审讯的嫌疑人。";
  if (!state.visibleSuspects.includes(suspectId)) return "这个人还没有进入你的调查视野。需要先从线索或证据中确认其关联。";

  const suspect = caseData.suspects.find((item) => item.id === suspectId);
  if (!suspect) return "指定嫌疑人不在当前案件档案中。";

  if (!state.interviewedSuspects.includes(suspectId)) {
    state.interviewedSuspects.push(suspectId);
  }

  const suspectState = state.suspectStates[suspectId];
  if (!suspectState) return `${suspect.name} 当前没有可用的审讯状态。`;

  // 语气只影响状态数值，不直接让嫌疑人吐露隐藏真相。
  // 是否暴露矛盾，仍要靠证据、压力和 breakConditions 继续细化。
  const pressureDelta = action.tone === "aggressive" ? 14 : action.tone === "logical" ? 10 : 6;
  const trustDelta = action.tone === "soft" ? 8 : action.tone === "aggressive" ? -8 : 1;
  suspectState.pressure = Math.min(100, suspectState.pressure + pressureDelta);
  suspectState.trust = Math.max(0, Math.min(100, suspectState.trust + trustDelta));
  suspectState.suspicion = Math.min(100, suspectState.suspicion + 4);

  if (suspectState.pressure > 75) {
    suspectState.currentEmotion = "defensive";
  } else if (suspectState.pressure > 45) {
    suspectState.currentEmotion = "nervous";
  }

  return `${suspect.name} 已进入审讯记录。压力 ${suspectState.pressure}，信任 ${suspectState.trust}。`;
}

function applyUseEvidence(caseData: CaseData, state: PlayerCaseState, action: ParsedAction) {
  const suspectId = action.targetSuspect;
  const evidenceId = action.targetEvidence;

  if (!suspectId || !evidenceId) {
    return "使用证据追问需要同时指定嫌疑人和证据。";
  }

  const suspect = caseData.suspects.find((item) => item.id === suspectId);
  const evidence = caseData.evidence.find((item) => item.id === evidenceId);
  const suspectState = state.suspectStates[suspectId];

  if (!suspect || !evidence || !suspectState) {
    return "当前案件状态下无法使用该嫌疑人或证据。";
  }

  if (!state.discoveredEvidence.includes(evidenceId)) {
    // 玩家不能拿未发现证据追问，这是防止 AI/自然语言越权推进案件的关键规则。
    return "这份证据尚未被发现。";
  }

  if (!suspectState.usedEvidenceAgainstThem.includes(evidenceId)) {
    suspectState.usedEvidenceAgainstThem.push(evidenceId);
  }

  const contradiction = evidence.contradicts.find((item) => item.toLowerCase().includes(suspect.name.toLowerCase()));
  if (contradiction && !suspectState.exposedContradictions.includes(contradiction)) {
    suspectState.exposedContradictions.push(contradiction);
  }

  suspectState.pressure = Math.min(100, suspectState.pressure + (evidence.isKeyEvidence ? 22 : 12));
  suspectState.currentEmotion = suspectState.pressure > 95 ? "broken" : "defensive";

  return `已用「${evidence.title}」追问 ${suspect.name}。矛盾压力上升。`;
}

export function applyAction(input: string, caseData: CaseData, previousState: PlayerCaseState): ActionResult {
  const state = cloneState(previousState);
  const parsedAction = parseAction(input, caseData);
  // 记录行动前状态，用于计算“这次行动新解锁了什么”，方便前端和 AI Director 做 reveal 效果。
  const beforeEvidence = new Set(state.discoveredEvidence);
  const beforeLocations = new Set(state.unlockedLocations);
  let resultText = "";
  let directlyUnlockedSuspects: SuspectProfile[] = [];
  let directlyUnlockedLocations: LocationData[] = [];

  switch (parsedAction.intent) {
    // 所有玩家自然语言最终都落到这些有限 intent 上。
    // 每个分支只改变自己负责的状态，避免 AI 叙事直接改写游戏事实。
    case "GO_TO_LOCATION": {
      const target = parsedAction.targetLocation;
      if (!target) {
        resultText = "没有识别到明确目的地。";
        break;
      }
      if (!state.unlockedLocations.includes(target)) {
        resultText = "该地点仍被当前案件状态锁定。";
        break;
      }
      state.currentLocation = target;
      resultText = `已前往「${caseData.locations.find((item) => item.id === target)?.name ?? target}」。`;
      break;
    }
    case "INVESTIGATE_OBJECT":
    case "REQUEST_EVIDENCE": {
      const currentLocation = caseData.locations.find((item) => item.id === state.currentLocation);
      const targetObject = currentLocation?.objects.find(
        (object) =>
          object.id === parsedAction.targetObject ||
          input.toLowerCase().replace(/\s+/g, "").includes(object.name.toLowerCase().replace(/\s+/g, "")),
      );
      if (!targetObject && !parsedAction.targetEvidence) {
        resultText = "没有在当前场景中找到对应线索点。可以先观察场景描述，或点击左侧可调查线索。";
        break;
      }
      const targetEvidence = parsedAction.targetEvidence ? [parsedAction.targetEvidence] : [];
      const objectEvidence = targetObject?.unlocksEvidence ?? [];
      // 调查物件和请求证据最终都走 unlockEvidence，保证解锁条件只在一个地方判断。
      const unlocked = unlockEvidence(caseData, state, [...targetEvidence, ...objectEvidence]);
      directlyUnlockedSuspects = unlockSuspects(caseData, state, targetObject?.unlocksSuspects ?? []);
      directlyUnlockedLocations = unlockSpecificLocations(caseData, state, targetObject?.unlocksLocations ?? []);
      resultText = unlocked.length
        ? `已解锁证据：${unlocked.map((item) => `「${item.title}」`).join("、")}。`
        : "这次调查暂时没有产生新的可采证据。";
      if (directlyUnlockedSuspects.length) {
        resultText += ` 新出现可调查对象：${directlyUnlockedSuspects.map((item) => `「${item.name}」`).join("、")}。`;
      }
      if (directlyUnlockedLocations.length) {
        resultText += ` 新地点已开放：${directlyUnlockedLocations.map((item) => `「${item.name}」`).join("、")}。`;
      }
      break;
    }
    case "OPEN_EVIDENCE": {
      if (!parsedAction.targetEvidence) {
        resultText = "没有识别到明确证据。";
        break;
      }
      resultText = state.discoveredEvidence.includes(parsedAction.targetEvidence)
        ? `已打开「${caseData.evidence.find((item) => item.id === parsedAction.targetEvidence)?.title ?? "证据"}」。`
        : "这份证据尚未被发现。";
      break;
    }
    case "INTERROGATE_SUSPECT":
      resultText = applyInterrogation(caseData, state, parsedAction);
      break;
    case "USE_EVIDENCE":
      resultText = applyUseEvidence(caseData, state, parsedAction);
      break;
    case "BUILD_TIMELINE":
      resultText = `已整理时间线，目前包含 ${state.playerTimeline.length} 个已知事件。`;
      break;
    case "BUILD_RELATIONSHIP":
      state.playerRelationships = caseData.relationships.filter((relationship) =>
        relationship.relatedEvidence.some((evidenceId) => state.discoveredEvidence.includes(evidenceId)),
      );
      resultText = `关系图已更新，当前包含 ${state.playerRelationships.length} 条有证据支撑的关系。`;
      break;
    case "ASK_ASSISTANT":
      resultText = parsedAction.suggestedFallback ?? "副手已就绪。建议优先关注时间戳冲突，以及被证据支撑的口供矛盾。";
      break;
    case "SUBMIT_DEDUCTION":
      resultText = "最终推理流程已经预留，本阶段暂未提交结算。";
      break;
    default:
      resultText = "行动已接收，但该系统模块尚未实现。";
  }

  const newLocations = unlockLocations(caseData, state).filter((location) => !beforeLocations.has(location.id));
  const newEvidence = caseData.evidence.filter(
    (evidence) => state.discoveredEvidence.includes(evidence.id) && !beforeEvidence.has(evidence.id),
  );

  const agentEvaluation = evaluateAgentLoop(caseData, state);
  state.phase = agentEvaluation.phase;
  state.truthScore = agentEvaluation.truthScore;
  state.agentLog = [...state.agentLog.slice(-5), agentEvaluation.agentLogEntry];

  state.actionHistory.push({
    // 行动历史是未来复盘、多人观战、偏差热力图的基础数据。
    id: randomUUID(),
    at: new Date().toISOString(),
    input,
    parsedAction,
    result: resultText,
  });

  return {
    state,
    parsedAction,
    resultText,
    unlockedEvidence: newEvidence,
    unlockedLocations: [
      ...directlyUnlockedLocations,
      ...newLocations.filter((location) => !directlyUnlockedLocations.some((item) => item.id === location.id)),
    ],
    unlockedSuspects: directlyUnlockedSuspects,
    isSolved: agentEvaluation.isSolved,
    truthScore: agentEvaluation.truthScore,
    agentLogEntry: agentEvaluation.agentLogEntry,
  };
}
