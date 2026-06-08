"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { BriefingScreen } from "@/components/investigation/BriefingModal";
import {
  CaseEndScreen,
  CenterStage,
  ExitCaseConfirmModal,
  FinalSubmissionConfirmModal,
  GameHelpModal,
  LeftDrawer,
  RelationshipModal,
  TimelineModal,
  VisualReadyModal,
} from "@/components/investigation/InvestigationShell";
import { useInvestigationSession } from "@/components/investigation/useInvestigationSession";
import { useRouteTransition } from "@/components/navigation/useRouteTransition";
import { looksLikeFinalSubmission } from "@/game/engine/parseAction";

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

const gameHelpSeenKey = "td-game-help-seen-v1";

export function InvestigationClient() {
  const router = useRouteTransition();
  const [input, setInput] = useState("");
  const [relationshipOpen, setRelationshipOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exitPrompt, setExitPrompt] = useState<"manual" | "solved" | "failed" | null>(null);
  const [localFinalPrompt, setLocalFinalPrompt] = useState<{ input: string; message?: string } | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [reviewEndedCase, setReviewEndedCase] = useState(false);
  const autoHelpHandledRef = useRef(false);

  const investigation = useInvestigationSession();
  const session = investigation.session;
  const state = session?.state;
  const finalSubmissionPrompt = localFinalPrompt ?? investigation.finalSubmissionPrompt;
  const isCaseEnded = state?.phase === "solved" || state?.phase === "failed";
  const showEndScreen = Boolean(isCaseEnded && !reviewEndedCase);

  useEffect(() => {
    if (
      autoHelpHandledRef.current ||
      !session ||
      investigation.isBooting ||
      investigation.showBriefing ||
      isCaseEnded ||
      showEndScreen ||
      isLeaving
    ) {
      return;
    }

    autoHelpHandledRef.current = true;
    try {
      if (window.localStorage.getItem(gameHelpSeenKey)) return;
      window.localStorage.setItem(gameHelpSeenKey, "1");
      setHelpOpen(true);
    } catch {
      setHelpOpen(true);
    }
  }, [investigation.isBooting, investigation.showBriefing, isCaseEnded, isLeaving, session, showEndScreen]);

  async function submitCommand(command: string, options?: { finalSubmissionConfirmed?: boolean }) {
    const trimmed = command.trim();
    if (!trimmed) return;
    if (!options?.finalSubmissionConfirmed && looksLikeFinalSubmission(trimmed)) {
      setLocalFinalPrompt({
        input: trimmed,
        message: "提交后会立刻判定对错，并结束本局。取消后可以继续调查。",
      });
      return;
    }

    const accepted = await investigation.submitCommand(trimmed, options);
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

  async function confirmFinalSubmission() {
    const pending = finalSubmissionPrompt;
    if (!pending) return;
    setLocalFinalPrompt(null);
    investigation.dismissFinalSubmissionPrompt();
    await submitCommand(pending.input, { finalSubmissionConfirmed: true });
  }

  function cancelFinalSubmission() {
    setLocalFinalPrompt(null);
    investigation.dismissFinalSubmissionPrompt();
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
        ) : session && state && showEndScreen ? (
          <motion.div
            animate="animate"
            className="min-h-0 flex-1"
            exit="exit"
            initial="initial"
            key={`ended-${session.sessionId}-${state.phase}`}
            variants={playScreenVariants}
          >
            <CaseEndScreen
              caseTitle={session.caseData.title}
              resultText={session.resultText}
              state={state}
              onExit={leaveCase}
              onReview={() => setReviewEndedCase(true)}
            />
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
                state?.phase === "solved" ||
                state?.phase === "failed"
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
              onOpenHelp={() => setHelpOpen(true)}
              onRequestExit={investigation.isBooting ? cancelBoot : () => setExitPrompt(state?.phase === "failed" ? "failed" : state?.phase === "solved" ? "solved" : "manual")}
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
      {helpOpen && <GameHelpModal onClose={() => setHelpOpen(false)} />}
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
      {finalSubmissionPrompt && session && (
        <FinalSubmissionConfirmModal
          caseTitle={session.caseData.title}
          command={finalSubmissionPrompt.input}
          message={finalSubmissionPrompt.message}
          onCancel={cancelFinalSubmission}
          onConfirm={confirmFinalSubmission}
        />
      )}
    </main>
  );
}
