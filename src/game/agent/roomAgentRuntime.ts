import { randomUUID } from "crypto";
import { claimRandomReadyCase } from "@/game/cache/caseCache";
import { ensureCaseCacheWorkerStarted } from "@/game/cache/caseCacheWorker";
import { applyAction } from "@/game/engine/applyAction";
import {
  appendSessionChatMessage,
  createSession,
  getSession,
  updateSession,
  type GameSession,
} from "@/game/engine/sessions";
import { writeAgentDispatchLog, writeAgentEventLog } from "@/game/agent/eventLog";
import { streamAiChatReply } from "@/game/agent/aiChatRuntime";
import {
  createFallbackRuntimeDiscoveryFromReply,
  streamRuntimeDiscoveryReply,
  structureRuntimeDiscoveryFromReply,
  type RuntimeDiscovery,
} from "@/game/agent/runtimeDiscovery";
import {
  buildAssistantReply,
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

function sessionPayload(
  session: GameSession,
  resultText?: string,
  caseData: CaseData = buildInitialPublicCaseData(session.caseData, session.state),
): AgentSessionPayload {
  return {
    sessionId: session.sessionId,
    caseData,
    state: buildPublicState(session.state),
    ...(resultText ? { resultText } : {}),
  };
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  private chatMode: ChatMode = { mode: "assistant", label: "案件 AI 助手" };
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

  async start() {
    if (this.running) {
      this.enqueueStatus("上一条调查指令仍在处理中。", "normal");
      return;
    }

    this.running = true;
    try {
      ensureCaseCacheWorkerStarted();
      this.enqueueStatus("正在从案件缓存池领取未使用案件...", "critical");

      const cachedCase = await claimRandomReadyCase();
      if (!cachedCase) {
        throw new Error("案件缓存池暂无可用案件。请先运行 npm run cache:worker，或等待后台补充缓存。");
      }

      this.enqueueStatus("案件已领取，正在创建本局调查会话...", "critical");
      const session = createSession({
        caseData: cachedCase.caseData,
        state: cachedCase.state,
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
      this.enqueueChatMode(this.chatMode, session.sessionId);
      this.streamChatMessage({
        sessionId: session.sessionId,
        speaker: "assistant",
        label: "案件 AI 助手",
        text: `案件已接入。你直接问要查什么，我会把查到的记录、证词或现场细节整理出来。\n当前任务：${session.caseData.openingEvent.initialPrompt}`,
      });
      this.scheduleIdleHint(session);
    } catch (error) {
      this.enqueueError(error instanceof Error ? error.message : "RoomAgent 开局失败。");
    } finally {
      this.running = false;
    }
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
      this.sessionId = session.sessionId;

      const turnId = randomUUID();
      this.enqueueStatus("正在理解你的问题...", "critical", sessionId);
      const result = applyAction(trimmed, session.caseData, session.state);
      const route = routeChatCommand(trimmed, session.caseData, result.state, this.chatMode, result.parsedAction);
      appendSessionChatMessage(sessionId, {
        role: "user",
        speaker: "user",
        label: "你",
        text: trimmed,
      });

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
        const refusalText = `${route.reason}\n你可以换成基于证据的问题，例如“比较已发现证据里的时间矛盾”或“用某份证据追问某个人”。`;
        this.streamChatMessage({
          sessionId,
          turnId,
          speaker: "assistant",
          label: "案件 AI 助手",
          text: refusalText,
        });
        appendSessionChatMessage(sessionId, {
          role: "assistant",
          speaker: "assistant",
          label: "案件 AI 助手",
          text: refusalText,
        });
        this.finishTurn(sessionId, turnId);
        this.scheduleIdleHint(session);
        return;
      }

      let speaker: "assistant" | "suspect" = "assistant";
      let suspectId: string | undefined;
      let suspect: SuspectProfile | undefined;
      let label = "案件 AI 助手";
      let replyText = "";
      let activeChatMode = this.chatMode;
      let discovery: RuntimeDiscovery | undefined;
      let shouldStructureDiscovery = false;
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
        if (this.chatMode.mode !== "assistant" && result.parsedAction.intent === "ASK_ASSISTANT") {
          this.chatMode = { mode: "assistant", label: "案件 AI 助手" };
          this.enqueueChatMode(this.chatMode, sessionId);
        }
        activeChatMode = this.chatMode;
        this.enqueueStatus("正在调取相关记录...", "critical", sessionId);
        shouldStructureDiscovery = true;
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
        this.enqueueStatus("正在归档本轮发现...", "normal", sessionId);
        try {
          discovery = await withTimeout(
            structureRuntimeDiscoveryFromReply({
              input: trimmed,
              reply: replyText,
              caseData: session.caseData,
              history: getSession(sessionId)?.chatHistory ?? runtimeHistory,
              result,
              state: result.state,
            }),
            15000,
            "动态发现归档超时。",
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "动态发现归档失败。";
          discovery = createFallbackRuntimeDiscoveryFromReply({
            input: trimmed,
            reply: replyText,
            caseData: session.caseData,
            state: result.state,
          });
          this.enqueueStatus(`本轮回答已完成，已按调查记录归档：${message.slice(0, 80)}`, "normal", sessionId);
        }
      } else {
        await this.streamAiOrFallbackChatMessage({
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

      this.enqueue(
        {
          event: "game.action.result",
          channel: "game",
          payload: {
            sessionId,
            resultText: finalResultText,
            parsedAction: result.parsedAction,
            unlockedEvidence: discovery?.addedEvidence ?? buildVisibleEvidence(finalCaseData, finalState).filter((evidence) =>
              result.unlockedEvidence.some((item) => item.id === evidence.id),
            ),
            unlockedLocations: discovery?.addedLocations ?? buildVisibleLocations(finalCaseData, finalState).filter((location) =>
              result.unlockedLocations.some((item) => item.id === location.id),
            ),
            unlockedSuspects: discovery?.addedSuspects ?? buildVisibleSuspects(finalCaseData, finalState).filter((suspect) =>
              result.unlockedSuspects.some((item) => item.id === suspect.id),
            ),
          },
        },
        { priority: "critical", sessionId, scope: "action" },
      );

      const statePatch = buildStatePatch(buildPublicState(session.state), buildPublicState(finalState));
      if (hasStatePatch(statePatch)) {
        this.enqueue(
          {
            event: "game.state.patch",
            channel: "game",
            payload: {
              sessionId,
              resultText: finalResultText,
              statePatch,
            },
          },
          { priority: "critical", sessionId, scope: "state" },
        );
      }

      this.enqueueActionMetadata(finalCaseData, session.state, {
        ...result,
        state: finalState,
        resultText: finalResultText,
        unlockedEvidence: result.unlockedEvidence,
        unlockedLocations: result.unlockedLocations,
        unlockedSuspects: result.unlockedSuspects,
      });
      if (discovery) this.enqueueDiscoveryMetadata(sessionId, discovery);
      const updated = updateSession(sessionId, {
        caseData: finalCaseData,
        state: finalState,
      });

      const finalSession = updated ?? { ...session, caseData: finalCaseData, state: finalState };
      this.enqueueBackgroundMetadata(finalSession);
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
      this.scheduleIdleHint(finalSession);
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
      if (!text) return;
      fullText += text;
      this.enqueue(
        {
          event: "chat.delta",
          channel: "agent",
          payload: { turnId, messageId, speaker, suspectId, label, text },
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
      if (aiBuffer.length >= 14 || /[。！？；，、\n]/.test(content)) {
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

    const finalText = fullText.trim() || fallbackText;
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
      if (!text) return;
      fullText += text;
      this.enqueue(
        {
          event: "chat.delta",
          channel: "agent",
          payload: { turnId, messageId, speaker: "assistant", label, text },
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
      if (aiBuffer.length >= 10 || /[。！？；，、\n]/.test(content)) {
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

    const finalText = fullText.trim() || fallbackText;
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
      this.enqueueMetadata(projectedSession, "currentLocation", buildCurrentLocationMetadata(caseData, result.state), {
        priority: "critical",
      });
      this.enqueueMetadata(projectedSession, "clues", buildVisibleClues(caseData, result.state), {
        priority: "normal",
        delayMs: 80,
      });
    }

    if (result.unlockedEvidence.length) {
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

    if (discovery.addedSuspects.length) {
      this.enqueue(
        {
          event: "metadata.patch",
          channel: "metadata",
          payload: {
            sessionId,
            scope: "suspects",
            mode: "patch",
            added: buildVisibleSuspects(discovery.caseData, discovery.state).filter((suspect) =>
              discovery.addedSuspects.some((item) => item.id === suspect.id),
            ),
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
            text: commands[0] ? `可以尝试：${commands[0]}` : "可以整理时间线，看看已知事件是否互相冲突。",
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
