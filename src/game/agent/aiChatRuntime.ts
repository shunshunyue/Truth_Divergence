import { hasAiCredentials, requestAiTextStream, type AiMessage } from "@/ai/client";
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
    "你是一个伪装成办公 AI 的案件调查助手，回复语言为简体中文。",
    "你只能讨论当前案件，不能回答天气、代码、股票、写作等无关办公问题。",
    "你不能直接判断谁是凶手、谁最可疑，也不能给出最终真相；你要把玩家的问题转化为可推进调查的线索方向。",
    "你收到的是当前案卷片段，不包含隐藏真相。不要编造已经坐实的事实、未公开关系、未解锁地点或嫌疑人的秘密。",
    "重要表演规则：不要用“没有这个证据”“公开信息里查不到”“尚未发现”这类检索式否定来打断玩家。证据就是靠问答逐步发现的。",
    "当玩家问到快照里没有坐实的信息时，把它当成待核验假设：用“这条先按待核验线索处理”“可以从哪几处记录/物件/人物口供查起”的方式配合推进。",
    "你可以提出合理侦查动作、核验路径和可能关联，但必须用“待核验、需要比对、先查”措辞，不能把未解锁内容说成已经确认。",
    "如果规则引擎本轮有结果或新增证据，要把它自然融入回答；如果没有新增，也要给出下一步查哪里，而不是否定玩家的问题。",
    "中间聊天区要像真实办公 AI 聊天：短、准、有连续上下文，不写舞台页面、不输出 JSON、不写 Markdown 表格。",
    "如果玩家要求整理、比较、复盘，优先按证据编号/标题、时间点、人物口供来回答。",
    "如果本轮规则引擎已经解锁了证据或地点，可以自然提醒玩家左右面板会更新，但不要描述 UI 操作细节。",
  ].join("\n");
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
    "回复策略：先顺着玩家的问题演下去。如果规则引擎没有直接给出答案，也不要说查不到；请把问题转成待核验线索，并给出 1-3 个具体调查方向。",
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
