import { z } from "zod";
import { requestAiJsonStream, requestAiTextStream, type AiMessage } from "@/ai/client";
import {
  buildCurrentLocationMetadata,
  buildVisibleClues,
  buildVisibleEvidence,
  buildVisibleLocations,
  buildVisibleRelationships,
  buildVisibleSuspects,
  buildVisibleTimeline,
} from "@/game/agent/publicProjection";
import type { SessionChatMessage } from "@/game/engine/sessions";
import type {
  ActionResult,
  CaseData,
  Evidence,
  LocationData,
  PlayerCaseState,
  Relationship,
  SuspectProfile,
  TimelineEvent,
} from "@/game/schemas/game";

const emptyDiscoveries = {
  evidence: [],
  locations: [],
  suspects: [],
  timeline: [],
  relationships: [],
  notes: [],
  keyEvidenceIds: [],
  keyTimelineIds: [],
};

const runtimeDiscoveriesSchema = z
  .object({
    evidence: z.array(z.unknown()).default([]),
    locations: z.array(z.unknown()).default([]),
    suspects: z.array(z.unknown()).default([]),
    timeline: z.array(z.unknown()).default([]),
    relationships: z.array(z.unknown()).default([]),
    notes: z.array(z.string()).default([]),
    keyEvidenceIds: z.array(z.string()).default([]),
    keyTimelineIds: z.array(z.string()).default([]),
  })
  .default(emptyDiscoveries);

const runtimeDiscoverySchema = z.object({
  reply: z.string().min(1),
  discoveries: runtimeDiscoveriesSchema,
});

const runtimeDiscoveryStructureSchema = z.object({
  reply: z.string().optional().default(""),
  discoveries: runtimeDiscoveriesSchema,
});

type RuntimeDiscoveries = z.infer<typeof runtimeDiscoveriesSchema>;

export type RuntimeDiscovery = {
  reply: string;
  caseData: CaseData;
  state: PlayerCaseState;
  addedEvidence: Evidence[];
  addedLocations: LocationData[];
  addedSuspects: SuspectProfile[];
  addedTimeline: TimelineEvent[];
  addedRelationships: Relationship[];
  notes: string[];
};

function slugify(input: string) {
  const ascii = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || Math.random().toString(36).slice(2, 8);
}

function idWithPrefix(prefix: string, raw: unknown, fallback: string, existing: Set<string>) {
  const base = typeof raw === "string" && raw.trim() ? raw.trim() : `${prefix}-${slugify(fallback)}`;
  const normalized = base.startsWith(`${prefix}-`) ? base : `${prefix}-${slugify(base)}`;
  let candidate = normalized;
  let index = 2;
  while (existing.has(candidate)) {
    candidate = `${normalized}-${index}`;
    index += 1;
  }
  existing.add(candidate);
  return candidate;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function recentMessages(history: SessionChatMessage[]) {
  return history.slice(-10).map((message) => ({
    speaker: message.speaker,
    label: message.label,
    suspectId: message.suspectId,
    text: message.text,
  }));
}

function hiddenTruthSeed(caseData: CaseData) {
  return {
    title: caseData.title,
    theme: caseData.theme,
    victim: caseData.victim,
    suspects: caseData.suspects.map((suspect) => ({
      id: suspect.id,
      name: suspect.name,
      age: suspect.age,
      identity: suspect.identity,
      publicRelationship: suspect.publicRelationship,
      hiddenRelationship: suspect.hiddenRelationship,
      publicStatement: suspect.publicStatement,
      hiddenTruth: suspect.hiddenTruth,
      motiveLevel: suspect.motiveLevel,
      opportunityLevel: suspect.opportunityLevel,
      lieStyle: suspect.lieStyle,
      emotionalWeakness: suspect.emotionalWeakness,
      falseLeads: suspect.falseLeads,
      isKiller: suspect.isKiller,
    })),
    witnesses: caseData.witnesses,
    truth: caseData.truth,
  };
}

function publicRuntimeSnapshot(caseData: CaseData, state: PlayerCaseState) {
  return {
    currentLocation: buildCurrentLocationMetadata(caseData, state),
    visibleClues: buildVisibleClues(caseData, state),
    visibleLocations: buildVisibleLocations(caseData, state),
    visibleEvidence: buildVisibleEvidence(caseData, state),
    visibleSuspects: buildVisibleSuspects(caseData, state),
    visibleTimeline: buildVisibleTimeline(state),
    visibleRelationships: buildVisibleRelationships(caseData, state),
    notes: state.notes.slice(-8),
    actionHistory: state.actionHistory.slice(-8).map((event) => ({
      input: event.input,
      intent: event.parsedAction.intent,
      result: event.result,
    })),
  };
}

function discoveryPrompt(input: string, caseData: CaseData, state: PlayerCaseState, result: ActionResult, history: SessionChatMessage[]) {
  return `玩家正在通过问答实时查案。你要直接生成“本轮查到的内容”，不要给建议列表。

玩家输入：${input}
规则引擎初判：${result.resultText}
解析意图：${result.parsedAction.intent}

隐藏真相种子（可用于保证最终导向正确，不能直接泄露给玩家）：
${JSON.stringify(hiddenTruthSeed(caseData), null, 2)}

当前玩家已发现内容：
${JSON.stringify(publicRuntimeSnapshot(caseData, state), null, 2)}

最近对话：
${JSON.stringify(recentMessages(history), null, 2)}

生成原则：
- 用户问“查/调取/看/翻/问某个记录或物件”，你必须直接生成一条查到的记录、事件、证词或物证，不要说“建议去查”。
- 生成的新发现必须最终服务于隐藏真相种子，不能改真凶、动机、手法。
- 可以动态新增证据、地点、嫌疑人、时间线和关系；新增内容要具体，有时间、地点、记录细节或人物行为。
- 不要一次性给出最终凶手。把真相拆成多轮可追查的矛盾。
- reply 是中间聊天框直接显示的话，要像“我已经调到了/我翻到了/记录里出现了...”。
- 如果本轮问的是进出记录，就造一段进出记录；问监控，就造监控片段；问账册，就造账册异常；问某人，就造口供反应。
- 返回严格 JSON，不要 markdown。

JSON 格式：
{
  "reply": "中文，直接说明本轮查到什么",
  "discoveries": {
    "evidence": [
      {
        "id": "evidence-可选",
        "title": "证据标题",
        "type": "ACCESS_LOG|CCTV|CALL_LOG|DIARY|RECEIPT|WITNESS|FORENSIC|CHAT|LOCATION|FINANCIAL|OBJECT|MAP",
        "source": "来源",
        "visibleData": {"summary":"玩家可见内容"},
        "proves": ["它支持的推理点"],
        "contradicts": ["它制造的矛盾"],
        "relatedSuspects": ["suspect-id"],
        "relatedLocations": ["loc-id"],
        "importance": 0-100,
        "isKeyEvidence": true|false
      }
    ],
    "locations": [{"id":"loc-可选","name":"地点名","kind":"类型","description":"描述","objects":[{"id":"obj-可选","name":"可查物件","description":"描述"}]}],
    "suspects": [{"id":"suspect-可选","name":"姓名","age":30,"identity":"身份","publicRelationship":"公开关系","publicStatement":"初始口供"}],
    "timeline": [{"id":"timeline-可选","time":"时间","description":"事件","source":"证据id","relatedEvidence":["evidence-id"],"relatedSuspects":["suspect-id"],"confidence":"confirmed|suspected|disputed"}],
    "relationships": [{"id":"relationship-可选","from":"id","to":"id","type":"normal|conflict|hidden|time|evidence|misleading","status":"unknown|suspected|conflict|confirmed|excluded|key","label":"关系说明","relatedEvidence":["evidence-id"]}],
    "notes": ["玩家笔记"],
    "keyEvidenceIds": ["本轮应加入 truth.keyEvidence 的证据 id"],
    "keyTimelineIds": ["本轮应加入 truth.keyTimeline 的时间线 id"]
  }
}`;
}

function discoveryReplyPrompt(input: string, caseData: CaseData, state: PlayerCaseState, result: ActionResult, history: SessionChatMessage[]) {
  return `玩家正在通过问答实时查案。你要直接生成“本轮查到的内容”，这是要立即流式显示在中间聊天框里的正文。

玩家输入：${input}
规则引擎初判：${result.resultText}
解析意图：${result.parsedAction.intent}

隐藏真相种子（只用于保证最终导向正确，不能直接泄露给玩家）：
${JSON.stringify(hiddenTruthSeed(caseData), null, 2)}

当前玩家已发现内容：
${JSON.stringify(publicRuntimeSnapshot(caseData, state), null, 2)}

最近对话：
${JSON.stringify(recentMessages(history), null, 2)}

回复原则：
- 必须直接顺着玩家的问题给出查到的记录、事件、证词或物件细节。
- 不要给“建议去哪里查”的列表；如果玩家说“查进出记录”，就直接写出进出记录里出现了什么。
- 不要说“没有这个证据”“查不到”“尚未发现”。证据就是这一轮被调出来的。
- 新内容要具体：至少包含时间、地点、人员、记录来源或异常点中的 2 类。
- 不能直接说出最终凶手或完整真相；用可继续追查的矛盾把玩家引向隐藏真相。
- 不要输出 JSON、不要 Markdown 表格、不要标题堆砌。自然中文，2 到 6 句话。`;
}

function structureDiscoveryPrompt({
  input,
  reply,
  caseData,
  state,
  result,
  history,
}: {
  input: string;
  reply: string;
  caseData: CaseData;
  state: PlayerCaseState;
  result: ActionResult;
  history: SessionChatMessage[];
}) {
  return `你是推理游戏的 Runtime Discovery 归档引擎。玩家已经在中间聊天框看到了一段调查结果，你现在只负责把这段已说出的内容结构化成左右两边案卷元数据。

玩家输入：${input}
已显示给玩家的回答：
${reply}

规则引擎初判：${result.resultText}
解析意图：${result.parsedAction.intent}

隐藏真相种子（可用于保证最终导向正确，不能直接泄露给玩家）：
${JSON.stringify(hiddenTruthSeed(caseData), null, 2)}

当前玩家已发现内容：
${JSON.stringify(publicRuntimeSnapshot(caseData, state), null, 2)}

最近对话：
${JSON.stringify(recentMessages(history), null, 2)}

归档原则：
- 结构化内容必须与“已显示给玩家的回答”一致，可以补齐必要字段，但不要新增回答里完全没提到的大事实。
- 如果回答中出现记录、物证、口供、监控、账册、定位、通话等，请至少生成 1 条 evidence。
- 如果回答中出现明确时间点，请生成 timeline。
- 如果回答中出现新地点或可继续追查的物件，可以生成 locations。
- 如果回答中出现新人物，可以生成 suspects；如果只是已有嫌疑人，不要重复创建。
- 相关嫌疑人和地点 id 优先使用现有 id。
- 返回严格 JSON，不要 markdown。

JSON 格式：
{
  "discoveries": {
    "evidence": [
      {
        "id": "evidence-可选",
        "title": "证据标题",
        "type": "ACCESS_LOG|CCTV|CALL_LOG|DIARY|RECEIPT|WITNESS|FORENSIC|CHAT|LOCATION|FINANCIAL|OBJECT|MAP",
        "source": "来源",
        "visibleData": {"summary":"玩家可见内容"},
        "proves": ["它支持的推理点"],
        "contradicts": ["它制造的矛盾"],
        "relatedSuspects": ["suspect-id"],
        "relatedLocations": ["loc-id"],
        "importance": 0-100,
        "isKeyEvidence": true|false
      }
    ],
    "locations": [{"id":"loc-可选","name":"地点名","kind":"类型","description":"描述","objects":[{"id":"obj-可选","name":"可查物件","description":"描述"}]}],
    "suspects": [{"id":"suspect-可选","name":"姓名","age":30,"identity":"身份","publicRelationship":"公开关系","publicStatement":"初始口供"}],
    "timeline": [{"id":"timeline-可选","time":"时间","description":"事件","source":"证据id","relatedEvidence":["evidence-id"],"relatedSuspects":["suspect-id"],"confidence":"confirmed|suspected|disputed"}],
    "relationships": [{"id":"relationship-可选","from":"id","to":"id","type":"normal|conflict|hidden|time|evidence|misleading","status":"unknown|suspected|conflict|confirmed|excluded|key","label":"关系说明","relatedEvidence":["evidence-id"]}],
    "notes": ["玩家笔记"],
    "keyEvidenceIds": ["本轮应加入 truth.keyEvidence 的证据 id"],
    "keyTimelineIds": ["本轮应加入 truth.keyTimeline 的时间线 id"]
  }
}`;
}

function normalizeEvidence(raw: unknown, caseData: CaseData, state: PlayerCaseState, existing: Set<string>): Evidence {
  const item = asRecord(raw);
  const title = asString(item.title, "新调取记录");
  const id = idWithPrefix("evidence", item.id, title, existing);
  const type = oneOf(item.type, ["CCTV", "CALL_LOG", "ACCESS_LOG", "DIARY", "RECEIPT", "WITNESS", "FORENSIC", "CHAT", "LOCATION", "FINANCIAL", "OBJECT", "MAP"] as const, "OBJECT");
  const currentLocation = state.currentLocation ? [state.currentLocation] : [];
  return {
    id,
    title,
    type,
    source: asString(item.source, "运行时调查"),
    visualTemplate: asString(item.visualTemplate, "document"),
    visibleData: asRecord(item.visibleData),
    hiddenMetadata: {},
    proves: asStringArray(item.proves),
    contradicts: asStringArray(item.contradicts),
    supports: asStringArray(item.supports),
    relatedSuspects: asStringArray(item.relatedSuspects).filter((suspectId) =>
      caseData.suspects.some((suspect) => suspect.id === suspectId),
    ),
    relatedLocations: asStringArray(item.relatedLocations).filter((locationId) =>
      caseData.locations.some((location) => location.id === locationId),
    ).concat(asStringArray(item.relatedLocations).length ? [] : currentLocation),
    relatedTimeline: asStringArray(item.relatedTimeline),
    unlockConditions: [],
    unlocks: [],
    reliability: oneOf(item.reliability, ["low", "medium", "high"] as const, "medium"),
    importance: Math.max(0, Math.min(100, asNumber(item.importance, 55))),
    isKeyEvidence: Boolean(item.isKeyEvidence),
  };
}

function normalizeLocation(raw: unknown, existing: Set<string>): LocationData {
  const item = asRecord(raw);
  const name = asString(item.name, "新地点");
  const id = idWithPrefix("loc", item.id, name, existing);
  const objects = Array.isArray(item.objects) ? item.objects.map((object, index) => {
    const objectRecord = asRecord(object);
    const objectName = asString(objectRecord.name, `线索点 ${index + 1}`);
    return {
      id: asString(objectRecord.id, `obj-${slugify(objectName)}`),
      name: objectName,
      description: asString(objectRecord.description, "可继续追查的线索点。"),
      unlocksEvidence: [],
      unlocksSuspects: [],
      unlocksLocations: [],
      visibleConditions: [],
    };
  }) : [];

  return {
    id,
    name,
    kind: asString(item.kind, "动态地点"),
    description: asString(item.description, "本轮调查中新出现的地点。"),
    objects,
    connectedLocations: asStringArray(item.connectedLocations),
    unlockConditions: [],
  };
}

function normalizeSuspect(raw: unknown, existing: Set<string>): SuspectProfile {
  const item = asRecord(raw);
  const name = asString(item.name, "新人物");
  const id = idWithPrefix("suspect", item.id, name, existing);
  return {
    id,
    name,
    age: Math.max(18, Math.min(90, asNumber(item.age, 35))),
    identity: asString(item.identity, "案件相关人员"),
    publicRelationship: asString(item.publicRelationship, "与案件存在待核验关联。"),
    hiddenRelationship: asString(item.hiddenRelationship, ""),
    publicStatement: asString(item.publicStatement, "我只知道自己接触过其中一部分情况。"),
    hiddenTruth: asStringArray(item.hiddenTruth),
    motiveLevel: Math.max(0, Math.min(100, asNumber(item.motiveLevel, 35))),
    opportunityLevel: Math.max(0, Math.min(100, asNumber(item.opportunityLevel, 35))),
    lieStyle: asString(item.lieStyle, "含糊回避"),
    emotionalWeakness: asString(item.emotionalWeakness, "害怕被牵连"),
    breakConditions: asStringArray(item.breakConditions),
    falseLeads: asStringArray(item.falseLeads),
    isKiller: false,
  };
}

function normalizeTimeline(raw: unknown, evidence: Evidence[], existing: Set<string>): TimelineEvent {
  const item = asRecord(raw);
  const description = asString(item.description, "新时间点");
  const id = idWithPrefix("timeline", item.id, description, existing);
  const relatedEvidence = asStringArray(item.relatedEvidence);
  return {
    id,
    time: asString(item.time, "时间待核验"),
    description,
    source: asString(item.source, relatedEvidence[0] ?? evidence[0]?.id ?? "runtime-discovery"),
    relatedEvidence,
    relatedSuspects: asStringArray(item.relatedSuspects),
    confidence: oneOf(item.confidence, ["confirmed", "suspected", "disputed"] as const, "suspected"),
  };
}

function normalizeRelationship(raw: unknown, evidence: Evidence[], existing: Set<string>): Relationship {
  const item = asRecord(raw);
  const label = asString(item.label, "新关系线索");
  const id = idWithPrefix("relationship", item.id, label, existing);
  return {
    id,
    from: asString(item.from, "unknown"),
    to: asString(item.to, "unknown"),
    type: oneOf(item.type, ["normal", "conflict", "hidden", "time", "evidence", "misleading"] as const, "evidence"),
    status: oneOf(item.status, ["unknown", "suspected", "conflict", "confirmed", "excluded", "key"] as const, "suspected"),
    label,
    relatedEvidence: asStringArray(item.relatedEvidence).length ? asStringArray(item.relatedEvidence) : evidence.map((item) => item.id),
  };
}

function evidenceTypeFromText(text: string) {
  if (/进出|出入|门岗|门禁|登记|刷卡|通行/.test(text)) return "ACCESS_LOG";
  if (/监控|录像|摄像|画面/.test(text)) return "CCTV";
  if (/通话|电话|来电|拨号/.test(text)) return "CALL_LOG";
  if (/账|票据|财务|货单|收据|小票/.test(text)) return "FINANCIAL";
  if (/聊天|微信|短信|消息/.test(text)) return "CHAT";
  if (/日记|笔记|便签/.test(text)) return "DIARY";
  if (/法医|尸检|鉴定|指纹|血迹|痕迹/.test(text)) return "FORENSIC";
  if (/定位|位置|轨迹/.test(text)) return "LOCATION";
  if (/地图|平面图|路线/.test(text)) return "MAP";
  if (/口供|证词|问询|询问/.test(text)) return "WITNESS";
  return "OBJECT";
}

function relatedSuspectsFromText(text: string, caseData: CaseData) {
  return caseData.suspects.filter((suspect) => text.includes(suspect.name)).map((suspect) => suspect.id);
}

function relatedLocationsFromText(text: string, caseData: CaseData, state: PlayerCaseState) {
  const explicit = caseData.locations.filter((location) => text.includes(location.name)).map((location) => location.id);
  return explicit.length ? explicit : state.currentLocation ? [state.currentLocation] : [];
}

function firstTimeText(text: string) {
  const match = text.match(/(?:凌晨|上午|中午|下午|晚上|昨晚|当晚|夜里)?\s*\d{1,2}(?:[:：点时]\d{1,2})?(?:分)?/);
  return match?.[0]?.replace(/\s+/g, "") ?? "";
}

export function createFallbackRuntimeDiscoveryFromReply({
  input,
  reply,
  caseData,
  state,
}: {
  input: string;
  reply: string;
  caseData: CaseData;
  state: PlayerCaseState;
}) {
  const stamp = Date.now().toString(36);
  const evidenceId = `evidence-runtime-${stamp}`;
  const title = input.length > 18 ? `调查记录：${input.slice(0, 18)}...` : `调查记录：${input}`;
  const time = firstTimeText(reply);
  const discoveries: RuntimeDiscoveries = {
    ...emptyDiscoveries,
    evidence: [
      {
        id: evidenceId,
        title,
        type: evidenceTypeFromText(`${input}\n${reply}`),
        source: "本轮实时调查",
        visibleData: {
          summary: reply,
        },
        proves: ["形成一条可继续核验的调查记录"],
        contradicts: /异常|空档|补录|不一致|没有对应|可疑|改动/.test(reply)
          ? ["记录中出现需要继续追查的异常点"]
          : [],
        relatedSuspects: relatedSuspectsFromText(reply, caseData),
        relatedLocations: relatedLocationsFromText(reply, caseData, state),
        importance: /异常|空档|补录|不一致|没有对应|指印|断电|重启/.test(reply) ? 72 : 58,
        isKeyEvidence: false,
      },
    ],
    timeline: time
      ? [
          {
            id: `timeline-runtime-${stamp}`,
            time,
            description: reply.split(/[。！？\n]/).find((line) => line.includes(time))?.trim() || title,
            source: evidenceId,
            relatedEvidence: [evidenceId],
            relatedSuspects: relatedSuspectsFromText(reply, caseData),
            confidence: "suspected",
          },
        ]
      : [],
    notes: [`${title} 已归档。`],
  };

  return buildRuntimeDiscoveryFromDiscoveries({
    reply,
    discoveries,
    caseData,
    state,
  });
}

function buildRuntimeDiscoveryFromDiscoveries({
  reply,
  discoveries,
  caseData,
  state,
}: {
  reply: string;
  discoveries: RuntimeDiscoveries;
  caseData: CaseData;
  state: PlayerCaseState;
}): RuntimeDiscovery {
  const evidenceIds = new Set(caseData.evidence.map((item) => item.id));
  const locationIds = new Set(caseData.locations.map((item) => item.id));
  const suspectIds = new Set(caseData.suspects.map((item) => item.id));
  const timelineIds = new Set(caseData.timeline.map((item) => item.id));
  const relationshipIds = new Set(caseData.relationships.map((item) => item.id));

  const addedEvidence = discoveries.evidence.map((item) => normalizeEvidence(item, caseData, state, evidenceIds));
  const addedLocations = discoveries.locations.map((item) => normalizeLocation(item, locationIds));
  const addedSuspects = discoveries.suspects.map((item) => normalizeSuspect(item, suspectIds));
  const addedTimeline = discoveries.timeline.map((item) => normalizeTimeline(item, addedEvidence, timelineIds));
  const addedRelationships = discoveries.relationships.map((item) => normalizeRelationship(item, addedEvidence, relationshipIds));

  const nextCaseData: CaseData = {
    ...caseData,
    evidence: [...caseData.evidence, ...addedEvidence],
    locations: [...caseData.locations, ...addedLocations],
    suspects: [...caseData.suspects, ...addedSuspects],
    timeline: [...caseData.timeline, ...addedTimeline],
    relationships: [...caseData.relationships, ...addedRelationships],
    truth: {
      ...caseData.truth,
      keyEvidence: Array.from(
        new Set([
          ...caseData.truth.keyEvidence,
          ...discoveries.keyEvidenceIds,
          ...addedEvidence.filter((item) => item.isKeyEvidence).map((item) => item.id),
        ]),
      ),
      keyTimeline: Array.from(
        new Set([
          ...caseData.truth.keyTimeline,
          ...discoveries.keyTimelineIds,
          ...addedTimeline.filter((item) => item.confidence === "confirmed").map((item) => item.id),
        ]),
      ),
    },
  };

  const nextState: PlayerCaseState = {
    ...state,
    discoveredEvidence: Array.from(new Set([...state.discoveredEvidence, ...addedEvidence.map((item) => item.id)])),
    unlockedLocations: Array.from(new Set([...state.unlockedLocations, ...addedLocations.map((item) => item.id)])),
    visibleSuspects: Array.from(
      new Set([...state.visibleSuspects, ...addedSuspects.map((item) => item.id), ...addedEvidence.flatMap((item) => item.relatedSuspects)]),
    ),
    playerTimeline: [
      ...state.playerTimeline,
      ...addedTimeline.filter((event) => !state.playerTimeline.some((item) => item.id === event.id)),
    ],
    playerRelationships: [
      ...state.playerRelationships,
      ...addedRelationships.filter((relationship) => !state.playerRelationships.some((item) => item.id === relationship.id)),
    ],
    notes: Array.from(new Set([...state.notes, ...discoveries.notes])).slice(-20),
  };

  return {
    reply,
    caseData: nextCaseData,
    state: nextState,
    addedEvidence,
    addedLocations,
    addedSuspects,
    addedTimeline,
    addedRelationships,
    notes: discoveries.notes,
  };
}

export async function streamRuntimeDiscoveryReply({
  input,
  caseData,
  history,
  result,
  state,
  onContent,
}: {
  input: string;
  caseData: CaseData;
  history: SessionChatMessage[];
  result: ActionResult;
  state: PlayerCaseState;
  onContent: (content: string) => void;
}) {
  const text = await requestAiTextStream({
    temperature: 0.68,
    maxTokens: 720,
    messages: [
      {
        role: "system",
        content:
          "你是推理游戏的现场调查叙事引擎。普通对话阶段只输出给玩家看的中文调查结果，不输出 JSON。",
      } satisfies AiMessage,
      {
        role: "user",
        content: discoveryReplyPrompt(input, caseData, state, result, history),
      },
    ],
    onContent,
  });

  return text.trim();
}

export async function structureRuntimeDiscoveryFromReply({
  input,
  reply,
  caseData,
  history,
  result,
  state,
}: {
  input: string;
  reply: string;
  caseData: CaseData;
  history: SessionChatMessage[];
  result: ActionResult;
  state: PlayerCaseState;
}): Promise<RuntimeDiscovery> {
  const raw = await requestAiJsonStream<unknown>({
    temperature: 0.35,
    messages: [
      {
        role: "system",
        content:
          "你是推理游戏的 Runtime Discovery 归档引擎。你只把已经显示给玩家的调查结果结构化成案卷元数据。只返回严格 JSON。",
      } satisfies AiMessage,
      {
        role: "user",
        content: structureDiscoveryPrompt({ input, reply, caseData, state, result, history }),
      },
    ],
  });
  const parsed = runtimeDiscoveryStructureSchema.parse(raw);
  return buildRuntimeDiscoveryFromDiscoveries({
    reply,
    discoveries: parsed.discoveries,
    caseData,
    state,
  });
}

export async function generateRuntimeDiscovery({
  input,
  caseData,
  history,
  result,
  state,
}: {
  input: string;
  caseData: CaseData;
  history: SessionChatMessage[];
  result: ActionResult;
  state: PlayerCaseState;
}): Promise<RuntimeDiscovery> {
  const raw = await requestAiJsonStream<unknown>({
    temperature: 0.68,
    messages: [
      {
        role: "system",
        content: "你是推理游戏的 Runtime Discovery 引擎。你负责根据隐藏真相种子，动态生成玩家本轮查到的证据和事件。只返回严格 JSON。",
      } satisfies AiMessage,
      {
        role: "user",
        content: discoveryPrompt(input, caseData, state, result, history),
      },
    ],
  });
  const parsed = runtimeDiscoverySchema.parse(raw);
  return buildRuntimeDiscoveryFromDiscoveries({
    reply: parsed.reply,
    discoveries: parsed.discoveries,
    caseData,
    state,
  });
}
