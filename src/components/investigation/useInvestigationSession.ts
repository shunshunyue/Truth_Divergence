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

const simulatedBootTimeline: Array<{ step: BootStepId; progress: number; status: string; delay: number }> = [
  { step: "core", progress: 18, status: "缓存命中，正在核对案件核心...", delay: 180 },
  { step: "scene", progress: 34, status: "正在装配初始现场和可调查区域...", delay: 360 },
  { step: "clues", progress: 50, status: "正在展开现场线索入口...", delay: 560 },
  { step: "evidence", progress: 66, status: "正在同步证据索引和解锁条件...", delay: 780 },
  { step: "agent", progress: 82, status: "正在接入问询路由和评分循环...", delay: 1040 },
  { step: "chat", progress: 96, status: "正在接通案件问答中枢...", delay: 1320 },
  { step: "chat", progress: 100, status: "案件领取完毕。", delay: 1640 },
];

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
  const socketRef = useRef<ReturnType<typeof connectAgentSocket> | null>(null);
  const sessionRef = useRef<SessionPayload | null>(null);
  const pendingSessionRef = useRef<SessionPayload | null>(null);
  const bootTimersRef = useRef<number[]>([]);
  const startSentRef = useRef(false);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const roomIdRef = useRef(`room-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [socketReady, setSocketReady] = useState(false);
  const [bootStatus, setBootStatus] = useState("正在连接案件缓存池...");
  const [bootProgress, setBootProgress] = useState(8);
  const [activeBootStep, setActiveBootStep] = useState<BootStepId>("core");
  const [bootError, setBootError] = useState("");
  const [bootReleased, setBootReleased] = useState(false);
  const [showBriefing, setShowBriefing] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [actionStatus, setActionStatus] = useState("等待调查指令。");
  const [chatMode, setChatMode] = useState<ChatModeState>({ mode: "assistant", label: "案件 AI 助手" });
  const [chatMessages, setChatMessages] = useState<InvestigationChatMessage[]>([]);
  const [visualFocus, setVisualFocus] = useState<VisualFocusState>(null);

  useEffect(() => {
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
          if (item.progress === 100) releasePendingSession();
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

    function appendChatDelta(messageId: string, text: string) {
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
            : "已切回案件 AI 助手。",
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
        upsertChatMessage({
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
        if (envelope.payload.speaker === "assistant" || envelope.payload.speaker === "suspect") {
          setIsActing(false);
        }
      }

      if (event === "session.ready") {
        playCachedBootSequence(envelope.payload);
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

      if (event === "visual.asset.pending" || event === "visual.asset.ready") {
        upsertVisualAsset(envelope.payload.asset);
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
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!socketReady || startSentRef.current || sessionRef.current) return;

    try {
      const activeSocket = socketRef.current;
      if (!activeSocket?.isOpen()) {
        throw new Error("Investigation Agent WebSocket 尚未准备好。");
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
  }, [socketReady]);

  useEffect(() => {
    sessionRef.current = session;
    if (!session) return;
    window.localStorage.setItem("td-session", JSON.stringify(session));
  }, [session]);

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
          label: chatMode.mode === "interrogation" ? chatMode.label : "案件 AI 助手",
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
    visualFocus,
    submitCommand,
  };
}
