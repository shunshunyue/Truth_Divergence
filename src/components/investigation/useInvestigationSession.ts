"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentEventEnvelope,
  AgentMetadataPatchPayload,
  AgentPlayerStatePatch,
  AgentServerEvent,
} from "@/game/agent/events";
import type { CaseData, PlayerCaseState, SuspectState } from "@/game/schemas/game";
import { connectAgentSocket } from "@/components/investigation/agentSocket";
import { deriveInvestigationData } from "@/components/investigation/deriveInvestigationData";
import {
  bootSteps,
  type BootStepId,
  type ChatModeState,
  type InvestigationChatMessage,
  type SessionPayload,
  type VisualFocusState,
} from "@/components/investigation/types";
import type { CaseVisualManifest, VisualAsset } from "@/game/schemas/visuals";

const persistedInvestigationKey = "td-investigation-save-v1";
const legacySessionKey = "td-session";
const chatStreamTickMs = 26;
const chatStreamChunkSize = 3;

type ChatStreamBuffer = {
  finalMessage?: InvestigationChatMessage;
  queue: string;
  timer?: number;
};

const simulatedBootTimeline: Array<{ step: BootStepId; progress: number; status: string; delay: number }> = [
  { step: "core", progress: 18, status: "缓存命中，正在核对案件核心...", delay: 260 },
  { step: "scene", progress: 34, status: "正在装配初始现场和可调查区域...", delay: 720 },
  { step: "clues", progress: 50, status: "正在展开现场线索入口...", delay: 1180 },
  { step: "evidence", progress: 66, status: "正在同步证据索引和解锁条件...", delay: 1680 },
  { step: "agent", progress: 82, status: "正在接入问询路由和评分循环...", delay: 2220 },
  { step: "chat", progress: 96, status: "正在接通案件问答中枢...", delay: 2820 },
  { step: "chat", progress: 100, status: "案件领取完毕，正在校准卷宗画面...", delay: 3420 },
];

const bootCompletionHoldMs = 780;

type PersistedInvestigationSnapshot = {
  version: 1;
  roomId: string;
  session: SessionPayload;
  chatMessages: InvestigationChatMessage[];
  chatMode: ChatModeState;
  actionStatus: string;
  showBriefing: boolean;
  visualFocus: VisualFocusState;
  savedAt: number;
};

function createRoomId() {
  return `room-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function hasBrowserStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionPayload>;
  return (
    typeof candidate.sessionId === "string" &&
    Boolean(candidate.sessionId) &&
    Boolean(candidate.caseData) &&
    Boolean(candidate.state) &&
    (typeof candidate.activatedAt === "undefined" || typeof candidate.activatedAt === "string")
  );
}

function isChatMode(value: unknown): value is ChatModeState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChatModeState>;
  return candidate.mode === "assistant" || candidate.mode === "interrogation";
}

function reviveChatMessages(value: unknown): InvestigationChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((message): message is InvestigationChatMessage => {
      if (!message || typeof message !== "object") return false;
      const candidate = message as Partial<InvestigationChatMessage>;
      return typeof candidate.id === "string" && typeof candidate.turnId === "string" && typeof candidate.text === "string";
    })
    .slice(-80)
    .map((message) => {
      if (!message.pending && !message.clientPending) return message;
      return {
        ...message,
        text: message.placeholder ? "刷新前的回复没有完整同步，可以重新追问这一条。" : message.text,
        pending: false,
        placeholder: false,
        clientPending: false,
      };
    });
}

function loadPersistedInvestigation(): PersistedInvestigationSnapshot | null {
  if (!hasBrowserStorage()) return null;

  try {
    const raw = window.localStorage.getItem(persistedInvestigationKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedInvestigationSnapshot>;
      if (parsed.version === 1 && typeof parsed.roomId === "string" && isSessionPayload(parsed.session)) {
        return {
          version: 1,
          roomId: parsed.roomId || createRoomId(),
          session: parsed.session,
          chatMessages: reviveChatMessages(parsed.chatMessages),
          chatMode: isChatMode(parsed.chatMode) ? parsed.chatMode : { mode: "assistant", label: "真相中枢" },
          actionStatus: typeof parsed.actionStatus === "string" ? parsed.actionStatus : "案件进度已恢复。",
          showBriefing: Boolean(parsed.showBriefing),
          visualFocus: parsed.visualFocus ?? null,
          savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
        };
      }
    }

    const legacyRaw = window.localStorage.getItem(legacySessionKey);
    if (legacyRaw) {
      const legacySession = JSON.parse(legacyRaw) as unknown;
      if (isSessionPayload(legacySession)) {
        return {
          version: 1,
          roomId: createRoomId(),
          session: legacySession,
          chatMessages: [],
          chatMode: { mode: "assistant", label: "真相中枢" },
          actionStatus: "已恢复旧版案件进度。",
          showBriefing: false,
          visualFocus: null,
          savedAt: Date.now(),
        };
      }
    }
  } catch {
    window.localStorage.removeItem(persistedInvestigationKey);
  }

  return null;
}

function persistInvestigationSnapshot(snapshot: PersistedInvestigationSnapshot) {
  if (!hasBrowserStorage()) return;
  window.localStorage.setItem(persistedInvestigationKey, JSON.stringify(snapshot));
  window.localStorage.removeItem(legacySessionKey);
}

function clearPersistedInvestigation() {
  if (!hasBrowserStorage()) return;
  window.localStorage.removeItem(persistedInvestigationKey);
  window.localStorage.removeItem(legacySessionKey);
}

function stepFromStatus(text: string): BootStepId {
  if (text.includes("对话") || text.includes("问答") || text.includes("聊天")) return "chat";
  if (text.includes("Agent") || text.includes("AI")) return "agent";
  if (text.includes("案件")) return "core";
  return "clues";
}

function clampBootProgress(progress: number) {
  return Math.min(96, Math.max(8, progress));
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, { ...byId.get(item.id), ...item });
  }
  return Array.from(byId.values());
}

function removeById<T extends { id: string }>(current: T[], removedIds: string[] | undefined) {
  if (!removedIds?.length) return current;
  const removed = new Set(removedIds);
  return current.filter((item) => !removed.has(item.id));
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function mergeCaseMetadata(caseData: CaseData, patch: AgentMetadataPatchPayload): CaseData {
  if (patch.scope === "case" && patch.mode === "snapshot" && patch.data) {
    return patch.data as CaseData;
  }

  if (patch.scope === "currentLocation" && patch.data) {
    const location = patch.data as CaseData["locations"][number];
    return {
      ...caseData,
      locations: mergeById(caseData.locations, [location]),
    };
  }

  if (patch.scope === "clues" && patch.data) {
    const currentLocation = caseData.locations[0];
    if (!currentLocation) return caseData;
    const clues = asArray<CaseData["locations"][number]["objects"][number]>(patch.data);
    return {
      ...caseData,
      locations: caseData.locations.map((location) =>
        location.id === currentLocation.id ? { ...location, objects: mergeById(location.objects, clues) } : location,
      ),
    };
  }

  if (patch.scope === "locations") {
    const incoming = patch.mode === "snapshot"
      ? asArray<CaseData["locations"][number]>(patch.data)
      : asArray<CaseData["locations"][number]>(patch.added).concat(asArray(patch.updated));
    return {
      ...caseData,
      locations: removeById(mergeById(caseData.locations, incoming), patch.removedIds),
    };
  }

  if (patch.scope === "evidence") {
    const incoming = patch.mode === "snapshot"
      ? asArray<CaseData["evidence"][number]>(patch.data)
      : asArray<CaseData["evidence"][number]>(patch.added).concat(asArray(patch.updated));
    return {
      ...caseData,
      evidence: removeById(mergeById(caseData.evidence, incoming), patch.removedIds),
    };
  }

  if (patch.scope === "suspects") {
    const incoming = patch.mode === "snapshot"
      ? asArray<CaseData["suspects"][number]>(patch.data)
      : asArray<CaseData["suspects"][number]>(patch.added).concat(asArray(patch.updated));
    return {
      ...caseData,
      suspects: removeById(mergeById(caseData.suspects, incoming), patch.removedIds),
    };
  }

  if (patch.scope === "timeline" && patch.data) {
    return {
      ...caseData,
      timeline: mergeById(caseData.timeline, asArray<CaseData["timeline"][number]>(patch.data)),
    };
  }

  if (patch.scope === "relationships" && patch.data) {
    return {
      ...caseData,
      relationships: mergeById(caseData.relationships, asArray<CaseData["relationships"][number]>(patch.data)),
    };
  }

  return caseData;
}

function mergeStatePatch(current: PlayerCaseState, patch: AgentPlayerStatePatch): PlayerCaseState {
  const suspectStates: Record<string, SuspectState> = {};
  if (patch.suspectStates) {
    for (const [suspectId, suspectState] of Object.entries(patch.suspectStates)) {
      if (suspectState) suspectStates[suspectId] = suspectState;
    }
  }
  const hasSuspectStates = Object.keys(suspectStates).length > 0;

  return {
    ...current,
    ...patch,
    suspectStates: hasSuspectStates
      ? {
          ...current.suspectStates,
          ...suspectStates,
        }
      : current.suspectStates,
  };
}

export function useInvestigationSession() {
  const defaultChatMode: ChatModeState = { mode: "assistant", label: "真相中枢" };
  const socketRef = useRef<ReturnType<typeof connectAgentSocket> | null>(null);
  const sessionRef = useRef<SessionPayload | null>(null);
  const pendingSessionRef = useRef<SessionPayload | null>(null);
  const bootTimersRef = useRef<number[]>([]);
  const startSentRef = useRef(false);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const chatStreamBuffersRef = useRef<Map<string, ChatStreamBuffer>>(new Map());
  const roomIdRef = useRef(createRoomId());
  const [storageReady, setStorageReady] = useState(false);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [socketReady, setSocketReady] = useState(false);
  const [bootStatus, setBootStatus] = useState("正在读取本地案件进度...");
  const [bootProgress, setBootProgress] = useState(8);
  const [activeBootStep, setActiveBootStep] = useState<BootStepId>("core");
  const [bootError, setBootError] = useState("");
  const [bootReleased, setBootReleased] = useState(false);
  const [showBriefing, setShowBriefing] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [actionStatus, setActionStatus] = useState("等待调查指令。");
  const [chatMode, setChatMode] = useState<ChatModeState>(defaultChatMode);
  const [chatMessages, setChatMessages] = useState<InvestigationChatMessage[]>([]);
  const [completedVisualAsset, setCompletedVisualAsset] = useState<VisualAsset | null>(null);
  const [visualFocus, setVisualFocus] = useState<VisualFocusState>(null);

  useEffect(() => {
    const snapshot = loadPersistedInvestigation();

    if (snapshot) {
      roomIdRef.current = snapshot.roomId || roomIdRef.current;
      sessionRef.current = snapshot.session;
      setSession(snapshot.session);
      setChatMessages(snapshot.chatMessages);
      setChatMode(snapshot.chatMode);
      setActionStatus(snapshot.actionStatus);
      setShowBriefing(snapshot.showBriefing);
      setVisualFocus(snapshot.visualFocus);
      setActiveBootStep("chat");
      setBootProgress(100);
      setBootStatus("已恢复本地案件进度，正在重连调查中枢...");
      setBootReleased(true);
    } else {
      setBootStatus("正在连接案件缓存池...");
    }

    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;

    let cancelled = false;
    let deltaCount = 0;

    function commitSession(nextSession: SessionPayload) {
      sessionRef.current = nextSession;
      setSession(nextSession);
    }

    function clearBootTimers() {
      for (const timer of bootTimersRef.current) window.clearTimeout(timer);
      bootTimersRef.current = [];
    }

    function releasePendingSession() {
      const pendingSession = pendingSessionRef.current;
      if (!pendingSession || cancelled) return;

      pendingSessionRef.current = null;
      setShowBriefing(true);
      setBootReleased(true);
      commitSession(pendingSession);
    }

    function playCachedBootSequence(nextSession: SessionPayload) {
      pendingSessionRef.current = nextSession;
      clearBootTimers();

      for (const item of simulatedBootTimeline) {
        const timer = window.setTimeout(() => {
          if (cancelled) return;
          setActiveBootStep((current) => {
            const currentIndex = bootSteps.findIndex((step) => step.id === current);
            const nextIndex = bootSteps.findIndex((step) => step.id === item.step);
            return nextIndex >= currentIndex ? item.step : current;
          });
          setBootProgress((current) => Math.max(current, item.progress));
          setBootStatus(item.status);
          if (item.progress === 100) {
            const releaseTimer = window.setTimeout(releasePendingSession, bootCompletionHoldMs);
            bootTimersRef.current.push(releaseTimer);
          }
        }, item.delay);
        bootTimersRef.current.push(timer);
      }
    }

    function mergeSession(updater: (current: SessionPayload) => SessionPayload) {
      setSession((current) => {
        const base = current ?? sessionRef.current ?? pendingSessionRef.current;
        if (!base) return current;

        const nextSession = updater(base);
        if (pendingSessionRef.current && !current && !sessionRef.current) {
          pendingSessionRef.current = nextSession;
          return current;
        }

        sessionRef.current = nextSession;
        return nextSession;
      });
    }

    function mergeVisualManifest(updater: (current: CaseVisualManifest | undefined) => CaseVisualManifest | undefined) {
      mergeSession((current) => ({
        ...current,
        visualManifest: updater(current.visualManifest),
      }));
    }

    function upsertVisualAsset(asset: VisualAsset) {
      mergeVisualManifest((manifest) => {
        if (!manifest) return manifest;
        const now = new Date().toISOString();
        return {
          ...manifest,
          assets: [...manifest.assets.filter((item) => item.id !== asset.id), asset],
          updatedAt: now,
        };
      });
    }

    function upsertChatMessage(message: InvestigationChatMessage) {
      setChatMessages((current) => {
        const existing = current.find((item) => item.id === message.id);
        if (!existing) {
          const pendingIndex = current.findIndex((item) => item.clientPending && item.speaker !== "user");
          if (pendingIndex >= 0 && message.speaker !== "user") {
            return current.map((item, index) => (index === pendingIndex ? message : item)).slice(-80);
          }
          return [...current, message].slice(-80);
        }
        return current.map((item) => (item.id === message.id ? { ...item, ...message } : item));
      });
    }

    function clearChatStreamBuffers() {
      for (const buffer of chatStreamBuffersRef.current.values()) {
        if (buffer.timer) window.clearTimeout(buffer.timer);
      }
      chatStreamBuffersRef.current.clear();
    }

    function updateChatMessageText(messageId: string, text: string) {
      setChatMessages((current) =>
        current.map((item) =>
          item.id === messageId
            ? {
                ...item,
                text: item.placeholder ? text : `${item.text}${text}`,
                pending: true,
                placeholder: false,
                clientPending: false,
              }
            : item,
        ),
      );
    }

    function finishBufferedChatMessage(messageId: string) {
      const buffer = chatStreamBuffersRef.current.get(messageId);
      const finalMessage = buffer?.finalMessage;
      if (!finalMessage) return;

      chatStreamBuffersRef.current.delete(messageId);
      upsertChatMessage(finalMessage);
      if (finalMessage.speaker === "assistant" || finalMessage.speaker === "suspect") {
        setIsActing(false);
      }
    }

    function pumpChatStream(messageId: string) {
      const buffer = chatStreamBuffersRef.current.get(messageId);
      if (!buffer) return;

      if (!buffer.queue) {
        buffer.timer = undefined;
        if (buffer.finalMessage) finishBufferedChatMessage(messageId);
        return;
      }

      const chunk = buffer.queue.slice(0, chatStreamChunkSize);
      buffer.queue = buffer.queue.slice(chatStreamChunkSize);
      updateChatMessageText(messageId, chunk);
      buffer.timer = window.setTimeout(() => pumpChatStream(messageId), chatStreamTickMs);
    }

    function appendChatDelta(messageId: string, text: string) {
      if (!text) return;
      const buffer = chatStreamBuffersRef.current.get(messageId) ?? { queue: "" };
      buffer.queue += text;
      chatStreamBuffersRef.current.set(messageId, buffer);
      if (!buffer.timer) {
        buffer.timer = window.setTimeout(() => pumpChatStream(messageId), chatStreamTickMs);
      }
    }

    function finishChatMessage(message: InvestigationChatMessage) {
      const buffer = chatStreamBuffersRef.current.get(message.id);
      if (!buffer) {
        upsertChatMessage(message);
        if (message.speaker === "assistant" || message.speaker === "suspect") {
          setIsActing(false);
        }
        return;
      }

      buffer.finalMessage = message;
      chatStreamBuffersRef.current.set(message.id, buffer);
      if (!buffer.queue && !buffer.timer) finishBufferedChatMessage(message.id);
    }

    function attachVisualToChatMessage({
      asset,
      messageId,
      turnId,
    }: {
      asset: VisualAsset;
      messageId?: string;
      turnId: string;
    }) {
      setChatMessages((current) => {
        let targetId = messageId;
        if (!targetId) {
          for (let index = current.length - 1; index >= 0; index -= 1) {
            const message = current[index];
            if (!message) continue;
            if (message.turnId === turnId && (message.speaker === "assistant" || message.speaker === "suspect")) {
              targetId = message.id;
              break;
            }
          }
        }

        if (!targetId) return current;

        return current.map((message) => {
          if (message.id !== targetId) return message;
          const attachments = message.attachments ?? [];
          if (attachments.some((item) => item.id === asset.id)) return message;
          return {
            ...message,
            attachments: [...attachments, asset],
          };
        });
      });
    }

    function handleRuntimeEvent(envelope: AgentEventEnvelope) {
      if (seenEventIdsRef.current.has(envelope.id)) return;
      seenEventIdsRef.current.add(envelope.id);
      if (seenEventIdsRef.current.size > 500) {
        const oldestId = seenEventIdsRef.current.values().next().value;
        if (oldestId) seenEventIdsRef.current.delete(oldestId);
      }
      const event = envelope.event;

      if (event === "agent.status") {
        const text = envelope.payload.text;
        if (!sessionRef.current && !pendingSessionRef.current) {
          setBootStatus(text);
          setActiveBootStep(stepFromStatus(text));
          setBootProgress((current) => clampBootProgress(current + 12));
        } else {
          if (envelope.priority !== "background") setActionStatus(text);
        }
      }

      if (event === "agent.delta" && !sessionRef.current && !pendingSessionRef.current) {
        deltaCount += 1;
        const stepIndex = Math.min(bootSteps.length - 1, Math.floor(deltaCount / 12));
        setActiveBootStep(bootSteps[stepIndex]?.id ?? "chat");
        setBootProgress((current) => clampBootProgress(current + 2));
      }

      if (event === "agent.hint") {
        setActionStatus(envelope.payload.text);
      }

      if (event === "agent.error") {
        setBootError((current) => current || envelope.payload.message);
        setActionStatus(envelope.payload.message);
        setIsActing(false);
        setChatMessages((current) =>
          current.map((message) =>
            message.clientPending && message.placeholder
              ? {
                  ...message,
                  text: envelope.payload.message,
                  pending: false,
                  placeholder: false,
                  clientPending: false,
                }
              : message,
          ),
        );
      }

      if (event === "agent.refusal") {
        setActionStatus(envelope.payload.message);
      }

      if (event === "chat.mode.changed") {
        setChatMode(envelope.payload);
        setActionStatus(
          envelope.payload.mode === "interrogation"
            ? `已切换为问询：${envelope.payload.label}`
            : "已切回真相中枢。",
        );
      }

      if (event === "chat.message.started") {
        upsertChatMessage({
          id: envelope.payload.messageId,
          turnId: envelope.payload.turnId,
          speaker: envelope.payload.speaker,
          text:
            envelope.payload.speaker === "assistant" || envelope.payload.speaker === "suspect"
              ? "正在调查..."
              : "",
          label: envelope.payload.label,
          suspectId: envelope.payload.suspectId,
          pending: true,
          placeholder: envelope.payload.speaker === "assistant" || envelope.payload.speaker === "suspect",
          createdAt: Date.now(),
        });
      }

      if (event === "chat.delta") {
        appendChatDelta(envelope.payload.messageId, envelope.payload.text);
      }

      if (event === "chat.message.finished") {
        finishChatMessage({
          id: envelope.payload.messageId,
          turnId: envelope.payload.turnId,
          speaker: envelope.payload.speaker,
          text: envelope.payload.text,
          label: envelope.payload.label,
          suspectId: envelope.payload.suspectId,
          pending: false,
          placeholder: false,
          clientPending: false,
          createdAt: Date.now(),
        });
      }

      if (event === "chat.attachment.added") {
        upsertVisualAsset(envelope.payload.asset);
        attachVisualToChatMessage({
          asset: envelope.payload.asset,
          messageId: envelope.payload.messageId,
          turnId: envelope.payload.turnId,
        });
        setActionStatus(`已调出影像：${envelope.payload.asset.title}`);
      }

      if (event === "session.ready") {
        if (sessionRef.current || bootReleased) {
          clearBootTimers();
          setActiveBootStep("chat");
          setBootProgress(100);
          setBootStatus(envelope.payload.resultText ?? "案件进度已恢复。");
          setBootReleased(true);
          commitSession(envelope.payload);
        } else {
          playCachedBootSequence(envelope.payload);
        }
      }

      if (event === "game.action.result") {
        setActionStatus(envelope.payload.resultText || "规则引擎已更新。");
      }

      if (event === "game.state.patch") {
        mergeSession((current) => ({
          ...current,
          state: mergeStatePatch(current.state, envelope.payload.statePatch),
          resultText: envelope.payload.resultText ?? current.resultText,
        }));
        setActionStatus(envelope.payload.resultText ?? "调查状态已更新。");
      }

      if (event === "game.command.finished") {
        setActionStatus(envelope.payload.resultText ?? "调查状态已更新。");
        setIsActing(false);
      }

      if (event === "turn.finished") {
        setIsActing(false);
      }

      if (event === "metadata.patch") {
        mergeSession((current) => ({
          ...current,
          caseData: mergeCaseMetadata(current.caseData, envelope.payload),
        }));
      }

      if (event === "visual.manifest.ready") {
        mergeVisualManifest(() => envelope.payload.manifest);
      }

      if (event === "visual.asset.pending") {
        upsertVisualAsset(envelope.payload.asset);
        setActionStatus(`影像整理中：${envelope.payload.asset.title}`);
      }

      if (event === "visual.asset.ready") {
        upsertVisualAsset(envelope.payload.asset);
        const asset = envelope.payload.asset;
        if (asset.tags.includes("runtime-demand") && (asset.fileUrl || asset.thumbUrl)) {
          setCompletedVisualAsset(asset);
          setActionStatus(`新影像已归档：${asset.title}`);
        }
      }

      if (event === "visual.focus.changed") {
        setVisualFocus(envelope.payload);
      }
    }

    function handleAgentEvent(event: AgentServerEvent) {
      if (cancelled) return;
      if (event.type !== "agent.event") return;
      handleRuntimeEvent(event);
    }

    const socket = connectAgentSocket({
      onEvent: handleAgentEvent,
      onOpen() {
        if (cancelled) return;
        setSocketReady(true);
        setBootStatus("Investigation Agent 已连接，正在接入对话中枢...");
      },
      onClose() {
        if (!cancelled) {
          setSocketReady(false);
          setActionStatus("Investigation Agent WebSocket 已断开。");
        }
      },
      onError(message) {
        if (!cancelled) {
          setBootError(message);
          setActionStatus(message);
          setIsActing(false);
        }
      },
    });

    socketRef.current = socket;

    return () => {
      cancelled = true;
      clearBootTimers();
      clearChatStreamBuffers();
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [storageReady]);

  useEffect(() => {
    if (!storageReady || !socketReady || startSentRef.current) return;

    try {
      const activeSocket = socketRef.current;
      if (!activeSocket?.isOpen()) {
        throw new Error("Investigation Agent WebSocket 尚未准备好。");
      }

      const restoredSession = sessionRef.current;
      if (restoredSession) {
        setActionStatus("案件进度已恢复，正在重连调查中枢...");
        setBootStatus("已恢复本地案件，正在同步服务器状态...");
        activeSocket.send({
          type: "session.resume",
          roomId: roomIdRef.current,
          sessionId: restoredSession.sessionId,
        });
        startSentRef.current = true;
        return;
      }

      setBootStatus("Investigation Agent 已连接，正在领取案件...");
      activeSocket.send({
        type: "session.start",
        roomId: roomIdRef.current,
      });
      startSentRef.current = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Investigation Agent 开局连接失败。";
      setBootError(message);
      setActionStatus(message);
    }
  }, [socketReady, storageReady]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!session) return;

    persistInvestigationSnapshot({
      version: 1,
      roomId: roomIdRef.current,
      session,
      chatMessages: reviveChatMessages(chatMessages),
      chatMode,
      actionStatus,
      showBriefing,
      visualFocus,
      savedAt: Date.now(),
    });
  }, [actionStatus, chatMessages, chatMode, session, showBriefing, visualFocus]);

  const data = useMemo(() => {
    if (!session) return null;
    return deriveInvestigationData(session.caseData, session.state, session.visualManifest);
  }, [session]);

  async function submitCommand(command: string) {
    const trimmed = command.trim();
    if (!trimmed || !session || isActing || session.state.phase === "solved") return false;

    setIsActing(true);
    setActionStatus("正在解析行动...");
    const localTurnId = `local-${Date.now().toString(36)}`;
    setChatMessages((current) =>
      [
        ...current,
        {
          id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          turnId: localTurnId,
          speaker: "user" as const,
          text: trimmed,
          label: "你",
          pending: false,
          createdAt: Date.now(),
        },
        {
          id: `assistant-pending-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          turnId: localTurnId,
          speaker: "assistant" as const,
          text: "正在调查...",
          label: chatMode.mode === "interrogation" ? chatMode.label : "真相中枢",
          suspectId: chatMode.mode === "interrogation" ? chatMode.suspectId : undefined,
          pending: true,
          placeholder: true,
          clientPending: true,
          createdAt: Date.now(),
        },
      ].slice(-80),
    );

    try {
      const socket = socketRef.current;
      if (!socket?.isOpen()) {
        throw new Error("Investigation Agent WebSocket 未连接，请确认使用 npm run dev 启动。");
      }

      socket.send({
        type: "player.command",
        sessionId: session.sessionId,
        input: trimmed,
      });
      return true;
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "未知行动错误。");
      setIsActing(false);
      setChatMessages((current) => current.filter((message) => !(message.clientPending && message.turnId === localTurnId)));
      return false;
    }
  }

  async function activateSession() {
    const currentSession = sessionRef.current ?? session;
    if (!currentSession) return false;

    if (currentSession.activatedAt) {
      setShowBriefing(false);
      return true;
    }

    try {
      const socket = socketRef.current;
      if (!socket?.isOpen()) {
        throw new Error("Investigation Agent WebSocket 未连接，请确认使用 npm run dev 启动。");
      }

      socket.send({
        type: "session.activate",
        sessionId: currentSession.sessionId,
      });
      setActionStatus("正在进入调查...");
      setShowBriefing(false);
      return true;
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "进入调查失败。");
      return false;
    }
  }

  function discardSession() {
    clearPersistedInvestigation();
    for (const buffer of chatStreamBuffersRef.current.values()) {
      if (buffer.timer) window.clearTimeout(buffer.timer);
    }
    chatStreamBuffersRef.current.clear();
    pendingSessionRef.current = null;
    sessionRef.current = null;
    startSentRef.current = true;
    socketRef.current?.close();
    setSession(null);
    setChatMessages([]);
    setCompletedVisualAsset(null);
    setVisualFocus(null);
    setShowBriefing(false);
    setBootReleased(false);
    setActionStatus("案件已退出。");
  }

  return {
    actionStatus,
    activeBootStep,
    bootError,
    bootProgress,
    bootStatus,
    data,
    isActing,
    isBooting: !bootReleased,
    session,
    setShowBriefing,
    showBriefing,
    chatMessages,
    chatMode,
    completedVisualAsset,
    dismissVisualNotice: () => setCompletedVisualAsset(null),
    discardSession,
    visualFocus,
    activateSession,
    submitCommand,
  };
}
