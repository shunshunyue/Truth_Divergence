"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Play, RotateCcw, X } from "lucide-react";
import { useRouteTransition } from "@/components/navigation/useRouteTransition";

type StartInvestigationButtonProps = {
  coverSrc: string;
};

type SavedInvestigationSummary = {
  caseTitle: string;
  phase: string;
  savedAt?: number;
  truthScore?: number;
  unfinished: boolean;
};

const persistedInvestigationKey = "td-investigation-save-v1";
const legacySessionKey = "td-session";

const phaseLabels: Record<string, string> = {
  opening: "开场",
  investigating: "调查中",
  closing: "收束中",
  solved: "已结案",
};

function clearPersistedInvestigation() {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.removeItem(persistedInvestigationKey);
  window.localStorage.removeItem(legacySessionKey);
}

function summarizeSession(session: unknown, savedAt?: number): SavedInvestigationSummary | null {
  if (!session || typeof session !== "object") return null;
  const candidate = session as {
    caseData?: { title?: unknown };
    state?: { phase?: unknown; truthScore?: unknown };
  };
  const phase = typeof candidate.state?.phase === "string" ? candidate.state.phase : "opening";

  return {
    caseTitle: typeof candidate.caseData?.title === "string" ? candidate.caseData.title : "未完成案件",
    phase,
    savedAt,
    truthScore: typeof candidate.state?.truthScore === "number" ? candidate.state.truthScore : undefined,
    unfinished: phase !== "solved",
  };
}

function readSavedInvestigation() {
  if (typeof window === "undefined" || !window.localStorage) return null;

  try {
    const raw = window.localStorage.getItem(persistedInvestigationKey);
    if (raw) {
      const parsed = JSON.parse(raw) as { savedAt?: unknown; session?: unknown };
      return summarizeSession(parsed.session, typeof parsed.savedAt === "number" ? parsed.savedAt : undefined);
    }

    const legacyRaw = window.localStorage.getItem(legacySessionKey);
    if (legacyRaw) {
      return summarizeSession(JSON.parse(legacyRaw), undefined);
    }
  } catch {
    clearPersistedInvestigation();
  }

  return null;
}

function formatSavedAt(savedAt?: number) {
  if (!savedAt) return "本地进度";
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(savedAt));
}

export function StartInvestigationButton({ coverSrc }: StartInvestigationButtonProps) {
  const router = useRouteTransition();
  const [pendingSave, setPendingSave] = useState<SavedInvestigationSummary | null>(null);
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    router.prefetch("/play");
  }, [router]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!pendingSave) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPendingSave(null);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingSave]);

  function startInvestigation() {
    const saved = readSavedInvestigation();
    if (saved?.unfinished) {
      setPendingSave(saved);
      return;
    }

    if (saved) clearPersistedInvestigation();
    router.push("/play");
  }

  function continueSavedInvestigation() {
    setPendingSave(null);
    router.push("/play");
  }

  function startFreshInvestigation() {
    clearPersistedInvestigation();
    setPendingSave(null);
    router.push("/play");
  }

  const resumeDialog = pendingSave && portalReady
    ? createPortal(
        <div
          aria-modal="true"
          className="fixed inset-0 z-[999] flex min-h-screen items-center justify-center bg-[#17130f]/58 px-4 py-8 backdrop-blur-sm"
          role="dialog"
        >
          <div className="relative grid max-h-[calc(100vh-4rem)] w-full max-w-xl overflow-hidden border border-[#fffdf7]/70 bg-[#f7f1e5] text-[#27241f] shadow-[0_28px_90px_rgba(19,16,12,0.42)] sm:grid-cols-[8.5rem_1fr]">
            <div className="hidden min-h-full border-r border-[#d8c8a8] bg-[#27241f] sm:block">
              <img alt="" className="h-full w-full object-cover opacity-72" src={coverSrc} />
            </div>

            <div className="relative overflow-y-auto p-5 sm:p-6">
              <button
                aria-label="关闭"
                className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center border border-[#cdbf9e] bg-[#fffdf7]/80 text-[#4f483d] transition hover:bg-[#fffdf7]"
                onClick={() => setPendingSave(null)}
                type="button"
              >
                <X size={15} />
              </button>

              <p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[#9d6d21]">
                local case found
              </p>
              <h2 className="mt-2 pr-8 text-2xl font-black leading-tight text-[#27241f]">本地还有一局没查完</h2>
              <p className="mt-3 max-w-md text-sm font-semibold leading-6 text-[#5c5345]">
                「{pendingSave.caseTitle}」停在{phaseLabels[pendingSave.phase] ?? pendingSave.phase}，
                {formatSavedAt(pendingSave.savedAt)}保存。
              </p>

              <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-[#4f483d]">
                <span className="border border-[#d8c8a8] bg-[#fffdf7]/70 px-2.5 py-1">
                  {phaseLabels[pendingSave.phase] ?? pendingSave.phase}
                </span>
                {typeof pendingSave.truthScore === "number" && (
                  <span className="border border-[#d8c8a8] bg-[#fffdf7]/70 px-2.5 py-1">
                    真相度 {pendingSave.truthScore}
                  </span>
                )}
              </div>

              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                <button
                  className="inline-flex min-h-12 items-center justify-center gap-2 border border-[#143b37] bg-[#163c3a] px-4 font-mono text-xs font-bold text-[#eafffb] transition hover:bg-[#24615b]"
                  onClick={continueSavedInvestigation}
                  type="button"
                >
                  <Play size={15} />
                  继续上局
                </button>
                <button
                  className="inline-flex min-h-12 items-center justify-center gap-2 border border-[#c5533d] bg-[#fffdf7] px-4 font-mono text-xs font-bold text-[#8b3528] transition hover:bg-[#f6e1d8]"
                  onClick={startFreshInvestigation}
                  type="button"
                >
                  <RotateCcw size={15} />
                  开新案件
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        className="group relative inline-flex min-h-14 w-fit items-center gap-3 overflow-hidden border border-[#143b37] bg-[#163c3a] px-6 font-mono text-xs font-bold text-[#eafffb] shadow-[0_18px_44px_rgba(22,60,58,0.25)] transition hover:bg-[#24615b]"
        onClick={startInvestigation}
        type="button"
      >
        <span className="absolute inset-y-0 left-0 w-10 -translate-x-12 skew-x-[-18deg] bg-[#e7f05f]/18 transition-transform duration-500 group-hover:translate-x-48" />
        <span className="relative">开始处理今天的事</span>
        <ArrowRight className="relative transition group-hover:translate-x-1" size={17} />
      </button>
      {resumeDialog}
    </>
  );
}
