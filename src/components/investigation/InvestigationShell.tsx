import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  Bot,
  FileText,
  Fingerprint,
  GitBranch,
  MapPin,
  Search,
  Send,
  UserRound,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { BootConsole } from "@/components/investigation/BootConsole";
import {
  bootSteps,
  phaseLabels,
  type BootStepId,
  type ChatModeState,
  type InvestigationChatMessage,
  type InvestigationData,
} from "@/components/investigation/types";
import type { CaseData, PlayerCaseState, SuspectState } from "@/game/schemas/game";

const emotionLabels: Record<string, string> = {
  calm: "冷静",
  nervous: "紧张",
  angry: "愤怒",
  defensive: "防御",
  silent: "沉默",
  broken: "崩溃",
};

const evidenceTypeLabels: Record<string, string> = {
  CCTV: "监控",
  CALL_LOG: "通话",
  ACCESS_LOG: "门禁",
  DIARY: "笔记",
  RECEIPT: "小票",
  WITNESS: "证词",
  FORENSIC: "鉴定",
  CHAT: "聊天",
  LOCATION: "定位",
  FINANCIAL: "财务",
  OBJECT: "物证",
  MAP: "地图",
};

function shortText(value: string | undefined, max = 34) {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function usePrevious<T>(value: T) {
  const ref = useRef<T>(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

function usePulseFlag(trigger: unknown, duration = 900) {
  const [active, setActive] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }

    setActive(true);
    const timer = setTimeout(() => setActive(false), duration);
    return () => clearTimeout(timer);
  }, [trigger, duration]);

  return active;
}

export function LeftDrawer({
  data,
  isActing,
  isBooting,
  setInput,
}: {
  data: InvestigationData | null;
  isActing: boolean;
  isBooting: boolean;
  setInput: (value: string) => void;
}) {
  const [open, setOpen] = useState<"locations" | "clues" | "evidence" | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<InvestigationData["unlockedLocations"][number] | null>(null);
  const [selectedClue, setSelectedClue] = useState<InvestigationData["availableClues"][number] | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<InvestigationData["discoveredEvidence"][number] | null>(null);

  const locationCount = data?.unlockedLocations.length ?? 0;
  const clueCount = data?.availableClues.length ?? 0;
  const evidenceCount = data?.discoveredEvidence.length ?? 0;
  const drawerReady = !isBooting && data;
  const locationPulse = usePulseFlag(locationCount, 780);
  const cluePulse = usePulseFlag(clueCount, 780);
  const evidencePulse = usePulseFlag(evidenceCount, 920);

  return (
    <div className="relative flex h-full flex-col">
      {/* Icon strip */}
      <div className="flex w-12 flex-col items-center gap-1 border-r border-[#d8cfba] bg-[#ede8dc] pt-3">
        {[
          { section: "locations" as const, Icon: MapPin, count: locationCount, active: data?.currentLocation != null, pulse: locationPulse },
          { section: "clues" as const, Icon: Search, count: clueCount, active: false, pulse: cluePulse },
          { section: "evidence" as const, Icon: Fingerprint, count: evidenceCount, active: false, pulse: evidencePulse },
        ].map(({ section, Icon, count, pulse }) => (
          <motion.button
            key={section}
            className={[
              "relative flex h-10 w-10 items-center justify-center transition",
              pulse ? "td-divergence" : "",
              open === section ? "text-[#24615b]" : "text-[#8b8171] hover:text-[#9d6d21]",
            ].join(" ")}
            animate={pulse ? { scale: [1, 1.22, 1], rotate: [0, -3, 2, 0] } : { scale: 1, rotate: 0 }}
            transition={{ duration: 0.42, ease: "easeOut" }}
            onClick={() => {
              const next = open === section ? null : section;
              setOpen(next);
            }}
            type="button"
            aria-label={section}
          >
            <Icon size={18} />
            {count > 0 && (
              <motion.span
                key={count}
                className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center bg-[#24615b] px-0.5 font-mono text-[0.55rem] font-bold text-[#eafffb]"
                initial={{ scale: 0.72, y: -2 }}
                animate={{ scale: 1, y: 0 }}
                transition={{ duration: 0.18 }}
              >
                {count}
              </motion.span>
            )}
          </motion.button>
        ))}
      </div>

      {/* Overlay drawer */}
      <AnimatePresence>
        {open && drawerReady && (
          <motion.div
            className="fixed inset-0 z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && drawerReady && (
          <motion.aside
            className="absolute left-12 top-0 z-20 flex h-full w-72 flex-col border-r border-t-2 border-r-[#d8cfba] border-t-[#24615b] bg-[#ede8dc]"
            style={{ willChange: "transform" }}
            initial={{ x: -288 }}
            animate={{ x: 0 }}
            exit={{ x: -288 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            onKeyDown={(e) => e.key === "Escape" && setOpen(null)}
          >
            <div className="flex items-center justify-between border-b border-[#d8cfba] px-4 py-3">
              <span className="font-mono text-xs text-[#24615b]">
                {open === "locations"
                  ? "可前往地点"
                  : open === "clues"
                    ? "场景线索"
                    : "证据索引"}
              </span>
              <button
                className="text-[#8b8171] hover:text-[#9d6d21]"
                onClick={() => setOpen(null)}
                type="button"
              >
                <X size={14} />
              </button>
            </div>

            <div className="td-scrollbar flex-1 overflow-y-auto p-3">
              {open === "locations" && data && (
                <div className="flex flex-col gap-1.5">
                  {data.unlockedLocations.map((location) => (
                    <button
                      key={location.id}
                      className={[
                        "flex w-full items-center gap-3 border px-3 py-2.5 text-left text-sm transition disabled:opacity-40",
                        location.id === data.currentLocation?.id
                          ? "border-[#b8d8d2] bg-[#dff4ef] text-[#24615b]"
                          : "border-[#ded4c0] bg-[#f4efe5] text-[#2f2a22] hover:border-[#cfa65b]",
                      ].join(" ")}
                      disabled={isActing}
                      onClick={() => setSelectedLocation(location)}
                      type="button"
                    >
                      <MapPin size={14} className="shrink-0" />
                      <span className="line-clamp-1 font-semibold">{location.name}</span>
                      {location.id === data.currentLocation?.id && (
                        <span className="ml-auto font-mono text-[0.58rem]">当前</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {open === "clues" && data && (
                <div className="flex flex-col gap-1.5">
                  {data.availableClues.length ? data.availableClues.map((clue) => (
                    <button
                      key={clue.id}
                      className="flex w-full items-start gap-3 border border-[#b8d8d2] bg-[#eff8f5] px-3 py-2.5 text-left transition hover:border-[#24615b] disabled:opacity-40"
                      disabled={isActing}
                      onClick={() => setSelectedClue(clue)}
                      type="button"
                    >
                      <Search size={14} className="mt-0.5 shrink-0 text-[#24615b]" />
                      <span>
                        <span className="block text-sm font-semibold text-[#27241f]">{clue.name}</span>
                        <span className="mt-0.5 block line-clamp-1 text-[0.68rem] text-[#9f9688]">{clue.description}</span>
                      </span>
                    </button>
                  )) : (
                    <p className="py-2 text-xs text-[#776f61]">当前场景无新线索。</p>
                  )}
                </div>
              )}

              {open === "evidence" && data && (
                <div className="flex flex-col gap-1.5">
                  {data.discoveredEvidence.length ? data.discoveredEvidence.map((evidence) => (
                    <button
                      key={evidence.id}
                      className="flex w-full items-start gap-3 border border-paper/15 bg-paper/5 px-3 py-2.5 text-left transition hover:border-brass/35"
                      onClick={() => setSelectedEvidence(evidence)}
                      type="button"
                    >
                      <FileText size={14} className="mt-0.5 shrink-0 text-[#9d6d21]" />
                      <span>
                        <span className="font-mono text-[0.6rem] text-[#9d6d21]">{evidenceTypeLabels[evidence.type] ?? evidence.type}</span>
                        <span className="mt-0.5 block line-clamp-1 text-sm font-semibold text-[#27241f]">{evidence.title}</span>
                      </span>
                    </button>
                  )) : (
                    <p className="py-2 text-xs text-[#776f61]">尚无已归档证据。</p>
                  )}
                </div>
              )}

            </div>

            {/* Current location card */}
            {data?.currentLocation && (
              <div className="border-t border-[#d8cfba] px-4 py-3">
                <div className="flex items-center gap-2">
                  <MapPin size={13} className="text-[#24615b]" />
                  <span className="text-xs font-semibold text-[#24615b]">{data.currentLocation.name}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[0.65rem] leading-4 text-[#776f61]">{data.currentLocation.description}</p>
              </div>
            )}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Clue detail modal */}
      {selectedClue && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-[#27241f]/35 p-6 backdrop-blur"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => setSelectedClue(null)}
        >
          <motion.div
            className="w-full max-w-sm border border-[#b8d8d2] bg-[#fffdf7] p-5 shadow-[0_18px_60px_rgba(49,40,28,0.14)]"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[0.65rem] text-[#24615b]">场景线索</span>
              <button onClick={() => setSelectedClue(null)} type="button" className="text-[#8b8171] hover:text-[#9d6d21]"><X size={13} /></button>
            </div>
            <h3 className="text-base font-bold text-[#27241f]">{selectedClue.name}</h3>
            <p className="mt-2 text-xs leading-5 text-[#564d42]">{selectedClue.description}</p>
            <button
              className="mt-4 flex items-center gap-2 border border-[#b8d8d2] bg-[#dff4ef] px-3 py-1.5 font-mono text-xs font-bold text-[#24615b] hover:bg-[#ccebe5]"
              onClick={() => { setInput(`调查${selectedClue.name}`); setSelectedClue(null); setOpen(null); }}
              type="button"
            >
              <Search size={13} /> 调查此线索
            </button>
          </motion.div>
        </motion.div>
      )}

      {/* Location detail modal */}
      {selectedLocation && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-[#27241f]/35 p-6 backdrop-blur"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => setSelectedLocation(null)}
        >
          <motion.div
            className="w-full max-w-sm border border-[#b8d8d2] bg-[#fffdf7] p-5 shadow-[0_18px_60px_rgba(49,40,28,0.14)]"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[0.65rem] text-[#24615b]">{selectedLocation.kind}</span>
              <button onClick={() => setSelectedLocation(null)} type="button" className="text-[#8b8171] hover:text-[#9d6d21]"><X size={13} /></button>
            </div>
            <h3 className="text-base font-bold text-[#27241f]">{selectedLocation.name}</h3>
            <p className="mt-2 text-xs leading-5 text-[#564d42]">{selectedLocation.description}</p>
            {selectedLocation.objects.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 font-mono text-[0.62rem] text-[#9d6d21]">可调查线索</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedLocation.objects.map((obj) => (
                    <span key={obj.id} className="border border-[#b8d8d2] bg-[#e8f6f2] px-2 py-0.5 font-mono text-[0.62rem] text-[#24615b]">{obj.name}</span>
                  ))}
                </div>
              </div>
            )}
            {selectedLocation.id !== data?.currentLocation?.id && (
              <button
                className="mt-4 flex items-center gap-2 border border-[#cfa65b] bg-[#d6a247] px-3 py-1.5 font-mono text-xs font-bold text-[#27241f] hover:bg-[#cfa65b]"
                onClick={() => { setInput(`前往${selectedLocation.name}`); setSelectedLocation(null); setOpen(null); }}
                type="button"
              >
                <MapPin size={13} /> 前往此地点
              </button>
            )}
          </motion.div>
        </motion.div>
      )}

      {/* Evidence detail modal */}
      {selectedEvidence && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-[#27241f]/35 p-6 backdrop-blur"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => setSelectedEvidence(null)}
        >
          <motion.div
            className={[
              "relative w-full max-w-sm overflow-hidden border border-[#cfa65b] bg-[#fffdf7] p-5 shadow-[0_18px_60px_rgba(49,40,28,0.14)]",
              selectedEvidence.reliability === "low" ? "td-noise td-divergence" : selectedEvidence.reliability === "medium" ? "td-noise" : "",
            ].join(" ")}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <motion.span
              className="td-stamp absolute right-5 top-10 rotate-[-8deg] text-[#9d6d21] opacity-80"
              initial={{ opacity: 0, scale: 1.45, rotate: -16 }}
              animate={{ opacity: 0.8, scale: 1, rotate: -8 }}
              transition={{ delay: 0.12, duration: 0.28, ease: "easeOut" }}
            >
              archived
            </motion.span>
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[0.62rem] text-[#9d6d21]">{evidenceTypeLabels[selectedEvidence.type] ?? selectedEvidence.type}</span>
              <button onClick={() => setSelectedEvidence(null)} type="button" className="text-[#8b8171] hover:text-[#9d6d21]"><X size={13} /></button>
            </div>
            <h3 className="text-base font-bold text-[#27241f]">{selectedEvidence.title}</h3>
            <p className="mt-1 font-mono text-[0.6rem] text-[#8b8171]">来源：{selectedEvidence.source}</p>
            {Object.entries(selectedEvidence.visibleData).length > 0 && (
              <div className="mt-3 grid gap-1.5">
                {Object.entries(selectedEvidence.visibleData).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[6rem_1fr] gap-2 border-b border-[#e3dac8] pb-1.5">
                    <span className="font-mono text-[0.6rem] text-[#8b8171]">{k}</span>
                    <span className="text-xs text-[#3d352b]">{String(v)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2">
              <span className="font-mono text-[0.58rem] text-[#8b8171]">可靠性</span>
              <span className={`font-mono text-[0.62rem] ${selectedEvidence.reliability === "high" ? "text-[#24615b]" : selectedEvidence.reliability === "medium" ? "text-[#9d6d21]" : "text-[#a64e3b]"}`}>
                {selectedEvidence.reliability === "high" ? "高" : selectedEvidence.reliability === "medium" ? "中" : "低"}
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}

export function CenterStage({
  activeStep,
  bootError,
  bootProgress,
  bootStatus,
  chatMessages,
  chatMode,
  commandDisabled,
  currentLocation,
  evidenceCount,
  input,
  isActing,
  isBooting,
  phase,
  recommendedCommands,
  setInput,
  onCommand,
}: {
  activeStep: BootStepId;
  bootError: string;
  bootProgress: number;
  bootStatus: string;
  chatMessages: InvestigationChatMessage[];
  chatMode: ChatModeState;
  commandDisabled: boolean;
  currentLocation?: InvestigationData["currentLocation"];
  evidenceCount: number;
  input: string;
  isActing: boolean;
  isBooting: boolean;
  phase?: PlayerCaseState["phase"];
  recommendedCommands: string[];
  setInput: (value: string) => void;
  onCommand: (command: string) => void;
}) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [cmdExpanded, setCmdExpanded] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationPulse = usePulseFlag(currentLocation?.id ?? "", 1100);
  const evidencePulse = usePulseFlag(evidenceCount, 1100);
  const solvedPulse = usePulseFlag(phase === "solved", 1700);

  useEffect(() => {
    const element = chatScrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [chatMessages]);

  const statusText = isActing ? "正在生成回答" : chatMode.mode === "interrogation" ? "问询接入" : "案件助手在线";
  const isInterrogation = chatMode.mode === "interrogation";

  return (
    <motion.section
      ref={workspaceRef}
      className="relative min-h-0 overflow-hidden bg-[#ede8dc]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.32, ease: "easeOut" }}
    >
      {isBooting ? (
        <div className="td-scrollbar h-full overflow-y-auto p-4">
          <BootConsole activeStep={activeStep} error={bootError} progress={bootProgress} status={bootStatus} />
        </div>
      ) : (
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#f1eee6] text-[#27241f]">
          <motion.div
            className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(39,36,31,0.9)_1px,transparent_1px),linear-gradient(90deg,rgba(39,36,31,0.9)_1px,transparent_1px)]"
            animate={{
              opacity: isInterrogation ? 0.11 : 0.07,
              backgroundSize: isInterrogation ? "24px 24px" : "28px 28px",
            }}
            transition={{ duration: 0.34 }}
          />
          <motion.div
            className="pointer-events-none absolute inset-x-0 top-0 h-32"
            animate={{
              background: isInterrogation
                ? "linear-gradient(180deg,rgba(197,83,61,0.17),transparent)"
                : "linear-gradient(180deg,rgba(111,213,199,0.18),transparent)",
            }}
            transition={{ duration: 0.3 }}
          />

          <motion.div
            className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b px-5 shadow-[0_12px_36px_rgba(36,30,22,0.08)]"
            animate={{
              backgroundColor: isInterrogation ? "rgba(255, 240, 234, 0.94)" : "rgba(251, 248, 240, 0.92)",
              borderColor: isInterrogation ? "#d0a092" : "#c8c0ae",
            }}
            transition={{ duration: 0.28 }}
          >
            <div className="flex min-w-0 items-center gap-3">
              <motion.span
                className="grid h-9 w-9 place-items-center rounded-md border text-[#d8fff8] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
                animate={{
                  backgroundColor: isInterrogation ? "#6d2d25" : "#163c3a",
                  borderColor: isInterrogation ? "#b86956" : "#d8cfba",
                }}
                transition={{ duration: 0.28 }}
              >
                <Bot size={16} />
              </motion.span>
              <div className="min-w-0">
                <p className={["line-clamp-1 text-sm font-bold text-[#1f2927]", isInterrogation ? "td-divergence" : ""].join(" ")}>
                  {chatMode.mode === "interrogation" ? `问询对象 / ${chatMode.label}` : chatMode.label}
                </p>
                <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-[#776f61]">
                  enterprise assistant / restricted case workspace
                </p>
              </div>
            </div>
            <motion.div
              className="flex items-center gap-2 rounded-full border bg-white/70 px-3 py-1.5 font-mono text-[0.62rem]"
              animate={{
                borderColor: isInterrogation ? "#d0a092" : "#d8cfba",
                color: isInterrogation ? "#a64e3b" : "#24615b",
              }}
            >
              <motion.span
                className="h-1.5 w-1.5 rounded-full"
                animate={{
                  scale: isActing ? [1, 1.55, 1] : [1, 1.25, 1],
                  backgroundColor: isInterrogation ? "#c5533d" : "#2a8c80",
                }}
                transition={{ duration: isInterrogation ? 1.25 : 1, repeat: Infinity }}
              />
              {statusText}
            </motion.div>
          </motion.div>

          <AnimatePresence>
            {locationPulse && currentLocation && (
              <motion.div
                className="pointer-events-none absolute inset-x-8 top-20 z-20 overflow-hidden border border-[#b8d8d2] bg-[#e8f6f2]/92 px-4 py-3 shadow-[0_18px_50px_rgba(36,30,22,0.14)]"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <motion.div
                  className="absolute inset-y-0 left-0 w-1/2 bg-[linear-gradient(90deg,transparent,rgba(111,213,199,0.28),transparent)]"
                  initial={{ x: "-120%" }}
                  animate={{ x: "240%" }}
                  transition={{ duration: 0.85, ease: "easeInOut" }}
                />
                <p className="relative font-mono text-[0.62rem] uppercase tracking-[0.2em] text-[#24615b]">current location updated</p>
                <p className="relative mt-1 line-clamp-1 text-sm font-bold text-[#27241f]">{currentLocation.name}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={chatScrollRef} className="td-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto px-6 pb-36 pt-6">
            <AnimatePresence>
              {evidencePulse && (
                <motion.div
                  className="pointer-events-none absolute inset-x-6 top-0 h-1 bg-[linear-gradient(90deg,transparent,#6fd5c7,#e7f05f,transparent)]"
                  initial={{ opacity: 0, scaleX: 0, transformOrigin: "0% 50%" }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              )}
            </AnimatePresence>
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {chatMessages.length === 0 && (
                <div className="rounded-lg border border-[#d8cfba] bg-white/82 p-5 shadow-[0_18px_60px_rgba(49,40,28,0.12)]">
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#24615b]">secured copilot workspace</p>
                  <p className="mt-3 text-sm leading-6 text-[#625a4d]">
                    直接输入案件相关问题。无关办公问答会被拒绝；涉及剧透的问题会被引导回证据分析。左右两侧会在回答之后同步刷新证据、人物和时间线。
                  </p>
                </div>
              )}
              {chatMessages.map((message) => {
                const isUser = message.speaker === "user";
                const isSuspect = message.speaker === "suspect";
                return (
                  <motion.div
                    key={message.id}
                    className={["flex", isUser ? "justify-end" : "justify-start"].join(" ")}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.16 }}
                  >
                    <div
                      className={[
                        "max-w-[82%] rounded-lg border px-4 py-3 shadow-[0_14px_40px_rgba(49,40,28,0.12)]",
                        isUser
                          ? "border-[#cfa65b] bg-[#fff5db] text-[#2f2618]"
                          : isSuspect
                            ? "border-[#b86956] bg-[#fff0ea] text-[#35201a]"
                            : "border-[#b8d8d2] bg-white/92 text-[#1f2927]",
                      ].join(" ")}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className={["font-mono text-[0.6rem] uppercase tracking-[0.16em]", isUser ? "text-[#9d6d21]" : isSuspect ? "text-[#a64e3b]" : "text-[#24615b]"].join(" ")}>
                          {message.label ?? (isUser ? "你" : isSuspect ? "问询对象" : "案件 AI 助手")}
                        </span>
                        {message.pending && (
                          <span className="flex items-center gap-1 text-[#8b8171]" aria-label="typing">
                            <span className="td-typing-dot" />
                            <span className="td-typing-dot" />
                            <span className="td-typing-dot" />
                          </span>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6">{message.text || "..."}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {phase === "solved" && (
        <motion.div
          className="absolute right-3 top-3 z-10 border border-signal/60 bg-[#e7f05f]/15 px-3 py-1.5 font-mono text-xs text-[#6f6f18]"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          案件已结案
        </motion.div>
      )}

      <AnimatePresence>
        {solvedPulse && phase === "solved" && (
          <motion.div
            className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-[#27241f]/12 backdrop-blur-[1px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="td-stamp border-[#9d6d21] bg-[#fffdf7]/90 px-6 py-4 text-2xl text-[#9d6d21] shadow-[0_20px_80px_rgba(49,40,28,0.18)]"
              initial={{ opacity: 0, scale: 1.7, rotate: -9 }}
              animate={{ opacity: 1, scale: [1.7, 0.96, 1], rotate: -9 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.48, ease: "easeOut" }}
            >
              CASE CLOSED
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {!isBooting && (
        <div className="absolute bottom-5 left-1/2 z-20 w-[min(700px,calc(100%-2.5rem))] -translate-x-1/2">
          <motion.div
            className={[
              "rounded-xl border border-[#d6c9ae] bg-[#fffdf7]/95 shadow-[0_22px_80px_rgba(36,30,22,0.24)] backdrop-blur",
              isActing ? "td-scanline" : "",
            ].join(" ")}
            animate={{ height: cmdExpanded ? "auto" : undefined }}
          >
            <AnimatePresence initial={false}>
              {cmdExpanded && recommendedCommands.length > 0 && (
                <motion.div
                  className="flex gap-2 overflow-x-auto px-3 pb-0 pt-3"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {recommendedCommands.map((cmd) => (
                    <motion.button
                      key={cmd}
                      className="h-7 shrink-0 rounded-full border border-[#d8cfba] bg-[#f4efe5] px-2.5 font-mono text-[0.63rem] text-[#675d4f] transition hover:border-[#24615b] hover:text-[#24615b]"
                      disabled={commandDisabled}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileTap={{ scale: 0.96 }}
                      onMouseDown={(e) => { e.preventDefault(); onCommand(cmd); setCmdExpanded(false); }}
                      type="button"
                    >
                      {cmd}
                    </motion.button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <form
              className="flex gap-2 p-3"
              onSubmit={(e) => { e.preventDefault(); onCommand(input); }}
            >
              <input
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-[#d8cfba] bg-white px-3 text-sm text-[#27241f] outline-none transition placeholder:text-[#9b9180] focus:border-[#24615b] focus:shadow-[0_0_0_3px_rgba(36,97,91,0.12)]"
                disabled={commandDisabled}
                placeholder={
                  phase === "solved"
                      ? "案件已结案"
                      : commandDisabled
                        ? "操作台准备中"
                        : chatMode.mode === "interrogation"
                          ? `继续问询 ${chatMode.label}…`
                          : "像问 AI 一样输入案件问题…"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => {
                  if (collapseTimer.current) clearTimeout(collapseTimer.current);
                  setCmdExpanded(true);
                }}
                onBlur={() => {
                  collapseTimer.current = setTimeout(() => setCmdExpanded(false), 150);
                }}
              />
              <button
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-[#143b37] bg-[#163c3a] px-4 font-mono text-xs font-bold text-[#eafffb] transition hover:bg-[#24615b] disabled:opacity-50"
                disabled={commandDisabled || !input.trim()}
                type="submit"
              >
                <Send size={14} />
                发送
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </motion.section>
  );
}

export function RightRail({
  actionStatus,
  activeStep,
  bootProgress,
  data,
  isBooting,
  state,
  onOpenRelationship,
  onOpenTimeline,
}: {
  actionStatus: string;
  activeStep: BootStepId;
  bootProgress: number;
  data: InvestigationData | null;
  isBooting: boolean;
  state?: PlayerCaseState;
  onOpenRelationship: () => void;
  onOpenTimeline: () => void;
}) {
  const [suspectsExpanded, setSuspectsExpanded] = useState(false);
  const previousTruthScore = usePrevious(state?.truthScore ?? 0);
  const truthDelta = state ? state.truthScore - previousTruthScore : 0;
  const truthPulse = usePulseFlag(state?.truthScore ?? 0, 1100);

  useEffect(() => {
    if (data?.visibleSuspects.length) setSuspectsExpanded(true);
  }, [data?.visibleSuspects.length]);

  if (isBooting || !data || !state) {
    return (
      <aside className="flex h-full flex-col gap-4 border-l border-[#d8cfba] bg-[#ede8dc] p-4">
        <div>
          <p className="font-mono text-[0.65rem] text-[#24615b]">生成状态</p>
          <p className="mt-2 text-xs text-[#675d4f]">{bootSteps.find((s) => s.id === activeStep)?.title}</p>
          <div className="mt-3 h-1 bg-[#d8cfba]">
            <div className="h-full bg-[#e7f05f] transition-all duration-500" style={{ width: `${bootProgress}%` }} />
          </div>
        </div>
      </aside>
    );
  }

  return (
    <motion.aside
      className="td-scrollbar flex h-full flex-col gap-4 overflow-y-auto border-l border-[#d8cfba] bg-[#ede8dc] p-4"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
    >
      {/* Truth gauge */}
      <div>
        <div className="flex items-center gap-3">
          <TruthGauge score={state.truthScore} delta={truthDelta} pulse={truthPulse} />
          <div>
            <p className="font-mono text-[0.6rem] uppercase tracking-widest text-[#24615b]">{phaseLabels[state.phase]}</p>
            <p className="mt-1 line-clamp-2 text-[0.65rem] leading-4 text-[#776f61]">{shortText(actionStatus, 40)}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <MiniStat label="证据" value={String(data.discoveredEvidence.length)} />
          <MiniStat label="人物" value={String(data.visibleSuspects.length)} />
          <MiniStat label="时间" value={String(state.playerTimeline.length)} />
        </div>
      </div>

      {/* Modal triggers */}
      <div className="grid grid-cols-2 gap-2">
        <button
          className="flex items-center justify-center gap-2 border border-[#d6c9ae] py-2 font-mono text-[0.65rem] text-[#9d6d21] transition hover:bg-[#f4efe5]"
          onClick={onOpenRelationship}
          type="button"
        >
          <GitBranch size={13} />
          关系图
        </button>
        <button
          className="flex items-center justify-center gap-2 border border-[#d6c9ae] py-2 font-mono text-[0.65rem] text-[#9d6d21] transition hover:bg-[#f4efe5]"
          onClick={onOpenTimeline}
          type="button"
        >
          <Clock3 size={13} />
          时间线
        </button>
      </div>

      {/* Suspects accordion */}
      <div>
        <button
          aria-expanded={data.visibleSuspects.length > 0 ? suspectsExpanded : undefined}
          className={[
            "flex w-full items-center justify-between font-mono text-[0.65rem] text-[#9d6d21] transition",
            data.visibleSuspects.length > 0 ? "hover:text-[#6f6f18]" : "cursor-default",
          ].join(" ")}
          onClick={() => data.visibleSuspects.length > 0 && setSuspectsExpanded(!suspectsExpanded)}
          type="button"
        >
          <span>人物状态 ({data.visibleSuspects.length})</span>
          {data.visibleSuspects.length > 0 ? (
            suspectsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          ) : (
            <span className="text-[0.55rem] text-[#8f8574]">待确认</span>
          )}
        </button>
        <AnimatePresence initial={false}>
          {data.visibleSuspects.length > 0 && suspectsExpanded ? (
            <motion.div
              key="suspects"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="mt-2 flex flex-col gap-2">
                {data.visibleSuspects.map((suspect) => {
                  const ss = state.suspectStates[suspect.id];
                  return <SuspectStatusCard key={suspect.id} name={suspect.name} state={ss} />;
                })}
              </div>
            </motion.div>
          ) : data.visibleSuspects.length === 0 ? (
            <motion.div
              key="suspect-empty"
              className="mt-2 border border-dashed border-[#d6c9ae] bg-[#f4efe5] p-3"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              <div className="flex items-center gap-2 text-[#8f8574]">
                <UserRound size={14} />
                <p className="font-mono text-[0.58rem] uppercase tracking-[0.16em]">no suspect pinned</p>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#675d4f]">
                等门禁、监控、口供或物证指到某个人，这里会自动亮出人物状态。
              </p>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.aside>
  );
}

function NodeBadge({ label }: { label: string }) {
  return (
    <motion.div
      className="grid min-h-12 place-items-center border border-[#d8cfba] bg-[#fff5db] p-2 text-center"
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
    >
      <span className="line-clamp-2 text-xs font-semibold text-[#27241f]">{label}</span>
    </motion.div>
  );
}

function TruthGauge({ score, delta, pulse }: { score: number; delta: number; pulse: boolean }) {
  const motionScore = useMotionValue(score);
  const springScore = useSpring(motionScore, { stiffness: 92, damping: 18, mass: 0.55 });
  const roundedScore = useTransform(springScore, (value) => Math.round(value));
  const angle = useTransform(springScore, (value) => `${Math.max(0, Math.min(100, value)) * 3.6}deg`);
  const background = useTransform(angle, (value) => `conic-gradient(#6fd5c7 ${value}, rgba(255,255,255,0.14) 0deg)`);

  useEffect(() => {
    motionScore.set(score);
  }, [motionScore, score]);

  return (
    <motion.div
      className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
      style={{ background }}
      animate={pulse ? { scale: [1, 1.08, 1], boxShadow: ["0 0 0 rgba(111,213,199,0)", "0 0 24px rgba(111,213,199,0.32)", "0 0 0 rgba(111,213,199,0)"] } : { scale: 1 }}
      transition={{ duration: 0.54, ease: "easeOut" }}
    >
      <div className="flex h-[3.2rem] w-[3.2rem] items-center justify-center rounded-full bg-[#fffdf7] font-mono text-sm font-black text-[#24615b]">
        <motion.span>{roundedScore}</motion.span>%
      </div>
      <AnimatePresence>
        {pulse && delta !== 0 && (
          <motion.span
            className={[
              "absolute -right-2 -top-2 border bg-[#fffdf7] px-1.5 py-0.5 font-mono text-[0.58rem] font-black",
              delta > 0 ? "border-[#b8d8d2] text-[#24615b]" : "border-[#d0a092] text-[#a64e3b]",
            ].join(" ")}
            initial={{ opacity: 0, y: 4, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
          >
            {delta > 0 ? "+" : ""}
            {delta}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SuspectStatusCard({ name, state }: { name: string; state?: SuspectState }) {
  const pressure = state?.pressure ?? 0;
  const suspicion = state?.suspicion ?? 0;
  const trust = state?.trust ?? 0;
  const emotion = state?.currentEmotion ?? "calm";
  const previousPressure = usePrevious(pressure);
  const previousTrust = usePrevious(trust);
  const stateSignature = `${pressure}:${suspicion}:${trust}:${emotion}`;
  const changed = usePulseFlag(stateSignature, 820);
  const pressureRose = pressure > previousPressure;
  const trustRose = trust > previousTrust;
  const unstable = emotion === "nervous" || emotion === "angry" || emotion === "broken" || pressureRose;

  return (
    <motion.div
      className={[
        "border p-3",
        unstable ? "td-divergence" : "",
        trustRose ? "bg-[#fff5db]" : "bg-[#f4efe5]",
      ].join(" ")}
      animate={
        changed
          ? {
              x: unstable ? [0, -1, 1, 0] : 0,
              borderColor: pressureRose ? ["#ded4c0", "#c5533d", "#ded4c0"] : trustRose ? ["#ded4c0", "#d6a247", "#ded4c0"] : ["#ded4c0", "#b8d8d2", "#ded4c0"],
            }
          : { x: 0, borderColor: "#ded4c0" }
      }
      transition={{ duration: 0.42, ease: "easeOut" }}
    >
      <div className="flex items-center gap-2">
        <motion.span animate={changed ? { scale: [1, 1.12, 1] } : { scale: 1 }} transition={{ duration: 0.32 }}>
          <UserRound size={15} className="shrink-0 text-[#a64e3b]" />
        </motion.span>
        <div className="min-w-0">
          <p className="line-clamp-1 text-xs font-semibold text-[#27241f]">{name}</p>
          <AnimatePresence mode="wait">
            <motion.p
              key={emotion}
              className="font-mono text-[0.55rem] text-[#a64e3b]"
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 3 }}
              transition={{ duration: 0.16 }}
            >
              {emotionLabels[emotion] ?? emotion}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
      <SignalBar label="压" value={pressure} tone="rust" />
      <SignalBar label="疑" value={suspicion} tone="brass" />
      <SignalBar label="信" value={trust} tone="scan" />
    </motion.div>
  );
}

function SignalBar({ label, value, tone }: { label: string; value: number; tone: "rust" | "brass" | "scan" }) {
  const colorClass = {
    brass: "bg-[#d6a247]",
    rust: "bg-[#c5533d]",
    scan: "bg-[#24615b]",
  }[tone];

  return (
    <div className="mt-2 grid grid-cols-[1rem_1fr_2rem] items-center gap-2">
      <span className="font-mono text-[0.58rem] text-[#8f8574]">{label}</span>
      <span className="h-1.5 overflow-hidden bg-[#d8cfba]">
        <motion.span
          className={`block h-full ${colorClass}`}
          initial={false}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.38, ease: [0.25, 0.1, 0.25, 1] }}
        />
      </span>
      <motion.span key={value} className="text-right font-mono text-[0.58rem] text-[#a99f8d]" initial={{ opacity: 0.55, y: -2 }} animate={{ opacity: 1, y: 0 }}>
        {value}
      </motion.span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <motion.div
      className="border border-[#ded4c0] bg-[#f4efe5] p-2 text-center"
      animate={{ borderColor: ["#ded4c0", "#b8d8d2", "#ded4c0"] }}
      transition={{ duration: 0.5 }}
    >
      <p className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-[#8f8574]">{label}</p>
      <AnimatePresence mode="wait">
        <motion.p
          key={value}
          className="mt-1 text-lg font-black leading-none text-[#9d6d21]"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.16 }}
        >
          {value}
        </motion.p>
      </AnimatePresence>
    </motion.div>
  );
}

export function RelationshipModal({
  data,
  onClose,
}: {
  data: InvestigationData;
  onClose: () => void;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-[#27241f]/35 p-6 backdrop-blur"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-2xl border border-[#cfa65b] bg-[#fffdf7] p-5 shadow-[0_18px_60px_rgba(49,40,28,0.14)]"
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="font-mono text-xs text-[#9d6d21]">人物关系图</span>
          <button className="text-[#8b8171] hover:text-[#9d6d21]" onClick={onClose} type="button"><X size={14} /></button>
        </div>
        <div className="td-scrollbar max-h-[60vh] overflow-y-auto">
          {data.visibleRelationships.length ? (
            <div className="grid gap-3">
              {data.visibleRelationships.map((rel, index) => (
                <motion.div
                  key={rel.id}
                  className="grid grid-cols-[1fr_auto_1fr] items-center gap-2"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.045, duration: 0.22 }}
                >
                  <NodeBadge label={data.entityNameById.get(rel.from) ?? rel.from} />
                  <div className="grid place-items-center text-[#9d6d21]">
                    <svg className="h-5 w-12 overflow-visible" viewBox="0 0 48 20" aria-hidden="true">
                      <motion.path
                        d="M2 10 C14 2, 34 18, 46 10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        initial={{ pathLength: 0, opacity: 0.35 }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ delay: index * 0.045 + 0.08, duration: 0.42, ease: "easeInOut" }}
                      />
                    </svg>
                    <motion.span
                      className="mt-1 font-mono text-[0.58rem]"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: index * 0.045 + 0.28 }}
                    >
                      {rel.status}
                    </motion.span>
                  </div>
                  <NodeBadge label={data.entityNameById.get(rel.to) ?? rel.to} />
                  <p className="col-span-3 text-center text-xs text-[#675d4f]">{rel.label}</p>
                </motion.div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#776f61]">关系图尚未形成。需要先获得能支撑关系的证据。</p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

export function TimelineModal({
  state,
  onClose,
}: {
  state: PlayerCaseState;
  onClose: () => void;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-[#27241f]/35 p-6 backdrop-blur"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-2xl border border-[#cfa65b] bg-[#fffdf7] p-5 shadow-[0_18px_60px_rgba(49,40,28,0.14)]"
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="font-mono text-xs text-[#9d6d21]">时间线</span>
          <button className="text-[#8b8171] hover:text-[#9d6d21]" onClick={onClose} type="button"><X size={14} /></button>
        </div>
        <div className="td-scrollbar max-h-[60vh] overflow-y-auto">
          {state.playerTimeline.length ? (
            <ol className="grid gap-3">
              {state.playerTimeline.map((event, index) => (
                <motion.li
                  key={event.id}
                  className="grid grid-cols-[3.5rem_1fr] items-start gap-3"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05, duration: 0.2 }}
                >
                  <motion.span
                    className="border border-[#d6c9ae] bg-[#fff0cc] px-2 py-1 text-center font-mono text-[0.62rem] text-[#9d6d21]"
                    initial={{ scale: 1.08 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: index * 0.05, duration: 0.2 }}
                  >
                    {event.time}
                  </motion.span>
                  <p className="relative border-l border-[#cfa65b] pl-3 text-xs leading-5 text-[#3d352b]">
                    <motion.span
                      className="absolute -left-[3px] top-1 h-1.5 w-1.5 rounded-full bg-[#24615b]"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: index * 0.05 + 0.1, duration: 0.18 }}
                    />
                    {event.description}
                  </p>
                </motion.li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-[#776f61]">暂无已确认时间点。</p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
