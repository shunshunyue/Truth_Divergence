import type { CaseData, PlayerCaseState } from "@/game/schemas/game";
import type { CaseVisualManifest } from "@/game/schemas/visuals";
import type { InvestigationData } from "@/components/investigation/types";

export function deriveInvestigationData(
  caseData: CaseData,
  state: PlayerCaseState,
  visualManifest?: CaseVisualManifest,
): InvestigationData {
  const currentLocation = caseData.locations.find((location) => location.id === state.currentLocation);
  const discoveredEvidence = caseData.evidence.filter((evidence) => state.discoveredEvidence.includes(evidence.id));
  const visibleSuspects = caseData.suspects.filter((suspect) => state.visibleSuspects.includes(suspect.id));
  const unlockedLocations = caseData.locations.filter((location) => state.unlockedLocations.includes(location.id));
  const availableClues =
    currentLocation?.objects.filter((object) =>
      object.visibleConditions.every((condition) => state.discoveredEvidence.includes(condition)),
    ) ?? [];
  const visibleRelationships = caseData.relationships.filter((relationship) =>
    relationship.relatedEvidence.some((evidenceId) => state.discoveredEvidence.includes(evidenceId)),
  );
  const entityNameById = new Map<string, string>([
    [caseData.victim.id, caseData.victim.name],
    ...caseData.suspects.map((suspect) => [suspect.id, suspect.name] as const),
    ...caseData.witnesses.map((witness) => [witness.id, witness.name] as const),
    ...caseData.locations.map((location) => [location.id, location.name] as const),
    ...caseData.evidence.map((evidence) => [evidence.id, evidence.title] as const),
  ]);
  const recommendedCommands = [
    ...availableClues.slice(0, 2).map((clue) => `调查${clue.name}`),
    ...unlockedLocations
      .filter((location) => location.id !== state.currentLocation)
      .slice(0, 2)
      .map((location) => `前往${location.name}`),
    ...visibleSuspects.slice(0, 1).map((suspect) => `审问${suspect.name}，逻辑一点`),
    "整理时间线",
  ];

  return {
    availableClues,
    caseData,
    currentLocation,
    discoveredEvidence,
    entityNameById,
    recommendedCommands,
    unlockedLocations,
    visibleRelationships,
    visibleSuspects,
    visualManifest,
  };
}
