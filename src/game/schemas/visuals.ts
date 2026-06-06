import { z } from "zod";

export const visualAssetKindSchema = z.enum([
  "case_cover",
  "location",
  "suspect_portrait",
  "witness_portrait",
  "victim_portrait",
  "clue_object",
  "evidence",
  "timeline_event",
  "relationship_node",
]);

export const visualAssetStatusSchema = z.enum(["pending", "ready", "failed"]);
export const visualAssetSourceSchema = z.enum(["openai", "fallback", "manual", "runtime"]);
export const visualVisibilitySchema = z.enum([
  "opening",
  "location_visible",
  "suspect_visible",
  "evidence_discovered",
  "timeline_visible",
  "relationship_visible",
  "never_public",
]);

export const caseVisualStyleSchema = z.object({
  title: z.string(),
  genre: z.string(),
  palette: z.array(z.string()),
  camera: z.string(),
  lighting: z.string(),
  texture: z.string(),
  consistencyPrompt: z.string(),
  spoilerGuard: z.string(),
});

export const visualAssetSchema = z.object({
  id: z.string(),
  kind: visualAssetKindSchema,
  entityId: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  caption: z.string().optional(),
  prompt: z.string(),
  fileUrl: z.string().optional(),
  thumbUrl: z.string().optional(),
  status: visualAssetStatusSchema,
  source: visualAssetSourceSchema,
  visibility: visualVisibilitySchema,
  revealConditions: z.array(z.string()).default([]),
  revealHints: z.array(z.string()).default([]),
  relatedEvidenceIds: z.array(z.string()).default([]),
  relatedLocationIds: z.array(z.string()).default([]),
  relatedSuspectIds: z.array(z.string()).default([]),
  plotClues: z.array(z.string()).default([]),
  investigationPrompts: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  width: z.number().optional(),
  height: z.number().optional(),
  createdAt: z.string(),
  revealedAt: z.string().optional(),
  updatedAt: z.string(),
  errorMessage: z.string().optional(),
});

export const caseVisualManifestSchema = z.object({
  version: z.literal(1),
  caseId: z.string(),
  cacheId: z.string().optional(),
  style: caseVisualStyleSchema,
  assets: z.array(visualAssetSchema),
  generatedAt: z.string(),
  updatedAt: z.string(),
});

export const visualFocusPayloadSchema = z.object({
  sessionId: z.string(),
  mode: z.enum(["case", "scene", "suspect", "evidence", "timeline", "relationship"]),
  assetId: z.string().optional(),
  entityId: z.string().optional(),
  title: z.string().optional(),
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

export type VisualAssetKind = z.infer<typeof visualAssetKindSchema>;
export type VisualAssetStatus = z.infer<typeof visualAssetStatusSchema>;
export type VisualAssetSource = z.infer<typeof visualAssetSourceSchema>;
export type VisualVisibility = z.infer<typeof visualVisibilitySchema>;
export type CaseVisualStyle = z.infer<typeof caseVisualStyleSchema>;
export type VisualAsset = z.infer<typeof visualAssetSchema>;
export type CaseVisualManifest = z.infer<typeof caseVisualManifestSchema>;
export type VisualFocusPayload = z.infer<typeof visualFocusPayloadSchema>;
