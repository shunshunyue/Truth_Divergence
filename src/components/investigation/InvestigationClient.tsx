"use client";

import { useState } from "react";
import { BriefingScreen } from "@/components/investigation/BriefingModal";
import {
  CenterStage,
  LeftDrawer,
  RelationshipModal,
  RightRail,
  TimelineModal,
  VisualReadyModal,
} from "@/components/investigation/InvestigationShell";
import { useInvestigationSession } from "@/components/investigation/useInvestigationSession";

export function InvestigationClient() {
  const [input, setInput] = useState("");
  const [relationshipOpen, setRelationshipOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);

  const investigation = useInvestigationSession();
  const session = investigation.session;
  const state = session?.state;

  async function submitCommand(command: string) {
    const accepted = await investigation.submitCommand(command);
    if (accepted) setInput("");
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#ede8dc] text-[#27241f]">
      {session && investigation.showBriefing ? (
        <BriefingScreen session={session} onClose={() => investigation.setShowBriefing(false)} />
      ) : (
      <div className="grid min-h-0 flex-1 grid-cols-[3rem_minmax(0,1fr)] overflow-hidden md:grid-cols-[3rem_minmax(0,1fr)_240px]">
        {/* Left drawer */}
        <LeftDrawer
          data={investigation.data}
          isActing={investigation.isActing}
          isBooting={investigation.isBooting}
          setInput={setInput}
        />

        {/* Center chat */}
        <CenterStage
          activeStep={investigation.activeBootStep}
          bootError={investigation.bootError}
          bootProgress={investigation.bootProgress}
          bootStatus={investigation.bootStatus}
          chatMessages={investigation.chatMessages}
          chatMode={investigation.chatMode}
          commandDisabled={
            investigation.isBooting ||
            investigation.isActing ||
            state?.phase === "solved"
          }
          currentLocation={investigation.data?.currentLocation}
          evidenceCount={investigation.data?.discoveredEvidence.length ?? 0}
          input={input}
          isActing={investigation.isActing}
          isBooting={investigation.isBooting}
          phase={state?.phase}
          recommendedCommands={investigation.data?.recommendedCommands ?? []}
          setInput={setInput}
          visualFocus={investigation.visualFocus}
          visualManifest={investigation.session?.visualManifest}
          onCommand={submitCommand}
        />

        {/* Right rail */}
        <div className="hidden min-h-0 md:block">
          <RightRail
            actionStatus={investigation.actionStatus}
            activeStep={investigation.activeBootStep}
            bootProgress={investigation.bootProgress}
            data={investigation.data}
            isBooting={investigation.isBooting}
            state={state}
            visualFocus={investigation.visualFocus}
            onOpenRelationship={() => setRelationshipOpen(true)}
            onOpenTimeline={() => setTimelineOpen(true)}
          />
        </div>
      </div>
      )}

      {relationshipOpen && investigation.data && (
        <RelationshipModal data={investigation.data} onClose={() => setRelationshipOpen(false)} />
      )}
      {timelineOpen && state && investigation.data && (
        <TimelineModal data={investigation.data} state={state} onClose={() => setTimelineOpen(false)} />
      )}
      {investigation.completedVisualAsset && (
        <VisualReadyModal
          asset={investigation.completedVisualAsset}
          onClose={investigation.dismissVisualNotice}
          onPrompt={setInput}
        />
      )}
    </main>
  );
}
