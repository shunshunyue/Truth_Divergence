import type { ActionResult, CaseData, ParsedAction, PlayerCaseState, SuspectProfile } from "@/game/schemas/game";

export type ChatMode =
  | { mode: "assistant"; label: string }
  | { mode: "interrogation"; suspectId: string; label: string };

export type ChatRoute =
  | { kind: "off_topic"; reason: string }
  | { kind: "spoiler_request"; reason: string }
  | { kind: "start_interrogation"; suspect: SuspectProfile }
  | { kind: "suspect_question"; suspect: SuspectProfile }
  | { kind: "case_assistant" };

export const offTopicReply =
  "我在，但我这边先守着这起案子的调查。你想查监控、门禁、证词，还是让我先帮你捋一遍已有线索？";

export const spoilerRequestReply =
  "我不能直接替你定最终责任人。我们先按证据往下拆，我可以帮你比对人物动机、机会和口供矛盾。";

export function buildRefusalReply(route: Extract<ChatRoute, { kind: "off_topic" | "spoiler_request" }>) {
  return route.kind === "off_topic" ? offTopicReply : spoilerRequestReply;
}

const offTopicKeywords = [
  "天气",
  "日报",
  "周报",
  "代码",
  "股票",
  "新闻",
  "笑话",
  "翻译",
  "写邮件",
  "写文案",
];

const spoilerPatterns = [
  "谁最可疑",
  "谁是责任人",
  "谁负责",
  "谁干的",
  "谁是凶手",
  "真凶是谁",
  "直接告诉我答案",
  "告诉我真相",
  "最终答案",
  "最终责任人",
  "凶手",
];

function normalize(input: string) {
  return input.toLowerCase().replace(/\s+/g, "");
}

function mentionedSuspect(input: string, caseData: CaseData) {
  const text = normalize(input);
  return caseData.suspects.find((suspect) =>
    [suspect.id, suspect.name].some((value) => text.includes(normalize(value))),
  );
}

function mentionedVisibleSuspect(input: string, caseData: CaseData, state: PlayerCaseState) {
  const suspect = mentionedSuspect(input, caseData);
  if (!suspect || !state.visibleSuspects.includes(suspect.id)) return undefined;
  return suspect;
}

function visibleSuspectById(id: string | undefined, caseData: CaseData, state: PlayerCaseState) {
  if (!id || !state.visibleSuspects.includes(id)) return undefined;
  return caseData.suspects.find((suspect) => suspect.id === id);
}

function wantsAssistantWhileInterrogating(text: string) {
  return /助手|帮我|总结|整理|复盘|分析|关系图|时间线|查|调查|调取|查看|打开|翻|监控|门禁|账册|记录|日志|证据/.test(text);
}

function looksLikeDirectSuspectQuestion(text: string) {
  return /^(你|你们)|你和|你跟|你认识|你当时|你为什么|你几点|你有没有|你是不是|你到底|说清楚|解释/.test(text);
}

export function routeChatCommand(
  input: string,
  caseData: CaseData,
  state: PlayerCaseState,
  currentMode: ChatMode,
  parsedAction: ParsedAction,
): ChatRoute {
  const text = normalize(input);
  const hasCaseEntity = Boolean(
    mentionedVisibleSuspect(input, caseData, state) ||
      caseData.evidence.some((item) => text.includes(normalize(item.title)) || text.includes(normalize(item.id))) ||
      caseData.locations.some((item) => text.includes(normalize(item.name)) || text.includes(normalize(item.id))),
  );

  if (!hasCaseEntity && offTopicKeywords.some((keyword) => text.includes(normalize(keyword)))) {
    return { kind: "off_topic", reason: offTopicReply };
  }

  if (spoilerPatterns.some((keyword) => text.includes(normalize(keyword)))) {
    return { kind: "spoiler_request", reason: spoilerRequestReply };
  }

  const suspect =
    mentionedVisibleSuspect(input, caseData, state) ?? visibleSuspectById(parsedAction.targetSuspect, caseData, state);
  const wantsInterrogation =
    parsedAction.intent === "INTERROGATE_SUSPECT" ||
    text.includes("审问") ||
    text.includes("询问") ||
    text.includes("问话") ||
    text.includes("对话") ||
    text.includes("追问");

  if (wantsInterrogation && suspect) {
    return { kind: "start_interrogation", suspect };
  }

  if (currentMode.mode === "interrogation") {
    const activeSuspect = visibleSuspectById(currentMode.suspectId, caseData, state);
    if (activeSuspect && looksLikeDirectSuspectQuestion(text) && !wantsAssistantWhileInterrogating(text)) {
      return { kind: "suspect_question", suspect: activeSuspect };
    }
    if (activeSuspect && ["ASK_ASSISTANT", "INTERROGATE_SUSPECT", "USE_EVIDENCE"].includes(parsedAction.intent)) {
      return { kind: "suspect_question", suspect: activeSuspect };
    }
  }

  return { kind: "case_assistant" };
}

function evidenceTitles(caseData: CaseData, state: PlayerCaseState) {
  return caseData.evidence
    .filter((evidence) => state.discoveredEvidence.includes(evidence.id))
    .map((evidence) => `「${evidence.title}」`);
}

function asksForAdvice(input: string) {
  return /下一步|建议|怎么查|查哪里|怎么办|方向|计划|该问谁|先查/.test(input);
}

function currentLocation(caseData: CaseData, state: PlayerCaseState) {
  return caseData.locations.find((location) => location.id === state.currentLocation);
}

export function buildAssistantReply(
  input: string,
  caseData: CaseData,
  state: PlayerCaseState,
  result: ActionResult,
) {
  const location = currentLocation(caseData, state);
  const evidence = evidenceTitles(caseData, state).slice(-4);
  const genericAssistantText = result.resultText.includes("副手已接入")
    ? "我先不硬造新东西，就按你手上已经亮出来的线索往下捋。"
    : result.resultText;
  const lines = [
    genericAssistantText ? `我先按这轮结果看：${genericAssistantText}` : "",
    result.unlockedEvidence.length
      ? `刚归进去 ${result.unlockedEvidence.length} 份新材料。`
      : "",
  ].filter(Boolean);

  if (asksForAdvice(input)) {
    lines.push(
      evidence.length
        ? `眼前能先对的是 ${evidence.slice(0, 2).join("、")}。`
        : location
          ? `先贴着「${location.name}」里已经露出的记录看。`
          : "先从已经出现过的记录和口供矛盾里挑一个点追。",
    );
  }

  if (input.includes("总结") || input.includes("整理")) {
    lines.unshift("行，我先把手上的东西捋一遍，不急着下结论。");
  }

  return lines.slice(0, 3).join("\n");
}

export function buildSuspectReply(
  suspect: SuspectProfile,
  state: PlayerCaseState,
  result: ActionResult,
) {
  const suspectState = state.suspectStates[suspect.id];
  const emotion = suspectState?.currentEmotion ?? "calm";
  const pressure = suspectState?.pressure ?? 0;
  const usedEvidenceCount = suspectState?.usedEvidenceAgainstThem.length ?? 0;
  const contradictions = suspectState?.exposedContradictions ?? [];

  const opener =
    emotion === "defensive"
      ? "你们一直绕着同一个问题打转。"
      : emotion === "nervous"
        ? "我记得不是很完整，但我没必要骗你们。"
        : emotion === "angry"
          ? "这种问法是在给我定罪吗？"
          : emotion === "broken"
            ? "……我需要一点时间。"
            : suspect.publicStatement;

  const pressureLine =
    pressure > 75
      ? "他回答前停顿很久，语速明显慢了下来。"
      : pressure > 45
        ? "他的视线短暂避开屏幕，像是在重新组织说法。"
        : "他的语气还算稳定。";

  const evidenceLine = usedEvidenceCount
    ? "那份材料我看到了，但它不代表你们想证明的全部。"
    : "你们要是怀疑我，就把具体记录拿出来问。";

  const contradictionLine = contradictions.length
    ? `你们说的矛盾点，我只能解释到这里：${contradictions[contradictions.length - 1]}。`
    : "我已经把我知道的说了。";

  return [pressureLine, `「${opener}」`, `「${evidenceLine}」`, `「${contradictionLine}」`, result.resultText]
    .filter(Boolean)
    .join("\n");
}
