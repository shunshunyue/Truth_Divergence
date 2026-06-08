import { randomUUID } from "crypto";
import type {
  ActionResult,
  CaseData,
  Evidence,
  FinalDeduction,
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
  const suspectId = action.targetSuspect ?? state.visibleSuspects[0] ?? caseData.suspects[0]?.id;
  if (!suspectId) return { resultText: "这轮问询先作为人物线索记录，需要从现场物件或出入记录里锁定具体对象。" };
  const suspect = caseData.suspects.find((item) => item.id === suspectId);
  if (!suspect) return { resultText: "这条人物指向先记为待核验，需要继续比对案件档案和现场记录。" };

  let unlockedSuspect: SuspectProfile | undefined;
  if (!state.visibleSuspects.includes(suspectId)) {
    if (!action.targetSuspect) return { resultText: "这个人先作为待核验关联对象记录，需要从线索或证据中确认其出场关系。" };
    state.visibleSuspects.push(suspectId);
    unlockedSuspect = suspect;
  }

  if (!state.interviewedSuspects.includes(suspectId)) {
    state.interviewedSuspects.push(suspectId);
  }

  const suspectState = state.suspectStates[suspectId];
  if (!suspectState) return { resultText: `${suspect.name} 当前没有可用的审讯状态。`, unlockedSuspect };

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

  return {
    resultText: `${suspect.name} 已进入审讯记录。压力 ${suspectState.pressure}，信任 ${suspectState.trust}。`,
    unlockedSuspect,
  };
}

function applyUseEvidence(caseData: CaseData, state: PlayerCaseState, action: ParsedAction) {
  const suspectId = action.targetSuspect;
  const evidenceId = action.targetEvidence;

  if (!suspectId || !evidenceId) {
    return "这条追问先记为待核验方向，需要把人物和具体证据对应起来。";
  }

  const suspect = caseData.suspects.find((item) => item.id === suspectId);
  const evidence = caseData.evidence.find((item) => item.id === evidenceId);
  const suspectState = state.suspectStates[suspectId];

  if (!suspect || !evidence || !suspectState) {
    return "这条人证关系先作为假设保留，需要继续补足人物或证据节点。";
  }

  if (!state.discoveredEvidence.includes(evidenceId)) {
    // 玩家不能拿未发现证据追问，这是防止 AI/自然语言越权推进案件的关键规则。
    return "这份材料先作为待调取方向记录，等找到来源或原始记录后再用于追问。";
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

function normalizeMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s"'“”‘’《》<>【】[\]（）()，,。.:：;；、_\-]/g, "")
    .replace(/^提交/, "")
    .replace(/^结案/, "")
    .replace(/^定案/, "")
    .replace(/^答案是/, "")
    .replace(/^我的答案是?/, "")
    .replace(/^我认为/, "")
    .replace(/^我推理/, "")
    .replace(/^最终推理/, "")
    .replace(/^最终答案是?/, "");
}

function meaningfulTerms(text: string) {
  return Array.from(
    new Set(
      text
        .split(/[，。！？；;、\s/|]+/)
        .map((term) => normalizeMatchText(term))
        .filter((term) => term.length >= 2),
    ),
  );
}

function textMatchesTruth(input: string, truthText: string) {
  const normalizedInput = normalizeMatchText(input);
  const normalizedTruth = normalizeMatchText(truthText);
  if (!normalizedTruth) return false;
  if (normalizedInput.includes(normalizedTruth) || normalizedTruth.includes(normalizedInput)) return true;

  const terms = meaningfulTerms(truthText);
  if (!terms.length) return false;
  const hits = terms.filter((term) => normalizedInput.includes(term)).length;
  return hits >= Math.min(2, terms.length);
}

function textMatchesAny(input: string, terms: string[]) {
  return terms.some((term) => textMatchesTruth(input, term));
}

function submittedSuspect(input: string, caseData: CaseData) {
  const normalizedInput = normalizeMatchText(input);
  if (textMatchesAny(input, ["自杀", "自己杀自己", "自行了断", "不是他杀", "无人行凶"])) return undefined;
  return caseData.suspects.find((suspect) =>
    [suspect.id, suspect.name, suspect.identity].some((value) => normalizedInput.includes(normalizeMatchText(value))),
  );
}

function knownEvidenceCount(caseData: CaseData, state: PlayerCaseState) {
  const discovered = new Set(state.discoveredEvidence);
  const discoveredKeyEvidence = caseData.truth.keyEvidence.filter((evidenceId) => discovered.has(evidenceId)).length;
  return Math.max(discoveredKeyEvidence, state.discoveredEvidence.length);
}

function buildFinalDeduction(input: string, caseData: CaseData, state: PlayerCaseState, solved: boolean): FinalDeduction {
  const suspect = submittedSuspect(input, caseData);

  return {
    killer: suspect?.id ?? "",
    motive: solved ? caseData.truth.motive : "",
    method: solved ? caseData.truth.method : "",
    timeline: state.playerTimeline.map((event) => event.id),
    keyEvidence: state.discoveredEvidence.filter((evidenceId) =>
      solved ? caseData.truth.keyEvidence.includes(evidenceId) : true,
    ),
    exclusions: solved ? caseData.truth.exclusionReasons : {},
    report: input,
  };
}

function killerSubmissionCorrect(input: string, caseData: CaseData, suspect: SuspectProfile | undefined) {
  if (suspect) return suspect.id === caseData.truth.killer;

  const killer = caseData.suspects.find((item) => item.id === caseData.truth.killer);
  const killerText = [killer?.name, killer?.identity, ...caseData.truth.hiddenRelationships].filter(Boolean).join(" ");
  const selfHarmAnswer = textMatchesAny(input, ["自杀", "自己杀自己", "自行了断", "不是他杀", "无人行凶"]);
  const truthIsSelfHarm = textMatchesAny(killerText, ["自杀", "自己杀自己", "自行了断", "不是他杀", "无人行凶"]);

  return selfHarmAnswer && truthIsSelfHarm;
}

function evaluateFinalSubmission(input: string, caseData: CaseData, state: PlayerCaseState) {
  const suspect = submittedSuspect(input, caseData);
  const killerCorrect = killerSubmissionCorrect(input, caseData, suspect);
  const motiveMatched = textMatchesTruth(input, caseData.truth.motive);
  const methodMatched = textMatchesTruth(input, caseData.truth.method);
  const timeMatched = textMatchesTruth(input, caseData.truth.deathTime);
  const preSubmitEvaluation = evaluateAgentLoop(caseData, state);
  const evidenceCount = knownEvidenceCount(caseData, state);
  const solved = killerCorrect;
  const score = solved
    ? 100
    : Math.min(
        95,
        Math.max(
          preSubmitEvaluation.truthScore,
          (killerCorrect ? 40 : 0) +
            (motiveMatched ? 18 : 0) +
            (methodMatched ? 18 : 0) +
            (timeMatched ? 10 : 0) +
            Math.min(14, evidenceCount * 2),
        ),
      );

  return {
    evidenceCount,
    killerCorrect,
    methodMatched,
    motiveMatched,
    score,
    solved,
    submittedName: suspect?.name,
    timeMatched,
  };
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
  let finalSubmission: ReturnType<typeof evaluateFinalSubmission> | undefined;

  switch (parsedAction.intent) {
    // 所有玩家自然语言最终都落到这些有限 intent 上。
    // 每个分支只改变自己负责的状态，避免 AI 叙事直接改写游戏事实。
    case "GO_TO_LOCATION": {
      const target = parsedAction.targetLocation;
      if (!target) {
        resultText = "这轮地点指向先记为待核验，可以继续补充地点名、区域或出入记录。";
        break;
      }
      if (!state.unlockedLocations.includes(target)) {
        resultText = "这个地点先作为待核验去向记录，需要通过当前线索确认进入路径。";
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
        resultText = "这条问题先作为待核验线索记录。可以沿当前场景的物件、记录或人员出入继续追。";
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
        : "这条线索已纳入待核验方向，当前需要继续比对现场物件、记录来源或相关人员口供。";
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
        resultText = "这轮查看请求先记为待核验材料，需要继续锁定具体记录或物件来源。";
        break;
      }
      resultText = state.discoveredEvidence.includes(parsedAction.targetEvidence)
        ? `已打开「${caseData.evidence.find((item) => item.id === parsedAction.targetEvidence)?.title ?? "证据"}」。`
        : "这份材料先作为待调取方向记录，需要通过现场或人员线索确认来源。";
      break;
    }
    case "INTERROGATE_SUSPECT":
      {
        const interrogation = applyInterrogation(caseData, state, parsedAction);
        resultText = interrogation.resultText;
        if (interrogation.unlockedSuspect) directlyUnlockedSuspects = [interrogation.unlockedSuspect];
      }
      break;
    case "USE_EVIDENCE":
      resultText = applyUseEvidence(caseData, state, parsedAction);
      break;
    case "BUILD_TIMELINE":
      resultText = `已整理时间线，目前包含 ${state.playerTimeline.length} 个已知事件。`;
      break;
    case "BUILD_RELATIONSHIP":
      {
        const discoveredEvidenceIds = new Set(state.discoveredEvidence);
        const relationshipsById = new Map(state.playerRelationships.map((relationship) => [relationship.id, relationship]));
        caseData.relationships
          .filter(
            (relationship) =>
              relationship.relatedEvidence.length === 0 ||
              relationship.relatedEvidence.some((evidenceId) => discoveredEvidenceIds.has(evidenceId)),
          )
          .forEach((relationship) => relationshipsById.set(relationship.id, relationship));
        state.playerRelationships = Array.from(relationshipsById.values());
      }
      resultText = `关系图已更新，当前包含 ${state.playerRelationships.length} 条人物关系。`;
      break;
    case "ASK_ASSISTANT":
      resultText =
        parsedAction.suggestedFallback ??
        "副手已接入。可以把你的问题当成待核验线索，沿时间戳、现场物件、出入记录和口供矛盾继续推进。";
      break;
    case "SUBMIT_DEDUCTION": {
      finalSubmission = evaluateFinalSubmission(input, caseData, state);
      state.finalDeduction = buildFinalDeduction(input, caseData, state, finalSubmission.solved);
      if (finalSubmission.solved) {
        const killerName =
          caseData.suspects.find((suspect) => suspect.id === caseData.truth.killer)?.name ?? finalSubmission.submittedName ?? "最终责任人";
        resultText = [
          "提交判定：正确。",
          `结论指向「${killerName}」。`,
          `动机：${caseData.truth.motive}`,
          `手法：${caseData.truth.method}`,
          `关键时间：${caseData.truth.deathTime}`,
          "案件已结束。",
        ].join("\n");
      } else {
        const killerName = caseData.suspects.find((suspect) => suspect.id === caseData.truth.killer)?.name ?? "最终责任人";
        resultText = [
          "提交判定：错误。",
          finalSubmission.submittedName
            ? `你提交的「${finalSubmission.submittedName}」不是本案真相指向。`
            : "这份答案没有命中本案真相指向。",
          `正确结论：${killerName}。`,
          `动机：${caseData.truth.motive}`,
          `手法：${caseData.truth.method}`,
          `关键时间：${caseData.truth.deathTime}`,
          "案件已结束。",
        ].join("\n");
      }
      break;
    }
    default:
      resultText = "行动已接收，但该系统模块尚未实现。";
  }

  const newLocations = unlockLocations(caseData, state).filter((location) => !beforeLocations.has(location.id));
  const newEvidence = caseData.evidence.filter(
    (evidence) => state.discoveredEvidence.includes(evidence.id) && !beforeEvidence.has(evidence.id),
  );

  let agentEvaluation = evaluateAgentLoop(caseData, state);
  if (finalSubmission?.solved) {
    agentEvaluation = {
      ...agentEvaluation,
      phase: "solved",
      truthScore: 100,
      isSolved: true,
      agentLogEntry: "玩家最终推理已命中责任人和证据链，案件进入结案。",
    };
  } else if (finalSubmission) {
    agentEvaluation = {
      ...agentEvaluation,
      phase: "failed",
      truthScore: Math.max(agentEvaluation.truthScore, finalSubmission.score),
      agentLogEntry: finalSubmission.killerCorrect
        ? "最终推理方向正确，但提交判定未通过。"
        : "最终推理提交错误，本局调查结束。",
    };
  }
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
