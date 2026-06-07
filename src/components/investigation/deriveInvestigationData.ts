import type { CaseData, PlayerCaseState } from "@/game/schemas/game";
import type { CaseVisualManifest } from "@/game/schemas/visuals";
import type { InvestigationData } from "@/components/investigation/types";
import { buildRecommendedCommands } from "@/game/agent/recommendations";

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
  const entityNameById = new Map<string, string>([
    [caseData.victim.id, caseData.victim.name],
    ...caseData.suspects.map((suspect) => [suspect.id, suspect.name] as const),
    ...caseData.witnesses.map((witness) => [witness.id, witness.name] as const),
    ...caseData.locations.map((location) => [location.id, location.name] as const),
    ...caseData.evidence.map((evidence) => [evidence.id, evidence.title] as const),
  ]);
  const discoveredEvidenceIds = new Set(state.discoveredEvidence);
  const personEntityIds = new Set([
    caseData.victim.id,
    ...caseData.suspects.map((suspect) => suspect.id),
    ...caseData.witnesses.map((witness) => witness.id),
  ]);
  const visibleRelationshipsById = new Map<string, CaseData["relationships"][number]>();
  const addRelationship = (relationship: CaseData["relationships"][number]) => {
    if (!entityNameById.has(relationship.from) || !entityNameById.has(relationship.to)) return;
    if (!personEntityIds.has(relationship.from) || !personEntityIds.has(relationship.to)) return;
    if (relationship.from === relationship.to) return;
    visibleRelationshipsById.set(relationship.id, relationship);
  };
  const relationshipIsRevealed = (relationship: CaseData["relationships"][number]) =>
    relationship.relatedEvidence.length === 0 || relationship.relatedEvidence.some((evidenceId) => discoveredEvidenceIds.has(evidenceId));

  caseData.relationships
    .filter(relationshipIsRevealed)
    .forEach(addRelationship);
  state.playerRelationships
    .filter(relationshipIsRevealed)
    .forEach(addRelationship);
  const visibleRelationships = Array.from(visibleRelationshipsById.values());
  const recommendedCommands = buildRecommendedCommands(caseData, state);

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
