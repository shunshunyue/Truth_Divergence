import { z } from "zod";
import { hasAiCredentials, requestAiJsonStream, requestAiTextStream, type AiMessage } from "@/ai/client";
import type { ChatMode, ChatRoute } from "@/game/agent/chatRuntime";
import {
  buildCurrentLocationMetadata,
  buildPublicCaseData,
  buildRecommendedCommands,
  buildVisibleClues,
  buildVisibleEvidence,
  buildVisibleRelationships,
  buildVisibleSuspects,
  buildVisibleTimeline,
} from "@/game/agent/publicProjection";
import type { GameSession, SessionChatMessage } from "@/game/engine/sessions";
import type { ActionResult, CaseData, PlayerCaseState, SuspectProfile } from "@/game/schemas/game";

type BuildAiChatMessagesOptions = {
  input: string;
  session: GameSession;
  nextState: PlayerCaseState;
  result: ActionResult;
  route: ChatRoute;
  chatMode: ChatMode;
  speaker: "assistant" | "suspect";
  suspect?: SuspectProfile;
};

type StreamAiChatReplyOptions = BuildAiChatMessagesOptions & {
  fallbackText: string;
  onContent: (content: string) => void;
};

type RouteChatWithAiOptions = {
  input: string;
  session: GameSession;
  nextState: PlayerCaseState;
  result: ActionResult;
  currentMode: ChatMode;
  fallbackRoute: ChatRoute;
};

const aiChatRouteSchema = z.object({
  kind: z.enum(["off_topic", "spoiler_request", "start_interrogation", "suspect_question", "case_assistant"]),
  suspectId: z.string().optional(),
  reason: z.string().optional(),
});

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function visibleEvidenceSummary(caseData: CaseData, state: PlayerCaseState) {
  return buildVisibleEvidence(caseData, state).map((evidence) => ({
    id: evidence.id,
    title: evidence.title,
    type: evidence.type,
    source: evidence.source,
    visibleData: evidence.visibleData,
    reliability: evidence.reliability,
    importance: evidence.importance,
    relatedSuspects: evidence.relatedSuspects.filter((id) => state.visibleSuspects.includes(id)),
    relatedLocations: evidence.relatedLocations.filter((id) => state.unlockedLocations.includes(id)),
    relatedTimeline: evidence.relatedTimeline,
  }));
}

function visibleSuspectsSummary(caseData: CaseData, state: PlayerCaseState) {
  return buildVisibleSuspects(caseData, state).map((suspect) => ({
    id: suspect.id,
    name: suspect.name,
    age: suspect.age,
    identity: suspect.identity,
    publicRelationship: suspect.publicRelationship,
    publicStatement: suspect.publicStatement,
    lieStyle: suspect.lieStyle,
    emotionalWeakness: suspect.emotionalWeakness,
    state: state.suspectStates[suspect.id],
  }));
}

function publicCaseSnapshot(caseData: CaseData, state: PlayerCaseState) {
  const publicCase = buildPublicCaseData(caseData);
  return {
    case: {
      id: publicCase.id,
      title: publicCase.title,
      theme: publicCase.theme,
      difficulty: publicCase.difficulty,
      openingEvent: publicCase.openingEvent,
      victim: publicCase.victim,
    },
    playerState: {
      phase: state.phase,
      truthScore: state.truthScore,
      currentLocation: state.currentLocation,
      discoveredEvidence: state.discoveredEvidence,
      unlockedLocations: state.unlockedLocations,
      visibleSuspects: state.visibleSuspects,
      interviewedSuspects: state.interviewedSuspects,
      notes: state.notes.slice(-6),
      agentLog: state.agentLog.slice(-6),
    },
    currentLocation: buildCurrentLocationMetadata(caseData, state),
    visibleClues: buildVisibleClues(caseData, state),
    visibleEvidence: visibleEvidenceSummary(caseData, state),
    visibleSuspects: visibleSuspectsSummary(caseData, state),
    visibleTimeline: buildVisibleTimeline(state),
    visibleRelationships: buildVisibleRelationships(caseData, state),
    recommendations: buildRecommendedCommands(caseData, state),
  };
}

function recentMessages(history: SessionChatMessage[]) {
  return history.slice(-12).map((message) => ({
    role: message.role === "user" ? "user" : "assistant",
    speaker: message.speaker,
    label: message.label,
    suspectId: message.suspectId,
    content: message.text,
  }));
}

function buildAssistantSystemPrompt() {
  return [
    "你是玩家身边的案件调查搭档，回复语言为简体中文。你可以借用办公 AI 的检索能力，但说话要像真人，不像系统。",
    "你只能讨论当前案件，不能回答天气、代码、股票、写作等无关办公问题。",
    "你不能直接判断谁是凶手、谁最可疑，也不能给出最终真相；你要先回答玩家当前这句话本身。",
    "你收到的是当前案卷片段，不包含隐藏真相。不要编造已经坐实的事实、未公开关系、未解锁地点或嫌疑人的秘密。",
    "重要表演规则：不要用“没有这个证据”“公开信息里查不到”“尚未发现”这类检索式否定来打断玩家。证据就是靠问答逐步发现的。",
    "当玩家问到快照里没有坐实的信息时，把它当成待核验假设，简短说明它为什么还不能定性即可。",
    "不要主动给攻略清单。除非玩家明确问“下一步/建议/怎么查/查哪里”，否则最多只轻轻点出一个可核验方向。",
    "如果规则引擎本轮有结果或新增证据，要把它自然融入回答；如果没有新增，也只围绕当前问题说，不要硬塞下一步计划。",
    "中间聊天区要像真人搭档聊天：短、准、有连续上下文，不写舞台页面、不输出 JSON、不写 Markdown 表格。",
    "优先用第一人称和自然口语，例如“我刚看了下”“这里不太顺”“先把这条扣住”“别急着定论”。",
    "禁止旁白腔和系统播报：不要写“你一开口”“旁边的 AI 副手”“立刻把重点拎出来”“最值得先碰的是三样东西”。",
    "禁止报告腔：不要连续使用“能看出/如果...就说明/则关系到/一旦...就能”解释线索价值。先说当前判断，不主动延展。",
    "如果玩家要求整理、比较、复盘，优先按证据编号/标题、时间点、人物口供来回答。",
    "如果本轮规则引擎已经解锁了证据或地点，可以自然提醒玩家左右面板会更新，但不要描述 UI 操作细节。",
  ].join("\n");
}

function buildRoutePrompt({
  currentMode,
  input,
  nextState,
  result,
  session,
}: RouteChatWithAiOptions) {
  const visibleSuspects = visibleSuspectsSummary(session.caseData, nextState).map((suspect) => ({
    id: suspect.id,
    name: suspect.name,
    identity: suspect.identity,
    publicRelationship: suspect.publicRelationship,
  }));
  const activeSuspect = currentMode.mode === "interrogation"
    ? visibleSuspects.find((suspect) => suspect.id === currentMode.suspectId)
    : undefined;

  return [
    "你是推理游戏的对话路由器。你只决定下一条回复由谁说，不生成正文。",
    "必须只返回严格 JSON。",
    "",
    `玩家本轮输入：${input}`,
    `本地解析意图：${result.parsedAction.intent}`,
    `规则引擎结果：${result.resultText}`,
    `当前对话模式：${currentMode.mode === "interrogation" ? `interrogation:${currentMode.label}:${currentMode.suspectId}` : "assistant"}`,
    `当前问询对象：${activeSuspect ? `${activeSuspect.name}(${activeSuspect.id})` : "无"}`,
    "",
    "可问询人物：",
    compactJson(visibleSuspects),
    "",
    "最近对话：",
    compactJson(recentMessages(session.chatHistory)),
    "",
    "判定规则：",
    "- 如果玩家明确点名某个可问询人物，并且是在问/审/追问这个人，返回 start_interrogation，并给 suspectId。",
    "- 如果当前已经在 interrogation 模式，且玩家用了“你/你们/你和/你当时/你为什么/你几点/你认识/你和死者什么关系”等第二人称追问，默认返回 suspect_question，suspectId 用当前问询对象。",
    "- 如果当前已经在 interrogation 模式，玩家没有明确说“问助手/整理案卷/查证据/打开关系图/整理时间线/切回助手”，也优先保持 suspect_question。",
    "- 如果玩家要求查记录、调监控、翻账册、整理时间线、打开关系图、复盘案卷、让助手分析，返回 case_assistant。",
    "- 如果玩家问无关案件内容，返回 off_topic。",
    "- 如果玩家要求直接公布凶手、真相或最终答案，返回 spoiler_request。",
    "",
    "JSON 格式：",
    '{"kind":"case_assistant|start_interrogation|suspect_question|off_topic|spoiler_request","suspectId":"可选，必须来自可问询人物 id","reason":"可选，拒绝原因"}',
  ].join("\n");
}

function routeFromAiDecision(
  rawDecision: unknown,
  { currentMode, fallbackRoute, nextState, session }: RouteChatWithAiOptions,
): ChatRoute {
  const decision = aiChatRouteSchema.parse(rawDecision);
  const visibleById = new Map(
    buildVisibleSuspects(session.caseData, nextState).map((suspect) => [suspect.id, suspect]),
  );
  const activeSuspect = currentMode.mode === "interrogation" ? visibleById.get(currentMode.suspectId) : undefined;

  if (decision.kind === "off_topic") {
    return { kind: "off_topic", reason: decision.reason || "当前窗口只接入本案调查，不处理普通办公问答。" };
  }

  if (decision.kind === "spoiler_request") {
    return { kind: "spoiler_request", reason: decision.reason || "我不能直接替你定嫌疑人，但可以继续按证据拆。" };
  }

  if (decision.kind === "case_assistant") {
    return { kind: "case_assistant" };
  }

  if (decision.kind === "suspect_question") {
    const suspect = (decision.suspectId && visibleById.get(decision.suspectId)) || activeSuspect;
    return suspect ? { kind: "suspect_question", suspect } : fallbackRoute;
  }

  if (decision.kind === "start_interrogation" && decision.suspectId) {
    const suspect = visibleById.get(decision.suspectId);
    return suspect ? { kind: "start_interrogation", suspect } : fallbackRoute;
  }

  return fallbackRoute;
}

export async function routeChatCommandWithAi(options: RouteChatWithAiOptions): Promise<ChatRoute> {
  if (!hasAiCredentials()) return options.fallbackRoute;
  if (options.fallbackRoute.kind === "off_topic" || options.fallbackRoute.kind === "spoiler_request") {
    return options.fallbackRoute;
  }

  try {
    const raw = await requestAiJsonStream<unknown>({
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: "你是对话模式路由器。只输出严格 JSON，不输出解释。",
        } satisfies AiMessage,
        {
          role: "user",
          content: buildRoutePrompt(options),
        },
      ],
    });

    return routeFromAiDecision(raw, options);
  } catch {
    return options.fallbackRoute;
  }
}

function buildSuspectSystemPrompt(suspect: SuspectProfile | undefined, state: PlayerCaseState) {
  const suspectState = suspect ? state.suspectStates[suspect.id] : undefined;
  return [
    "你正在扮演案件中的一个被问询对象，回复语言为简体中文。",
    "你必须用第一人称回答，语气像被调查者，不像 AI 助手。不要说“作为 AI”。",
    "你只能知道公开口供、公开关系、当前压力/信任/情绪、玩家已出示或已发现的证据。",
    "不要承认隐藏真相，不要把未核验信息说成事实，也不要主动补充案件档案没有公开的信息。",
    "不要用“没有证据”这种旁观者口吻。被问到你不能确认的细节时，要像当事人一样回避、含糊、反问、要求对方拿记录，或给出可被继续追问的说法。",
    "如果压力较高，可以出现迟疑、防御、改口边缘，但最后仍不能直接泄露隐藏真相。",
    "回复要自然，通常 2 到 5 句话。不要输出 JSON、不要写旁白剧本。",
    suspect
      ? `当前问询对象：${suspect.name}，身份：${suspect.identity}，公开关系：${suspect.publicRelationship}，公开口供：${suspect.publicStatement}。`
      : "",
    suspectState
      ? `当前状态：pressure=${suspectState.pressure}, trust=${suspectState.trust}, suspicion=${suspectState.suspicion}, emotion=${suspectState.currentEmotion}, relationship=${suspectState.relationshipWithPlayer}, usedEvidence=${suspectState.usedEvidenceAgainstThem.join(",") || "none"}, contradictions=${suspectState.exposedContradictions.join("；") || "none"}。`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildUserPrompt({
  input,
  session,
  nextState,
  result,
  route,
  chatMode,
}: BuildAiChatMessagesOptions) {
  return [
    `玩家本轮输入：${input}`,
    `当前对话模式：${chatMode.mode === "interrogation" ? `interrogation:${chatMode.label}` : "assistant"}`,
    `路由结果：${route.kind}`,
    `规则引擎结果：${result.resultText}`,
    `本轮新增证据：${result.unlockedEvidence.map((item) => item.title).join("、") || "无"}`,
    `本轮新增地点：${result.unlockedLocations.map((item) => item.name).join("、") || "无"}`,
    `本轮新增人物：${result.unlockedSuspects.map((item) => item.name).join("、") || "无"}`,
    "回复策略：只顺着玩家本轮问题回答，不要默认扩展成下一步攻略。如果规则引擎没有直接答案，也不要说查不到；用一句话把它放回待核验状态。",
    "风格要求：不要旁白，不要系统总结，不要写“你一开口/AI 副手”。不要列“一二三”清单，除非玩家明确要求建议。自然中文 1 到 3 句。",
    "最近对话：",
    compactJson(recentMessages(session.chatHistory)),
    "当前案卷片段：",
    compactJson(publicCaseSnapshot(session.caseData, nextState)),
    "请直接输出要显示在中间聊天气泡里的文本。",
  ].join("\n\n");
}

export async function streamAiChatReply(options: StreamAiChatReplyOptions) {
  if (!hasAiCredentials()) return options.fallbackText;

  const messages: AiMessage[] = [
    {
      role: "system",
      content:
        options.speaker === "suspect"
          ? buildSuspectSystemPrompt(options.suspect, options.nextState)
          : buildAssistantSystemPrompt(),
    },
    {
      role: "user",
      content: buildUserPrompt(options),
    },
  ];

  const text = await requestAiTextStream({
    messages,
    temperature: options.speaker === "suspect" ? 0.72 : 0.45,
    maxTokens: options.speaker === "suspect" ? 420 : 620,
    onContent: options.onContent,
  });

  return text.trim();
}
