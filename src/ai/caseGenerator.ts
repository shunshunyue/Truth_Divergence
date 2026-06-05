import { z } from "zod";
import { hasAiCredentials, requestAiJsonStream } from "@/ai/client";
import { caseDataSchema, type CaseData, type PlayerCaseState } from "@/game/schemas/game";
import { createInitialPlayerState } from "@/game/engine/state";

const generatedSessionSchema = z.object({
  caseData: caseDataSchema,
});

export type GeneratedSession = {
  caseData: CaseData;
  state: PlayerCaseState;
};

function schemaContract() {
  return `必须严格返回这个 JSON 顶层结构：
{
  "caseData": {
    "id": "session-case",
    "title": "中文案件名",
    "theme": "中文主题",
    "difficulty": "中文难度",
    "openingEvent": {"headline":"中文","brief":"中文","initialPrompt":"中文"},
    "victim": {"id":"victim-xxx","name":"中文","role":"死者","description":"中文"},
    "suspects": [
      {
        "id":"suspect-xxx","name":"中文","age":30,"identity":"中文",
        "publicRelationship":"中文","hiddenRelationship":"中文",
        "publicStatement":"中文","hiddenTruth":["中文"],
        "motiveLevel":50,"opportunityLevel":50,
        "lieStyle":"中文","emotionalWeakness":"中文",
        "breakConditions":["evidence-xxx"],"falseLeads":["中文"],"isKiller":false
      }
    ],
    "witnesses": [{"id":"witness-xxx","name":"中文","role":"中文","description":"中文"}],
    "locations": [
      {
        "id":"loc-xxx","name":"中文","kind":"中文","description":"中文",
        "objects":[
          {
            "id":"obj-xxx","name":"中文","description":"中文",
            "unlocksEvidence":["evidence-xxx"],
            "unlocksSuspects":["suspect-xxx"],
            "unlocksLocations":["loc-xxx"],
            "visibleConditions":[]
          }
        ],
        "connectedLocations":["loc-xxx"],
        "unlockConditions":[]
      }
    ],
    "evidence": [
      {
        "id":"evidence-xxx","title":"中文","type":"OBJECT","source":"中文","visualTemplate":"document",
        "visibleData":{"summary":"中文"},
        "hiddenMetadata":{"truthRole":"中文"},
        "proves":["中文"],"contradicts":["中文"],"supports":["timeline-xxx"],
        "relatedSuspects":["suspect-xxx"],"relatedLocations":["loc-xxx"],"relatedTimeline":["timeline-xxx"],
        "unlockConditions":[],
        "unlocks":[],
        "reliability":"high","importance":80,"isKeyEvidence":true
      }
    ],
    "timeline": [
      {
        "id":"timeline-xxx","time":"中文时间","description":"中文","source":"evidence-xxx",
        "relatedEvidence":["evidence-xxx"],"relatedSuspects":["suspect-xxx"],"confidence":"confirmed"
      }
    ],
    "relationships": [
      {
        "id":"relationship-xxx","from":"suspect-xxx","to":"victim-xxx",
        "type":"hidden","status":"suspected","label":"中文","relatedEvidence":["evidence-xxx"]
      }
    ],
    "truth": {
      "killer":"suspect-xxx","motive":"中文","method":"中文","deathTime":"中文",
      "keyTimeline":["timeline-xxx"],"keyEvidence":["evidence-xxx"],
      "falseLeads":["relationship-xxx"],"hiddenRelationships":["relationship-xxx"],
      "exclusionReasons":{"suspect-xxx":"中文"}
    },
    "scoringRules":{"killer":25,"motive":15,"method":15,"timeline":15,"keyEvidence":10,"exclusions":10,"relationships":5,"clarity":5}
  }
}`;
}

function generationPrompt() {
  return `生成一局全新的中文推理游戏案件。不要使用预设案件，不要复用示例内容，不要 markdown。

硬性要求：
- 所有案件内容都由你原创生成。
- 只返回 JSON 对象。
- 必须完全符合下面的字段契约，不能增加 age 到 victim，不能把 victim 写成 suspect 格式，不能漏 role/description。
- 证据 type 只能是 CCTV、CALL_LOG、ACCESS_LOG、DIARY、RECEIPT、WITNESS、FORENSIC、CHAT、LOCATION、FINANCIAL、OBJECT、MAP。
- reliability 只能是 low、medium、high。
- relationship.type 只能是 normal、conflict、hidden、time、evidence、misleading。
- relationship.status 只能是 unknown、suspected、conflict、confirmed、excluded、key。
- timeline.confidence 只能是 confirmed、suspected、disputed。
- 第一个 location 是开局位置，开局 objects 必须至少 2 个。
  - 开局不要直接暴露嫌疑人，visibleSuspects 会由系统初始状态隐藏，但 suspects 数据必须完整存在。
  - truth 里必须指定真凶、动机、手法、关键证据和关键时间线。
  - 不要生成页面、HTML 或 aiPage；案件进入游戏后由 WebSocket 对话和左右侧元数据面板呈现。

${schemaContract()}`;
}

function repairPrompt(raw: unknown, error: z.ZodError) {
  return `你刚才返回的 JSON 没有通过游戏 schema 校验。请只返回修复后的完整 JSON 对象，不要解释，不要 markdown。

校验错误：
${JSON.stringify(error.issues, null, 2)}

原始 JSON：
${JSON.stringify(raw).slice(0, 50000)}

字段契约：
${schemaContract()}`;
}

function parseGeneratedCase(raw: unknown) {
  return generatedSessionSchema.parse(raw);
}

export async function generateInitialSession(
  onContent?: (content: string) => void,
  onStatus?: (status: string) => void,
): Promise<GeneratedSession> {
  if (!hasAiCredentials()) {
    throw new Error("UNITY2_AI_API_KEY or UNITY2_AI_MODEL is not configured.");
  }

  onStatus?.("AI 正在生成原创案件结构...");
  const raw = await requestAiJsonStream<unknown>({
    temperature: 0.7,
    onContent,
    messages: [
      {
        role: "system",
        content: "你是《真相偏差》的 AI 案件生成器。案件内容必须全部原创，且必须输出严格 JSON。",
      },
      {
        role: "user",
        content: generationPrompt(),
      },
    ],
  });

  let parsed;
  try {
    onStatus?.("正在校验案件结构...");
    parsed = parseGeneratedCase(raw);
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    onStatus?.("AI 正在流式修正案件结构...");
    const repaired = await requestAiJsonStream<unknown>({
      temperature: 0.2,
      onContent,
      messages: [
        {
          role: "system",
          content: "你是 JSON schema 修复器。只能修字段结构，不能改成示例案件，不能解释。",
        },
        {
          role: "user",
          content: repairPrompt(raw, error),
        },
      ],
    });
    parsed = parseGeneratedCase(repaired);
  }

  const state = createInitialPlayerState(parsed.caseData);

  return {
    caseData: parsed.caseData,
    state,
  };
}
