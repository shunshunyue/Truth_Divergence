import type { CaseData, Evidence, PlayerCaseState } from "@/game/schemas/game";

function normalizeMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s"'“”‘’《》<>【】[\]（）()，,。.:：;；、_\-]/g, "");
}

function compactValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(compactValue).filter(Boolean).join("\n");
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map(compactValue).filter(Boolean).join("\n");
  return String(value);
}

function evidenceText(evidence: Evidence) {
  return normalizeMatchText(
    [
      evidence.title,
      evidence.type,
      evidence.source,
      compactValue(evidence.visibleData),
      evidence.proves.join("\n"),
      evidence.contradicts.join("\n"),
      evidence.supports.join("\n"),
    ].join("\n"),
  );
}

function hasAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(normalizeMatchText(keyword)));
}

function discoveredEvidence(caseData: CaseData, state: PlayerCaseState) {
  const discoveredIds = new Set(state.discoveredEvidence);
  return caseData.evidence.filter((evidence) => discoveredIds.has(evidence.id));
}

function visibleKiller(caseData: CaseData, state: PlayerCaseState) {
  return state.visibleSuspects.includes(caseData.truth.killer)
    ? caseData.suspects.find((suspect) => suspect.id === caseData.truth.killer)
    : undefined;
}

function focalSuspect(caseData: CaseData, state: PlayerCaseState, evidence: Evidence[]) {
  const killer = visibleKiller(caseData, state);
  if (killer) return killer;

  const suspects = caseData.suspects.filter((suspect) => state.visibleSuspects.includes(suspect.id));
  const timelineText = state.playerTimeline.map((event) => `${event.time}\n${event.description}`).join("\n");
  const relationshipText = state.playerRelationships.map((relationship) => relationship.label).join("\n");
  const haystack = normalizeMatchText(`${evidence.map(evidenceText).join("\n")}\n${timelineText}\n${relationshipText}`);
  const scored = suspects
    .map((suspect) => {
      const terms = [suspect.id, suspect.name, suspect.identity]
        .map(normalizeMatchText)
        .filter((term) => term.length >= 2);
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { score, suspect };
    })
    .sort((left, right) => right.score - left.score);

  return scored[0]?.score ? scored[0].suspect : suspects[0];
}

function hasEvidenceMatching(evidence: Evidence[], keywords: string[]) {
  return evidence.some((item) => hasAny(evidenceText(item), keywords));
}

function hasTimelineMatching(state: PlayerCaseState, keywords: string[]) {
  return state.playerTimeline.some((event) =>
    hasAny(normalizeMatchText(`${event.time}\n${event.description}\n${event.source}`), keywords),
  );
}

function pushUnique(commands: string[], command: string) {
  if (!commands.includes(command)) commands.push(command);
}

export function buildRecommendedCommands(caseData: CaseData, state: PlayerCaseState) {
  const evidence = discoveredEvidence(caseData, state);
  const clues = caseData.locations
    .find((location) => location.id === state.currentLocation)
    ?.objects.filter((object) => object.visibleConditions.every((condition) => state.discoveredEvidence.includes(condition))) ?? [];
  const locations = caseData.locations.filter((location) => state.unlockedLocations.includes(location.id));
  const suspect = focalSuspect(caseData, state, evidence);
  const commands: string[] = [];

  const hasLedger = hasEvidenceMatching(evidence, ["账册", "对账", "异常批次", "货签", "次日报", "高价货", "财务", "票据"]);
  const hasMonitor = hasEvidenceMatching(evidence, ["监控", "控制台", "静音", "门磁", "断流", "录像", "摄像"]);
  const hasPower = hasEvidenceMatching(evidence, ["配电", "复位", "断电", "短时", "维保"]);
  const hasDoorTrace = hasEvidenceMatching(evidence, ["分拣间", "内门", "拖蹭", "颈", "肩", "门边", "痕迹", "伤痕"]);
  const hasAccessLog = hasEvidenceMatching(evidence, ["门岗", "门禁", "出入", "进出", "补录", "调车", "放行"]);
  const hasRouteGap =
    hasTimelineMatching(state, ["路线空档", "空档", "不在场", "外场", "冷库", "时间线"]) ||
    hasEvidenceMatching(evidence, ["路线空档", "空档", "不在场", "外场", "冷库", "路线"]);
  const hasCallOrPosition = hasEvidenceMatching(evidence, ["通话", "电话", "基站", "定位", "位置", "本机日志"]);
  const hasForensicTool = hasEvidenceMatching(evidence, ["痕检", "鉴定", "工具", "工具箱", "颈后", "压制", "击打"]);
  const hasFalseLeadReview =
    hasEvidenceMatching(evidence, ["秦卫", "补录", "林雪", "维保", "排除", "误导"]) &&
    state.playerRelationships.length > 0;

  if (!hasLedger) {
    pushUnique(commands, "调查账册、票据或异常记录，核对动机和利益冲突");
  }
  if ((hasLedger || hasAccessLog || hasMonitor) && !hasRouteGap && suspect) {
    pushUnique(commands, `整理时间线：对比${suspect.name}关键时段的电话、出入记录、现场触发和监控断流`);
  }
  if ((hasRouteGap || hasMonitor || hasAccessLog) && !hasCallOrPosition && suspect) {
    pushUnique(commands, `核对${suspect.name}关键时段的通话详单、定位和现场设备本机操作日志`);
  }
  if ((hasDoorTrace || hasCallOrPosition) && !hasForensicTool && suspect) {
    pushUnique(commands, `调查伤痕、现场接触点和${suspect.name}常用工具或随身物件的痕检对应`);
  }
  if ((hasPower || hasMonitor || hasCallOrPosition) && !hasFalseLeadReview) {
    pushUnique(commands, "整理人物关系图：区分核心冲突、流程补录和技术/设备误导线");
  }
  if (state.phase === "closing" || (evidence.length >= 5 && suspect)) {
    const name = suspect?.name ?? "责任人";
    pushUnique(commands, `提交最终推理：责任人是${name}，说明动机、手法、关键时间线和排除理由`);
  }

  for (const clue of clues) {
    pushUnique(commands, `调查${clue.name}`);
    if (commands.length >= 5) break;
  }
  for (const location of locations.filter((location) => location.id !== state.currentLocation)) {
    pushUnique(commands, `前往${location.name}`);
    if (commands.length >= 5) break;
  }
  if (suspect) pushUnique(commands, `审问${suspect.name}，用已发现记录逻辑追问`);
  pushUnique(commands, "整理时间线");

  return commands.slice(0, 5);
}
