"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
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
import { useRouteTransition } from "@/components/navigation/useRouteTransition";

const playScreenVariants: Variants = {
  initial: {
    filter: "blur(10px)",
    opacity: 0,
    scale: 0.992,
    y: 16,
  },
  animate: {
    filter: "blur(0px)",
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.68, ease: [0.18, 0.78, 0.16, 1] },
  },
  exit: {
    filter: "blur(9px)",
    opacity: 0,
    scale: 1.004,
    y: -14,
    transition: { duration: 0.52, ease: [0.38, 0, 0.18, 1] },
  },
};

export function InvestigationClient() {
  const router = useRouteTransition();
  const [input, setInput] = useState("");
  const [relationshipOpen, setRelationshipOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [exitPrompt, setExitPrompt] = useState<"manual" | "solved" | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
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

  function leaveCase() {
    setIsLeaving(true);
    setExitPrompt(null);
    investigation.discardSession();
    router.replace("/");
  }

  function confirmExitCase() {
    leaveCase();
  }

  function cancelBoot() {
    leaveCase();
  }

  async function enterInvestigation() {
    return investigation.activateSession();
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#d9d2c4] text-[#27241f]">
      <AnimatePresence mode="wait" initial={false}>
        {isLeaving ? (
          <motion.div
            animate="animate"
            className="grid min-h-0 flex-1 place-items-center bg-[#f4f0e7] p-6 text-center"
            exit="exit"
            initial="initial"
            key="leaving"
            variants={playScreenVariants}
          >
            <div>
              <p className="font-mono text-xs font-bold text-[#24615b]">returning home</p>
              <p className="mt-2 text-lg font-black text-[#27241f]">正在返回首页...</p>
            </div>
          </motion.div>
        ) : session && investigation.showBriefing ? (
          <motion.div
            animate="animate"
            className="min-h-0 flex-1"
            exit="exit"
            initial="initial"
            key={`briefing-${session.sessionId}`}
            variants={playScreenVariants}
          >
            <BriefingScreen session={session} onClose={enterInvestigation} />
          </motion.div>
        ) : (
          <motion.div
            animate="animate"
            className="td-case-shell m-2 grid min-h-0 flex-1 grid-cols-[3.25rem_minmax(0,1fr)] overflow-hidden rounded-lg border border-[#c8bda7]"
            exit="exit"
            initial="initial"
            key="case"
            variants={playScreenVariants}
          >
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
              onRequestExit={investigation.isBooting ? cancelBoot : () => setExitPrompt("manual")}
            />
          </motion.div>
        )}
      </AnimatePresence>

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
