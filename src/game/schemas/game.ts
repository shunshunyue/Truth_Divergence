import { z } from "zod";

// 本文件是游戏的“结构化真相层”契约。
// AI 可以参与叙事和页面生成，但案件、证据、嫌疑人状态、玩家进度和评分都要落到这些 schema 上。
export const playerIntentSchema = z.enum([
  "GO_TO_LOCATION",
  "INVESTIGATE_OBJECT",
  "OPEN_EVIDENCE",
  "REQUEST_EVIDENCE",
  "INTERROGATE_SUSPECT",
  "USE_EVIDENCE",
  "COMPARE_STATEMENTS",
  "BUILD_TIMELINE",
  "BUILD_RELATIONSHIP",
  "ASK_ASSISTANT",
  "SUBMIT_DEDUCTION",
  "JOIN_PK",
  "REVIEW_CASE",
]);

export type PlayerIntent = z.infer<typeof playerIntentSchema>;

export const parsedActionSchema = z.object({
  rawInput: z.string(),
  intent: playerIntentSchema,
  targetLocation: z.string().optional(),
  targetSuspect: z.string().optional(),
  targetEvidence: z.string().optional(),
  targetObject: z.string().optional(),
  tone: z.enum(["soft", "neutral", "aggressive", "logical", "emotional"]).optional(),
  confidence: z.number().min(0).max(1),
  suggestedFallback: z.string().optional(),
});

export type ParsedAction = z.infer<typeof parsedActionSchema>;

export const evidenceTypeSchema = z.enum([
  "CCTV",
  "CALL_LOG",
  "ACCESS_LOG",
  "DIARY",
  "RECEIPT",
  "WITNESS",
  "FORENSIC",
  "CHAT",
  "LOCATION",
  "FINANCIAL",
  "OBJECT",
  "MAP",
]);

export type EvidenceType = z.infer<typeof evidenceTypeSchema>;

export const evidenceSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: evidenceTypeSchema,
  source: z.string(),
  visualTemplate: z.string(),
  // visibleData 给前端证据模板和 AI 导演使用；hiddenMetadata 只给规则系统使用。
  // 关键事实应优先放入 proves/contradicts/supports，而不是让 AI 从自然语言里猜。
  visibleData: z.record(z.string(), z.unknown()),
  hiddenMetadata: z.record(z.string(), z.unknown()),
  proves: z.array(z.string()),
  contradicts: z.array(z.string()),
  supports: z.array(z.string()),
  relatedSuspects: z.array(z.string()),
  relatedLocations: z.array(z.string()),
  relatedTimeline: z.array(z.string()),
  unlockConditions: z.array(z.string()),
  unlocks: z.array(z.string()),
  reliability: z.enum(["low", "medium", "high"]),
  importance: z.number().min(0).max(100),
  isKeyEvidence: z.boolean(),
});

export type Evidence = z.infer<typeof evidenceSchema>;

export const characterSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  description: z.string(),
});

export type Character = z.infer<typeof characterSchema>;

export const suspectProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number(),
  identity: z.string(),
  publicRelationship: z.string(),
  hiddenRelationship: z.string(),
  publicStatement: z.string(),
  hiddenTruth: z.array(z.string()),
  motiveLevel: z.number().min(0).max(100),
  opportunityLevel: z.number().min(0).max(100),
  lieStyle: z.string(),
  emotionalWeakness: z.string(),
  breakConditions: z.array(z.string()),
  falseLeads: z.array(z.string()),
  isKiller: z.boolean(),
});

export type SuspectProfile = z.infer<typeof suspectProfileSchema>;

export const suspectStateSchema = z.object({
  pressure: z.number().min(0).max(100),
  trust: z.number().min(0).max(100),
  suspicion: z.number().min(0).max(100),
  exposedContradictions: z.array(z.string()),
  usedEvidenceAgainstThem: z.array(z.string()),
  currentEmotion: z.enum(["calm", "nervous", "angry", "defensive", "silent", "broken"]),
  relationshipWithPlayer: z.enum(["hostile", "guarded", "neutral", "cooperative"]),
});

export type SuspectState = z.infer<typeof suspectStateSchema>;

export const locationSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  description: z.string(),
  objects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      unlocksEvidence: z.array(z.string()),
      unlocksSuspects: z.array(z.string()).default([]),
      unlocksLocations: z.array(z.string()).default([]),
      visibleConditions: z.array(z.string()).default([]),
    }),
  ),
  connectedLocations: z.array(z.string()),
  unlockConditions: z.array(z.string()),
});

export type LocationData = z.infer<typeof locationSchema>;

export const timelineEventSchema = z.object({
  id: z.string(),
  time: z.string(),
  description: z.string(),
  source: z.string(),
  relatedEvidence: z.array(z.string()),
  relatedSuspects: z.array(z.string()),
  confidence: z.enum(["confirmed", "suspected", "disputed"]),
});

export type TimelineEvent = z.infer<typeof timelineEventSchema>;

export const relationshipSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  type: z.enum(["normal", "conflict", "hidden", "time", "evidence", "misleading"]),
  status: z.enum(["unknown", "suspected", "conflict", "confirmed", "excluded", "key"]),
  label: z.string(),
  relatedEvidence: z.array(z.string()),
});

export type Relationship = z.infer<typeof relationshipSchema>;

export const truthSchema = z.object({
  killer: z.string(),
  motive: z.string(),
  method: z.string(),
  deathTime: z.string(),
  keyTimeline: z.array(z.string()),
  keyEvidence: z.array(z.string()),
  falseLeads: z.array(z.string()),
  hiddenRelationships: z.array(z.string()),
  exclusionReasons: z.record(z.string(), z.string()),
});

export type Truth = z.infer<typeof truthSchema>;

export const scoringRulesSchema = z.object({
  killer: z.number(),
  motive: z.number(),
  method: z.number(),
  timeline: z.number(),
  keyEvidence: z.number(),
  exclusions: z.number(),
  relationships: z.number(),
  clarity: z.number(),
});

export type ScoringRules = z.infer<typeof scoringRulesSchema>;

export const caseDataSchema = z.object({
  id: z.string(),
  title: z.string(),
  theme: z.string(),
  difficulty: z.string(),
  openingEvent: z.object({
    headline: z.string(),
    brief: z.string(),
    initialPrompt: z.string(),
  }),
  victim: characterSchema,
  suspects: z.array(suspectProfileSchema),
  witnesses: z.array(characterSchema),
  locations: z.array(locationSchema),
  evidence: z.array(evidenceSchema),
  timeline: z.array(timelineEventSchema),
  relationships: z.array(relationshipSchema),
  truth: truthSchema,
  scoringRules: scoringRulesSchema,
});

export type CaseData = z.infer<typeof caseDataSchema>;

export const gameEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  input: z.string(),
  parsedAction: parsedActionSchema,
  result: z.string(),
});

export type GameEvent = z.infer<typeof gameEventSchema>;

export const finalDeductionSchema = z.object({
  killer: z.string(),
  motive: z.string(),
  method: z.string(),
  timeline: z.array(z.string()),
  keyEvidence: z.array(z.string()),
  exclusions: z.record(z.string(), z.string()),
  report: z.string(),
});

export type FinalDeduction = z.infer<typeof finalDeductionSchema>;

export const playerCaseStateSchema = z.object({
  playerId: z.string(),
  caseId: z.string(),
  phase: z.enum(["opening", "investigating", "closing", "solved"]),
  truthScore: z.number().min(0).max(100),
  agentLog: z.array(z.string()),
  currentLocation: z.string(),
  discoveredEvidence: z.array(z.string()),
  unlockedLocations: z.array(z.string()),
  visibleSuspects: z.array(z.string()),
  interviewedSuspects: z.array(z.string()),
  suspectStates: z.record(z.string(), suspectStateSchema),
  playerTimeline: z.array(timelineEventSchema),
  playerRelationships: z.array(relationshipSchema),
  notes: z.array(z.string()),
  actionHistory: z.array(gameEventSchema),
  finalDeduction: finalDeductionSchema.optional(),
});

export type PlayerCaseState = z.infer<typeof playerCaseStateSchema>;

export interface ActionResult {
  state: PlayerCaseState;
  parsedAction: ParsedAction;
  resultText: string;
  unlockedEvidence: Evidence[];
  unlockedLocations: LocationData[];
  unlockedSuspects: SuspectProfile[];
  isSolved: boolean;
  truthScore: number;
  agentLogEntry: string;
}
