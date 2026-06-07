import { randomUUID } from "crypto";
import { claimRandomReadyCase, countReadyCases, markClaimedCaseUsed } from "@/game/cache/caseCache";
import { ensureCaseCacheWorkerStarted } from "@/game/cache/caseCacheWorker";
import {
  createPendingEvidenceVisualAsset,
  generateEvidenceVisualAsset,
  shouldGenerateRuntimeVisualAssets,
} from "@/ai/imageGenerator";
import { applyAction } from "@/game/engine/applyAction";
import {
  appendSessionChatMessage,
  createSession,
  getSession,
  updateSession,
  type GameSession,
} from "@/game/engine/sessions";
import { writeAgentDispatchLog, writeAgentEventLog } from "@/game/agent/eventLog";
import { routeChatCommandWithAi, streamAiChatReply } from "@/game/agent/aiChatRuntime";
import { directVisualFocus } from "@/game/agent/visualDirector";
import {
  createFallbackRuntimeDiscoveryFromReply,
  streamRuntimeDiscoveryReply,
  structureRuntimeDiscoveryFromReply,
  type RuntimeDiscovery,
} from "@/game/agent/runtimeDiscovery";
import {
  buildAssistantReply,
  buildRefusalReply,
  buildSuspectReply,
  routeChatCommand,
  type ChatMode,
  type ChatRoute,
} from "@/game/agent/chatRuntime";
import {
  buildCurrentLocationMetadata,
  buildInitialPublicCaseData,
  buildPublicState,
  buildRecommendedCommands,
  buildVisibleClues,
  buildVisibleEvidence,
  buildVisibleLocations,
  buildVisibleRelationships,
  buildVisibleSuspects,
  buildVisibleTimeline,
} from "@/game/agent/publicProjection";
import type {
  AgentEventEnvelope,
  AgentEventPriority,
  AgentEventSender,
  AgentMetadataScope,
  AgentPlayerStatePatch,
  AgentRuntimeEvent,
  AgentSessionPayload,
} from "@/game/agent/events";
import type { ActionResult, CaseData, PlayerCaseState, SuspectProfile } from "@/game/schemas/game";
import type { CaseVisualManifest, VisualAsset, VisualFocusPayload } from "@/game/schemas/visuals";

type Subscriber = {
  id: string;
  send: AgentEventSender;
  lastAckSeq: number;
};

type EnqueueOptions = {
  priority?: AgentEventPriority;
  sessionId?: string;
  scope?: string;
  delayMs?: number;
};

type FinalizeActionOptions = {
  baseSession: GameSession;
  caseData: CaseData;
  discovery?: RuntimeDiscovery;
  finalState: PlayerCaseState;
  input: string;
  result: ActionResult;
  resultText: string;
  sessionId: string;
};

const caseCacheClaimPollMs = 2_000;
const caseCacheStatusEveryMs = 10_000;

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sessionPayload(
  session: GameSession,
  resultText?: string,
  caseData: CaseData = buildInitialPublicCaseData(session.caseData, session.state),
): AgentSessionPayload {
  return {
    sessionId: session.sessionId,
    ...(session.activatedAt ? { activatedAt: session.activatedAt } : {}),
    caseData,
    state: buildPublicState(session.state),
    ...(session.visualManifest ? { visualManifest: publicVisualManifest(session.visualManifest) } : {}),
    ...(resultText ? { resultText } : {}),
  };
}

function publicVisualAsset(asset: VisualAsset): VisualAsset {
  return {
    ...asset,
    prompt: "",
  };
}

function isPublicVisualAsset(asset: VisualAsset) {
  return asset.visibility === "opening" || Boolean(asset.revealedAt);
}

function publicVisualManifest(manifest: CaseVisualManifest): CaseVisualManifest {
  return {
    ...manifest,
    assets: manifest.assets.filter(isPublicVisualAsset).map(publicVisualAsset),
  };
}

function normalizeMatchText(value: string | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function compactMatchValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(compactMatchValue).filter(Boolean).join("\n");
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map(compactMatchValue).filter(Boolean).join("\n");
  return String(value);
}

const genericVisualTriggerWords = new Set([
  "查",
  "调查",
  "看看",
  "看一下",
  "证据",
  "线索",
  "物件",
  "现场",
  "地点",
  "记录",
  "照片",
  "图",
  "影像",
  "头像",
]);

const runtimeVisualDemandWords = [
  "看",
  "看看",
  "看一下",
  "调出",
  "展示",
  "放大",
  "图片",
  "图像",
  "照片",
  "影像",
  "画面",
  "截图",
  "特写",
];

function visualAssetMatchesText(asset: VisualAsset, input: string, reply: string) {
  const haystack = normalizeMatchText(`${input}\n${reply}`);
  const strongNeedles = [
    asset.title,
    asset.description,
    asset.caption,
    asset.entityId,
    ...asset.tags,
    ...asset.revealHints.filter((hint) => !genericVisualTriggerWords.has(hint)),
  ]
    .map(normalizeMatchText)
    .filter((item) => item.length >= 2);

  if (strongNeedles.some((needle) => haystack.includes(needle) || needle.includes(haystack))) {
    return true;
  }

  const weakHits = asset.revealHints
    .map(normalizeMatchText)
    .filter((hint) => genericVisualTriggerWords.has(hint) && haystack.includes(hint));

  return weakHits.length >= 2;
}

function textSuggestsRuntimeVisual(input: string) {
  const normalized = normalizeMatchText(input);
  return runtimeVisualDemandWords.some((word) => normalized.includes(word));
}

function evidenceMatchesText(evidence: CaseData["evidence"][number], input: string, reply: string) {
  const haystack = normalizeMatchText(`${input}\n${reply}`);
  const needles = [
    evidence.id,
    evidence.title,
    evidence.type,
    evidence.source,
    evidence.visualTemplate,
    compactMatchValue(evidence.visibleData),
  ]
    .map(normalizeMatchText)
    .filter((item) => item.length >= 2);
  return needles.some((needle) => haystack.includes(needle) || needle.includes(haystack));
}

function visualAssetHasAvailableContext(asset: VisualAsset, state: PlayerCaseState) {
  if (asset.relatedEvidenceIds.length && asset.relatedEvidenceIds.some((id) => state.discoveredEvidence.includes(id))) {
    return true;
  }
  if (asset.relatedLocationIds.length && asset.relatedLocationIds.some((id) => state.unlockedLocations.includes(id) || state.currentLocation === id)) {
    return true;
  }
  if (asset.relatedSuspectIds.length && asset.relatedSuspectIds.some((id) => state.visibleSuspects.includes(id) || state.interviewedSuspects.includes(id))) {
    return true;
  }
  return !asset.relatedEvidenceIds.length && !asset.relatedLocationIds.length && !asset.relatedSuspectIds.length;
}

function buildStatePatch(previous: PlayerCaseState, next: PlayerCaseState): AgentPlayerStatePatch {
  const patch: AgentPlayerStatePatch = {};

  if (previous.phase !== next.phase) patch.phase = next.phase;
  if (previous.truthScore !== next.truthScore) patch.truthScore = next.truthScore;
  if (previous.currentLocation !== next.currentLocation) patch.currentLocation = next.currentLocation;
  if (previous.playerId !== next.playerId) patch.playerId = next.playerId;
  if (previous.caseId !== next.caseId) patch.caseId = next.caseId;

  if (JSON.stringify(previous.agentLog) !== JSON.stringify(next.agentLog)) patch.agentLog = next.agentLog;
  if (JSON.stringify(previous.discoveredEvidence) !== JSON.stringify(next.discoveredEvidence)) {
    patch.discoveredEvidence = next.discoveredEvidence;
  }
  if (JSON.stringify(previous.unlockedLocations) !== JSON.stringify(next.unlockedLocations)) {
    patch.unlockedLocations = next.unlockedLocations;
  }
  if (JSON.stringify(previous.visibleSuspects) !== JSON.stringify(next.visibleSuspects)) {
    patch.visibleSuspects = next.visibleSuspects;
  }
  if (JSON.stringify(previous.interviewedSuspects) !== JSON.stringify(next.interviewedSuspects)) {
    patch.interviewedSuspects = next.interviewedSuspects;
  }
  if (JSON.stringify(previous.playerTimeline) !== JSON.stringify(next.playerTimeline)) {
    patch.playerTimeline = next.playerTimeline;
  }
  if (JSON.stringify(previous.playerRelationships) !== JSON.stringify(next.playerRelationships)) {
    patch.playerRelationships = next.playerRelationships;
  }
  if (JSON.stringify(previous.notes) !== JSON.stringify(next.notes)) patch.notes = next.notes;
  if (JSON.stringify(previous.actionHistory) !== JSON.stringify(next.actionHistory)) {
    patch.actionHistory = next.actionHistory;
  }
  if (JSON.stringify(previous.finalDeduction) !== JSON.stringify(next.finalDeduction)) {
    patch.finalDeduction = next.finalDeduction;
  }

  const suspectStates: AgentPlayerStatePatch["suspectStates"] = {};
  for (const [suspectId, suspectState] of Object.entries(next.suspectStates)) {
    if (JSON.stringify(previous.suspectStates[suspectId]) !== JSON.stringify(suspectState)) {
      suspectStates[suspectId] = suspectState;
    }
  }
  if (Object.keys(suspectStates).length) patch.suspectStates = suspectStates;

  return patch;
}

function hasStatePatch(patch: AgentPlayerStatePatch) {
  return Object.keys(patch).length > 0;
}

function splitTextForStream(text: string) {
  const chunks: string[] = [];
  let buffer = "";
  for (const char of text) {
    buffer += char;
    if (buffer.length >= 12 || /[。！？\n]/.test(char)) {
      chunks.push(buffer);
      buffer = "";
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

function sanitizePlayerFacingText(text: string, caseData: CaseData) {
  let sanitized = text;

  for (const suspect of caseData.suspects) {
    const escapedId = suspect.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    sanitized = sanitized.replace(new RegExp(`\\b${escapedId}\\b`, "gi"), suspect.name);
  }

  return sanitized
    .replace(/\b(?:evidence|timeline|relationship|loc)-[a-z0-9-]+\b/gi, "这条记录")
    .replace(/\bsuspect-[a-z0-9-]+\b/gi, "相关人员");
}

function shouldHoldPlayerFacingBuffer(text: string) {
  return /(?:^|[^a-z0-9-])(?:suspect|evidence|timeline|relationship|loc)-[a-z0-9-]*$/i.test(text);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldUseRuntimeDiscovery(input: string, result: ActionResult) {
  const normalized = input.toLowerCase().replace(/\s+/g, "");
  const discoveryIntents: Array<ActionResult["parsedAction"]["intent"]> = [
    "INVESTIGATE_OBJECT",
    "REQUEST_EVIDENCE",
    "OPEN_EVIDENCE",
    "GO_TO_LOCATION",
    "BUILD_RELATIONSHIP",
  ];
  const asksForRelationshipMap = /关系图|人物关系|关系网|关系线|整理关系|梳理关系|拓扑/.test(normalized);
  const asksForMaterial =
    /查|调取|查看|看一下|翻|检查|调查|打开|读取|核对|记录|日志|监控|录像|门禁|门岗|登记|账册|账本|药箱|物证|证词|口供|鉴定|报告|通话|短信|聊天|定位|票据|收据|小票|指纹|血迹|痕迹|控制台/.test(
      normalized,
    );
  const asksForThinkingOnly =
    /总结|整理|复盘|分析|建议|下一步|方向|怎么看|怎么想|推理一下|帮我想|怀疑谁|可疑/.test(normalized) &&
    !/查|调取|查看|翻|检查|调查|记录|日志|监控|门禁|账册|物证|证词|口供/.test(normalized);

  return asksForRelationshipMap || (!asksForThinkingOnly && (discoveryIntents.includes(result.parsedAction.intent) || asksForMaterial));
}

function shouldStructureRelationshipMapNow(input: string, result: ActionResult) {
  const normalized = input.toLowerCase().replace(/\s+/g, "");
  return result.parsedAction.intent === "BUILD_RELATIONSHIP" || /关系图|人物关系|关系网|关系线|整理关系|梳理关系|拓扑/.test(normalized);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class RoomAgentRuntime {
  readonly roomId: string;
  private seq = 0;
  private queue: AgentEventEnvelope[] = [];
  private subscribers = new Map<string, Subscriber>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private idleHintTimer: ReturnType<typeof setTimeout> | undefined;
  private sessionId: string | undefined;
  private chatMode: ChatMode = { mode: "assistant", label: "真相中枢" };
  private running = false;

  constructor(roomId: string = randomUUID()) {
    this.roomId = roomId;
  }

  subscribe(send: AgentEventSender) {
    const id = randomUUID();
    this.subscribers.set(id, { id, send, lastAckSeq: 0 });
    this.enqueue(
      {
        event: "agent.status",
        channel: "agent",
        payload: { text: "Investigation Agent WebSocket 已连接，RoomAgent 调度器待命。" },
      },
      { priority: "critical", sessionId: this.sessionId },
    );
    return () => {
      this.subscribers.delete(id);
      if (!this.subscribers.size) this.clearIdleHint();
    };
  }

  ack(lastSeq: number, subscriberId?: string) {
    if (subscriberId) {
      const subscriber = this.subscribers.get(subscriberId);
      if (subscriber) subscriber.lastAckSeq = Math.max(subscriber.lastAckSeq, lastSeq);
      return;
    }

    for (const subscriber of this.subscribers.values()) {
      subscriber.lastAckSeq = Math.max(subscriber.lastAckSeq, lastSeq);
    }
  }

  reportError(message: string, sessionId = this.sessionId) {
    this.enqueueError(message, sessionId);
  }

  private async claimCachedCaseWhenReady() {
    let nextStatusAt = 0;
    const startedAt = Date.now();

    while (true) {
      const cachedCase = await claimRandomReadyCase();
      if (cachedCase) return cachedCase;

      const now = Date.now();
      if (now >= nextStatusAt) {
        const ready = await countReadyCases();
        const waitedSeconds = Math.max(1, Math.round((now - startedAt) / 1000));
        this.enqueueStatus(
          ready > 0
            ? "案件缓存刚补上但被占用，正在重新领取..."
            : `案件缓存池暂时为空，正在等待后台补充缓存... 已等待 ${waitedSeconds} 秒`,
          "critical",
        );
        nextStatusAt = now + caseCacheStatusEveryMs;
      }

      ensureCaseCacheWorkerStarted();
      await delay(caseCacheClaimPollMs);
    }
  }

  async start() {
    if (this.running) {
      this.enqueueStatus(this.sessionId ? "上一条调查指令仍在处理中。" : "正在等待案件缓存补充，拿到后会自动开局。", "normal");
      return;
    }

    this.running = true;
    try {
      ensureCaseCacheWorkerStarted();
      this.enqueueStatus("正在从案件缓存池领取未使用案件...", "critical");

      const cachedCase = await this.claimCachedCaseWhenReady();

      this.enqueueStatus("案件已领取，正在创建本局调查会话...", "critical");
      const session = createSession({
        cacheRecordId: cachedCase.id,
        caseData: cachedCase.caseData,
        state: cachedCase.state,
        visualManifest: cachedCase.visualManifest,
      });
      this.sessionId = session.sessionId;

      this.enqueue(
        {
          event: "session.ready",
          channel: "game",
          payload: sessionPayload(session),
        },
        { priority: "critical", sessionId: session.sessionId },
      );

      this.enqueue(
        {
          event: "agent.status",
          channel: "agent",
          payload: { text: "对话中枢已就绪，正在同步案件元数据..." },
        },
        { priority: "critical", sessionId: session.sessionId, scope: "chat" },
      );

      this.scheduleOpeningMetadata(session);
      if (session.visualManifest) {
        this.enqueueVisualManifest(session);
        const coverAsset = this.visualAssetFor(session.visualManifest, {
          entityId: session.caseData.id,
          kind: "case_cover",
        });
        if (coverAsset) this.enqueueVisualAssetReady(session.sessionId, coverAsset);
        this.enqueueVisualFocus(session, {
          mode: "case",
          entityId: session.caseData.id,
          asset: coverAsset,
          reason: "opening",
          intensity: "quiet",
        });
      }
      this.enqueueChatMode(this.chatMode, session.sessionId);
      this.streamChatMessage({
        sessionId: session.sessionId,
        speaker: "assistant",
        label: "真相中枢",
        text: `案件已接入。你直接问要查什么，我会把查到的记录、证词或现场细节整理出来。\n当前任务：${session.caseData.openingEvent.initialPrompt}`,
      });
      this.scheduleIdleHint(session);
    } catch (error) {
      this.enqueueError(error instanceof Error ? error.message : "RoomAgent 开局失败。");
    } finally {
      this.running = false;
    }
  }

  async activate(sessionId: string) {
    const session = getSession(sessionId);
    if (!session) throw new Error("本局调查已失效，请重新开始。");

    if (!session.activatedAt) {
      if (session.cacheRecordId) await markClaimedCaseUsed(session.cacheRecordId);
      const activatedAt = new Date().toISOString();
      updateSession(session.sessionId, { activatedAt });
      session.activatedAt = activatedAt;
    }

    this.enqueueStatus("案件已进入调查。", "critical", session.sessionId);
    this.enqueue(
      {
        event: "session.ready",
        channel: "game",
        payload: sessionPayload(session, "案件已进入调查。"),
      },
      { priority: "critical", sessionId: session.sessionId, scope: "session.activate" },
    );

    return session;
  }

  async resume(sessionId: string) {
    const session = getSession(sessionId);
    if (!session) throw new Error("本局调查已失效，请重新开始。");

    this.sessionId = session.sessionId;
    this.enqueueStatus("已恢复当前案件进度。", "critical", session.sessionId);
    this.enqueue(
      {
        event: "session.ready",
        channel: "game",
        payload: sessionPayload(session, "案件进度已恢复。"),
      },
      { priority: "critical", sessionId: session.sessionId, scope: "session.resume" },
    );

    this.scheduleOpeningMetadata(session);
    this.enqueueBackgroundMetadata(session);
    if (session.visualManifest) {
      this.enqueueVisualManifest(session);
      const focusAsset = this.visualAssetFor(session.visualManifest, {
        entityId: session.state.currentLocation || session.caseData.id,
      });
      this.enqueueVisualFocus(session, {
        mode: focusAsset?.kind === "location" ? "scene" : "case",
        entityId: focusAsset?.entityId ?? session.caseData.id,
        asset: focusAsset,
        reason: "assistant_reference",
        intensity: "quiet",
      });
    }
    this.enqueueChatMode(this.chatMode, session.sessionId);
    this.scheduleIdleHint(session);
  }

  async command(sessionId: string, input: string) {
    if (this.running) {
      this.enqueueStatus("上一条调查指令仍在处理中。", "normal", sessionId);
      return;
    }

    this.running = true;
    this.clearIdleHint();
    try {
      const trimmed = input.trim();
      if (!sessionId) throw new Error("缺少 sessionId。");
      if (!trimmed) throw new Error("请输入调查行动。");

      const session = getSession(sessionId);
      if (!session) throw new Error("本局调查已失效，请重新开始。");
      if (!session.activatedAt) await this.activate(session.sessionId);
      this.sessionId = session.sessionId;

      const turnId = randomUUID();
      this.enqueueStatus("正在理解你的问题...", "critical", sessionId);
      const result = applyAction(trimmed, session.caseData, session.state);
      const localRoute = routeChatCommand(trimmed, session.caseData, result.state, this.chatMode, result.parsedAction);
      const route =
        result.parsedAction.intent === "SUBMIT_DEDUCTION"
          ? localRoute
          : await routeChatCommandWithAi({
              input: trimmed,
              session,
              nextState: result.state,
              result,
              currentMode: this.chatMode,
              fallbackRoute: localRoute,
            });
      appendSessionChatMessage(sessionId, {
        role: "user",
        speaker: "user",
        label: "你",
        text: trimmed,
      });
      const visualFocusDecision = await directVisualFocus({
        input: trimmed,
        session,
        result,
        route,
        chatMode: this.chatMode,
      });

      if (result.parsedAction.intent === "SUBMIT_DEDUCTION") {
        this.enqueueStatus(result.isSolved ? "最终推理已结案。" : "最终推理已记录。", "critical", sessionId);
        await this.streamFixedChatMessage({
          sessionId,
          turnId,
          speaker: "assistant",
          label: "真相中枢",
          text: result.resultText,
        });
        const finalSession = this.finalizeAction({
          baseSession: session,
          caseData: session.caseData,
          finalState: result.state,
          input: trimmed,
          result,
          resultText: result.resultText,
          sessionId,
        });
        this.enqueueVisualFocus(finalSession, {
          ...visualFocusDecision,
          asset: this.assetForVisualDecision(finalSession, visualFocusDecision),
        });
        const visualSession = this.revealTriggeredVisualAssets({
          input: trimmed,
          reply: result.resultText,
          session: finalSession,
          turnId,
        });
        this.enqueue(
          {
            event: "game.command.finished",
            channel: "game",
            payload: {
              sessionId,
              resultText: result.resultText,
            },
          },
          { priority: "critical", sessionId, scope: "action.finished" },
        );
        this.finishTurn(sessionId, turnId);
        this.scheduleIdleHint(visualSession);
        return;
      }

      if (route.kind === "off_topic" || route.kind === "spoiler_request") {
        this.enqueue(
          {
            event: "agent.refusal",
            channel: "agent",
            payload: {
              turnId,
              message: route.reason,
            },
          },
          { priority: "critical", sessionId, scope: "chat.refusal" },
        );
        const refusalText = buildRefusalReply(route);
        this.streamChatMessage({
          sessionId,
          turnId,
          speaker: "assistant",
          label: "真相中枢",
          text: refusalText,
        });
        appendSessionChatMessage(sessionId, {
          role: "assistant",
          speaker: "assistant",
          label: "真相中枢",
          text: refusalText,
        });
        this.finishTurn(sessionId, turnId);
        this.scheduleIdleHint(session);
        return;
      }

      let speaker: "assistant" | "suspect" = "assistant";
      let suspectId: string | undefined;
      let suspect: SuspectProfile | undefined;
      let label = "真相中枢";
      let replyText = "";
      let activeChatMode = this.chatMode;
      let discovery: RuntimeDiscovery | undefined;
      let shouldStructureDiscovery = false;
      let shouldStructureRelationshipMap = false;
      let runtimeHistory = getSession(sessionId)?.chatHistory ?? session.chatHistory;

      if (route.kind === "start_interrogation" || route.kind === "suspect_question") {
        this.chatMode = { mode: "interrogation", suspectId: route.suspect.id, label: route.suspect.name };
        this.enqueueChatMode(this.chatMode, sessionId);
        activeChatMode = this.chatMode;
        speaker = "suspect";
        suspectId = route.suspect.id;
        suspect = route.suspect;
        label = route.suspect.name;
        replyText = buildSuspectReply(route.suspect, result.state, result);
      } else {
        if (this.chatMode.mode !== "assistant") {
          this.chatMode = { mode: "assistant", label: "真相中枢" };
          this.enqueueChatMode(this.chatMode, sessionId);
        }
        activeChatMode = this.chatMode;
        shouldStructureDiscovery = shouldUseRuntimeDiscovery(trimmed, result);
        shouldStructureRelationshipMap = shouldStructureRelationshipMapNow(trimmed, result);
        this.enqueueStatus(
          shouldStructureRelationshipMap ? "正在梳理人物关系..." : shouldStructureDiscovery ? "正在调取相关记录..." : "正在整理线索...",
          "critical",
          sessionId,
        );
        runtimeHistory = getSession(sessionId)?.chatHistory ?? session.chatHistory;
        replyText = buildAssistantReply(trimmed, session.caseData, result.state, result);
      }

      const updatedSessionForPrompt = {
        ...session,
        caseData: session.caseData,
        state: result.state,
        chatHistory: getSession(sessionId)?.chatHistory ?? session.chatHistory,
      };

      if (shouldStructureDiscovery && speaker === "assistant") {
        replyText = await this.streamRuntimeDiscoveryChatMessage({
          sessionId,
          turnId,
          label,
          fallbackText: replyText,
          input: trimmed,
          caseData: session.caseData,
          history: runtimeHistory,
          result,
          state: result.state,
        });
        const fallbackDiscovery = createFallbackRuntimeDiscoveryFromReply({
          input: trimmed,
          reply: replyText,
          caseData: session.caseData,
          state: result.state,
        });
        discovery = fallbackDiscovery;
        let structuredSynchronously = false;
        if (shouldStructureRelationshipMap) {
          try {
            this.enqueueStatus("正在梳理人物关系...", "critical", sessionId);
            discovery = await withTimeout(
              structureRuntimeDiscoveryFromReply({
                input: trimmed,
                reply: replyText,
                caseData: session.caseData,
                history: runtimeHistory,
                result,
                state: result.state,
              }),
              15000,
              "人物关系归档超时。",
            );
            structuredSynchronously = true;
          } catch (error) {
            const message = error instanceof Error ? error.message : "人物关系归档失败。";
            this.enqueueStatus(`人物关系先等后台精细归档：${message.slice(0, 80)}`, "background", sessionId);
          }
        }
        const finalCaseData = discovery.caseData;
        const finalState = discovery.state;
        const finalResultText = replyText || discovery.reply || result.resultText;
        const finalSession = this.finalizeAction({
          baseSession: session,
          caseData: finalCaseData,
          discovery,
          finalState,
          input: trimmed,
          result,
          resultText: finalResultText,
          sessionId,
        });
        this.enqueueVisualFocus(finalSession, {
          ...visualFocusDecision,
          asset: this.assetForVisualDecision(finalSession, visualFocusDecision),
        });
        const visualSession = this.revealTriggeredVisualAssets({
          input: trimmed,
          reply: finalResultText,
          session: finalSession,
          turnId,
        });
        this.enqueue(
          {
            event: "game.command.finished",
            channel: "game",
            payload: {
              sessionId,
              resultText: finalResultText,
            },
          },
          { priority: "critical", sessionId, scope: "action.finished" },
        );
        this.finishTurn(sessionId, turnId);
        this.running = false;
        if (!structuredSynchronously) {
          this.structureDiscoveryInBackground({
            input: trimmed,
            reply: replyText,
            caseData: finalCaseData,
            history: getSession(sessionId)?.chatHistory ?? runtimeHistory,
            result: {
              ...result,
              state: finalState,
            },
            sessionId,
            state: finalState,
            fallbackDiscovery,
          });
        }
        this.scheduleIdleHint(visualSession);
        return;
      } else {
        replyText = await this.streamAiOrFallbackChatMessage({
          sessionId,
          turnId,
          speaker,
          suspectId,
          suspect,
          label,
          fallbackText: replyText,
          input: trimmed,
          session: updatedSessionForPrompt,
          result,
          route,
          chatMode: activeChatMode,
        });
      }

      const finalCaseData = discovery?.caseData ?? session.caseData;
      const finalState = discovery?.state ?? result.state;
      const finalResultText = replyText || discovery?.reply || result.resultText;
      const finalSession = this.finalizeAction({
        baseSession: session,
        caseData: finalCaseData,
        discovery,
        finalState,
        input: trimmed,
        result,
        resultText: finalResultText,
        sessionId,
      });
      this.enqueueVisualFocus(finalSession, {
        ...visualFocusDecision,
        asset: this.assetForVisualDecision(finalSession, visualFocusDecision),
      });
      const visualSession = this.revealTriggeredVisualAssets({
        input: trimmed,
        reply: finalResultText,
        session: finalSession,
        turnId,
      });
      this.enqueue(
        {
          event: "game.command.finished",
          channel: "game",
          payload: {
            sessionId,
            resultText: finalResultText,
          },
        },
        { priority: "normal", sessionId, scope: "action.finished" },
      );
      this.finishTurn(sessionId, turnId);
      this.scheduleIdleHint(visualSession);
    } catch (error) {
      this.enqueueError(error instanceof Error ? error.message : "RoomAgent 行动处理失败。", sessionId);
    } finally {
      this.running = false;
    }
  }

  private enqueue(event: AgentRuntimeEvent, options: EnqueueOptions = {}) {
    const sessionId = options.sessionId ?? this.sessionId;
    const envelope: AgentEventEnvelope = {
      ...event,
      type: "agent.event",
      id: randomUUID(),
      seq: ++this.seq,
      sessionId,
      priority: options.priority ?? "normal",
      scope: options.scope,
      createdAt: new Date().toISOString(),
    };

    const delayMs = options.delayMs ?? 0;
    if (delayMs > 0) {
      setTimeout(() => {
        this.queue.push(envelope);
        writeAgentEventLog(envelope);
        this.scheduleFlush();
      }, delayMs);
      return envelope;
    }

    this.queue.push(envelope);
    writeAgentEventLog(envelope);
    this.scheduleFlush();
    return envelope;
  }

  private finalizeAction({
    baseSession,
    caseData,
    discovery,
    finalState,
    input,
    result,
    resultText,
    sessionId,
  }: FinalizeActionOptions) {
    this.enqueue(
      {
        event: "game.action.result",
        channel: "game",
        payload: {
          sessionId,
          resultText,
          parsedAction: result.parsedAction,
          unlockedEvidence: discovery?.addedEvidence ?? buildVisibleEvidence(caseData, finalState).filter((evidence) =>
            result.unlockedEvidence.some((item) => item.id === evidence.id),
          ),
          unlockedLocations: discovery?.addedLocations ?? buildVisibleLocations(caseData, finalState).filter((location) =>
            result.unlockedLocations.some((item) => item.id === location.id),
          ),
          unlockedSuspects: discovery?.addedSuspects ?? buildVisibleSuspects(caseData, finalState).filter((suspect) =>
            result.unlockedSuspects.some((item) => item.id === suspect.id),
          ),
        },
      },
      { priority: "critical", sessionId, scope: "action" },
    );

    const statePatch = buildStatePatch(buildPublicState(baseSession.state), buildPublicState(finalState));
    if (hasStatePatch(statePatch)) {
      this.enqueue(
        {
          event: "game.state.patch",
          channel: "game",
          payload: {
            sessionId,
            resultText,
            statePatch,
          },
        },
        { priority: "critical", sessionId, scope: "state" },
      );
    }

    this.enqueueActionMetadata(caseData, baseSession.state, {
      ...result,
      state: finalState,
      resultText,
      unlockedEvidence: result.unlockedEvidence,
      unlockedLocations: result.unlockedLocations,
      unlockedSuspects: result.unlockedSuspects,
    });
    if (discovery) this.enqueueDiscoveryMetadata(sessionId, discovery);

    const updated = updateSession(sessionId, {
      caseData,
      state: finalState,
    });
    const finalSession = updated ?? { ...baseSession, caseData, state: finalState };
    const visualEvidence = this.selectRuntimeEvidenceVisuals({
      discovery,
      input,
      reply: resultText,
      result,
      session: finalSession,
    });
    if (visualEvidence.length) {
      this.generateEvidenceVisualsInBackground(finalSession, visualEvidence);
    }
    this.enqueueBackgroundMetadata(finalSession);
    return finalSession;
  }

  private structureDiscoveryInBackground({
    caseData,
    fallbackDiscovery,
    history,
    input,
    reply,
    result,
    sessionId,
    state,
  }: {
    caseData: CaseData;
    fallbackDiscovery: RuntimeDiscovery;
    history: GameSession["chatHistory"];
    input: string;
    reply: string;
    result: ActionResult;
    sessionId: string;
    state: PlayerCaseState;
  }) {
    void (async () => {
      try {
        this.enqueueStatus("正在补全本轮发现的归档...", "background", sessionId);
        const discovery = await withTimeout(
          structureRuntimeDiscoveryFromReply({
            input,
            reply,
            caseData,
            history,
            result,
            state,
          }),
          15000,
          "动态发现归档超时。",
        );

        const latest = getSession(sessionId);
        if (!latest) return;

        const fallbackEvidenceIds = new Set(fallbackDiscovery.addedEvidence.map((item) => item.id));
        const fallbackLocationIds = new Set(fallbackDiscovery.addedLocations.map((item) => item.id));
        const fallbackSuspectIds = new Set(fallbackDiscovery.addedSuspects.map((item) => item.id));
        const fallbackTimelineIds = new Set(fallbackDiscovery.addedTimeline.map((item) => item.id));
        const fallbackRelationshipIds = new Set(fallbackDiscovery.addedRelationships.map((item) => item.id));
        const mergedTruth = {
          ...latest.caseData.truth,
          keyEvidence: Array.from(new Set([...latest.caseData.truth.keyEvidence, ...discovery.caseData.truth.keyEvidence])),
          keyTimeline: Array.from(new Set([...latest.caseData.truth.keyTimeline, ...discovery.caseData.truth.keyTimeline])),
        };
        const mergedCaseData: CaseData = {
          ...latest.caseData,
          evidence: [
            ...latest.caseData.evidence.filter((item) => !(discovery.addedEvidence.length && fallbackEvidenceIds.has(item.id))),
            ...discovery.addedEvidence.filter((item) => !latest.caseData.evidence.some((existing) => existing.id === item.id)),
          ],
          locations: [
            ...latest.caseData.locations.filter((item) => !(discovery.addedLocations.length && fallbackLocationIds.has(item.id))),
            ...discovery.addedLocations.filter((item) => !latest.caseData.locations.some((existing) => existing.id === item.id)),
          ],
          suspects: [
            ...latest.caseData.suspects.filter((item) => !(discovery.addedSuspects.length && fallbackSuspectIds.has(item.id))),
            ...discovery.addedSuspects.filter((item) => !latest.caseData.suspects.some((existing) => existing.id === item.id)),
          ],
          timeline: [
            ...latest.caseData.timeline.filter((item) => !(discovery.addedTimeline.length && fallbackTimelineIds.has(item.id))),
            ...discovery.addedTimeline.filter((item) => !latest.caseData.timeline.some((existing) => existing.id === item.id)),
          ],
          relationships: [
            ...latest.caseData.relationships.filter((item) => !(discovery.addedRelationships.length && fallbackRelationshipIds.has(item.id))),
            ...discovery.addedRelationships.filter((item) => !latest.caseData.relationships.some((existing) => existing.id === item.id)),
          ],
          truth: mergedTruth,
        };
        const mergedState: PlayerCaseState = {
          ...latest.state,
          discoveredEvidence: Array.from(
            new Set([
              ...latest.state.discoveredEvidence.filter((id) => !(discovery.addedEvidence.length && fallbackEvidenceIds.has(id))),
              ...discovery.addedEvidence.map((item) => item.id),
            ]),
          ),
          unlockedLocations: Array.from(
            new Set([
              ...latest.state.unlockedLocations.filter((id) => !(discovery.addedLocations.length && fallbackLocationIds.has(id))),
              ...discovery.addedLocations.map((item) => item.id),
            ]),
          ),
          visibleSuspects: Array.from(
            new Set([
              ...latest.state.visibleSuspects.filter((id) => !(discovery.addedSuspects.length && fallbackSuspectIds.has(id))),
              ...discovery.addedSuspects.map((item) => item.id),
              ...discovery.addedEvidence.flatMap((item) => item.relatedSuspects),
              ...discovery.addedTimeline.flatMap((item) => item.relatedSuspects),
              ...discovery.addedRelationships.flatMap((item) => [item.from, item.to]),
            ].filter((id) => mergedCaseData.suspects.some((suspect) => suspect.id === id))),
          ),
          playerTimeline: [
            ...latest.state.playerTimeline.filter((item) => !(discovery.addedTimeline.length && fallbackTimelineIds.has(item.id))),
            ...discovery.addedTimeline.filter((item) => !latest.state.playerTimeline.some((existing) => existing.id === item.id)),
          ],
          playerRelationships: [
            ...latest.state.playerRelationships.filter((item) => !(discovery.addedRelationships.length && fallbackRelationshipIds.has(item.id))),
            ...discovery.addedRelationships.filter((item) => !latest.state.playerRelationships.some((existing) => existing.id === item.id)),
          ],
          notes: Array.from(new Set([...latest.state.notes, ...discovery.notes])).slice(-20),
        };

        updateSession(sessionId, {
          caseData: mergedCaseData,
          state: mergedState,
        });
        this.enqueueRuntimeDiscoveryReplacement(sessionId, fallbackDiscovery, discovery);
        this.enqueueDiscoveryMetadata(sessionId, {
          ...discovery,
          caseData: mergedCaseData,
          state: mergedState,
        });
        const statePatch = buildStatePatch(buildPublicState(latest.state), buildPublicState(mergedState));
        if (hasStatePatch(statePatch)) {
          this.enqueue(
            {
              event: "game.state.patch",
              channel: "game",
              payload: {
                sessionId,
                resultText: reply,
                statePatch,
              },
            },
            { priority: "background", sessionId, scope: "state.discovery" },
          );
        }
        this.enqueueBackgroundMetadata({ ...latest, caseData: mergedCaseData, state: mergedState });
      } catch (error) {
        const message = error instanceof Error ? error.message : "动态发现归档失败。";
        this.enqueueStatus(`本轮发现已先粗归档，精细归档稍后可重试：${message.slice(0, 80)}`, "background", sessionId);
        this.enqueueDiscoveryMetadata(sessionId, fallbackDiscovery);
      }
    })();
  }

  private selectRuntimeEvidenceVisuals({
    discovery,
    input,
    reply,
    result,
    session,
  }: {
    discovery?: RuntimeDiscovery;
    input: string;
    reply: string;
    result: ActionResult;
    session: GameSession;
  }) {
    if (!shouldGenerateRuntimeVisualAssets()) return [];

    const selected = new Map<string, CaseData["evidence"][number]>();
    for (const evidence of discovery?.addedEvidence ?? result.unlockedEvidence) {
      selected.set(evidence.id, evidence);
    }

    if (textSuggestsRuntimeVisual(input)) {
      for (const evidence of buildVisibleEvidence(session.caseData, session.state)) {
        if (evidenceMatchesText(evidence, input, reply)) selected.set(evidence.id, evidence);
      }
    }

    const limit = Math.max(1, Number(process.env.CASE_VISUALS_RUNTIME_LIMIT ?? 2));
    return Array.from(selected.values()).slice(0, limit);
  }

  private generateEvidenceVisualsInBackground(session: GameSession, evidenceItems: CaseData["evidence"]) {
    if (!shouldGenerateRuntimeVisualAssets()) return;
    if (!session.visualManifest?.cacheId || !evidenceItems.length) return;
    const cacheId = session.visualManifest.cacheId;

    void (async () => {
      for (const evidence of evidenceItems) {
        try {
          const latest = getSession(session.sessionId) ?? session;
          const manifest = latest.visualManifest;
          if (!manifest || manifest.assets.some((asset) => asset.entityId === evidence.id && asset.kind === "evidence")) {
            continue;
          }

          const pendingAsset = createPendingEvidenceVisualAsset({ cacheId, evidence, manifest });
          const pendingManifest: CaseVisualManifest = {
            ...manifest,
            assets: [...manifest.assets.filter((item) => item.id !== pendingAsset.id), pendingAsset],
            updatedAt: pendingAsset.updatedAt,
          };
          updateSession(session.sessionId, { visualManifest: pendingManifest });
          this.enqueueVisualAssetPending(session.sessionId, pendingAsset);
          this.enqueueStatus(`正在整理「${evidence.title}」的证据影像...`, "background", session.sessionId);

          const asset = await generateEvidenceVisualAsset({ cacheId, evidence, manifest: pendingManifest });
          const latestAfterGeneration = getSession(session.sessionId) ?? {
            ...latest,
            visualManifest: pendingManifest,
          };
          const activeManifest = latestAfterGeneration.visualManifest ?? pendingManifest;
          const existingAsset = activeManifest.assets.find((item) => item.id === pendingAsset.id);
          const revealedAt = existingAsset?.revealedAt ?? new Date().toISOString();
          const readyAsset: VisualAsset = {
            ...asset,
            createdAt: existingAsset?.createdAt ?? asset.createdAt,
            revealedAt,
            tags: Array.from(new Set([...asset.tags, "runtime-demand"])),
            updatedAt: new Date().toISOString(),
          };
          const updatedManifest: CaseVisualManifest = {
            ...activeManifest,
            assets: [...activeManifest.assets.filter((item) => item.id !== readyAsset.id), readyAsset],
            updatedAt: new Date().toISOString(),
          };
          const updatedSession = updateSession(session.sessionId, { visualManifest: updatedManifest }) ?? {
            ...latestAfterGeneration,
            visualManifest: updatedManifest,
          };
          this.enqueueVisualAssetReady(session.sessionId, readyAsset);
          this.enqueueVisualFocus(updatedSession, {
            mode: "evidence",
            entityId: evidence.id,
            asset: readyAsset,
            reason: "evidence_unlocked",
            intensity: "pulse",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "证据影像生成失败。";
          this.enqueueStatus(`证据影像稍后再补：${message.slice(0, 80)}`, "background", session.sessionId);
        }
      }
    })();
  }

  private enqueueRuntimeDiscoveryReplacement(sessionId: string, fallbackDiscovery: RuntimeDiscovery, discovery: RuntimeDiscovery) {
    if (fallbackDiscovery.addedEvidence.length && discovery.addedEvidence.length) {
      this.enqueue(
        {
          event: "metadata.patch",
          channel: "metadata",
          payload: {
            sessionId,
            scope: "evidence",
            mode: "patch",
            removedIds: fallbackDiscovery.addedEvidence.map((item) => item.id),
          },
        },
        { priority: "background", sessionId, scope: "evidence.discovery.replace" },
      );
    }

    if (fallbackDiscovery.addedLocations.length && discovery.addedLocations.length) {
      this.enqueue(
        {
          event: "metadata.patch",
          channel: "metadata",
          payload: {
            sessionId,
            scope: "locations",
            mode: "patch",
            removedIds: fallbackDiscovery.addedLocations.map((item) => item.id),
          },
        },
        { priority: "background", sessionId, scope: "locations.discovery.replace" },
      );
    }

    if (fallbackDiscovery.addedSuspects.length && discovery.addedSuspects.length) {
      this.enqueue(
        {
          event: "metadata.patch",
          channel: "metadata",
          payload: {
            sessionId,
            scope: "suspects",
            mode: "patch",
            removedIds: fallbackDiscovery.addedSuspects.map((item) => item.id),
          },
        },
        { priority: "background", sessionId, scope: "suspects.discovery.replace" },
      );
    }
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, 10);
  }

  private flush() {
    if (!this.queue.length) return;
    const events = this.queue
      .splice(0)
      .sort((a, b) => a.seq - b.seq);

    for (const event of events) {
      writeAgentDispatchLog(event, this.subscribers.size);
      for (const subscriber of this.subscribers.values()) {
        subscriber.send(event);
      }
    }
  }

  private enqueueStatus(text: string, priority: AgentEventPriority = "normal", sessionId = this.sessionId) {
    this.enqueue(
      {
        event: "agent.status",
        channel: "agent",
        payload: { text },
      },
      { priority, sessionId },
    );
  }

  private enqueueError(message: string, sessionId = this.sessionId) {
    this.enqueue(
      {
        event: "agent.error",
        channel: "agent",
        payload: { message },
      },
      { priority: "critical", sessionId },
    );
  }

  private enqueueChatMode(mode: ChatMode, sessionId = this.sessionId) {
    this.enqueue(
      {
        event: "chat.mode.changed",
        channel: "agent",
        payload: mode,
      },
      { priority: "critical", sessionId, scope: "chat.mode" },
    );
  }

  private visualAssetFor(
    manifest: CaseVisualManifest | undefined,
    options: { entityId?: string; kind?: VisualAsset["kind"] },
  ) {
    if (!manifest) return undefined;
    return manifest.assets.find((asset) => {
      if (asset.status !== "ready" && asset.source !== "fallback") return false;
      if (options.entityId && asset.entityId !== options.entityId) return false;
      if (options.kind && asset.kind !== options.kind) return false;
      return true;
    });
  }

  private canRevealVisual(session: GameSession, asset: VisualAsset | undefined) {
    if (!asset) return false;
    if (asset.revealedAt) return true;
    if (asset.visibility === "opening") return true;
    if (asset.visibility === "location_visible") {
      return !asset.entityId || session.state.unlockedLocations.includes(asset.entityId) || asset.revealConditions.some((id) => session.state.unlockedLocations.includes(id));
    }
    if (asset.visibility === "suspect_visible") {
      return !asset.entityId || session.state.visibleSuspects.includes(asset.entityId);
    }
    if (asset.visibility === "evidence_discovered") {
      return !asset.entityId || session.state.discoveredEvidence.includes(asset.entityId);
    }
    if (asset.visibility === "timeline_visible") {
      return !asset.entityId || session.state.playerTimeline.some((event) => event.id === asset.entityId);
    }
    if (asset.visibility === "relationship_visible") {
      return !asset.entityId || session.state.playerRelationships.some((relationship) => relationship.id === asset.entityId);
    }
    return false;
  }

  private enqueueVisualManifest(session: GameSession) {
    if (!session.visualManifest) return;
    this.enqueue(
      {
        event: "visual.manifest.ready",
        channel: "metadata",
        payload: { sessionId: session.sessionId, manifest: publicVisualManifest(session.visualManifest) },
      },
      { priority: "normal", sessionId: session.sessionId, scope: "visual.manifest" },
    );
  }

  private enqueueVisualAssetPending(sessionId: string, asset: VisualAsset) {
    this.enqueue(
      {
        event: "visual.asset.pending",
        channel: "metadata",
        payload: { sessionId, asset: publicVisualAsset(asset) },
      },
      { priority: "normal", sessionId, scope: "visual.asset" },
    );
  }

  private enqueueVisualAssetReady(sessionId: string, asset: VisualAsset) {
    this.enqueue(
      {
        event: "visual.asset.ready",
        channel: "metadata",
        payload: { sessionId, asset: publicVisualAsset(asset) },
      },
      { priority: "normal", sessionId, scope: "visual.asset" },
    );
  }

  private enqueueChatVisualAttachment(session: GameSession, turnId: string, asset: VisualAsset) {
    this.enqueue(
      {
        event: "chat.attachment.added",
        channel: "agent",
        payload: {
          sessionId: session.sessionId,
          turnId,
          asset: publicVisualAsset(asset),
        },
      },
      { priority: "normal", sessionId: session.sessionId, scope: "chat.attachment" },
    );
  }

  private revealTriggeredVisualAssets({
    input,
    reply,
    session,
    turnId,
  }: {
    input: string;
    reply: string;
    session: GameSession;
    turnId: string;
  }) {
    const manifest = session.visualManifest;
    if (!manifest) return session;

    const candidates = manifest.assets
      .filter((asset) => {
        if (asset.visibility === "opening" || asset.revealedAt) return false;
        if (asset.status !== "ready" && asset.source !== "fallback") return false;
        if (!asset.fileUrl && !asset.thumbUrl) return false;
        if (!visualAssetHasAvailableContext(asset, session.state)) return false;
        return visualAssetMatchesText(asset, input, reply);
      })
      .slice(0, 2);

    if (!candidates.length) return session;

    const revealedAt = new Date().toISOString();
    const revealedIds = new Set(candidates.map((asset) => asset.id));
    const updatedManifest: CaseVisualManifest = {
      ...manifest,
      assets: manifest.assets.map((asset) => (revealedIds.has(asset.id) ? { ...asset, revealedAt, updatedAt: revealedAt } : asset)),
      updatedAt: revealedAt,
    };
    const updatedSession = updateSession(session.sessionId, { visualManifest: updatedManifest }) ?? {
      ...session,
      visualManifest: updatedManifest,
    };

    for (const asset of updatedManifest.assets.filter((item) => revealedIds.has(item.id))) {
      this.enqueueVisualAssetReady(session.sessionId, asset);
      this.enqueueChatVisualAttachment(updatedSession, turnId, asset);
      this.enqueueVisualFocus(updatedSession, {
        mode: asset.kind === "evidence" || asset.kind === "clue_object" ? "evidence" : asset.kind === "location" ? "scene" : "case",
        entityId: asset.entityId,
        asset,
        reason: "assistant_reference",
        intensity: "spotlight",
      });
    }

    return updatedSession;
  }

  private enqueueVisualFocus(
    session: GameSession,
    focus: Omit<VisualFocusPayload, "sessionId" | "assetId" | "title"> & { asset?: VisualAsset },
  ) {
    const asset = focus.asset;
    if (asset && !this.canRevealVisual(session, asset)) return;

    this.enqueue(
      {
        event: "visual.focus.changed",
        channel: "metadata",
        payload: {
          sessionId: session.sessionId,
          mode: focus.mode,
          ...(asset ? { assetId: asset.id, title: asset.title } : {}),
          ...(focus.entityId ? { entityId: focus.entityId } : asset?.entityId ? { entityId: asset.entityId } : {}),
          reason: focus.reason,
          intensity: focus.intensity ?? "quiet",
        },
      },
      { priority: "normal", sessionId: session.sessionId, scope: "visual.focus" },
    );
  }

  private assetForVisualDecision(
    session: GameSession,
    decision: Omit<VisualFocusPayload, "sessionId" | "assetId" | "title">,
  ) {
    if (!decision.entityId) return undefined;
    if (decision.mode === "suspect") {
      return this.visualAssetFor(session.visualManifest, { kind: "suspect_portrait", entityId: decision.entityId });
    }
    if (decision.mode === "evidence") {
      return this.visualAssetFor(session.visualManifest, { kind: "evidence", entityId: decision.entityId });
    }
    if (decision.mode === "scene") {
      return this.visualAssetFor(session.visualManifest, { kind: "location", entityId: decision.entityId });
    }
    return this.visualAssetFor(session.visualManifest, { entityId: decision.entityId });
  }

  private streamChatMessage({
    label,
    sessionId = this.sessionId,
    speaker,
    suspectId,
    text,
    turnId = randomUUID(),
  }: {
    label?: string;
    sessionId?: string;
    speaker: "assistant" | "suspect" | "system";
    suspectId?: string;
    text: string;
    turnId?: string;
  }) {
    const messageId = randomUUID();
    this.enqueue(
      {
        event: "chat.message.started",
        channel: "agent",
        payload: { turnId, messageId, speaker, suspectId, label },
      },
      { priority: "critical", sessionId, scope: "chat" },
    );

    let delayMs = 40;
    for (const chunk of splitTextForStream(text)) {
      this.enqueue(
        {
          event: "chat.delta",
          channel: "agent",
          payload: { turnId, messageId, speaker, suspectId, label, text: chunk },
        },
        { priority: "normal", sessionId, scope: "chat.delta", delayMs },
      );
      delayMs += 18;
    }

    this.enqueue(
      {
        event: "chat.message.finished",
        channel: "agent",
        payload: { turnId, messageId, speaker, suspectId, label, text },
      },
      { priority: "normal", sessionId, scope: "chat", delayMs: delayMs + 10 },
    );
  }

  private async streamFixedChatMessage({
    label,
    sessionId = this.sessionId,
    speaker,
    suspectId,
    text,
    turnId = randomUUID(),
  }: {
    label?: string;
    sessionId?: string;
    speaker: "assistant" | "suspect" | "system";
    suspectId?: string;
    text: string;
    turnId?: string;
  }) {
    const messageId = randomUUID();
    this.enqueue(
      {
        event: "chat.message.started",
        channel: "agent",
        payload: { turnId, messageId, speaker, suspectId, label },
      },
      { priority: "critical", sessionId, scope: "chat" },
    );

    for (const chunk of splitTextForStream(text)) {
      await sleep(16);
      this.enqueue(
        {
          event: "chat.delta",
          channel: "agent",
          payload: { turnId, messageId, speaker, suspectId, label, text: chunk },
        },
        { priority: "normal", sessionId, scope: "chat.delta" },
      );
    }

    this.enqueue(
      {
        event: "chat.message.finished",
        channel: "agent",
        payload: { turnId, messageId, speaker, suspectId, label, text },
      },
      { priority: "normal", sessionId, scope: "chat" },
    );

    if (sessionId) {
      appendSessionChatMessage(sessionId, {
        role: "assistant",
        speaker,
        suspectId,
        label,
        text,
      });
    }
  }

  private async streamAiOrFallbackChatMessage({
    chatMode,
    fallbackText,
    input,
    label,
    result,
    route,
    session,
    sessionId = this.sessionId,
    speaker,
    suspect,
    suspectId,
    turnId = randomUUID(),
  }: {
    chatMode: ChatMode;
    fallbackText: string;
    input: string;
    label?: string;
    result: ActionResult;
    route: ChatRoute;
    session: GameSession;
    sessionId?: string;
    speaker: "assistant" | "suspect";
    suspect?: SuspectProfile;
    suspectId?: string;
    turnId?: string;
  }) {
    const messageId = randomUUID();
    let fullText = "";
    let receivedAiContent = false;

    this.enqueue(
      {
        event: "chat.message.started",
        channel: "agent",
        payload: { turnId, messageId, speaker, suspectId, label },
      },
      { priority: "critical", sessionId, scope: "chat" },
    );

    let aiBuffer = "";
    const emitChunk = (text: string) => {
      const sanitizedText = sanitizePlayerFacingText(text, session.caseData);
      if (!sanitizedText) return;
      fullText += sanitizedText;
      this.enqueue(
        {
          event: "chat.delta",
          channel: "agent",
          payload: { turnId, messageId, speaker, suspectId, label, text: sanitizedText },
        },
        { priority: "normal", sessionId, scope: "chat.delta" },
      );
    };
    const flushAiBuffer = () => {
      if (!aiBuffer) return;
      const chunk = aiBuffer;
      aiBuffer = "";
      emitChunk(chunk);
    };
    const emitAiContent = (content: string) => {
      aiBuffer += content;
      if (!shouldHoldPlayerFacingBuffer(aiBuffer) && (aiBuffer.length >= 14 || /[。！？；，、\n]/.test(content))) {
        flushAiBuffer();
      }
    };

    try {
      const aiText = await streamAiChatReply({
        chatMode,
        fallbackText,
        input,
        nextState: result.state,
        onContent(content) {
          receivedAiContent = true;
          emitAiContent(content);
        },
        result,
        route,
        session,
        speaker,
        suspect,
      });
      flushAiBuffer();

      if (!receivedAiContent) {
        for (const chunk of splitTextForStream(aiText)) {
          emitChunk(chunk);
          await sleep(12);
        }
      }
    } catch (error) {
      flushAiBuffer();
      const message = error instanceof Error ? error.message : "AI 对话生成失败。";
      if (fullText.trim()) {
        this.enqueueStatus(`AI 对话流提前结束：${message.slice(0, 80)}`, "normal", sessionId);
      } else {
        this.enqueueStatus(`AI 对话暂不可用，已切回本地回复：${message.slice(0, 80)}`, "normal", sessionId);
        for (const chunk of splitTextForStream(fallbackText)) {
          emitChunk(chunk);
          await sleep(12);
        }
      }
    }

    const finalText = sanitizePlayerFacingText(fullText.trim() || fallbackText, session.caseData);
    this.enqueue(
      {
        event: "chat.message.finished",
        channel: "agent",
        payload: { turnId, messageId, speaker, suspectId, label, text: finalText },
      },
      { priority: "normal", sessionId, scope: "chat" },
    );

    if (sessionId) {
      appendSessionChatMessage(sessionId, {
        role: "assistant",
        speaker,
        suspectId,
        label,
        text: finalText,
      });
    }

    return finalText;
  }

  private async streamRuntimeDiscoveryChatMessage({
    caseData,
    fallbackText,
    history,
    input,
    label,
    result,
    sessionId = this.sessionId,
    state,
    turnId = randomUUID(),
  }: {
    caseData: CaseData;
    fallbackText: string;
    history: GameSession["chatHistory"];
    input: string;
    label?: string;
    result: ActionResult;
    sessionId?: string;
    state: PlayerCaseState;
    turnId?: string;
  }) {
    const messageId = randomUUID();
    let fullText = "";
    let receivedAiContent = false;

    this.enqueue(
      {
        event: "chat.message.started",
        channel: "agent",
        payload: { turnId, messageId, speaker: "assistant", label },
      },
      { priority: "critical", sessionId, scope: "chat" },
    );

    let aiBuffer = "";
    const emitChunk = (text: string) => {
      const sanitizedText = sanitizePlayerFacingText(text, caseData);
      if (!sanitizedText) return;
      fullText += sanitizedText;
      this.enqueue(
        {
          event: "chat.delta",
          channel: "agent",
          payload: { turnId, messageId, speaker: "assistant", label, text: sanitizedText },
        },
        { priority: "normal", sessionId, scope: "chat.delta" },
      );
    };
    const flushAiBuffer = () => {
      if (!aiBuffer) return;
      const chunk = aiBuffer;
      aiBuffer = "";
      emitChunk(chunk);
    };
    const emitAiContent = (content: string) => {
      aiBuffer += content;
      if (!shouldHoldPlayerFacingBuffer(aiBuffer) && (aiBuffer.length >= 10 || /[。！？；，、\n]/.test(content))) {
        flushAiBuffer();
      }
    };

    try {
      const aiText = await streamRuntimeDiscoveryReply({
        input,
        caseData,
        history,
        result,
        state,
        onContent(content) {
          receivedAiContent = true;
          emitAiContent(content);
        },
      });
      flushAiBuffer();

      if (!receivedAiContent) {
        for (const chunk of splitTextForStream(aiText)) {
          emitChunk(chunk);
          await sleep(12);
        }
      }
    } catch (error) {
      flushAiBuffer();
      const message = error instanceof Error ? error.message : "AI 调查流生成失败。";
      if (fullText.trim()) {
        this.enqueueStatus(`AI 调查流提前结束：${message.slice(0, 80)}`, "normal", sessionId);
      } else {
        this.enqueueStatus(`AI 调查暂不可用，已切回本地回复：${message.slice(0, 80)}`, "normal", sessionId);
        for (const chunk of splitTextForStream(fallbackText)) {
          emitChunk(chunk);
          await sleep(12);
        }
      }
    }

    const finalText = sanitizePlayerFacingText(fullText.trim() || fallbackText, caseData);
    this.enqueue(
      {
        event: "chat.message.finished",
        channel: "agent",
        payload: { turnId, messageId, speaker: "assistant", label, text: finalText },
      },
      { priority: "normal", sessionId, scope: "chat" },
    );

    if (sessionId) {
      appendSessionChatMessage(sessionId, {
        role: "assistant",
        speaker: "assistant",
        label,
        text: finalText,
      });
    }

    return finalText;
  }

  private finishTurn(sessionId: string, turnId: string) {
    this.enqueue(
      {
        event: "turn.finished",
        channel: "game",
        payload: { sessionId, turnId },
      },
      { priority: "normal", sessionId, scope: "turn.finished", delayMs: 180 },
    );
  }

  private enqueueMetadata(
    session: GameSession,
    scope: AgentMetadataScope,
    data: unknown,
    options: Omit<EnqueueOptions, "sessionId" | "scope"> = {},
  ) {
    this.enqueue(
      {
        event: "metadata.patch",
        channel: "metadata",
        payload: {
          sessionId: session.sessionId,
          scope,
          mode: "snapshot",
          data,
        },
      },
      {
        priority: options.priority ?? "background",
        delayMs: options.delayMs,
        sessionId: session.sessionId,
        scope,
      },
    );
  }

  private scheduleOpeningMetadata(session: GameSession) {
    this.enqueueMetadata(session, "currentLocation", buildCurrentLocationMetadata(session.caseData, session.state), {
      priority: "normal",
      delayMs: 80,
    });
    this.enqueueMetadata(session, "clues", buildVisibleClues(session.caseData, session.state), {
      priority: "normal",
      delayMs: 160,
    });
    this.enqueueMetadata(session, "locations", buildVisibleLocations(session.caseData, session.state), {
      priority: "background",
      delayMs: 320,
    });
    this.enqueueMetadata(session, "evidence", buildVisibleEvidence(session.caseData, session.state), {
      priority: "background",
      delayMs: 480,
    });
    this.enqueueMetadata(session, "suspects", buildVisibleSuspects(session.caseData, session.state), {
      priority: "background",
      delayMs: 620,
    });
    this.enqueueMetadata(session, "recommendations", buildRecommendedCommands(session.caseData, session.state), {
      priority: "background",
      delayMs: 740,
    });
  }

  private enqueueActionMetadata(caseData: CaseData, previousState: PlayerCaseState, result: ActionResult) {
    const session = getSession(this.sessionId ?? "");
    if (!session) return;
    const projectedSession: GameSession = {
      ...session,
      caseData,
      state: result.state,
    };

    if (previousState.currentLocation !== result.state.currentLocation) {
      this.enqueueVisualFocus(projectedSession, {
        mode: "scene",
        entityId: result.state.currentLocation,
        asset: this.visualAssetFor(projectedSession.visualManifest, {
          entityId: result.state.currentLocation,
          kind: "location",
        }),
        reason: "location_changed",
        intensity: "pulse",
      });
      this.enqueueMetadata(projectedSession, "currentLocation", buildCurrentLocationMetadata(caseData, result.state), {
        priority: "critical",
      });
      this.enqueueMetadata(projectedSession, "clues", buildVisibleClues(caseData, result.state), {
        priority: "normal",
        delayMs: 80,
      });
    }

    if (result.unlockedEvidence.length) {
      const spotlightEvidence = result.unlockedEvidence[0];
      if (spotlightEvidence) {
        this.enqueueVisualFocus(projectedSession, {
          mode: "evidence",
          entityId: spotlightEvidence.id,
          asset: this.visualAssetFor(projectedSession.visualManifest, {
            entityId: spotlightEvidence.id,
            kind: "evidence",
          }),
          reason: "evidence_unlocked",
          intensity: "spotlight",
        });
      }
      this.enqueue(
        {
          event: "metadata.patch",
          channel: "metadata",
          payload: {
            sessionId: projectedSession.sessionId,
            scope: "evidence",
            mode: "patch",
            added: buildVisibleEvidence(caseData, result.state).filter((evidence) =>
              result.unlockedEvidence.some((item) => item.id === evidence.id),
            ),
          },
        },
        { priority: "normal", sessionId: projectedSession.sessionId, scope: "evidence" },
      );
    }

    if (result.unlockedLocations.length) {
      this.enqueue(
        {
          event: "metadata.patch",
          channel: "metadata",
          payload: {
            sessionId: projectedSession.sessionId,
            scope: "locations",
            mode: "patch",
            added: buildVisibleLocations(caseData, result.state).filter((location) =>
              result.unlockedLocations.some((item) => item.id === location.id),
            ),
          },
        },
        { priority: "normal", sessionId: projectedSession.sessionId, scope: "locations" },
      );
    }

    if (result.unlockedSuspects.length) {
      this.enqueue(
        {
          event: "metadata.patch",
          channel: "metadata",
          payload: {
            sessionId: projectedSession.sessionId,
            scope: "suspects",
            mode: "patch",
            added: buildVisibleSuspects(caseData, result.state).filter((suspect) =>
              result.unlockedSuspects.some((item) => item.id === suspect.id),
            ),
          },
        },
        { priority: "normal", sessionId: projectedSession.sessionId, scope: "suspects" },
      );
    }

    this.enqueueMetadata(projectedSession, "recommendations", buildRecommendedCommands(caseData, result.state), {
      priority: "background",
      delayMs: 160,
    });
  }

  private enqueueDiscoveryMetadata(sessionId: string, discovery: RuntimeDiscovery) {
    if (discovery.addedEvidence.length) {
      this.enqueue(
        {
          event: "metadata.patch",
          channel: "metadata",
          payload: {
            sessionId,
            scope: "evidence",
            mode: "patch",
            added: buildVisibleEvidence(discovery.caseData, discovery.state).filter((evidence) =>
              discovery.addedEvidence.some((item) => item.id === evidence.id),
            ),
          },
        },
        { priority: "critical", sessionId, scope: "evidence.discovery" },
      );
    }

    if (discovery.addedLocations.length) {
      this.enqueue(
        {
          event: "metadata.patch",
          channel: "metadata",
          payload: {
            sessionId,
            scope: "locations",
            mode: "patch",
            added: buildVisibleLocations(discovery.caseData, discovery.state).filter((location) =>
              discovery.addedLocations.some((item) => item.id === location.id),
            ),
          },
        },
        { priority: "normal", sessionId, scope: "locations.discovery" },
      );
    }

    if (discovery.state.visibleSuspects.length) {
      this.enqueue(
        {
          event: "metadata.patch",
          channel: "metadata",
          payload: {
            sessionId,
            scope: "suspects",
            mode: "patch",
            added: buildVisibleSuspects(discovery.caseData, discovery.state),
          },
        },
        { priority: "normal", sessionId, scope: "suspects.discovery" },
      );
    }

    if (discovery.addedTimeline.length) {
      this.enqueueMetadata(
        {
          sessionId,
          caseData: discovery.caseData,
          state: discovery.state,
          chatHistory: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        "timeline",
        buildVisibleTimeline(discovery.state),
        { priority: "normal", delayMs: 80 },
      );
    }

    if (discovery.addedRelationships.length) {
      this.enqueueMetadata(
        {
          sessionId,
          caseData: discovery.caseData,
          state: discovery.state,
          chatHistory: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        "relationships",
        buildVisibleRelationships(discovery.caseData, discovery.state),
        { priority: "normal", delayMs: 120 },
      );
    }
  }

  private enqueueBackgroundMetadata(session: GameSession) {
    this.enqueueMetadata(session, "timeline", buildVisibleTimeline(session.state), {
      priority: "background",
      delayMs: 180,
    });
    this.enqueueMetadata(session, "relationships", buildVisibleRelationships(session.caseData, session.state), {
      priority: "background",
      delayMs: 260,
    });
    this.enqueueMetadata(session, "recommendations", buildRecommendedCommands(session.caseData, session.state), {
      priority: "background",
      delayMs: 340,
    });
  }

  private clearIdleHint() {
    if (!this.idleHintTimer) return;
    clearTimeout(this.idleHintTimer);
    this.idleHintTimer = undefined;
  }

  private scheduleIdleHint(session: GameSession) {
    this.clearIdleHint();
    this.idleHintTimer = setTimeout(() => {
      const commands = buildRecommendedCommands(session.caseData, session.state).slice(0, 3);
      this.enqueue(
        {
          event: "agent.hint",
          channel: "agent",
          payload: {
            text: "我先停在这里，你继续按你想追的点问。",
            commands,
          },
        },
        { priority: "background", sessionId: session.sessionId, scope: "idle.hint" },
      );
    }, 12000);
  }
}

const globalStore = globalThis as typeof globalThis & {
  truthDivergenceRoomAgents?: Map<string, RoomAgentRuntime>;
};

const roomAgents = globalStore.truthDivergenceRoomAgents ?? new Map<string, RoomAgentRuntime>();
globalStore.truthDivergenceRoomAgents = roomAgents;

export function getOrCreateRoomAgent(roomId: string = "default") {
  const existing = roomAgents.get(roomId);
  if (existing) return existing;

  const runtime = new RoomAgentRuntime(roomId);
  roomAgents.set(roomId, runtime);
  return runtime;
}
