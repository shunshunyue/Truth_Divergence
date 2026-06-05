"use client";

import { useState } from "react";
import { BriefingModal } from "@/components/investigation/BriefingModal";
import {
  CenterStage,
  LeftDrawer,
  RelationshipModal,
  RightRail,
  TimelineModal,
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
      <div className="grid min-h-0 flex-1 grid-cols-[3rem_1fr_240px] overflow-hidden md:grid-cols-[3rem_1fr_240px]">
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
          input={input}
          isActing={investigation.isActing}
          isBooting={investigation.isBooting}
          phase={state?.phase}
          recommendedCommands={investigation.data?.recommendedCommands ?? []}
          setInput={setInput}
          onCommand={submitCommand}
        />

        {/* Right rail */}
        <RightRail
          actionStatus={investigation.actionStatus}
          activeStep={investigation.activeBootStep}
          bootProgress={investigation.bootProgress}
          data={investigation.data}
          isBooting={investigation.isBooting}
          state={state}
          onOpenRelationship={() => setRelationshipOpen(true)}
          onOpenTimeline={() => setTimelineOpen(true)}
        />
      </div>

      {session && investigation.showBriefing && (
        <BriefingModal session={session} onClose={() => investigation.setShowBriefing(false)} />
      )}

      {relationshipOpen && investigation.data && (
        <RelationshipModal data={investigation.data} onClose={() => setRelationshipOpen(false)} />
      )}
      {timelineOpen && state && (
        <TimelineModal state={state} onClose={() => setTimelineOpen(false)} />
      )}
    </main>
  );
}
