import { z } from "zod";
import { hasAiCredentials, requestAiJsonStream, type AiMessage } from "@/ai/client";
import type { ActionResult } from "@/game/schemas/game";
import type { GameSession } from "@/game/engine/sessions";
import type { ChatMode, ChatRoute } from "@/game/agent/chatRuntime";
import type { VisualFocusPayload } from "@/game/schemas/visuals";

type VisualDirectorOptions = {
  input: string;
  session: GameSession;
  result: ActionResult;
  route: ChatRoute;
  chatMode: ChatMode;
};

type VisualFocusDecision = Omit<VisualFocusPayload, "sessionId">;

const visualFocusDecisionSchema = z.object({
  mode: z.enum(["case", "scene", "suspect", "evidence", "timeline", "relationship"]),
  entityId: z.string().optional(),
  reason: z.enum([
    "opening",
    "location_changed",
    "interrogation",
    "evidence_unlocked",
    "assistant_reference",
    "timeline_updated",
    "relationship_updated",
  ]),
  intensity: z.enum(["quiet", "pulse", "spotlight"]).default("quiet"),
});

function visibleVisualTargets(session: GameSession, result: ActionResult) {
  const state = result.state;
  const currentLocation = session.caseData.locations.find((location) => location.id === state.currentLocation);
  return {
    currentLocation: currentLocation
      ? {
          id: currentLocation.id,
          name: currentLocation.name,
          kind: currentLocation.kind,
        }
      : undefined,
    suspects: session.caseData.suspects
      .filter((suspect) => state.visibleSuspects.includes(suspect.id))
      .map((suspect) => ({
        id: suspect.id,
        name: suspect.name,
        identity: suspect.identity,
      })),
    evidence: session.caseData.evidence
      .filter((evidence) => state.discoveredEvidence.includes(evidence.id))
      .map((evidence) => ({
        id: evidence.id,
        title: evidence.title,
        type: evidence.type,
        importance: evidence.importance,
      })),
    newlyUnlockedEvidence: result.unlockedEvidence.map((evidence) => ({
      id: evidence.id,
      title: evidence.title,
      type: evidence.type,
      importance: evidence.importance,
    })),
  };
}

function fallbackVisualFocus({
  result,
  route,
  session,
}: VisualDirectorOptions): VisualFocusDecision {
  if ((route.kind === "start_interrogation" || route.kind === "suspect_question") && route.suspect) {
    return {
      mode: "suspect",
      entityId: route.suspect.id,
      reason: "interrogation",
      intensity: route.kind === "start_interrogation" ? "spotlight" : "pulse",
    };
  }

  const evidence = result.unlockedEvidence[0];
  if (evidence) {
    return {
      mode: "evidence",
      entityId: evidence.id,
      reason: "evidence_unlocked",
      intensity: "spotlight",
    };
  }

  return {
    mode: "scene",
    entityId: result.state.currentLocation || session.state.currentLocation,
    reason: result.state.currentLocation !== session.state.currentLocation ? "location_changed" : "assistant_reference",
    intensity: result.state.currentLocation !== session.state.currentLocation ? "pulse" : "quiet",
  };
}

function buildVisualDirectorPrompt(options: VisualDirectorOptions) {
  return [
    "你是推理游戏的视觉导演。你只能从玩家当前可见的地点、人物和证据中选择一个画面焦点。",
    "不要选择未出现的人物，不要选择未发现的证据，不要暗示凶手或真相。",
    "如果玩家正在审问某人，优先聚焦该人物；如果本轮刚发现证据，优先聚焦证据；否则聚焦当前地点。",
    "只返回严格 JSON。",
    "",
    `玩家输入：${options.input}`,
    `当前对话模式：${options.chatMode.mode === "interrogation" ? `interrogation:${options.chatMode.label}` : "assistant"}`,
    `路由：${options.route.kind}`,
    `行动结果：${options.result.resultText}`,
    `可见目标：${JSON.stringify(visibleVisualTargets(options.session, options.result))}`,
    "",
    "JSON 格式：",
    '{"mode":"scene|suspect|evidence|timeline|relationship","entityId":"可选，必须来自可见目标 id","reason":"interrogation|evidence_unlocked|location_changed|assistant_reference|timeline_updated|relationship_updated","intensity":"quiet|pulse|spotlight"}',
  ].join("\n");
}

function normalizeDecision(raw: unknown, options: VisualDirectorOptions): VisualFocusDecision {
  const decision = visualFocusDecisionSchema.parse(raw);
  const targets = visibleVisualTargets(options.session, options.result);
  const currentLocationId = targets.currentLocation?.id;
  const suspectIds = new Set(targets.suspects.map((suspect) => suspect.id));
  const evidenceIds = new Set(targets.evidence.map((evidence) => evidence.id));

  if (decision.mode === "scene") {
    return {
      ...decision,
      entityId: currentLocationId,
    };
  }

  if (decision.mode === "suspect" && decision.entityId && suspectIds.has(decision.entityId)) {
    return decision;
  }

  if (decision.mode === "evidence" && decision.entityId && evidenceIds.has(decision.entityId)) {
    return decision;
  }

  return fallbackVisualFocus(options);
}

export async function directVisualFocus(options: VisualDirectorOptions): Promise<VisualFocusDecision> {
  if (!hasAiCredentials()) return fallbackVisualFocus(options);

  try {
    const raw = await requestAiJsonStream<unknown>({
      temperature: 0.15,
      messages: [
        {
          role: "system",
          content: "你是视觉导演路由器。只输出严格 JSON。",
        } satisfies AiMessage,
        {
          role: "user",
          content: buildVisualDirectorPrompt(options),
        },
      ],
    });

    return normalizeDecision(raw, options);
  } catch {
    return fallbackVisualFocus(options);
  }
}
