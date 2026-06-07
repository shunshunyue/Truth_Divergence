import { createHash } from "crypto";
import OpenAI from "openai";
import { saveVisualObject } from "@/ai/visualStorage";
import type { CaseData, Evidence, SuspectProfile } from "@/game/schemas/game";
import {
  caseVisualManifestSchema,
  type CaseVisualManifest,
  type CaseVisualStyle,
  type VisualAsset,
  type VisualAssetKind,
  type VisualVisibility,
} from "@/game/schemas/visuals";

type VisualGenerationLogger = (message: string, data?: Record<string, unknown>) => void;

type PlannedAsset = {
  kind: VisualAssetKind;
  entityId?: string;
  title: string;
  description?: string;
  caption?: string;
  prompt: string;
  visibility: VisualVisibility;
  revealConditions?: string[];
  revealHints?: string[];
  relatedEvidenceIds?: string[];
  relatedLocationIds?: string[];
  relatedSuspectIds?: string[];
  plotClues?: string[];
  investigationPrompts?: string[];
  tags?: string[];
  width: number;
  height: number;
};

type GenerateCaseVisualManifestOptions = {
  cacheId?: string;
  logger?: VisualGenerationLogger;
};

type ImageGenerationResult = {
  fileUrl?: string;
  source: VisualAsset["source"];
  status: VisualAsset["status"];
  width?: number;
  height?: number;
  errorMessage?: string;
};

const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_IMAGE_QUALITY = "high";
const DEFAULT_IMAGE_FORMAT = "png";
const FALLBACK_IMAGE_WIDTH = 1024;
const FALLBACK_IMAGE_HEIGHT = 768;

type OpenAiImageConfig = {
  apiKey?: string;
  baseURL: string;
  model: string;
  quality: "low" | "medium" | "high" | "auto";
  outputFormat: "png" | "jpeg" | "webp";
  moderation: "low" | "auto";
};

type CaseVisualsScope = "opening" | "preload" | "full";

function envFlag(name: string, fallback = true) {
  const value = process.env[name];
  if (value == null) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function safeSlug(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (normalized) return normalized.slice(0, 80);
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function normalizeOpenAiBaseUrl(value: string) {
  const url = new URL(value);
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  if (!normalizedPath.endsWith("/v1")) {
    url.pathname = `${normalizedPath}/v1`;
  } else {
    url.pathname = normalizedPath;
  }
  return url.toString().replace(/\/+$/, "");
}

function enumEnv<T extends string>(name: string, allowed: readonly T[], fallback: T) {
  const value = process.env[name];
  if (!value) return fallback;
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function getOpenAiImageConfig(): OpenAiImageConfig {
  const baseURL = normalizeOpenAiBaseUrl(
    process.env.OPENAI_IMAGE_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  );

  return {
    apiKey: process.env.OPENAI_IMAGE_API_KEY ?? process.env.OPENAI_API_KEY,
    baseURL,
    model: process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL,
    quality: enumEnv("OPENAI_IMAGE_QUALITY", ["low", "medium", "high", "auto"] as const, DEFAULT_IMAGE_QUALITY),
    outputFormat: enumEnv("OPENAI_IMAGE_FORMAT", ["png", "jpeg", "webp"] as const, DEFAULT_IMAGE_FORMAT),
    moderation: enumEnv("OPENAI_IMAGE_MODERATION", ["low", "auto"] as const, "auto"),
  };
}

export function hasOpenAiImageCredentials() {
  return Boolean(getOpenAiImageConfig().apiKey);
}

function imageSize(width: number, height: number) {
  return `${width}x${height}`;
}

function parseImageSize(value: string | undefined, fallback: { width: number; height: number }) {
  if (!value || value === "auto") return fallback;
  const match = value.match(/^(\d{2,5})x(\d{2,5})$/);
  if (!match) return fallback;
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function requestedImageSize(planned: Pick<PlannedAsset, "width" | "height">) {
  const override = parseImageSize(process.env.OPENAI_IMAGE_SIZE, planned);
  return {
    width: override.width,
    height: override.height,
    size: process.env.OPENAI_IMAGE_SIZE === "auto" ? "auto" : imageSize(override.width, override.height),
  };
}

function isDallEModel(model: string) {
  return model.startsWith("dall-e-");
}

function getCaseVisualsScope(): CaseVisualsScope {
  const value = String(process.env.CASE_VISUALS_SCOPE ?? "preload").toLowerCase();
  if (value === "full") return "full";
  if (value === "opening") return "opening";
  return "preload";
}

function getPreloadVisualLimit() {
  return Math.max(1, Number(process.env.CASE_VISUALS_PRELOAD_LIMIT ?? 8));
}

export function shouldGenerateEvidenceVisualAssets() {
  return getCaseVisualsScope() === "full";
}

export function shouldGenerateRuntimeVisualAssets() {
  return envFlag("CASE_VISUALS_RUNTIME_ENABLED", true);
}

function buildVisualStyle(caseData: CaseData): CaseVisualStyle {
  const theme = caseData.theme || caseData.openingEvent.headline || caseData.title;
  return {
    title: `${caseData.title} 视觉设定`,
    genre: theme,
    palette: ["weathered paper", "cold teal", "muted brass", "soft emergency red"],
    camera: "cinematic investigative photography, grounded documentary framing",
    lighting: "low-key practical light, wet surfaces, restrained contrast",
    texture: "case-file realism, slightly worn, no comic style, no fantasy elements",
    consistencyPrompt: [
      `Chinese mystery investigation game case: ${caseData.title}.`,
      `Theme: ${theme}.`,
      "Maintain one cohesive visual language across all assets.",
      "Realistic cinematic still, grounded modern Chinese setting, no text overlays, no UI, no watermark.",
    ].join(" "),
    spoilerGuard: [
      "Do not reveal the responsible party, hidden relationships, exact event mechanism, or undiscovered decisive evidence.",
      "Portraits must be neutral and fair; do not make any suspect visually more guilty than the others.",
      "Evidence images should show observable material only, never the conclusion.",
    ].join(" "),
  };
}

function entityIdentityText(suspect: SuspectProfile) {
  return `${suspect.name}，${suspect.age}岁，${suspect.identity}，公开关系：${suspect.publicRelationship}`;
}

const domainVisualHintWords = [
  "监控",
  "录像",
  "画面",
  "门禁",
  "终端",
  "登记",
  "放行",
  "账册",
  "账本",
  "货单",
  "合同",
  "药箱",
  "药物",
  "叉车",
  "车辆",
  "面包车",
  "冷库",
  "停电",
  "备用电",
  "钥匙",
  "脚印",
  "血迹",
  "指纹",
];

function domainRevealHints(...values: Array<string | undefined>) {
  const text = values.filter(Boolean).join("\n");
  return domainVisualHintWords.filter((hint) => text.includes(hint));
}

function evidenceTypeRevealHints(type: Evidence["type"]) {
  const hints: Partial<Record<Evidence["type"], string[]>> = {
    CCTV: ["监控", "录像", "画面"],
    ACCESS_LOG: ["门禁", "进出", "登记", "放行"],
    FINANCIAL: ["账册", "费用", "结算"],
    RECEIPT: ["小票", "收据", "付款"],
    CALL_LOG: ["通话", "电话", "通讯"],
    CHAT: ["聊天", "消息", "对话"],
    LOCATION: ["定位", "位置", "轨迹"],
    FORENSIC: ["鉴定", "痕迹", "检验"],
    OBJECT: ["物证", "物件", "实物"],
    MAP: ["地图", "路线", "平面图"],
    DIARY: ["笔记", "日记", "记录"],
    WITNESS: ["证词", "口供", "证人"],
  };
  return hints[type] ?? [];
}

function compactPromptValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(compactPromptValue).filter(Boolean).join("; ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nestedValue]) => {
        const nestedText = compactPromptValue(nestedValue);
        return nestedText ? `${key}: ${nestedText}` : "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return String(value);
}

function evidenceVisibleDataLines(evidence: Evidence) {
  const lines = Object.entries(evidence.visibleData)
    .map(([key, value]) => {
      const text = compactPromptValue(value);
      return text ? `- ${key}: ${text.slice(0, 260)}` : "";
    })
    .filter(Boolean);

  if (!lines.length) {
    return [`- summary: ${evidence.title}`];
  }

  return lines.slice(0, 14);
}

function evidencePromptSummary(evidence: Evidence) {
  const summary = compactPromptValue(evidence.visibleData.summary);
  if (summary) return summary;
  const firstVisibleValue = Object.values(evidence.visibleData).map(compactPromptValue).find(Boolean);
  return firstVisibleValue || evidence.title;
}

function uniqueNonEmpty(values: Array<string | undefined>, limit = 6) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = value?.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
    if (output.length >= limit) break;
  }
  return output;
}

function evidencePlotClues(evidence: Evidence) {
  const visible = evidence.visibleData;
  const details = Array.isArray(visible.visibleDetails) ? visible.visibleDetails.map(compactPromptValue) : [];
  return uniqueNonEmpty(
    [
      compactPromptValue(visible.abnormalPoint),
      ...details,
      compactPromptValue(visible.timeWindow) ? `时间点/时间段：${compactPromptValue(visible.timeWindow)}` : undefined,
      compactPromptValue(visible.locationCue) ? `地点线索：${compactPromptValue(visible.locationCue)}` : undefined,
      ...evidence.contradicts.map((item) => `矛盾点：${item}`),
      ...evidence.proves.map((item) => `支持点：${item}`),
      evidencePromptSummary(evidence),
    ],
    5,
  );
}

function evidenceInvestigationPrompts(evidence: Evidence) {
  const visible = evidence.visibleData;
  const abnormalPoint = compactPromptValue(visible.abnormalPoint);
  const timeWindow = compactPromptValue(visible.timeWindow);
  const locationCue = compactPromptValue(visible.locationCue);
  const prompts = [
    abnormalPoint ? `追问${evidence.title}里的异常点：${abnormalPoint}` : `继续核对${evidence.title}`,
    timeWindow ? `对比${timeWindow}前后的记录` : undefined,
    locationCue ? `围绕${locationCue}继续查` : undefined,
    evidence.relatedSuspects.length ? `用${evidence.title}追问相关人员` : undefined,
  ];
  return uniqueNonEmpty(prompts, 4);
}

function evidenceTypeVisualDirection(type: Evidence["type"]) {
  const directions: Record<Evidence["type"], string[]> = {
    CCTV: [
      "Depict a surveillance image or CCTV control-screen still, not a generic corridor.",
      "Include camera-frame cues: timestamp strip, camera label block, slight digital noise, monitor bezel or DVR interface.",
      "Only show people, vehicles, doors, corridors, shelves, or exterior angles if they are supported by the visible data.",
    ],
    ACCESS_LOG: [
      "Depict an access-control terminal, door-card reader log, guard desk screen, or exported entry table.",
      "Show rows, time columns, status chips, card swipes, badge terminal, or highlighted/redacted entry lines.",
      "The image must feel like the exact door/access record described by the evidence.",
    ],
    FINANCIAL: [
      "Depict a ledger, settlement account book, invoice stack, spreadsheet printout, or stamped reconciliation sheet.",
      "Show ruled columns, circled line items, page tabs, calculator, and redacted numeric blocks where relevant.",
      "The composition must center the financial document itself.",
    ],
    RECEIPT: [
      "Depict a receipt, small ticket, payment slip, register printout, or folded invoice on an evidence desk.",
      "Show thermal-paper texture, item rows, totals area, timestamps redacted or blurred.",
    ],
    CALL_LOG: [
      "Depict a phone call log on a mobile phone or printed telecom record.",
      "Show call rows, time blocks, duration columns, phone screen glare, or handset context.",
    ],
    CHAT: [
      "Depict a chat transcript on a phone or computer screen, with message bubbles redacted enough to avoid readable text.",
      "Show timestamps, alternating bubbles, highlighted message region, and device context.",
    ],
    LOCATION: [
      "Depict a GPS/location trace, map printout, route screen, or positioning report.",
      "Show route lines, pins, time markers, and map-grid texture, with labels unreadable or redacted.",
    ],
    FORENSIC: [
      "Depict a forensic report, lab evidence tray, measurement photos, sealed sample bag, or annotated inspection sheet.",
      "Show rulers, evidence labels, gloves, sample containers, or clinical desk lighting.",
    ],
    OBJECT: [
      "Depict the physical object itself as a close evidence-table photograph.",
      "Show material texture, scratches, stains, tags, seals, fingerprints, packaging, or nearby scale ruler only when supported by visible data.",
    ],
    MAP: [
      "Depict a site map, floor plan, route sketch, warehouse plan, or annotated movement diagram.",
      "Show pins, arrows, clipped paper edges, ruler marks, and redacted labels.",
    ],
    DIARY: [
      "Depict a notebook, diary page, handwritten memo, or personal record opened to the relevant page.",
      "Show page texture, bookmarks, underlines, torn edges, and redacted handwriting blocks.",
    ],
    WITNESS: [
      "Depict a witness statement file, interview transcript, audio recorder, or signed statement sheet.",
      "Show official paper layout, highlighted paragraph blocks, recorder, pen, and redacted identity text.",
    ],
  };
  return directions[type] ?? directions.OBJECT;
}

function visualTemplateDirection(template: string) {
  const value = template.toLowerCase();
  if (value.includes("cctv") || value.includes("monitor") || value.includes("video")) {
    return "Template cue: make it a surveillance-frame or monitor screenshot with camera UI framing.";
  }
  if (value.includes("access") || value.includes("terminal") || value.includes("log")) {
    return "Template cue: make it a terminal/exported log record with highlighted rows and status columns.";
  }
  if (value.includes("ledger") || value.includes("financial") || value.includes("account")) {
    return "Template cue: make it a ledger/accounting document close-up with ruled columns.";
  }
  if (value.includes("chat") || value.includes("message")) {
    return "Template cue: make it a phone/computer chat transcript with redacted message bubbles.";
  }
  if (value.includes("map") || value.includes("location")) {
    return "Template cue: make it a map, route trace, or floor-plan evidence sheet.";
  }
  if (value.includes("object") || value.includes("photo")) {
    return "Template cue: make it a close physical evidence photograph on an evidence desk.";
  }
  if (value.includes("document") || value.includes("report")) {
    return "Template cue: make it a document/report evidence photo, with the layout matching the record type.";
  }
  return `Template cue: ${template}`;
}

function clueObjectVisualDirections(
  location: CaseData["locations"][number],
  object: CaseData["locations"][number]["objects"][number],
) {
  const text = `${object.name}\n${object.description}\n${location.name}\n${location.description}`;
  const directions = [
    "Create ONE clue-entry image, not a generic atmosphere shot.",
    "The exact object must fill most of the frame, with a clear inspectable area that invites a follow-up question.",
    "Encode one or two non-conclusive visual anomalies from the object description. They should be noticeable, but they must not solve the case by themselves.",
  ];

  if (/监控|录像|画面|摄像|控制台|缺帧/.test(text)) {
    directions.push(
      "If this is CCTV-related, show a DVR monitor or control console close-up with camera tiles, timestamp strip, a highlighted/redacted missing-frame block, or one suspicious frozen thumbnail. Do not show the culprit clearly.",
    );
  }

  if (/门禁|门岗|登记|终端|刷卡|进出|放行|系统/.test(text)) {
    directions.push(
      "If this is access-log-related, show a guard terminal or card-reader log screen with table rows, time columns, status chips, and one circled or highlighted abnormal row. Text should be redacted or unreadable.",
    );
  }

  if (/账册|账本|流水|票据|合同|收据|货单|结算|发票|单据/.test(text)) {
    directions.push(
      "If this is document or ledger related, show a close-up page with ruled columns, page tabs, folded corners, moisture marks, circled line items, or redacted number blocks.",
    );
  }

  if (/电话|座机|通话|手机|聊天|消息/.test(text)) {
    directions.push(
      "If this is call or message related, show the device or printed record with a small highlighted call/message row, duration/time blocks, and redacted identity text.",
    );
  }

  if (/门|锁|钥匙|封条|柜|箱|样本|药箱|物件|工具|缺口|空槽/.test(text)) {
    directions.push(
      "If this is a physical clue object, show material detail: scratches, lifted seal edges, missing slots, damp marks, scuffs, labels, or a scale marker when supported by the description.",
    );
  }

  if (/水印|脚印|潮|冷凝|湿|划痕|痕迹|污渍/.test(text)) {
    directions.push(
      "If this is trace-related, make the trace inspectable with oblique light, a ruler/marker, directional marks, condensation, or a close surface texture.",
    );
  }

  directions.push(
    "Keep all text blocks unreadable or redacted. Use visual structure, highlighted rows, marks, gaps, and material details instead of legible exposition.",
  );

  return directions;
}

function planCaseAssets(caseData: CaseData, style: CaseVisualStyle): PlannedAsset[] {
  const firstLocation = caseData.locations[0];
  const coverAsset: PlannedAsset = {
    kind: "case_cover",
    entityId: caseData.id,
    title: `${caseData.title} 案件封面`,
    description: `开场沉浸背景：${caseData.openingEvent.brief}`,
    caption: caseData.openingEvent.headline,
    visibility: "opening",
    revealHints: ["开场", "案件背景", caseData.title, caseData.openingEvent.headline],
    tags: ["cover", "briefing", "opening-hero"],
    width: 1536,
    height: 864,
    prompt: [
      "Create a wide immersive opening hero background for a Chinese mystery investigation game.",
      "",
      "The image must integrate with a pale paper case-file UI, not look like a separate movie poster.",
      "Composition: the left 40 percent must be clean negative space with light warm paper texture, faint grid lines, soft teal forensic lines, and enough calm area for overlaying Chinese title and briefing text.",
      "Composition: the right 60 percent contains the main case atmosphere and visual subject, with soft depth and restrained realism.",
      "",
      `Case title: ${caseData.title}.`,
      `Theme: ${style.genre}.`,
      `Opening brief: ${caseData.openingEvent.brief}`,
      firstLocation ? `Initial location: ${firstLocation.name}. ${firstLocation.description}` : "",
      "",
      "Visual style: pale investigative dossier, warm off-white paper, muted teal lines, muted brass accents, subtle archival texture, realistic cinematic but restrained, low contrast, no harsh dark poster look.",
      "Right side scene: grounded modern Chinese investigation environment, observable incident atmosphere, no explicit violence, no culprit reveal.",
      "Make the entire image feel like the natural background layer of a light beige investigation interface.",
      "",
      style.spoilerGuard,
      "No readable text, no title lettering, no UI, no watermark, no logos.",
      "Avoid dark movie poster style, black background, dramatic celebrity portrait, strong horror lighting, readable documents, police board text, over-saturated colors.",
    ].filter(Boolean).join("\n"),
  };

  if (getCaseVisualsScope() === "opening") return [coverAsset];

  const assets: PlannedAsset[] = [
    coverAsset,
    {
      kind: "victim_portrait",
      entityId: caseData.victim.id,
      title: `${caseData.victim.name} 肖像`,
      description: `${caseData.victim.name}，${caseData.victim.role}。${caseData.victim.description}`,
      caption: `${caseData.victim.name}的案卷肖像。`,
      visibility: "never_public",
      revealHints: [caseData.victim.name, "当事人", "受影响人", "关键人物", "管理员", "照片", "肖像"],
      relatedSuspectIds: [caseData.victim.id],
      tags: ["affected-party", "portrait"],
      width: 1024,
      height: 1024,
      prompt: [
        style.consistencyPrompt,
        "Neutral archival portrait of the affected party or key stakeholder for an investigation case file.",
        `${caseData.victim.name}，${caseData.victim.role}，${caseData.victim.description}`,
        "Respectful, not graphic, no injury, square portrait.",
      ].join("\n"),
    },
  ];

  for (const location of caseData.locations) {
    assets.push({
      kind: "location",
      entityId: location.id,
      title: `${location.name} 场景图`,
      description: location.description,
      caption: `${location.name}的现场视角。`,
      visibility: "never_public",
      revealConditions: [location.id],
      revealHints: [location.name, location.kind, ...domainRevealHints(location.name, location.kind, location.description)],
      relatedLocationIds: [location.id],
      tags: ["location", location.kind],
      width: 1536,
      height: 864,
      prompt: [
        style.consistencyPrompt,
        style.spoilerGuard,
        `Scene still of location: ${location.name}.`,
        `Kind: ${location.kind}. Description: ${location.description}`,
        "No people clearly identifying the culprit, no text overlays, cinematic 16:9.",
      ].join("\n"),
    });

    for (const object of location.objects) {
      const objectDirections = clueObjectVisualDirections(location, object);
      assets.push({
        kind: "clue_object",
        entityId: object.id,
        title: `${object.name} 线索图`,
        description: object.description,
        caption: `${object.name}的细节图。`,
        visibility: "never_public",
        revealConditions: [location.id],
        revealHints: [object.name, location.name, ...domainRevealHints(object.name, object.description, location.name)],
        relatedLocationIds: [location.id],
        tags: ["clue", location.id],
        width: 1024,
        height: 768,
        prompt: [
          style.consistencyPrompt,
          style.spoilerGuard,
          "",
          `Clue object: ${object.name}.`,
          `Location: ${location.name}. ${location.description}`,
          `Object description with player-visible cues: ${object.description}`,
          "",
          "Required visual translation:",
          ...objectDirections,
          "",
          "Composition: close investigative evidence-table or control-screen photograph, 4:3, pale case-file UI style, restrained documentary realism, muted teal/brass accents.",
          "Do NOT show a generic warehouse corner, generic folder, decorative detective board, unrelated suspect portrait, or poster-like scene.",
          "Do NOT reveal the culprit or exact hidden mechanism. Show only observable clues that make the player want to inspect this object.",
          "No readable spoiler text, no title lettering, no watermark, no logos.",
        ].join("\n"),
      });
    }
  }

  for (const suspect of caseData.suspects) {
    assets.push({
      kind: "suspect_portrait",
      entityId: suspect.id,
      title: `${suspect.name} 头像`,
      description: entityIdentityText(suspect),
      caption: `${suspect.name}的问询头像。`,
      visibility: "never_public",
      revealConditions: [suspect.id],
      revealHints: [suspect.name, suspect.identity, "问", "询问", "审", "见", "照片", "头像"],
      relatedSuspectIds: [suspect.id],
      tags: ["suspect", "portrait"],
      width: 1024,
      height: 1024,
      prompt: [
        style.consistencyPrompt,
        style.spoilerGuard,
        "Neutral interrogation-room portrait, same lighting and framing as every suspect.",
        entityIdentityText(suspect),
        "Chinese adult, realistic face, guarded expression, square crop, no police mugshot board, no text.",
      ].join("\n"),
    });
  }

  for (const witness of caseData.witnesses) {
    assets.push({
      kind: "witness_portrait",
      entityId: witness.id,
      title: `${witness.name} 头像`,
      description: `${witness.name}，${witness.role}。${witness.description}`,
      caption: `${witness.name}的证人头像。`,
      visibility: "never_public",
      revealConditions: [witness.id],
      revealHints: [witness.name, witness.role, "证人", "问", "询问", "见", "照片", "头像"],
      tags: ["witness", "portrait"],
      width: 1024,
      height: 1024,
      prompt: [
        style.consistencyPrompt,
        "Neutral witness portrait for a case file.",
        `${witness.name}，${witness.role}，${witness.description}`,
        "Square crop, realistic, no text.",
      ].join("\n"),
    });
  }

  for (const evidence of caseData.evidence) {
    assets.push(planEvidenceAsset(evidence, style));
  }

  if (getCaseVisualsScope() === "preload") {
    const usefulKinds = new Set<VisualAssetKind>(["location", "clue_object", "evidence"]);
    return [
      coverAsset,
      ...assets
        .slice(1)
        .filter((asset) => usefulKinds.has(asset.kind))
        .slice(0, getPreloadVisualLimit()),
    ];
  }

  return assets;
}

export function planEvidenceAsset(evidence: Evidence, style: CaseVisualStyle): PlannedAsset {
  const visibleDataLines = evidenceVisibleDataLines(evidence);
  const summary = evidencePromptSummary(evidence);
  const typeDirections = evidenceTypeVisualDirection(evidence.type);
  const plotClues = evidencePlotClues(evidence);
  const investigationPrompts = evidenceInvestigationPrompts(evidence);

  return {
    kind: "evidence",
    entityId: evidence.id,
    title: `${evidence.title} 证据图`,
    description: summary,
    caption: `${evidence.title}已调出。`,
    visibility: "never_public",
    revealConditions: [evidence.id],
    revealHints: [
      evidence.title,
      evidence.type,
      evidence.source,
      summary,
      ...evidenceTypeRevealHints(evidence.type),
      ...domainRevealHints(evidence.title, evidence.source, summary, evidence.visualTemplate, visibleDataLines.join("\n")),
    ],
    relatedEvidenceIds: [evidence.id],
    relatedLocationIds: evidence.relatedLocations,
    relatedSuspectIds: evidence.relatedSuspects,
    plotClues,
    investigationPrompts,
    tags: ["evidence", evidence.type, evidence.visualTemplate, evidence.reliability],
    width: 1024,
    height: 768,
    prompt: [
      style.consistencyPrompt,
      style.spoilerGuard,
      "",
      "Create ONE evidence-specific image for the investigation UI.",
      "The main subject must be this exact evidence item itself, not generic crime atmosphere.",
      "The image must visibly encode details from the evidence title, source, visual template, and visible data below.",
      "",
      `Evidence title: ${evidence.title}.`,
      `Evidence type: ${evidence.type}.`,
      `Evidence source: ${evidence.source}.`,
      `Visual template: ${evidence.visualTemplate}.`,
      `Evidence reliability: ${evidence.reliability}.`,
      "",
      "Player-visible evidence data that MUST shape the image:",
      ...visibleDataLines,
      "",
      "Plot-driving visual clues that MUST be visibly represented in the image:",
      ...plotClues.map((clue) => `- ${clue}`),
      "",
      "Required visual translation:",
      ...typeDirections,
      visualTemplateDirection(evidence.visualTemplate),
      "Include at least three concrete visual cues derived from the visible data, such as the described time window, object, location, terminal, document layout, highlighted row, device, route, missing item, or abnormal mark.",
      "At least one clue must be strong enough that a player could naturally ask a follow-up question from the image alone.",
      "Make the clue visually inspectable: use a circled row, highlighted screen region, missing slot, redacted but shaped timestamp block, route pin, camera-frame corner, object damage, seal mark, or measurement marker as appropriate.",
      "",
      "Composition: close investigative evidence photograph, 4:3, on a pale case-file desk or screen, restrained documentary realism, light beige case UI style, muted teal/brass accents.",
      "If the evidence is a log/document/chat/map, show redacted or blurred text blocks and highlighted regions; avoid fully readable paragraphs or exact private data.",
      "If the evidence is a physical object, center the object and show material details; do not replace it with a generic file folder.",
      "",
      "Do NOT show a random detective board, generic police scene, unrelated warehouse, unrelated suspect portrait, cinematic poster, abstract symbol, or decorative dossier cover.",
      "Do NOT invent decisive hidden facts, reveal the culprit, or depict conclusions that are not in the visible data.",
      "No title lettering, no watermark, no logos.",
    ].join("\n"),
  };
}

function fallbackSvg(title: string, kind: VisualAssetKind) {
  const label = `${kind}\n${title}`.replace(/[<>&]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f1eee6"/>
      <stop offset="1" stop-color="#d8cfba"/>
    </linearGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#27241f" stroke-opacity="0.08" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="1024" height="768" fill="url(#bg)"/>
  <rect width="1024" height="768" fill="url(#grid)"/>
  <rect x="72" y="72" width="880" height="624" fill="none" stroke="#24615b" stroke-width="3" stroke-opacity="0.45"/>
  <circle cx="512" cy="316" r="86" fill="#24615b" fill-opacity="0.16" stroke="#24615b" stroke-width="2"/>
  <text x="512" y="438" text-anchor="middle" font-family="monospace" font-size="28" fill="#27241f">${label}</text>
</svg>`;
}

export async function requestOpenAiImage({
  prompt,
  width,
  height,
}: {
  prompt: string;
  width: number;
  height: number;
}) {
  const config = getOpenAiImageConfig();
  if (!config.apiKey) throw new Error("OPENAI_IMAGE_API_KEY or OPENAI_API_KEY is not configured.");

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  const requestedSize = requestedImageSize({ width, height });
  const response = await client.images.generate({
    model: config.model,
    prompt,
    n: 1,
    size: requestedSize.size,
    quality: config.quality,
    output_format: config.outputFormat,
    moderation: config.moderation,
    background: "opaque",
    ...(isDallEModel(config.model) ? { response_format: "b64_json" as const } : {}),
  });

  if (!("data" in response)) {
    throw new Error("OpenAI image response unexpectedly returned a stream.");
  }

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI image response did not include b64_json.");

  return {
    buffer: Buffer.from(b64, "base64"),
    width: requestedSize.width,
    height: requestedSize.height,
    model: config.model,
    baseURL: config.baseURL,
  };
}

async function generateAssetImage({
  relativePath,
  planned,
}: {
  relativePath: string;
  planned: PlannedAsset;
}): Promise<ImageGenerationResult> {
  const visualsEnabled = envFlag("CASE_VISUALS_ENABLED", true);
  const fallbackRelativePath = relativePath.replace(/\.png$/, ".svg");

  if (!visualsEnabled || !hasOpenAiImageCredentials()) {
    const fallback = await saveVisualObject({
      relativePath: fallbackRelativePath,
      body: fallbackSvg(planned.title, planned.kind),
      contentType: "image/svg+xml",
    });
    return {
      fileUrl: fallback.url,
      source: "fallback",
      status: "ready",
      width: FALLBACK_IMAGE_WIDTH,
      height: FALLBACK_IMAGE_HEIGHT,
      errorMessage: visualsEnabled ? "OpenAI image credentials missing; fallback asset created." : "Visual generation disabled.",
    };
  }

  try {
    const image = await requestOpenAiImage({
      prompt: planned.prompt,
      width: planned.width,
      height: planned.height,
    });
    const saved = await saveVisualObject({
      relativePath,
      body: image.buffer,
      contentType: "image/png",
    });
    return {
      fileUrl: saved.url,
      source: "openai",
      status: "ready",
      width: image.width,
      height: image.height,
    };
  } catch (error) {
    const fallback = await saveVisualObject({
      relativePath: fallbackRelativePath,
      body: fallbackSvg(planned.title, planned.kind),
      contentType: "image/svg+xml",
    });
    return {
      fileUrl: fallback.url,
      source: "fallback",
      status: "failed",
      width: FALLBACK_IMAGE_WIDTH,
      height: FALLBACK_IMAGE_HEIGHT,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function generateCaseVisualManifest(
  caseData: CaseData,
  options: GenerateCaseVisualManifestOptions = {},
): Promise<CaseVisualManifest> {
  const cacheId = options.cacheId ?? caseData.id;
  const style = buildVisualStyle(caseData);
  const plannedAssets = planCaseAssets(caseData, style);
  const now = new Date().toISOString();
  const concurrency = Math.max(1, Number(process.env.CASE_VISUALS_CONCURRENCY ?? 2));
  const assets: VisualAsset[] = [];

  let index = 0;
  async function worker() {
    while (index < plannedAssets.length) {
      const currentIndex = index;
      index += 1;
      const planned = plannedAssets[currentIndex];
      const slug = safeSlug(planned.entityId ?? planned.title);
      const filename = `${slug}.png`;
      options.logger?.("正在生成视觉资产。", {
        kind: planned.kind,
        title: planned.title,
        current: currentIndex + 1,
        total: plannedAssets.length,
      });

      const result = await generateAssetImage({
        relativePath: `${cacheId}/${planned.kind}/${filename}`,
        planned,
      });
      const assetNow = new Date().toISOString();
      assets[currentIndex] = {
        id: `visual-${planned.kind}-${slug}`,
        kind: planned.kind,
        ...(planned.entityId ? { entityId: planned.entityId } : {}),
        title: planned.title,
        ...(planned.description ? { description: planned.description } : {}),
        ...(planned.caption ? { caption: planned.caption } : {}),
        prompt: planned.prompt,
        fileUrl: result.fileUrl,
        thumbUrl: result.fileUrl,
        status: result.status,
        source: result.source,
        visibility: planned.visibility,
        revealConditions: planned.revealConditions ?? [],
        revealHints: planned.revealHints ?? [],
        relatedEvidenceIds: planned.relatedEvidenceIds ?? [],
        relatedLocationIds: planned.relatedLocationIds ?? [],
        relatedSuspectIds: planned.relatedSuspectIds ?? [],
        plotClues: planned.plotClues ?? [],
        investigationPrompts: planned.investigationPrompts ?? [],
        tags: planned.tags ?? [],
        width: result.width,
        height: result.height,
        createdAt: assetNow,
        updatedAt: assetNow,
        ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
      };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, plannedAssets.length) }, () => worker()));

  return caseVisualManifestSchema.parse({
    version: 1,
    caseId: caseData.id,
    cacheId,
    style,
    assets,
    generatedAt: now,
    updatedAt: new Date().toISOString(),
  });
}

export async function generateEvidenceVisualAsset({
  cacheId,
  evidence,
  manifest,
}: {
  cacheId: string;
  evidence: Evidence;
  manifest: CaseVisualManifest;
}) {
  const planned = planEvidenceAsset(evidence, manifest.style);
  const slug = safeSlug(planned.entityId ?? planned.title);
  const filename = `${slug}.png`;
  const result = await generateAssetImage({
    relativePath: `${cacheId}/${planned.kind}/${filename}`,
    planned,
  });
  const now = new Date().toISOString();

  return {
    id: `visual-${planned.kind}-${slug}`,
    kind: planned.kind,
    entityId: planned.entityId,
    title: planned.title,
    ...(planned.description ? { description: planned.description } : {}),
    ...(planned.caption ? { caption: planned.caption } : {}),
    prompt: planned.prompt,
    fileUrl: result.fileUrl,
    thumbUrl: result.fileUrl,
    status: result.status,
    source: result.source,
    visibility: planned.visibility,
    revealConditions: planned.revealConditions ?? [],
    revealHints: planned.revealHints ?? [],
    relatedEvidenceIds: planned.relatedEvidenceIds ?? [],
    relatedLocationIds: planned.relatedLocationIds ?? [],
    relatedSuspectIds: planned.relatedSuspectIds ?? [],
    plotClues: planned.plotClues ?? [],
    investigationPrompts: planned.investigationPrompts ?? [],
    tags: planned.tags ?? [],
    width: result.width,
    height: result.height,
    createdAt: now,
    updatedAt: now,
    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
  } satisfies VisualAsset;
}

export function createPendingEvidenceVisualAsset({
  cacheId,
  evidence,
  manifest,
}: {
  cacheId: string;
  evidence: Evidence;
  manifest: CaseVisualManifest;
}) {
  const planned = planEvidenceAsset(evidence, manifest.style);
  const slug = safeSlug(planned.entityId ?? planned.title);
  const now = new Date().toISOString();

  return {
    id: `visual-${planned.kind}-${slug}`,
    kind: planned.kind,
    entityId: planned.entityId,
    title: planned.title,
    ...(planned.description ? { description: planned.description } : {}),
    ...(planned.caption ? { caption: planned.caption } : {}),
    prompt: planned.prompt,
    status: "pending",
    source: "runtime",
    visibility: planned.visibility,
    revealConditions: planned.revealConditions ?? [],
    revealHints: planned.revealHints ?? [],
    relatedEvidenceIds: planned.relatedEvidenceIds ?? [],
    relatedLocationIds: planned.relatedLocationIds ?? [],
    relatedSuspectIds: planned.relatedSuspectIds ?? [],
    plotClues: planned.plotClues ?? [],
    investigationPrompts: planned.investigationPrompts ?? [],
    tags: Array.from(new Set([...(planned.tags ?? []), "runtime-demand"])),
    width: planned.width,
    height: planned.height,
    createdAt: now,
    revealedAt: now,
    updatedAt: now,
  } satisfies VisualAsset;
}
