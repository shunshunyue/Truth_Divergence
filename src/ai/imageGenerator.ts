import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import OpenAI from "openai";
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
  prompt: string;
  visibility: VisualVisibility;
  revealConditions?: string[];
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

type CaseVisualsScope = "opening" | "full";

function envFlag(name: string, fallback = true) {
  const value = process.env[name];
  if (value == null) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function getVisualsDir() {
  return process.env.CASE_VISUALS_DIR ?? "public/generated/cases";
}

function getPublicBasePath() {
  const dir = getVisualsDir().replace(/\\/g, "/").replace(/^public\/?/, "");
  return `/${dir.replace(/^\/+|\/+$/g, "")}`;
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
  return String(process.env.CASE_VISUALS_SCOPE ?? "opening").toLowerCase() === "full" ? "full" : "opening";
}

export function shouldGenerateEvidenceVisualAssets() {
  return getCaseVisualsScope() === "full";
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
      "Do not reveal the killer, hidden relationships, exact murder method, or undiscovered decisive evidence.",
      "Portraits must be neutral and fair; do not make any suspect visually more guilty than the others.",
      "Evidence images should show observable material only, never the conclusion.",
    ].join(" "),
  };
}

function entityIdentityText(suspect: SuspectProfile) {
  return `${suspect.name}，${suspect.age}岁，${suspect.identity}，公开关系：${suspect.publicRelationship}`;
}

function planCaseAssets(caseData: CaseData, style: CaseVisualStyle): PlannedAsset[] {
  const firstLocation = caseData.locations[0];
  const coverAsset: PlannedAsset = {
    kind: "case_cover",
    entityId: caseData.id,
    title: `${caseData.title} 案件封面`,
    visibility: "opening",
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
      "Right side scene: grounded modern Chinese crime investigation environment, observable case atmosphere, no explicit violence, no culprit reveal.",
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
      visibility: "opening",
      tags: ["victim", "portrait"],
      width: 1024,
      height: 1024,
      prompt: [
        style.consistencyPrompt,
        "Neutral archival portrait of the victim for a police case file.",
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
      visibility: "location_visible",
      revealConditions: [location.id],
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
      assets.push({
        kind: "clue_object",
        entityId: object.id,
        title: `${object.name} 线索图`,
        visibility: "location_visible",
        revealConditions: [location.id],
        tags: ["clue", location.id],
        width: 1024,
        height: 768,
        prompt: [
          style.consistencyPrompt,
          style.spoilerGuard,
          `Close investigative object photo: ${object.name}.`,
          `Object description: ${object.description}`,
          "Evidence-table photography, observable material only, no readable spoiler text, 4:3.",
        ].join("\n"),
      });
    }
  }

  for (const suspect of caseData.suspects) {
    assets.push({
      kind: "suspect_portrait",
      entityId: suspect.id,
      title: `${suspect.name} 头像`,
      visibility: "suspect_visible",
      revealConditions: [suspect.id],
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
      visibility: "suspect_visible",
      revealConditions: [witness.id],
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

  return assets;
}

export function planEvidenceAsset(evidence: Evidence, style: CaseVisualStyle): PlannedAsset {
  return {
    kind: "evidence",
    entityId: evidence.id,
    title: `${evidence.title} 证据图`,
    visibility: "evidence_discovered",
    revealConditions: [evidence.id],
    tags: ["evidence", evidence.type, evidence.reliability],
    width: 1024,
    height: 768,
    prompt: [
      style.consistencyPrompt,
      style.spoilerGuard,
      `Evidence image for an investigation file: ${evidence.title}.`,
      `Type: ${evidence.type}. Source: ${evidence.source}. Summary: ${String(evidence.visibleData.summary ?? evidence.title)}`,
      `Reliability: ${evidence.reliability}.`,
      "Show only observable material. Do not depict the crime conclusion, culprit identity, or hidden truth. No readable text.",
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

async function writeFallbackAsset(assetDir: string, filename: string, title: string, kind: VisualAssetKind) {
  await mkdir(assetDir, { recursive: true });
  const filePath = path.join(assetDir, filename);
  await writeFile(filePath, fallbackSvg(title, kind), "utf8");
  return filePath;
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
  assetDir,
  filename,
  planned,
}: {
  assetDir: string;
  filename: string;
  planned: PlannedAsset;
}): Promise<ImageGenerationResult> {
  const visualsEnabled = envFlag("CASE_VISUALS_ENABLED", true);
  if (!visualsEnabled || !hasOpenAiImageCredentials()) {
    await writeFallbackAsset(assetDir, filename.replace(/\.png$/, ".svg"), planned.title, planned.kind);
    return {
      fileUrl: undefined,
      source: "fallback",
      status: "ready",
      width: FALLBACK_IMAGE_WIDTH,
      height: FALLBACK_IMAGE_HEIGHT,
      errorMessage: visualsEnabled ? "OpenAI image credentials missing; fallback asset created." : "Visual generation disabled.",
    };
  }

  await mkdir(assetDir, { recursive: true });
  const filePath = path.join(assetDir, filename);
  try {
    const image = await requestOpenAiImage({
      prompt: planned.prompt,
      width: planned.width,
      height: planned.height,
    });
    await writeFile(filePath, image.buffer);
    return {
      fileUrl: undefined,
      source: "openai",
      status: "ready",
      width: image.width,
      height: image.height,
    };
  } catch (error) {
    const fallbackName = filename.replace(/\.png$/, ".svg");
    await writeFallbackAsset(assetDir, fallbackName, planned.title, planned.kind);
    return {
      fileUrl: undefined,
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
  const rootDir = path.join(process.cwd(), getVisualsDir(), cacheId);
  const publicBase = `${getPublicBasePath()}/${cacheId}`;
  const concurrency = Math.max(1, Number(process.env.CASE_VISUALS_CONCURRENCY ?? 2));
  const assets: VisualAsset[] = [];

  let index = 0;
  async function worker() {
    while (index < plannedAssets.length) {
      const currentIndex = index;
      index += 1;
      const planned = plannedAssets[currentIndex];
      const kindDir = path.join(rootDir, planned.kind);
      const slug = safeSlug(planned.entityId ?? planned.title);
      const filename = `${slug}.png`;
      const fallbackFilename = `${slug}.svg`;
      options.logger?.("正在生成视觉资产。", {
        kind: planned.kind,
        title: planned.title,
        current: currentIndex + 1,
        total: plannedAssets.length,
      });

      const result = await generateAssetImage({ assetDir: kindDir, filename, planned });
      const isOpenAi = result.source === "openai" && result.status === "ready";
      const fileNameForUrl = isOpenAi ? filename : fallbackFilename;
      const assetNow = new Date().toISOString();
      assets[currentIndex] = {
        id: `visual-${planned.kind}-${slug}`,
        kind: planned.kind,
        ...(planned.entityId ? { entityId: planned.entityId } : {}),
        title: planned.title,
        prompt: planned.prompt,
        fileUrl: `${publicBase}/${planned.kind}/${fileNameForUrl}`,
        thumbUrl: `${publicBase}/${planned.kind}/${fileNameForUrl}`,
        status: result.status,
        source: result.source,
        visibility: planned.visibility,
        revealConditions: planned.revealConditions ?? [],
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
  const rootDir = path.join(process.cwd(), getVisualsDir(), cacheId);
  const publicBase = `${getPublicBasePath()}/${cacheId}`;
  const kindDir = path.join(rootDir, planned.kind);
  const slug = safeSlug(planned.entityId ?? planned.title);
  const filename = `${slug}.png`;
  const fallbackFilename = `${slug}.svg`;
  const result = await generateAssetImage({ assetDir: kindDir, filename, planned });
  const isOpenAi = result.source === "openai" && result.status === "ready";
  const now = new Date().toISOString();

  return {
    id: `visual-${planned.kind}-${slug}`,
    kind: planned.kind,
    entityId: planned.entityId,
    title: planned.title,
    prompt: planned.prompt,
    fileUrl: `${publicBase}/${planned.kind}/${isOpenAi ? filename : fallbackFilename}`,
    thumbUrl: `${publicBase}/${planned.kind}/${isOpenAi ? filename : fallbackFilename}`,
    status: result.status,
    source: result.source,
    visibility: planned.visibility,
    revealConditions: planned.revealConditions ?? [],
    tags: planned.tags ?? [],
    width: result.width,
    height: result.height,
    createdAt: now,
    updatedAt: now,
    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
  } satisfies VisualAsset;
}
