import type { CaseData, ParsedAction } from "@/game/schemas/game";

// 第一版解析器采用“有限意图 + 名称匹配”的规则系统。
// 后面可以替换成 AI Action Parser，但输出仍应保持 ParsedAction 这个结构。
const intentKeywords: Array<[ParsedAction["intent"], string[]]> = [
  ["GO_TO_LOCATION", ["go", "drive", "walk", "enter", "前往", "去", "开车", "进入"]],
  ["INTERROGATE_SUSPECT", ["interrogate", "question", "ask", "审问", "询问", "追问"]],
  ["USE_EVIDENCE", ["use", "press", "confront", "用", "拿", "出示", "质问"]],
  ["OPEN_EVIDENCE", ["open", "view", "check", "查看", "打开", "调取"]],
  ["REQUEST_EVIDENCE", ["request", "pull", "retrieve", "调取", "申请"]],
  ["INVESTIGATE_OBJECT", ["inspect", "investigate", "search", "调查", "检查", "查看", "检修", "维修", "修过", "动过", "记录"]],
  ["BUILD_TIMELINE", ["timeline", "时间线", "轨迹"]],
  ["BUILD_RELATIONSHIP", ["relationship", "关系图", "关系"]],
  ["ASK_ASSISTANT", ["assistant", "hint", "help", "助手", "提示", "帮我"]],
  ["SUBMIT_DEDUCTION", ["submit", "deduction", "truth", "提交", "推理", "真凶"]],
];

function normalize(input: string) {
  // 中文玩家常常不输入空格，比如“用23:08后门门禁记录追问周启明”。
  // 去空格后再匹配，可以同时兼容 UI 展示名和自然输入。
  return input.toLowerCase().replace(/\s+/g, "").trim();
}

function findNameMatch(input: string, items: Array<{ id: string; name?: string; title?: string }>) {
  const lowered = normalize(input);
  return items.find((item) => {
    const candidates = [item.id, item.name, item.title].filter(Boolean) as string[];
    return candidates.some((candidate) => lowered.includes(normalize(candidate)));
  });
}

function looksLikeFactFindingQuestion(input: string) {
  const lowered = normalize(input);
  return ["谁", "怎么", "为什么", "何时", "什么时候", "哪里", "哪儿", "是否", "有没有", "是不是"].some((keyword) =>
    lowered.includes(normalize(keyword)),
  );
}

export function parseAction(input: string, caseData: CaseData): ParsedAction {
  const lowered = normalize(input);
  // 先判断玩家想做什么，再从案件数据里抽取目标地点、嫌疑人、证据或物件。
  const matchedIntent = intentKeywords.find(([, keywords]) =>
    keywords.some((keyword) => lowered.includes(normalize(keyword))),
  )?.[0];

  const targetLocation = findNameMatch(input, caseData.locations)?.id;
  const targetSuspect = findNameMatch(input, caseData.suspects)?.id;
  const targetEvidence = findNameMatch(input, caseData.evidence)?.id;
  const targetObject = caseData.locations
    .flatMap((location) => location.objects)
    .find((object) => lowered.includes(normalize(object.name)) || lowered.includes(normalize(object.id)))?.id;

  let intent: ParsedAction["intent"] = matchedIntent ?? "ASK_ASSISTANT";

  if (!matchedIntent) {
    // 如果没有命中动作关键词，就根据目标类型做保守推断：
    // 提到嫌疑人通常是审问，提到证据通常是查看，提到地点通常是移动。
    if (targetSuspect) intent = "INTERROGATE_SUSPECT";
    if (targetEvidence) intent = "OPEN_EVIDENCE";
    if (targetLocation) intent = "GO_TO_LOCATION";
    if (targetObject && looksLikeFactFindingQuestion(input)) intent = "INVESTIGATE_OBJECT";
  }

  if (
    targetObject &&
    ["OPEN_EVIDENCE", "REQUEST_EVIDENCE", "ASK_ASSISTANT"].includes(intent)
  ) {
    // “查看监控控制台/看一下门禁面板”在玩家语义里是在调查场景物件，
    // 不是打开一份已经归档的证据。优先落到 INVESTIGATE_OBJECT 才能形成线索解锁循环。
    intent = "INVESTIGATE_OBJECT";
  }

  if (
    targetEvidence &&
    targetSuspect &&
    (lowered.includes("追问") || lowered.includes("质问") || lowered.includes("出示") || lowered.includes("confront"))
  ) {
    // “调取门禁记录”和“用门禁记录追问”是两个不同动作。
    // 同样提到证据时，只要出现追问/质问，就升级为 USE_EVIDENCE。
    intent = "USE_EVIDENCE";
  }

  const tone = lowered.includes("温和") || lowered.includes("soft")
    ? "soft"
    : lowered.includes("强硬") || lowered.includes("aggressive")
      ? "aggressive"
      : lowered.includes("逻辑") || lowered.includes("logical")
        ? "logical"
        : lowered.includes("情绪") || lowered.includes("emotional")
          ? "emotional"
          : "neutral";

  const confidence =
    // 这里的置信度是 UI/导演引导用，不是安全判断。
    // 真正能不能解锁证据、移动地点，仍由 applyAction 的状态机决定。
    Number(Boolean(matchedIntent)) * 0.45 +
    Number(Boolean(targetLocation || targetSuspect || targetEvidence || targetObject)) * 0.4 +
    0.15;

  return {
    rawInput: input,
    intent,
    targetLocation,
    targetSuspect,
    targetEvidence,
    targetObject,
    tone,
    confidence: Math.min(confidence, 0.96),
    suggestedFallback:
      confidence < 0.55
        ? "可以尝试明确说出地点、嫌疑人、证据名称，或让 AI 副手总结当前可行动方向。"
        : undefined,
  };
}
