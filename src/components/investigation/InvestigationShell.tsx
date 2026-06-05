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
import { AnimatePresence, motion } from "framer-motion";
import { BootConsole } from "@/components/investigation/BootConsole";
import {
  bootSteps,
  phaseLabels,
  type BootStepId,
  type ChatModeState,
  type InvestigationChatMessage,
  type InvestigationData,
} from "@/components/investigation/types";
import type { CaseData, PlayerCaseState } from "@/game/schemas/game";

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

  return (
    <div className="relative flex h-full flex-col">
      {/* Icon strip */}
      <div className="flex w-12 flex-col items-center gap-1 border-r border-[#d8cfba] bg-[#ede8dc] pt-3">
        {[
          { section: "locations" as const, Icon: MapPin, count: locationCount, active: data?.currentLocation != null },
          { section: "clues" as const, Icon: Search, count: clueCount, active: false },
          { section: "evidence" as const, Icon: Fingerprint, count: evidenceCount, active: false },
        ].map(({ section, Icon, count }) => (
          <button
            key={section}
            className={[
              "relative flex h-10 w-10 items-center justify-center transition",
              open === section ? "text-[#24615b]" : "text-[#8b8171] hover:text-[#9d6d21]",
            ].join(" ")}
            onClick={() => {
              const next = open === section ? null : section;
              setOpen(next);
            }}
            type="button"
            aria-label={section}
          >
            <Icon size={18} />
            {count > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center bg-[#24615b] px-0.5 font-mono text-[0.55rem] font-bold text-[#eafffb]">
                {count}
              </span>
            )}
          </button>
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
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#27241f]/35 p-6 backdrop-blur" onClick={() => setSelectedClue(null)}>
          <div className="w-full max-w-sm border border-[#b8d8d2] bg-[#fffdf7] p-5 shadow-[0_18px_60px_rgba(49,40,28,0.14)]" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
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
          </div>
        </div>
      )}

      {/* Location detail modal */}
      {selectedLocation && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#27241f]/35 p-6 backdrop-blur" onClick={() => setSelectedLocation(null)}>
          <div className="w-full max-w-sm border border-[#b8d8d2] bg-[#fffdf7] p-5 shadow-[0_18px_60px_rgba(49,40,28,0.14)]" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
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
          </div>
        </div>
      )}

      {/* Evidence detail modal */}
      {selectedEvidence && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#27241f]/35 p-6 backdrop-blur" onClick={() => setSelectedEvidence(null)}>
          <div className="w-full max-w-sm border border-[#cfa65b] bg-[#fffdf7] p-5 shadow-[0_18px_60px_rgba(49,40,28,0.14)]" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
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
          </div>
        </div>
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

  useEffect(() => {
    const element = chatScrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [chatMessages]);

  const statusText = isActing ? "正在生成回答" : chatMode.mode === "interrogation" ? "问询接入" : "案件助手在线";

  return (
    <section ref={workspaceRef} className="relative min-h-0 overflow-hidden bg-[#ede8dc]">
      {isBooting ? (
        <div className="td-scrollbar h-full overflow-y-auto p-4">
          <BootConsole activeStep={activeStep} error={bootError} progress={bootProgress} status={bootStatus} />
        </div>
      ) : (
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#f1eee6] text-[#27241f]">
          <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(39,36,31,0.9)_1px,transparent_1px),linear-gradient(90deg,rgba(39,36,31,0.9)_1px,transparent_1px)] [background-size:28px_28px]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[linear-gradient(180deg,rgba(111,213,199,0.18),transparent)]" />

          <div className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b border-[#c8c0ae] bg-[#fbf8f0]/92 px-5 shadow-[0_12px_36px_rgba(36,30,22,0.08)]">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-md border border-[#d8cfba] bg-[#163c3a] text-[#d8fff8] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
                <Bot size={16} />
              </span>
              <div className="min-w-0">
                <p className="line-clamp-1 text-sm font-bold text-[#1f2927]">
                  {chatMode.mode === "interrogation" ? `问询对象 / ${chatMode.label}` : chatMode.label}
                </p>
                <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-[#776f61]">
                  enterprise assistant / restricted case workspace
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-[#d8cfba] bg-white/70 px-3 py-1.5 font-mono text-[0.62rem] text-[#24615b]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2a8c80]" />
              {statusText}
            </div>
          </div>

          <div ref={chatScrollRef} className="td-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto px-6 pb-36 pt-6">
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
                          <span className="font-mono text-[0.55rem] text-[#8b8171]">typing</span>
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
        <div className="absolute right-3 top-3 z-10 border border-signal/60 bg-[#e7f05f]/15 px-3 py-1.5 font-mono text-xs text-[#6f6f18]">
          案件已结案
        </div>
      )}

      {!isBooting && (
        <div className="absolute bottom-5 left-1/2 z-20 w-[min(700px,calc(100%-2.5rem))] -translate-x-1/2">
          <motion.div
            className="rounded-xl border border-[#d6c9ae] bg-[#fffdf7]/95 shadow-[0_22px_80px_rgba(36,30,22,0.24)] backdrop-blur"
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
                    <button
                      key={cmd}
                      className="h-7 shrink-0 rounded-full border border-[#d8cfba] bg-[#f4efe5] px-2.5 font-mono text-[0.63rem] text-[#675d4f] transition hover:border-[#24615b] hover:text-[#24615b]"
                      disabled={commandDisabled}
                      onMouseDown={(e) => { e.preventDefault(); onCommand(cmd); setCmdExpanded(false); }}
                      type="button"
                    >
                      {cmd}
                    </button>
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
    </section>
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

  if (isBooting || !data || !state) {
    return (
      <aside className="flex flex-col gap-4 border-l border-[#d8cfba] bg-[#ede8dc] p-4">
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
    <aside className="td-scrollbar flex flex-col gap-4 overflow-y-auto border-l border-[#d8cfba] bg-[#ede8dc] p-4">
      {/* Truth gauge */}
      <div>
        <div className="flex items-center gap-3">
          <div
            className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
            style={{ background: `conic-gradient(#6fd5c7 ${state.truthScore * 3.6}deg, rgba(255,255,255,0.07) 0deg)` }}
          >
            <div className="flex h-[3.2rem] w-[3.2rem] items-center justify-center rounded-full bg-[#fffdf7] font-mono text-sm font-black text-[#24615b]">
              {state.truthScore}%
            </div>
          </div>
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
      {data.visibleSuspects.length > 0 && (
        <div>
          <button
            className="flex w-full items-center justify-between font-mono text-[0.65rem] text-[#9d6d21] transition hover:text-[#6f6f18]"
            onClick={() => setSuspectsExpanded(!suspectsExpanded)}
            type="button"
          >
            <span>人物状态 ({data.visibleSuspects.length})</span>
            {suspectsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <AnimatePresence initial={false}>
            {suspectsExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <div className="mt-2 flex flex-col gap-2">
                  {data.visibleSuspects.map((suspect) => {
                    const ss = state.suspectStates[suspect.id];
                    return (
                      <div key={suspect.id} className="border border-[#ded4c0] bg-[#f4efe5] p-3">
                        <div className="flex items-center gap-2">
                          <UserRound size={15} className="shrink-0 text-[#a64e3b]" />
                          <div className="min-w-0">
                            <p className="line-clamp-1 text-xs font-semibold text-[#27241f]">{suspect.name}</p>
                            <p className="font-mono text-[0.55rem] text-[#a64e3b]">
                              {emotionLabels[ss?.currentEmotion ?? ""] ?? ss?.currentEmotion}
                            </p>
                          </div>
                        </div>
                        <SignalBar label="压" value={ss?.pressure ?? 0} tone="rust" />
                        <SignalBar label="疑" value={ss?.suspicion ?? 0} tone="brass" />
                        <SignalBar label="信" value={ss?.trust ?? 0} tone="scan" />
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </aside>
  );
}

function NodeBadge({ label }: { label: string }) {
  return (
    <div className="grid min-h-12 place-items-center border border-[#d8cfba] bg-[#fff5db] p-2 text-center">
      <span className="line-clamp-2 text-xs font-semibold text-[#27241f]">{label}</span>
    </div>
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
      <span className="h-1.5 bg-[#d8cfba]">
        <span className={`block h-full ${colorClass}`} style={{ width: `${value}%` }} />
      </span>
      <span className="text-right font-mono text-[0.58rem] text-[#a99f8d]">{value}</span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#ded4c0] bg-[#f4efe5] p-2 text-center">
      <p className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-[#8f8574]">{label}</p>
      <p className="mt-1 text-lg font-black leading-none text-[#9d6d21]">{value}</p>
    </div>
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#27241f]/35 p-6 backdrop-blur" onClick={onClose}>
      <div
        className="w-full max-w-2xl border border-[#cfa65b] bg-[#fffdf7] p-5 shadow-[0_18px_60px_rgba(49,40,28,0.14)]"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="font-mono text-xs text-[#9d6d21]">人物关系图</span>
          <button className="text-[#8b8171] hover:text-[#9d6d21]" onClick={onClose} type="button"><X size={14} /></button>
        </div>
        <div className="td-scrollbar max-h-[60vh] overflow-y-auto">
          {data.visibleRelationships.length ? (
            <div className="grid gap-3">
              {data.visibleRelationships.map((rel) => (
                <div key={rel.id} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <NodeBadge label={data.entityNameById.get(rel.from) ?? rel.from} />
                  <div className="grid place-items-center text-[#9d6d21]">
                    <GitBranch size={14} />
                    <span className="mt-1 font-mono text-[0.58rem]">{rel.status}</span>
                  </div>
                  <NodeBadge label={data.entityNameById.get(rel.to) ?? rel.to} />
                  <p className="col-span-3 text-center text-xs text-[#675d4f]">{rel.label}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#776f61]">关系图尚未形成。需要先获得能支撑关系的证据。</p>
          )}
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#27241f]/35 p-6 backdrop-blur" onClick={onClose}>
      <div
        className="w-full max-w-2xl border border-[#cfa65b] bg-[#fffdf7] p-5 shadow-[0_18px_60px_rgba(49,40,28,0.14)]"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="font-mono text-xs text-[#9d6d21]">时间线</span>
          <button className="text-[#8b8171] hover:text-[#9d6d21]" onClick={onClose} type="button"><X size={14} /></button>
        </div>
        <div className="td-scrollbar max-h-[60vh] overflow-y-auto">
          {state.playerTimeline.length ? (
            <ol className="grid gap-3">
              {state.playerTimeline.map((event) => (
                <li key={event.id} className="grid grid-cols-[3.5rem_1fr] items-start gap-3">
                  <span className="border border-[#d6c9ae] bg-[#fff0cc] px-2 py-1 text-center font-mono text-[0.62rem] text-[#9d6d21]">{event.time}</span>
                  <p className="border-l border-[#cfa65b] pl-3 text-xs leading-5 text-[#3d352b]">{event.description}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-[#776f61]">暂无已确认时间点。</p>
          )}
        </div>
      </div>
    </div>
  );
}
