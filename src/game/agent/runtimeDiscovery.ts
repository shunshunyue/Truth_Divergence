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

function asLooseStringArray(value: unknown) {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return asStringArray(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function compactRuntimeValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(compactRuntimeValue).filter(Boolean).join("；");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nestedValue]) => {
        const nestedText = compactRuntimeValue(nestedValue);
        return nestedText ? `${key}：${nestedText}` : "";
      })
      .filter(Boolean)
      .join("；");
  }
  return String(value);
}

function visualTemplateForEvidenceType(type: Evidence["type"]) {
  const templates: Record<Evidence["type"], string> = {
    CCTV: "cctv_frame",
    ACCESS_LOG: "access_log",
    FINANCIAL: "ledger_page",
    RECEIPT: "document",
    CALL_LOG: "call_log",
    CHAT: "chat_screen",
    LOCATION: "map_trace",
    FORENSIC: "forensic_report",
    OBJECT: "object_photo",
    MAP: "map_trace",
    DIARY: "document",
    WITNESS: "statement_file",
  };
  return templates[type] ?? "document";
}

function visualCarrierForEvidenceType(type: Evidence["type"]) {
  const carriers: Record<Evidence["type"], string> = {
    CCTV: "监控画面或监控控制台屏幕",
    ACCESS_LOG: "门禁终端、门岗登记屏或刷卡记录表",
    FINANCIAL: "账册、结算表或费用核对单",
    RECEIPT: "收据、小票或付款凭证",
    CALL_LOG: "通话记录屏幕或通讯清单",
    CHAT: "手机/电脑聊天记录界面",
    LOCATION: "定位轨迹图或位置记录",
    FORENSIC: "鉴定报告、样本袋或检验台",
    OBJECT: "封存物证或现场物件特写",
    MAP: "地图、平面图或路线标记图",
    DIARY: "笔记本、日记页或手写记录",
    WITNESS: "证词笔录、访谈记录或录音设备",
  };
  return carriers[type] ?? "证据文件或物证载体";
}

function normalizeEvidenceVisibleData({
  caseData,
  fallbackText,
  rawVisibleData,
  source,
  state,
  title,
  type,
}: {
  caseData: CaseData;
  fallbackText: string;
  rawVisibleData: Record<string, unknown>;
  source: string;
  state: PlayerCaseState;
  title: string;
  type: Evidence["type"];
}) {
  const rawSummary = compactRuntimeValue(rawVisibleData.summary);
  const fallbackSummary = compactRuntimeValue(rawVisibleData) || fallbackText || title;
  const summary = rawSummary || fallbackSummary;
  const existingDetails = asStringArray(rawVisibleData.visibleDetails);
  const detailCandidates = [
    ...existingDetails,
    ...summary.split(/[。！？\n；;]/).map((line) => line.trim()).filter(Boolean),
    source,
  ];
  const currentLocationName = caseData.locations.find((location) => location.id === state.currentLocation)?.name;

  return {
    ...rawVisibleData,
    summary,
    visualSubject: asString(rawVisibleData.visualSubject, title),
    visualCarrier: asString(rawVisibleData.visualCarrier, visualCarrierForEvidenceType(type)),
    visibleDetails: Array.from(new Set(detailCandidates)).slice(0, 5),
    ...(asString(rawVisibleData.timeWindow) || firstTimeText(summary)
      ? { timeWindow: asString(rawVisibleData.timeWindow, firstTimeText(summary)) }
      : {}),
    ...(asString(rawVisibleData.locationCue) || currentLocationName
      ? { locationCue: asString(rawVisibleData.locationCue, currentLocationName) }
      : {}),
    ...(asString(rawVisibleData.abnormalPoint)
      ? { abnormalPoint: asString(rawVisibleData.abnormalPoint) }
      : /异常|空档|补录|不一致|缺失|断电|重启|改动|可疑/.test(summary)
        ? { abnormalPoint: summary.split(/[。！？\n]/).find((line) => /异常|空档|补录|不一致|缺失|断电|重启|改动|可疑/.test(line))?.trim() ?? summary }
        : {}),
  };
}

function normalizeTextForMatch(value: string) {
  return value.toLowerCase().replace(/[\s"'“”‘’《》<>【】[\]（）()，,。.:：;；、_-]+/g, "");
}

function resolveSuspectIds(values: unknown, caseData: CaseData, text = "") {
  const requestedValues = asLooseStringArray(values);
  const requested = new Set(requestedValues.map(normalizeTextForMatch));
  const normalizedText = normalizeTextForMatch([text, ...requestedValues].join("\n"));

  return caseData.suspects
    .filter((suspect) => {
      const candidates = [suspect.id, suspect.name, suspect.identity].map(normalizeTextForMatch);
      return candidates.some((candidate) => requested.has(candidate) || Boolean(candidate && normalizedText.includes(candidate)));
    })
    .map((suspect) => suspect.id);
}

function personRelationshipIds(caseData: CaseData) {
  return new Set([
    caseData.victim.id,
    ...caseData.suspects.map((suspect) => suspect.id),
    ...caseData.witnesses.map((witness) => witness.id),
  ]);
}

function resolvePersonIds(values: unknown, caseData: CaseData, text = "") {
  const requestedValues = asLooseStringArray(values);
  const requested = new Set(requestedValues.map(normalizeTextForMatch));
  const normalizedText = normalizeTextForMatch([text, ...requestedValues].join("\n"));
  const people = [
    { id: caseData.victim.id, labels: [caseData.victim.id, caseData.victim.name, caseData.victim.role] },
    ...caseData.suspects.map((suspect) => ({
      id: suspect.id,
      labels: [suspect.id, suspect.name, suspect.identity, suspect.publicRelationship],
    })),
    ...caseData.witnesses.map((witness) => ({
      id: witness.id,
      labels: [witness.id, witness.name, witness.role, witness.description],
    })),
  ];

  return people
    .filter((person) =>
      person.labels
        .map(normalizeTextForMatch)
        .some((candidate) => requested.has(candidate) || Boolean(candidate && normalizedText.includes(candidate))),
    )
    .map((person) => person.id);
}

function resolveExistingSuspectFromRecord(raw: unknown, caseData: CaseData) {
  const item = asRecord(raw);
  const id = asString(item.id);
  const name = asString(item.name);
  const text = [id, name].filter(Boolean).join("\n");
  return resolveSuspectIds([id, name], caseData, text)[0];
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
    fieldSemantics: {
      victim: "受影响当事人或关键利益方，不一定是死者。",
      killer: "主要责任人/关键隐瞒者，不一定杀人。",
      method: "事件形成机制、违规操作或作案手法。",
      deathTime: "关键发生时间点，不一定是死亡时间。",
    },
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

可直接提到的嫌疑人（给玩家看的回答只能使用中文姓名，禁止输出 suspect- 开头的内部 id）：
${JSON.stringify(caseData.suspects.map((suspect) => ({ name: suspect.name, identity: suspect.identity })), null, 2)}

最近对话：
${JSON.stringify(recentMessages(history), null, 2)}

生成原则：
- 用户问“查/调取/看/翻/问某个记录或物件”，你必须直接生成一条查到的记录、事件、证词或物证，不要说“建议去查”。
- 生成的新发现必须最终服务于隐藏真相种子，不能改主要责任人、动机和事件形成机制。
- 可以动态新增证据、地点、嫌疑人、时间线和关系；新增内容要具体，有时间、地点、记录细节或人物行为。
- 每轮都要检查是否能沉淀时间线：只要本轮记录、口供、监控、日志、聊天、账册、证据或当前已知内容出现明确时间、时间段、先后顺序、进出、交接、停留、报警、重启、断电、补录等事件，就输出 timeline，并由后台实时推送到时间线。
- 如果玩家要求“时间线/时间轴/轨迹/整理经过/先后顺序”，必须优先输出 timeline；普通调查轮次如果出现可定位事件，也要输出 timeline。
- timeline.time 写玩家能看懂的时间锚点，例如“凌晨2:13”“案发前一天晚上”“门禁补录后”；description 只写一个可复盘事件，不要写分析建议。
- timeline.source 优先填支撑证据 id；没有新证据时填 runtime-discovery。relatedEvidence 只能填真实 evidence id。
- 每轮都要检查是否能沉淀人物关系：只要本轮记录、口供、监控、时间线或当前已知内容显示两名人物共同出现、认识、交接、合作、利益牵连、冲突、隐瞒或互相包庇，就输出 relationship，并由后台实时推送到关系图。
- 如果玩家要求“关系图/人物关系/关系网/整理关系”，必须优先输出 relationships；普通调查轮次如果出现人物接触或关系线索，也要输出 relationships。
- relationships.from 和 relationships.to 只能使用人物 id：受影响当事人、嫌疑人或证人。证据只能放在 relatedEvidence 里作为支撑来源。
- relationships.label 要写清关系本身和认识/冲突/合作场景，例如“张某与李某是朋友，两人是在饭桌上认识的”，不要写成“某证据关联某人”。
- relationships.label 不要写“某证据把某人纳入核验范围”这类泛泛关联，必须是人物之间的关系句。
- 如果当前已经有时间线事件或已发现证据能支撑人物之间的接触、认识、利益、冲突、隐瞒、合作，就为这些人物生成 2-6 条关系；不要为了撑图创建证据节点关系。
- 不要一次性给出最终责任人或完整真相。把真相拆成多轮可追查的矛盾。
- 不要把非命案强行写成凶杀、尸体、死亡时间或杀人手法；跟随本案主题生成合理事件细节。
- reply 是中间聊天框直接显示的话，要像一个真人搭档在旁边低声过线索：用“我刚翻到/我看了下/这儿有个不对劲/先别急着定论”。
- reply 禁止写成旁白或系统播报：不要出现“你一开口”“旁边的 AI 副手”“立刻把重点拎出来”“最值得先碰的是三样东西”这类句子。
- reply 不要堆并列说明，不要用报告腔解释“账册能看出、药箱如果、控制台则关系到”。要先说眼前发现，再说为什么值得追。
- 如果本轮问的是进出记录，就造一段进出记录；问监控，就造监控片段；问账册，就造账册异常；问某人，就造口供反应。
- 如果生成 evidence，visibleData 不能只填 summary；必须多填 visualSubject、visualCarrier、visibleDetails、timeWindow/locationCue/abnormalPoint 中能从回答里支撑的字段，方便后续生成强相关证据图。
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
        "visualTemplate": "document|cctv_frame|access_log|ledger_page|chat_screen|call_log|map_trace|object_photo|forensic_report|statement_file",
        "visibleData": {
          "summary": "玩家可见内容",
          "visualSubject": "这张图应该聚焦的证据本体，例如门禁终端屏幕/监控画面/账册某一页/药箱缺口",
          "visualCarrier": "证据载体，例如监控控制台、门岗终端、纸质账册、手机聊天界面、封存物证袋",
          "visibleDetails": ["画面中能看到的具体细节，至少 2 条"],
          "timeWindow": "如果回答里有时间，填时间段",
          "locationCue": "如果回答里有地点，填地点线索",
          "abnormalPoint": "这条证据最可视化的异常点"
        },
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
    "relationships": [{"id":"relationship-可选","from":"人物id","to":"人物id","type":"normal|conflict|hidden|time|evidence|misleading","status":"unknown|suspected|conflict|confirmed|excluded|key","label":"人物关系说明，包含认识场景/关系性质/矛盾点","relatedEvidence":["evidence-id"]}],
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

可直接提到的嫌疑人（给玩家看的回答只能使用中文姓名，禁止输出 suspect- 开头的内部 id）：
${JSON.stringify(caseData.suspects.map((suspect) => ({ name: suspect.name, identity: suspect.identity })), null, 2)}

最近对话：
${JSON.stringify(recentMessages(history), null, 2)}

回复原则：
- 必须直接顺着玩家的问题给出查到的记录、事件、证词或物件细节。
- 如果玩家要求“时间线/时间轴/轨迹/整理经过/先后顺序”，按时间或先后顺序说已知节点，不要混排。
- 如果本轮查到明确时间、时间段、先后顺序、轨迹、出入、停留或交接，正文里自然说出时间锚点和对应事件，方便后台实时更新时间线。
- 如果玩家要求“关系图/人物关系/关系网/整理关系”，只说人物之间的关系和关系场景，例如朋友、合作、冲突、饭桌认识、共同出现；不要把证据或地点说成关系图节点。
- 如果本轮查到的记录里有两个人共同出现、交接、认识、冲突或互相遮掩，正文里自然点出这个人物关系线索，方便后台实时更新关系图。
- 不要给“建议去哪里查”的列表；如果玩家说“查进出记录”，就直接写出进出记录里出现了什么。
- 如果本轮调出了可沉淀为 evidence 的记录、监控、票据、截图、物证照片或证据图片，正文里要自然说明“对应证据影像我也在整理/稍等会贴上来/我把图附在下面”，不要让图片附件无声出现。
- 不要在回答末尾主动安排“下一位问谁/接下来查两样/我建议一二三”。除非玩家明确问下一步，否则只说本轮查到的内容和一个很轻的判断。
- 不要说“没有这个证据”“查不到”“尚未发现”。证据就是这一轮被调出来的。
- 新内容要具体：至少包含时间、地点、人员、记录来源或异常点中的 2 类。
- 不能直接说出最终责任人或完整真相；用可继续追查的矛盾把玩家引向隐藏真相。
- 不要把非命案强行写成凶杀、尸体、死亡时间或杀人手法；跟随本案主题生成合理事件细节。
- 说话要像真人搭档，不像系统总结。优先第一人称：“我刚翻到...”“这里有个细节不太顺...”“先把这条扣住。”
- 禁止旁白腔：不要写“你一开口”“旁边的 AI 副手”“立刻把重点拎出来”“最值得先碰的是三样东西”。
- 禁止报告腔：不要连续使用“能看出/如果...就说明/则关系到/一旦...就能”来讲道理。
- 禁止把内部 id 说给玩家：不要输出 suspect-、evidence-、timeline-、relationship-、loc- 这类字段值；需要说人物时只说中文姓名。
- 不要输出 JSON、不要 Markdown 表格、不要标题堆砌。自然中文，1 到 3 句，每句尽量短。

风格示例：
不要这样写：你一开口，旁边的 AI 副手立刻把现场重点拎出来了：账册、药箱、监控控制台都很关键。
要这样写：我先看了桌上那本封闸账册，翻页痕迹很乱，像是有人赶着找某一页。墙角药箱也别放过，缺的不是普通纱布，像是被人专门拿走过。监控台凌晨重启过，这条得和门禁时间一起对。`;
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

本案已有嫌疑人索引（归档用；提到这些人时必须使用 id，不要重复创建 suspects）：
${JSON.stringify(caseData.suspects.map((suspect) => ({ id: suspect.id, name: suspect.name, identity: suspect.identity })), null, 2)}

最近对话：
${JSON.stringify(recentMessages(history), null, 2)}

归档原则：
- 结构化内容必须与“已显示给玩家的回答”一致，可以补齐必要字段，但不要新增回答里完全没提到的大事实。
- evidence 不是每轮必填。只有回答里出现了可被玩家反复引用、比对或出示的材料，才沉淀为 evidence。
- 可以沉淀为 evidence 的例子：门禁/门岗记录、监控片段、账册页、药箱缺失记录、通话/聊天/定位记录、法医/痕检报告、现场物证、明确证词。
- 不要沉淀为 evidence 的例子：普通建议、推理方向、复盘总结、下一步计划、对已有证据的解释、没有具体来源/时间/对象的闲聊式判断。
- 如果本轮只是分析或建议，把重点放进 notes，evidence 必须返回空数组。
- 如果回答里只是提到“可以查某物”，但没有真的调出具体内容，也不要创建 evidence。
- 如果回答只是围绕已有证据解释，不要为同一段解释新建 evidence；可以补 notes、timeline 或 relationship。
- 每轮归档都要检查是否能沉淀时间线：只要已显示回答、本轮新增 evidence、当前可见证据或当前可见事件里出现明确时间、时间段、先后顺序、进出、交接、停留、报警、重启、断电、补录等，就生成 timeline，由后台实时推送到时间线。
- 如果玩家要求“时间线/时间轴/轨迹/整理经过/先后顺序”，必须把回答和当前可见事件结构化为 timeline；普通调查轮次如果出现可定位事件，也要结构化为 timeline。
- 可以从本轮回答和当前可见内容生成 1-6 条 timeline；没有足够时间或顺序支撑时宁可只写 notes。
- timeline.time 必须是玩家可见的时间锚点，例如“凌晨2:13”“案发前一天晚上”“门禁补录后”；description 只写该时点发生的事；source 优先证据 id，无新证据用 runtime-discovery；relatedEvidence 只能填真实 evidence id。
- 每轮归档都要检查是否能沉淀人物关系：只要已显示回答、本轮新增 evidence/timeline，或当前可见事件显示两名人物共同出现、认识、交接、合作、利益牵连、冲突、隐瞒或互相包庇，就生成 relationship，由后台实时推送到关系图。
- 如果玩家要求“关系图/人物关系/关系网/整理关系”，必须把回答和当前可见事件结构化为 relationships；普通调查轮次如果出现人物接触或关系线索，也要结构化为 relationships。
- 关系图只画人物关系，不要把证据、地点或时间线事件作为 relationship.from/to。
- relationship.from 和 relationship.to 只能使用人物 id：受影响当事人、嫌疑人或证人。证据只允许放在 relatedEvidence 里作为支撑来源。
- relationship.label 要写清人物关系本身和关系场景，例如“张某与李某是朋友，两人是在饭桌上认识的”；不要写成“某证据关联某人”。
- relationship.label 不要写“某证据把某人纳入核验范围”这类泛泛关联，必须是人物之间的关系句。
- 如果当前可见时间线、证据或口供已经支持人物之间的接触、认识、利益、冲突、隐瞒、合作，可以生成 1-6 条 relationship；没有足够支撑时宁可只写 notes。
- 如果 evidence/timeline/relationship 里提到已有嫌疑人，relatedSuspects/from/to 必须填对应人物 id。不要填人名。
- 如果回答中提到已有嫌疑人姓名，即使没有创建新 suspects，也要把该嫌疑人 id 写进相关 evidence.relatedSuspects、timeline.relatedSuspects 或 relationship.from/to。
- 只有回答里出现了案卷里完全没有的新人物，才放进 suspects；已有嫌疑人绝对不要重复创建。
- 如果回答中出现新地点或可继续追查的物件，可以生成 locations。
- 如果回答中出现新人物，可以生成 suspects；如果只是已有嫌疑人，不要重复创建。
- 相关嫌疑人和地点 id 优先使用现有 id。
- 如果生成 evidence，visibleData 不能只填 summary；必须多填 visualSubject、visualCarrier、visibleDetails、timeWindow/locationCue/abnormalPoint 中能从已显示回答支撑的字段，方便后续生成强相关证据图。
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
        "visualTemplate": "document|cctv_frame|access_log|ledger_page|chat_screen|call_log|map_trace|object_photo|forensic_report|statement_file",
        "visibleData": {
          "summary": "玩家可见内容",
          "visualSubject": "这张图应该聚焦的证据本体，例如门禁终端屏幕/监控画面/账册某一页/药箱缺口",
          "visualCarrier": "证据载体，例如监控控制台、门岗终端、纸质账册、手机聊天界面、封存物证袋",
          "visibleDetails": ["画面中能看到的具体细节，至少 2 条"],
          "timeWindow": "如果回答里有时间，填时间段",
          "locationCue": "如果回答里有地点，填地点线索",
          "abnormalPoint": "这条证据最可视化的异常点"
        },
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
    "relationships": [{"id":"relationship-可选","from":"人物id","to":"人物id","type":"normal|conflict|hidden|time|evidence|misleading","status":"unknown|suspected|conflict|confirmed|excluded|key","label":"人物关系说明，包含认识场景/关系性质/矛盾点","relatedEvidence":["evidence-id"]}],
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
  const source = asString(item.source, "运行时调查");
  const visualTemplate = asString(item.visualTemplate, visualTemplateForEvidenceType(type));
  const rawVisibleData = asRecord(item.visibleData);
  const fallbackText = [
    title,
    source,
    ...Object.values(rawVisibleData).map(compactRuntimeValue),
    ...asStringArray(item.proves),
    ...asStringArray(item.contradicts),
  ].filter(Boolean).join("\n");
  const visibleData = normalizeEvidenceVisibleData({
    caseData,
    fallbackText,
    rawVisibleData,
    source,
    state,
    title,
    type,
  });
  const visibleSummary = Object.values(visibleData).map(compactRuntimeValue).join("\n");
  const suspectText = `${title}\n${asString(item.source)}\n${visibleSummary}\n${asStringArray(item.proves).join("\n")}\n${asStringArray(item.contradicts).join("\n")}\n${asStringArray(item.supports).join("\n")}`;
  return {
    id,
    title,
    type,
    source,
    visualTemplate,
    visibleData,
    hiddenMetadata: {},
    proves: asStringArray(item.proves),
    contradicts: asStringArray(item.contradicts),
    supports: asStringArray(item.supports),
    relatedSuspects: resolveSuspectIds(item.relatedSuspects, caseData, suspectText),
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

function normalizeTimeline(raw: unknown, evidence: Evidence[], caseData: CaseData, existing: Set<string>): TimelineEvent {
  const item = asRecord(raw);
  const description = asString(item.description, "新时间点");
  const id = idWithPrefix("timeline", item.id, description, existing);
  const evidenceIds = new Set([...caseData.evidence, ...evidence].map((item) => item.id));
  const relatedEvidence = asStringArray(item.relatedEvidence).filter((evidenceId) => evidenceIds.has(evidenceId));
  const rawSource = asString(item.source);
  const source =
    rawSource && (!rawSource.startsWith("evidence-") || evidenceIds.has(rawSource))
      ? rawSource
      : relatedEvidence[0] ?? evidence[0]?.id ?? "runtime-discovery";
  const suspectText = [description, asString(item.time), asString(item.source), relatedEvidence.join("\n")].join("\n");
  return {
    id,
    time: asString(item.time, "时间待核验"),
    description,
    source,
    relatedEvidence,
    relatedSuspects: resolveSuspectIds(item.relatedSuspects, caseData, suspectText),
    confidence: oneOf(item.confidence, ["confirmed", "suspected", "disputed"] as const, "suspected"),
  };
}

function timelineFingerprint(event: Pick<TimelineEvent, "time" | "description">) {
  return `${normalizeTextForMatch(event.time)}|${normalizeTextForMatch(event.description)}`;
}

function normalizeRelationship(raw: unknown, evidence: Evidence[], caseData: CaseData, existing: Set<string>): Relationship {
  const item = asRecord(raw);
  const label = asString(item.label, "新关系线索");
  const id = idWithPrefix("relationship", item.id, label, existing);
  const rawFrom = asString(item.from);
  const rawTo = asString(item.to);
  const mentionedPeople = resolvePersonIds([], caseData, label);
  let from = resolvePersonIds([rawFrom], caseData, rawFrom || label)[0] ?? rawFrom;
  let to = resolvePersonIds([rawTo], caseData, rawTo || label)[0] ?? rawTo;
  if (!from || !to || from === to) {
    from = mentionedPeople[0] ?? from;
    to = mentionedPeople.find((personId) => personId !== from) ?? to;
  }
  const evidenceIds = new Set([...caseData.evidence, ...evidence].map((item) => item.id));
  const relatedEvidence = asStringArray(item.relatedEvidence).filter((evidenceId) => evidenceIds.has(evidenceId));
  return {
    id,
    from,
    to,
    type: oneOf(item.type, ["normal", "conflict", "hidden", "time", "evidence", "misleading"] as const, "evidence"),
    status: oneOf(item.status, ["unknown", "suspected", "conflict", "confirmed", "excluded", "key"] as const, "suspected"),
    label,
    relatedEvidence,
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

function shouldCreateFallbackEvidence(input: string, reply: string) {
  const text = `${input}\n${reply}`;
  const evidenceIntent =
    /查|调取|看一下|看看|翻|打开|核对|比对|读取|记录|日志|监控|录像|门禁|门岗|登记|账册|账本|药箱|物证|证词|口供|鉴定|报告|通话|短信|聊天|定位|票据|收据|小票|指纹|血迹|痕迹|控制台/.test(
      input,
    );
  const materialSignal =
    /记录显示|记录里|刷卡记录|开门记录|出入记录|通行记录|门禁记录|日志|编号|刷卡|登记|补录|签名|时间戳|画面|镜头|录像|账册|账页|药箱|少了|缺失|提取|鉴定|报告|通话|短信|定位|票据|指纹|血迹|痕迹|来源|备注栏/.test(
      text,
    );
  const specificitySignal =
    /(?:凌晨|上午|中午|下午|晚上|昨晚|当晚|夜里)?\s*\d{1,2}(?:[:：点时]\d{1,2})?(?:分)?/.test(text) ||
    /[A-Z]{1,4}[-_]\d{2,}|#\d{2,}|第[一二三四五六七八九十\d]+页/.test(text);
  const conversationalOnly =
    /总结|整理|复盘|怎么看|怎么想|下一步|建议|分析|推理|怀疑|方向/.test(input) &&
    !/查|调取|翻|记录|日志|监控|门禁|账册|物证|证词|口供/.test(input);

  return !conversationalOnly && evidenceIntent && materialSignal && specificitySignal;
}

function relatedSuspectsFromText(text: string, caseData: CaseData) {
  return resolveSuspectIds([], caseData, text);
}

function relatedLocationsFromText(text: string, caseData: CaseData, state: PlayerCaseState) {
  const explicit = caseData.locations.filter((location) => text.includes(location.name)).map((location) => location.id);
  return explicit.length ? explicit : state.currentLocation ? [state.currentLocation] : [];
}

function firstTimeText(text: string) {
  const compact = text.replace(/\s+/g, "");
  const dateMatch = compact.match(
    /(?:\d{4}[年/-])?\d{1,2}(?:月|[-/.])\d{1,2}(?:日|号)?(?:(?:凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里|夜间|深夜)?\d{1,2}(?::|：)\d{1,2}|(?:凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里|夜间|深夜)?\d{1,2}(?:点半|点(?:[0-5]?\d分?)?|时(?:[0-5]?\d分?)?))?/,
  );
  if (dateMatch?.[0]) return dateMatch[0];

  const relativeMatch = compact.match(
    /(?:(?:案发|事发)?(?:前两天|前一天|前一晚|前夜)|前天|昨天|昨晚|昨日|当天|当晚|当夜|次日|翌日|第二天|第二日)(?:(?:凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里|夜间|深夜)?\d{1,2}(?::|：)\d{1,2}|(?:凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里|夜间|深夜)?\d{1,2}(?:点半|点(?:[0-5]?\d分?)?|时(?:[0-5]?\d分?)?))?/,
  );
  if (relativeMatch?.[0]) return relativeMatch[0];

  const clockMatch =
    compact.match(/(?:凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里|夜间|深夜|昨晚|当晚|当夜)?\d{1,2}(?::|：)\d{1,2}/) ??
    compact.match(/(?:凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里|夜间|深夜|昨晚|当晚|当夜)\d{1,2}(?:点半|点(?:[0-5]?\d分?)?|时(?:[0-5]?\d分?)?)?/);

  return clockMatch?.[0] ?? "";
}

function firstTimelineAnchor(text: string) {
  const explicitTime = firstTimeText(text);
  if (explicitTime) return explicitTime;

  const compact = text.replace(/\s+/g, "");
  const orderMatch = compact.match(
    /(?:报警|报案|重启|断电|停电|补录|交接|进入|离开|到达|返回|通话|登记|刷卡|签名|争吵|见面|停留)(?:前|后)|(?:之前|之后|随后|接着|紧接着|同时|同一时段|期间)/,
  );
  return orderMatch?.[0] ?? "";
}

function asksForTimeline(input: string) {
  return /时间线|时间轴|轨迹|整理经过|经过|先后|顺序|几点|什么时候|出入|进出/.test(input);
}

function hasTimelineEventSignal(text: string) {
  return /记录显示|记录里|画面|镜头|录像|监控|日志|门禁|刷卡|登记|通行|出入|进出|进入|离开|到达|返回|停留|交接|拿走|放回|重启|断电|停电|报警|报案|补录|签名|通话|来电|拨号|聊天|消息|账册|账页|票据|定位|轨迹|口供|证词|承认|争吵|见面|共同出现|同时出现/.test(text);
}

function shouldCreateFallbackTimeline(input: string, reply: string, createEvidence: boolean) {
  const text = `${input}\n${reply}`;
  if (!firstTimelineAnchor(text)) return false;

  const timelineRequest = asksForTimeline(input);
  const eventSignal = hasTimelineEventSignal(text);
  const conversationalOnly =
    /总结|整理|复盘|怎么看|怎么想|下一步|建议|分析|推理|怀疑|方向/.test(input) &&
    !timelineRequest &&
    !eventSignal;

  return !conversationalOnly && (createEvidence || timelineRequest || eventSignal);
}

function timelineDescriptionFromText(reply: string, input: string, anchor: string, fallback: string) {
  const parts = `${reply}\n${input}`
    .split(/[。！？；;\n]/)
    .map((line) => line.trim())
    .filter(Boolean);
  const normalizedAnchor = normalizeTextForMatch(anchor);
  const anchored = parts.find((line) => normalizeTextForMatch(line).includes(normalizedAnchor));
  const eventful = parts.find((line) => hasTimelineEventSignal(line));
  const description = anchored || eventful || parts[0] || fallback;
  return description.length > 120 ? `${description.slice(0, 117)}...` : description;
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
  const evidenceTime = firstTimeText(reply);
  const timelineTime = firstTimelineAnchor(`${input}\n${reply}`);
  const createEvidence = shouldCreateFallbackEvidence(input, reply);
  const createTimeline = shouldCreateFallbackTimeline(input, reply, createEvidence);
  const timelineDescription = timelineTime ? timelineDescriptionFromText(reply, input, timelineTime, title) : "";
  const fallbackEvidenceType = evidenceTypeFromText(`${input}\n${reply}`);
  const fallbackLocation = caseData.locations.find((location) => location.id === state.currentLocation)?.name;
  const fallbackDetails = reply.split(/[。！？\n]/).map((line) => line.trim()).filter(Boolean).slice(0, 4);
  const discoveries: RuntimeDiscoveries = {
    ...emptyDiscoveries,
    evidence: createEvidence
      ? [
          {
            id: evidenceId,
            title,
            type: fallbackEvidenceType,
            source: "本轮实时调查",
            visualTemplate: visualTemplateForEvidenceType(fallbackEvidenceType),
            visibleData: {
              summary: reply,
              visualSubject: title,
              visualCarrier: visualCarrierForEvidenceType(fallbackEvidenceType),
              visibleDetails: fallbackDetails,
              ...(evidenceTime || timelineTime ? { timeWindow: evidenceTime || timelineTime } : {}),
              ...(fallbackLocation ? { locationCue: fallbackLocation } : {}),
              ...(reply.match(/异常|空档|补录|不一致|缺失|断电|重启|改动|可疑/) ? { abnormalPoint: reply } : {}),
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
        ]
      : [],
    timeline: createTimeline && timelineTime
      ? [
          {
            id: `timeline-runtime-${stamp}`,
            time: timelineTime,
            description: timelineDescription || title,
            source: createEvidence ? evidenceId : "runtime-discovery",
            relatedEvidence: createEvidence ? [evidenceId] : [],
            relatedSuspects: relatedSuspectsFromText(reply, caseData),
            confidence: "suspected",
          },
        ]
      : [],
    notes: [
      createEvidence
        ? `${title} 已临时归档，等待精细结构化。`
        : createTimeline
          ? `时间线节点已临时归档：${timelineDescription || timelineTime}`
        : `未形成独立证据：${reply.split(/[。！？\n]/).find((line) => line.trim())?.trim() || input}`,
    ],
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
  const existingSuspectIdsFromDiscoveries = discoveries.suspects
    .map((item) => resolveExistingSuspectFromRecord(item, caseData))
    .filter((id): id is string => Boolean(id));
  const addedSuspects = discoveries.suspects
    .filter((item) => !resolveExistingSuspectFromRecord(item, caseData))
    .map((item) => normalizeSuspect(item, suspectIds));
  const existingTimelineFingerprints = new Set([...caseData.timeline, ...state.playerTimeline].map(timelineFingerprint));
  const addedTimeline = discoveries.timeline
    .map((item) => normalizeTimeline(item, addedEvidence, caseData, timelineIds))
    .filter((event) => {
      const fingerprint = timelineFingerprint(event);
      if (existingTimelineFingerprints.has(fingerprint)) return false;
      existingTimelineFingerprints.add(fingerprint);
      return true;
    });
  const knownPersonIds = new Set([...personRelationshipIds(caseData), ...addedSuspects.map((suspect) => suspect.id)]);
  const addedRelationships = discoveries.relationships
    .map((item) => normalizeRelationship(item, addedEvidence, caseData, relationshipIds))
    .filter((relationship) => knownPersonIds.has(relationship.from) && knownPersonIds.has(relationship.to) && relationship.from !== relationship.to);
  const nextSuspectIds = new Set([...caseData.suspects.map((item) => item.id), ...addedSuspects.map((item) => item.id)]);
  const relatedSuspectIds = [
    ...existingSuspectIdsFromDiscoveries,
    ...addedSuspects.map((item) => item.id),
    ...addedEvidence.flatMap((item) => item.relatedSuspects),
    ...addedTimeline.flatMap((item) => item.relatedSuspects),
    ...addedRelationships.flatMap((item) => [item.from, item.to]),
  ].filter((id) => nextSuspectIds.has(id));

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
      new Set([...state.visibleSuspects, ...relatedSuspectIds]),
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
          "你是推理游戏里的调查搭档。说话像真人在旁边帮玩家看现场，不要像系统播报或报告摘要。普通对话阶段只输出给玩家看的中文调查结果，不输出 JSON。",
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
