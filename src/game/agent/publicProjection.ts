import type { CaseData, PlayerCaseState } from "@/game/schemas/game";
import { sortTimelineEvents } from "@/game/engine/timelineSort";

function redactEvidence(evidence: CaseData["evidence"][number]): CaseData["evidence"][number] {
  return {
    ...evidence,
    hiddenMetadata: {},
    proves: [],
    contradicts: [],
    supports: [],
    unlockConditions: [],
    unlocks: [],
  };
}

function visibleObjects(location: CaseData["locations"][number], state: PlayerCaseState) {
  return location.objects.filter((object) =>
    object.visibleConditions.every((condition) => state.discoveredEvidence.includes(condition)),
  );
}

function redactLocation(
  location: CaseData["locations"][number],
  state?: PlayerCaseState,
): CaseData["locations"][number] {
  return {
    ...location,
    unlockConditions: [],
    objects: (state ? visibleObjects(location, state) : location.objects).map((object) => ({
      ...object,
      unlocksEvidence: [],
      unlocksSuspects: [],
      unlocksLocations: [],
      visibleConditions: [],
    })),
  };
}

function redactSuspect(suspect: CaseData["suspects"][number]): CaseData["suspects"][number] {
  return {
    ...suspect,
    hiddenRelationship: "",
    hiddenTruth: [],
    motiveLevel: 0,
    opportunityLevel: 0,
    breakConditions: [],
    falseLeads: [],
    isKiller: false,
  };
}

export function buildPublicCaseData(caseData: CaseData): CaseData {
  return {
    ...caseData,
    locations: caseData.locations.map((location) => redactLocation(location)),
    evidence: caseData.evidence.map(redactEvidence),
    suspects: caseData.suspects.map(redactSuspect),
    truth: {
      killer: "",
      motive: "",
      method: "",
      deathTime: "",
      keyTimeline: [],
      keyEvidence: [],
      falseLeads: [],
      hiddenRelationships: [],
      exclusionReasons: {},
    },
  };
}

export function buildInitialPublicCaseData(caseData: CaseData, state: PlayerCaseState): CaseData {
  const publicCase = buildPublicCaseData(caseData);
  const currentLocation = buildCurrentLocationMetadata(caseData, state);

  return {
    ...publicCase,
    locations: currentLocation ? [currentLocation] : [],
    evidence: [],
    suspects: publicCase.suspects.filter((suspect) => state.visibleSuspects.includes(suspect.id)).slice(0, 1),
    timeline: [],
    relationships: [],
  };
}

export function buildPublicState(state: PlayerCaseState): PlayerCaseState {
  const visibleSuspects = new Set(state.visibleSuspects);
  const suspectStates = Object.fromEntries(
    Object.entries(state.suspectStates).filter(([suspectId]) => visibleSuspects.has(suspectId)),
  );

  return {
    ...state,
    suspectStates,
  };
}

export function buildVisibleEvidence(caseData: CaseData, state: PlayerCaseState) {
  const publicCase = buildPublicCaseData(caseData);
  return publicCase.evidence.filter((evidence) => state.discoveredEvidence.includes(evidence.id));
}

export function buildVisibleLocations(caseData: CaseData, state: PlayerCaseState) {
  return caseData.locations
    .filter((location) => state.unlockedLocations.includes(location.id))
    .map((location) => redactLocation(location, state));
}

export function buildVisibleSuspects(caseData: CaseData, state: PlayerCaseState) {
  return caseData.suspects.filter((suspect) => state.visibleSuspects.includes(suspect.id)).map(redactSuspect);
}

export function buildCurrentLocationMetadata(caseData: CaseData, state: PlayerCaseState) {
  const currentLocation = caseData.locations.find((location) => location.id === state.currentLocation);
  return currentLocation ? redactLocation(currentLocation, state) : undefined;
}

export function buildVisibleClues(caseData: CaseData, state: PlayerCaseState) {
  const currentLocation = buildCurrentLocationMetadata(caseData, state);
  return currentLocation?.objects ?? [];
}

export function buildVisibleTimeline(state: PlayerCaseState) {
  return sortTimelineEvents(state.playerTimeline);
}

function relationshipPersonIds(caseData: CaseData) {
  return new Set([
    caseData.victim.id,
    ...caseData.suspects.map((suspect) => suspect.id),
    ...caseData.witnesses.map((witness) => witness.id),
  ]);
}

export function buildVisibleRelationships(caseData: CaseData, state: PlayerCaseState) {
  const publicCase = buildPublicCaseData(caseData);
  const personIds = relationshipPersonIds(publicCase);
  const discoveredEvidenceIds = new Set(state.discoveredEvidence);
  const visibleById = new Map<string, CaseData["relationships"][number]>();
  const addRelationship = (relationship: CaseData["relationships"][number]) => {
    if (!personIds.has(relationship.from) || !personIds.has(relationship.to)) return;
    if (relationship.from === relationship.to) return;
    const revealed =
      relationship.relatedEvidence.length === 0 ||
      relationship.relatedEvidence.some((evidenceId) => discoveredEvidenceIds.has(evidenceId));
    if (!revealed) return;
    visibleById.set(relationship.id, relationship);
  };

  publicCase.relationships.forEach(addRelationship);
  state.playerRelationships.forEach(addRelationship);

  return Array.from(visibleById.values());
}

export function buildRecommendedCommands(caseData: CaseData, state: PlayerCaseState) {
  const clues = buildVisibleClues(caseData, state);
  const locations = buildVisibleLocations(caseData, state);
  const suspects = buildVisibleSuspects(caseData, state);

  return [
    ...clues.slice(0, 2).map((clue) => `调查${clue.name}`),
    ...locations
      .filter((location) => location.id !== state.currentLocation)
      .slice(0, 2)
      .map((location) => `前往${location.name}`),
    ...suspects.slice(0, 1).map((suspect) => `审问${suspect.name}，逻辑一点`),
    "整理时间线",
  ];
}
