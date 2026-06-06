"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BriefingScreen } from "@/components/investigation/BriefingModal";
import {
  CenterStage,
  ExitCaseConfirmModal,
  LeftDrawer,
  RelationshipModal,
  TimelineModal,
  VisualReadyModal,
} from "@/components/investigation/InvestigationShell";
import { useInvestigationSession } from "@/components/investigation/useInvestigationSession";

export function InvestigationClient() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [relationshipOpen, setRelationshipOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [exitPrompt, setExitPrompt] = useState<"manual" | "solved" | null>(null);
  const solvedPromptedSessionRef = useRef<string | null>(null);

  const investigation = useInvestigationSession();
  const session = investigation.session;
  const state = session?.state;

  useEffect(() => {
    if (state?.phase !== "solved" || !session?.sessionId) return;
    if (solvedPromptedSessionRef.current === session.sessionId) return;
    solvedPromptedSessionRef.current = session.sessionId;
    setExitPrompt("solved");
  }, [session?.sessionId, state?.phase]);

  async function submitCommand(command: string) {
    const accepted = await investigation.submitCommand(command);
    if (accepted) setInput("");
  }

  function confirmExitCase() {
    investigation.discardSession();
    router.push("/");
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#d9d2c4] text-[#27241f]">
      {session && investigation.showBriefing ? (
        <BriefingScreen session={session} onClose={() => investigation.setShowBriefing(false)} />
      ) : (
      <div className="td-case-shell m-2 grid min-h-0 flex-1 grid-cols-[3.25rem_minmax(0,1fr)] overflow-hidden rounded-lg border border-[#c8bda7]">
        {/* Left drawer */}
        <LeftDrawer
          actionStatus={investigation.actionStatus}
          activeStep={investigation.activeBootStep}
          bootProgress={investigation.bootProgress}
          data={investigation.data}
          isActing={investigation.isActing}
          isBooting={investigation.isBooting}
          state={state}
          setInput={setInput}
          visualFocus={investigation.visualFocus}
          onOpenRelationship={() => setRelationshipOpen(true)}
          onOpenTimeline={() => setTimelineOpen(true)}
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
          input={input}
          isActing={investigation.isActing}
          isBooting={investigation.isBooting}
          phase={state?.phase}
          recommendedCommands={investigation.data?.recommendedCommands ?? []}
          setInput={setInput}
          visualFocus={investigation.visualFocus}
          visualManifest={investigation.session?.visualManifest}
          onCommand={submitCommand}
          onRequestExit={() => setExitPrompt("manual")}
        />
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
      {exitPrompt && session && (
        <ExitCaseConfirmModal
          caseTitle={session.caseData.title}
          reason={exitPrompt}
          onCancel={() => setExitPrompt(null)}
          onConfirm={confirmExitCase}
        />
      )}
    </main>
  );
}
