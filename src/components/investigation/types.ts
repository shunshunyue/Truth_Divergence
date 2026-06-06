import type { CaseData, PlayerCaseState } from "@/game/schemas/game";

export type SessionPayload = {
  sessionId: string;
  caseData: CaseData;
  state: PlayerCaseState;
  resultText?: string;
};

export type ChatModeState =
  | { mode: "assistant"; label: string }
  | { mode: "interrogation"; suspectId: string; label: string };

export type InvestigationChatMessage = {
  id: string;
  turnId: string;
  speaker: "assistant" | "suspect" | "system" | "user";
  text: string;
  label?: string;
  suspectId?: string;
  pending?: boolean;
  placeholder?: boolean;
  clientPending?: boolean;
  createdAt: number;
};

export type BootStepId = "core" | "scene" | "clues" | "evidence" | "agent" | "chat";

export type InvestigationData = {
  availableClues: NonNullable<CaseData["locations"][number]["objects"]>;
  caseData: CaseData;
  currentLocation: CaseData["locations"][number] | undefined;
  discoveredEvidence: CaseData["evidence"];
  entityNameById: Map<string, string>;
  recommendedCommands: string[];
  unlockedLocations: CaseData["locations"];
  visibleRelationships: CaseData["relationships"];
  visibleSuspects: CaseData["suspects"];
};

export const bootSteps: Array<{ id: BootStepId; title: string; text: string }> = [
  { id: "core", title: "案件核心", text: "从缓存池领取一个未使用案件。" },
  { id: "scene", title: "初始现场", text: "载入开局地点与现场可调查区域。" },
  { id: "clues", title: "线索暴露", text: "接入玩家可追查的场景线索点。" },
  { id: "evidence", title: "证据链", text: "载入证据归档、解锁条件与可见信息。" },
  { id: "agent", title: "后台 Agent", text: "接入评分循环、关系图与时间线监控。" },
  { id: "chat", title: "对话中枢", text: "接入案件问答、问询语气与实时元数据同步。" },
];

export const phaseLabels: Record<PlayerCaseState["phase"], string> = {
  opening: "案发播报",
  investigating: "调查循环",
  closing: "接近真相",
  solved: "自动结案",
};
