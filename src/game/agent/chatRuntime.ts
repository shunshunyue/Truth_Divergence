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
  "谁是凶手",
  "真凶是谁",
  "直接告诉我答案",
  "告诉我真相",
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

function visibleSuspectById(id: string | undefined, caseData: CaseData, state: PlayerCaseState) {
  if (!id || !state.visibleSuspects.includes(id)) return undefined;
  return caseData.suspects.find((suspect) => suspect.id === id);
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
    mentionedSuspect(input, caseData) ||
      caseData.evidence.some((item) => text.includes(normalize(item.title)) || text.includes(normalize(item.id))) ||
      caseData.locations.some((item) => text.includes(normalize(item.name)) || text.includes(normalize(item.id))),
  );

  if (!hasCaseEntity && offTopicKeywords.some((keyword) => text.includes(normalize(keyword)))) {
    return { kind: "off_topic", reason: "当前窗口只接入本案调查，不处理普通办公问答。" };
  }

  if (spoilerPatterns.some((keyword) => text.includes(normalize(keyword)))) {
    return { kind: "spoiler_request", reason: "我不能替你直接给出嫌疑结论，只能基于已发现证据帮你比较矛盾。" };
  }

  const suspect = mentionedSuspect(input, caseData) ?? visibleSuspectById(parsedAction.targetSuspect, caseData, state);
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
  const lines = [
    result.resultText,
    location ? `当前焦点仍在「${location.name}」。` : "",
    evidence.length ? `最近可用证据：${evidence.join("、")}。` : "证据链还很薄，优先调查当前场景的可疑物件。",
    result.unlockedEvidence.length
      ? `这轮新增了 ${result.unlockedEvidence.length} 份证据，左侧证据索引会同步更新。`
      : "",
    "你可以继续让我整理时间线、比较口供，或者指定某个人进入问询。",
  ].filter(Boolean);

  if (input.includes("总结") || input.includes("整理")) {
    lines.unshift("我先按已知事实做一版工作摘要。");
  }

  return lines.join("\n");
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
    ? "那份证据我看到了，但它不代表你们想证明的全部。"
    : "如果你们有证据，就直接拿出来。";

  const contradictionLine = contradictions.length
    ? `你们说的矛盾点，我只能解释到这里：${contradictions[contradictions.length - 1]}。`
    : "我已经把我知道的说了。";

  return [pressureLine, `「${opener}」`, `「${evidenceLine}」`, `「${contradictionLine}」`, result.resultText]
    .filter(Boolean)
    .join("\n");
}
