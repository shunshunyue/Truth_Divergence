import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  Bot,
  FileText,
  Fingerprint,
  GitBranch,
  ImageIcon,
  LogOut,
  MapPin,
  Maximize2,
  Search,
  Send,
  ShieldCheck,
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
  type VisualFocusState,
} from "@/components/investigation/types";
import { findVisualAsset, visualUrl } from "@/components/investigation/visualAssets";
import { sortTimelineEvents } from "@/game/engine/timelineSort";
import type { CaseVisualManifest, VisualAsset } from "@/game/schemas/visuals";
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

const visualKindLabels: Record<VisualAsset["kind"], string> = {
  case_cover: "案件背景",
  location: "现场影像",
  suspect_portrait: "人物头像",
  witness_portrait: "证人头像",
  victim_portrait: "当事人肖像",
  clue_object: "线索特写",
  evidence: "证据影像",
  timeline_event: "时间线影像",
  relationship_node: "关系图像",
};

type EvidenceItem = InvestigationData["discoveredEvidence"][number];

const evidenceVisibleDataLabels: Record<string, string> = {
  visualSubject: "证据本体",
  visualCarrier: "载体",
  timeWindow: "时间",
  locationCue: "地点",
  abnormalPoint: "异常点",
  operator: "操作人",
  actor: "关联人员",
  person: "关联人员",
  suspect: "关联人员",
  witness: "关联证人",
  vehicle: "车辆",
  vehicleId: "车辆",
  plate: "车牌",
  entryTime: "进入时间",
  exitTime: "离开时间",
  accessTime: "门禁时间",
  recordTime: "记录时间",
  status: "记录状态",
  result: "记录结果",
};

const evidenceVisibleDataOrder = [
  "visualSubject",
  "visualCarrier",
  "timeWindow",
  "locationCue",
  "abnormalPoint",
  "operator",
  "actor",
  "person",
  "suspect",
  "witness",
  "vehicle",
  "vehicleId",
  "plate",
  "entryTime",
  "exitTime",
  "accessTime",
  "recordTime",
  "status",
  "result",
];

const evidenceInternalVisibleKeys = new Set([
  "summary",
  "visibleDetails",
  "visualTemplate",
  "imagePrompt",
  "prompt",
  "caption",
  "description",
  "style",
]);

function compactDisplayValue(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(compactDisplayValue).filter(Boolean).join("、");
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(compactDisplayValue).filter(Boolean).join("、");
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value).replace(/\s+/g, " ").trim();
}

function evidenceVisibleSummary(evidence: EvidenceItem) {
  return compactDisplayValue(evidence.visibleData.summary);
}

function evidenceVisibleDetails(evidence: EvidenceItem) {
  const raw = evidence.visibleData.visibleDetails;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[；;\n]/) : [];
  return values.map(compactDisplayValue).filter(Boolean).slice(0, 5);
}

function evidenceDetailRows(evidence: EvidenceItem) {
  const used = new Set<string>();
  const rows: Array<{ key: string; label: string; value: string }> = [];

  const pushRow = (key: string, label: string) => {
    if (used.has(key) || evidenceInternalVisibleKeys.has(key)) return;
    const value = compactDisplayValue(evidence.visibleData[key]);
    if (!value) return;
    rows.push({ key, label, value });
    used.add(key);
  };

  evidenceVisibleDataOrder.forEach((key) => pushRow(key, evidenceVisibleDataLabels[key]));
  Object.keys(evidence.visibleData).forEach((key) => {
    if (!/[\u4e00-\u9fff]/.test(key)) return;
    pushRow(key, key);
  });

  return rows.slice(0, 8);
}

function comparableEvidenceLine(value: string) {
  return value
    .replace(/^[\u4e00-\u9fff]{1,8}[：:]/, "")
    .replace(/[，。；;、,\s]/g, "")
    .toLowerCase();
}

function isDuplicateEvidenceLine(a: string, b: string) {
  const left = comparableEvidenceLine(a);
  const right = comparableEvidenceLine(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function uniqueEvidenceLines(values: string[], max = 3) {
  const lines: string[] = [];
  values.forEach((value) => {
    const line = compactDisplayValue(value);
    if (!line || lines.some((existing) => isDuplicateEvidenceLine(existing, line))) return;
    lines.push(line);
  });
  return lines.slice(0, max);
}

function evidenceModalContent(evidence: EvidenceItem, asset?: VisualAsset) {
  const rowLines = evidenceDetailRows(evidence)
    .filter((row) => row.key !== "visualSubject" && row.key !== "visualCarrier")
    .map((row) => `${row.label}：${row.value}`);
  const candidates = uniqueEvidenceLines([
    ...evidenceVisibleDetails(evidence),
    ...rowLines,
    ...(asset?.plotClues ?? []),
  ], 6);
  const summary = evidenceVisibleSummary(evidence);
  const keyFinding = summary || candidates[0] || compactDisplayValue(asset?.caption) || compactDisplayValue(asset?.description);
  const detailLines = uniqueEvidenceLines(
    candidates.filter((line) => !keyFinding || !isDuplicateEvidenceLine(line, keyFinding)),
    3,
  );

  return { keyFinding, detailLines };
}

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

function VisualThumb({
  asset,
  className = "h-12 w-12",
}: {
  asset?: VisualAsset;
  className?: string;
}) {
  const url = visualUrl(asset, true);
  if (!url) return null;

  const isPending = asset?.status === "pending";

  return (
    <span className={["relative shrink-0 overflow-hidden border border-[#d8cfba] bg-[#efe8d8]", className].join(" ")}>
      <img alt="" className="h-full w-full object-cover" src={url} />
      {isPending && (
        <span className="absolute inset-0 grid place-items-center bg-[#fffdf7]/78 px-1 text-center">
          <span className="flex flex-col items-center gap-1">
            <motion.span
              className="h-4 w-4 rounded-full border border-[#24615b]/30 border-t-[#24615b]"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, ease: "linear", repeat: Infinity }}
            />
            <span className="font-mono text-[0.52rem] leading-none text-[#24615b]">整理中</span>
          </span>
        </span>
      )}
    </span>
  );
}

function VisualInlineStatus({ asset }: { asset?: VisualAsset }) {
  if (asset?.status === "pending") {
    return (
      <span className="mt-1 inline-flex items-center gap-1 rounded-sm border border-[#b8d8d2] bg-[#e8f6f2] px-1.5 py-0.5 font-mono text-[0.56rem] text-[#24615b]">
        <motion.span
          className="h-1.5 w-1.5 rounded-full bg-[#24615b]"
          animate={{ opacity: [0.35, 1, 0.35] }}
          transition={{ duration: 0.9, repeat: Infinity }}
        />
        影像整理中
      </span>
    );
  }
  if (asset?.status === "failed") {
    return (
      <span className="mt-1 inline-flex rounded-sm border border-[#d0a092] bg-[#fff0ea] px-1.5 py-0.5 font-mono text-[0.56rem] text-[#a64e3b]">
        影像待重试
      </span>
    );
  }
  return null;
}

function ChatVisualAttachmentGrid({
  assets,
  onOpen,
}: {
  assets: VisualAsset[];
  onOpen: (asset: VisualAsset) => void;
}) {
  const visibleAssets = assets.filter((asset) => visualUrl(asset, true));
  if (!visibleAssets.length) return null;

  return (
    <motion.div
      className="grid gap-2 sm:grid-cols-2"
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
    >
      {visibleAssets.map((asset) => {
        const imageUrl = visualUrl(asset, true);
        return (
          <button
            key={asset.id}
            className="group relative overflow-hidden rounded-md border border-[#d8cfba] bg-[#fffdf7]/92 p-2 text-left shadow-[0_12px_34px_rgba(49,40,28,0.12)] transition hover:border-[#cfa65b] hover:bg-[#fffaf0]"
            onClick={() => onOpen(asset)}
            type="button"
          >
            <div className="relative h-28 overflow-hidden rounded-[4px] border border-[#e2d7c1] bg-[#efe8d8]">
              {imageUrl ? (
                <img alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" src={imageUrl} />
              ) : (
                <span className="absolute inset-0 bg-[linear-gradient(135deg,rgba(36,97,91,0.18),transparent_45%,rgba(157,109,33,0.18))]" />
              )}
              <span className="absolute left-2 top-2 flex items-center gap-1 rounded-sm border border-[#fffdf7]/70 bg-[#fffdf7]/86 px-1.5 py-0.5 font-mono text-[0.56rem] text-[#24615b] shadow-sm">
                <ImageIcon size={10} /> {visualKindLabels[asset.kind]}
              </span>
              <span className="absolute bottom-2 right-2 grid h-6 w-6 place-items-center rounded-sm bg-[#27241f]/72 text-[#fffdf7] opacity-0 transition group-hover:opacity-100">
                <Maximize2 size={12} />
              </span>
            </div>
            <div className="mt-2 min-w-0">
              <p className="line-clamp-1 text-xs font-bold text-[#27241f]">{asset.title}</p>
              <p className="mt-1 line-clamp-2 text-[0.68rem] leading-4 text-[#6a6256]">
                {asset.caption || asset.description || "这张影像已同步到侧边索引。"}
              </p>
            </div>
          </button>
        );
      })}
    </motion.div>
  );
}

function VisualAttachmentModal({
  asset,
  onClose,
  onPrompt,
}: {
  asset: VisualAsset;
  onClose: () => void;
  onPrompt?: (prompt: string) => void;
}) {
  const imageUrl = visualUrl(asset);
  const plotClues = asset.plotClues.slice(0, 5);
  const prompts = asset.investigationPrompts.slice(0, 4);

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-[#27241f]/42 p-4 backdrop-blur"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="relative grid max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-lg border border-[#cfa65b] bg-[#fffdf7] shadow-[0_28px_100px_rgba(31,25,17,0.34)] md:grid-cols-[minmax(0,1fr)_18rem]"
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.985 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="relative min-h-[18rem] bg-[#efe8d8] md:min-h-[34rem]">
          {imageUrl ? (
            <img alt="" className="h-full max-h-[70vh] w-full object-contain md:max-h-[92vh]" src={imageUrl} />
          ) : (
            <div className="h-full w-full bg-[linear-gradient(135deg,rgba(36,97,91,0.18),transparent_45%,rgba(157,109,33,0.18))]" />
          )}
          <div className="pointer-events-none absolute inset-0 border-[10px] border-[#fffdf7]/22" />
        </div>
        <aside className="flex min-h-0 flex-col border-t border-[#d8cfba] p-5 md:border-l md:border-t-0">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-[#24615b]">{visualKindLabels[asset.kind]}</p>
              <h3 className="mt-2 text-lg font-black leading-tight text-[#27241f]">{asset.title}</h3>
            </div>
            <button className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#8b8171] hover:bg-[#f4efe5] hover:text-[#9d6d21]" onClick={onClose} type="button">
              <X size={15} />
            </button>
          </div>
          <p className="text-sm leading-6 text-[#5f564a]">{asset.description || asset.caption || "影像内容已归档。"}</p>
          {asset.caption && asset.caption !== asset.description && (
            <p className="mt-3 border-l-2 border-[#b8d8d2] pl-3 text-xs leading-5 text-[#24615b]">{asset.caption}</p>
          )}
          {plotClues.length > 0 && (
            <div className="mt-4 border border-[#d8cfba] bg-[#f8f3e8] p-3">
              <p className="font-mono text-[0.58rem] uppercase tracking-[0.14em] text-[#9d6d21]">图上可追点</p>
              <div className="mt-2 grid gap-1.5">
                {plotClues.map((clue) => (
                  <p key={clue} className="border-l-2 border-[#cfa65b] pl-2 text-xs leading-5 text-[#3d352b]">
                    {clue}
                  </p>
                ))}
              </div>
            </div>
          )}
          {prompts.length > 0 && onPrompt && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  className="inline-flex items-center gap-1 rounded-sm border border-[#b8d8d2] bg-[#e8f6f2] px-2 py-1 font-mono text-[0.58rem] text-[#24615b] hover:border-[#24615b]"
                  onClick={() => {
                    onPrompt(prompt);
                    onClose();
                  }}
                  type="button"
                >
                  <Search size={11} /> {shortText(prompt, 22)}
                </button>
              ))}
            </div>
          )}
          <div className="mt-auto pt-5">
            <div className="flex flex-wrap gap-1.5">
              {asset.tags.slice(0, 5).map((tag) => (
                <span key={tag} className="rounded-sm border border-[#d8cfba] bg-[#f4efe5] px-2 py-0.5 font-mono text-[0.58rem] text-[#8b8171]">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </aside>
      </motion.div>
    </motion.div>
  );
}

export function VisualReadyModal({
  asset,
  onClose,
  onPrompt,
}: {
  asset: VisualAsset;
  onClose: () => void;
  onPrompt?: (prompt: string) => void;
}) {
  const imageUrl = visualUrl(asset);
  const plotClues = asset.plotClues.slice(0, 3);
  const prompts = asset.investigationPrompts.slice(0, 3);

  return (
    <motion.div
      className="fixed inset-0 z-[60] grid place-items-center bg-[#27241f]/36 p-4 backdrop-blur"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="grid max-h-[calc(100dvh-2rem)] w-full max-w-4xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-[#cfa65b] bg-[#fffdf7] shadow-[0_26px_90px_rgba(31,25,17,0.32)] md:grid-cols-[minmax(0,1fr)_20rem] md:grid-rows-none"
        style={{ height: "min(44rem, calc(100dvh - 2rem))" }}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.985 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="relative h-[min(42vh,22rem)] min-h-0 bg-[#efe8d8] md:h-auto">
          {imageUrl ? (
            <img alt="" className="h-full w-full object-contain" src={imageUrl} />
          ) : (
            <div className="h-full w-full bg-[linear-gradient(135deg,rgba(36,97,91,0.18),transparent_45%,rgba(157,109,33,0.18))]" />
          )}
          <motion.span
            className="td-stamp absolute left-5 top-5 rotate-[-7deg] border-[#9d6d21] bg-[#fffdf7]/82 px-3 py-1 text-[#9d6d21]"
            initial={{ opacity: 0, scale: 1.35, rotate: -15 }}
            animate={{ opacity: 0.9, scale: 1, rotate: -7 }}
            transition={{ delay: 0.12, duration: 0.24 }}
          >
            archived
          </motion.span>
        </div>
        <aside className="td-scrollbar flex min-h-0 flex-col overflow-y-auto border-t border-[#d8cfba] p-5 md:border-l md:border-t-0">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-[#24615b]">新影像入档</p>
              <h3 className="mt-2 text-lg font-black leading-tight text-[#27241f]">{asset.title}</h3>
            </div>
            <button className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#8b8171] hover:bg-[#f4efe5] hover:text-[#9d6d21]" onClick={onClose} type="button">
              <X size={15} />
            </button>
          </div>
          <p className="text-sm leading-6 text-[#5f564a]">
            {asset.caption || asset.description || "后台整理完成，影像已经同步到左侧索引。"}
          </p>
          {plotClues.length > 0 && (
            <div className="mt-4 border border-[#d8cfba] bg-[#f8f3e8] p-3">
              <p className="font-mono text-[0.58rem] uppercase tracking-[0.14em] text-[#9d6d21]">图上可追点</p>
              <div className="mt-2 grid gap-1.5">
                {plotClues.map((clue) => (
                  <p key={clue} className="border-l-2 border-[#cfa65b] pl-2 text-xs leading-5 text-[#3d352b]">
                    {clue}
                  </p>
                ))}
              </div>
            </div>
          )}
          <div className="mt-auto flex flex-col gap-2 pt-5">
            {prompts.length > 0 && onPrompt && (
              <div className="flex flex-wrap gap-1.5">
                {prompts.map((prompt) => (
                  <button
                    key={prompt}
                    className="inline-flex items-center gap-1 rounded-sm border border-[#b8d8d2] bg-[#e8f6f2] px-2 py-1 font-mono text-[0.58rem] text-[#24615b] hover:border-[#24615b]"
                    onClick={() => {
                      onPrompt(prompt);
                      onClose();
                    }}
                    type="button"
                  >
                    <Search size={11} /> {shortText(prompt, 20)}
                  </button>
                ))}
              </div>
            )}
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#143b37] bg-[#163c3a] px-3 font-mono text-xs font-bold text-[#eafffb] hover:bg-[#24615b]"
              onClick={onClose}
              type="button"
            >
              <ImageIcon size={13} /> 收入案卷
            </button>
          </div>
        </aside>
      </motion.div>
    </motion.div>
  );
}

export function ExitCaseConfirmModal({
  caseTitle,
  reason,
  onCancel,
  onConfirm,
}: {
  caseTitle: string;
  reason: "manual" | "solved";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isSolved = reason === "solved";

  return (
    <motion.div
      className="fixed inset-0 z-[70] grid place-items-center bg-[#27241f]/42 p-4 backdrop-blur"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.div
        className="w-full max-w-md overflow-hidden rounded-lg border border-[#cfa65b] bg-[#fffdf7] shadow-[0_28px_100px_rgba(31,25,17,0.34)]"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.985 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="border-b border-[#d8cfba] bg-[#fbf8f0] px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-[#b8d8d2] bg-[#e8f6f2] text-[#24615b]">
              {isSolved ? <ShieldCheck size={18} /> : <LogOut size={18} />}
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.16em] text-[#24615b]">
                {isSolved ? "case closed" : "leave case"}
              </p>
              <h3 className="mt-1 text-lg font-black leading-tight text-[#27241f]">
                {isSolved ? "确认退出已完成案件？" : "确认退出当前案件？"}
              </h3>
            </div>
          </div>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm font-semibold leading-6 text-[#4f483d]">{caseTitle}</p>
          <p className="mt-2 text-sm leading-6 text-[#6a6256]">
            {isSolved
              ? "确认后会清除这局案件的本地进度，并返回首页。"
              : "未结案进度会被清除；取消后可以继续调查，刷新浏览器也会回到这局。"}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-[#d8cfba] bg-[#fbf8f0] px-5 py-4 sm:flex-row sm:justify-end">
          <button
            className="inline-flex h-10 items-center justify-center rounded-md border border-[#cfc4ad] bg-[#fffdf7] px-4 font-mono text-xs font-bold text-[#675d4f] transition hover:border-[#24615b] hover:text-[#24615b]"
            onClick={onCancel}
            type="button"
          >
            继续调查
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#143b37] bg-[#163c3a] px-4 font-mono text-xs font-bold text-[#eafffb] transition hover:bg-[#24615b]"
            onClick={onConfirm}
            type="button"
          >
            <LogOut size={14} />
            确认退出
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function VisualStage({
  chatMode,
  focus,
  manifest,
}: {
  chatMode: ChatModeState;
  currentLocation?: InvestigationData["currentLocation"];
  focus: VisualFocusState;
  manifest?: CaseVisualManifest;
}) {
  const focusedAsset =
    focus?.assetId && (focus.mode === "suspect" || focus.mode === "evidence")
      ? findVisualAsset(manifest, { assetId: focus.assetId })
      : undefined;
  const suspectAsset =
    chatMode.mode === "interrogation"
      ? findVisualAsset(manifest, { kind: "suspect_portrait", entityId: chatMode.suspectId })
      : undefined;
  const asset = focusedAsset ?? suspectAsset;
  const imageUrl = visualUrl(asset);
  const title =
    (focus?.mode !== "case" ? focus?.title : undefined) ??
    (chatMode.mode === "interrogation" ? chatMode.label : undefined) ??
    "调查焦点";
  const eyebrow =
    focus?.mode === "evidence"
      ? "evidence spotlight"
      : chatMode.mode === "interrogation"
        ? "interrogation focus"
        : "case focus";

  if (!imageUrl && chatMode.mode !== "interrogation" && focus?.mode !== "evidence") return null;

  return (
    <motion.div
      className="mx-auto mb-5 grid w-full max-w-[56rem] overflow-hidden rounded-lg border border-[#d8cfba] bg-[#fffdf7]/88 shadow-[0_18px_60px_rgba(49,40,28,0.14)] md:grid-cols-[11rem_1fr]"
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
    >
      <div className="relative h-40 md:h-full">
        {imageUrl ? (
          <img alt="" className="h-full w-full object-cover" src={imageUrl} />
        ) : (
          <div className="h-full w-full bg-[linear-gradient(135deg,rgba(36,97,91,0.18),transparent_45%,rgba(157,109,33,0.2))]" />
        )}
        {focus?.intensity === "spotlight" && (
          <motion.div
            className="pointer-events-none absolute inset-0 border-2 border-[#e7f05f]"
            initial={{ opacity: 0.2 }}
            animate={{ opacity: [0.2, 0.8, 0.2] }}
            transition={{ duration: 1.2, repeat: 2 }}
          />
        )}
      </div>
      <div className="p-4">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[#24615b]">{eyebrow}</p>
        <h3 className="mt-2 line-clamp-1 text-lg font-black text-[#27241f]">{title}</h3>
        <p className="mt-2 line-clamp-3 text-xs leading-5 text-[#675d4f]">
          {focus?.mode === "evidence"
            ? "这份材料已被归档，图像只呈现可观察细节。"
            : chatMode.mode === "interrogation"
              ? "当前画面锁定问询对象，口供和情绪变化会同步到右侧人物状态。"
              : "当前调查焦点已同步。"}
        </p>
      </div>
    </motion.div>
  );
}

function findEntityVisual(data: InvestigationData, entityId: string) {
  return (
    findVisualAsset(data.visualManifest, { kind: "suspect_portrait", entityId }) ??
    findVisualAsset(data.visualManifest, { kind: "victim_portrait", entityId }) ??
    findVisualAsset(data.visualManifest, { kind: "witness_portrait", entityId }) ??
    findVisualAsset(data.visualManifest, { kind: "evidence", entityId }) ??
    findVisualAsset(data.visualManifest, { kind: "location", entityId }) ??
    findVisualAsset(data.visualManifest, { kind: "clue_object", entityId })
  );
}

export function LeftDrawer({
  actionStatus,
  activeStep,
  bootProgress,
  data,
  isActing,
  isBooting,
  state,
  setInput,
  visualFocus,
  onOpenRelationship,
  onOpenTimeline,
}: {
  actionStatus: string;
  activeStep: BootStepId;
  bootProgress: number;
  data: InvestigationData | null;
  isActing: boolean;
  isBooting: boolean;
  state?: PlayerCaseState;
  setInput: (value: string) => void;
  visualFocus: VisualFocusState;
  onOpenRelationship: () => void;
  onOpenTimeline: () => void;
}) {
  const [open, setOpen] = useState<"dashboard" | "locations" | "clues" | "evidence" | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<InvestigationData["unlockedLocations"][number] | null>(null);
  const [selectedClue, setSelectedClue] = useState<InvestigationData["availableClues"][number] | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<InvestigationData["discoveredEvidence"][number] | null>(null);

  const locationCount = data?.unlockedLocations.length ?? 0;
  const clueCount = data?.availableClues.length ?? 0;
  const evidenceCount = data?.discoveredEvidence.length ?? 0;
  const drawerReady = open === "dashboard" || (!isBooting && data);
  const locationPulse = usePulseFlag(locationCount, 780);
  const cluePulse = usePulseFlag(clueCount, 780);
  const evidencePulse = usePulseFlag(evidenceCount, 920);
  const statusPulse = usePulseFlag(state?.truthScore ?? bootProgress, 920);
  const drawerWidthClass = open === "dashboard" ? "w-[25rem]" : "w-80";
  const drawerOffset = open === "dashboard" ? -400 : -320;

  return (
    <div className="relative flex h-full flex-col bg-[#163c3a]">
      {/* Icon strip */}
      <div className="flex w-[3.25rem] flex-1 flex-col items-center border-r border-[#0f2b28] bg-[#163c3a] shadow-[inset_-1px_0_0_rgba(255,255,255,0.08)]">
        <div className="grid h-14 w-full place-items-center border-b border-[#2f6760]">
          <span className="font-display text-lg font-black leading-none text-[#eafffb]">N</span>
        </div>
        <div className="flex flex-1 flex-col items-center gap-1 pt-3">
          {[
            { section: "dashboard" as const, Icon: FileText, count: state?.truthScore ?? 0, active: Boolean(state), pulse: statusPulse },
            { section: "locations" as const, Icon: MapPin, count: locationCount, active: data?.currentLocation != null, pulse: locationPulse },
            { section: "clues" as const, Icon: Search, count: clueCount, active: false, pulse: cluePulse },
            { section: "evidence" as const, Icon: Fingerprint, count: evidenceCount, active: false, pulse: evidencePulse },
          ].map(({ section, Icon, count, pulse }) => (
            <motion.button
              key={section}
              className={[
                "relative flex h-10 w-10 items-center justify-center rounded-md transition",
                pulse ? "td-divergence" : "",
                open === section
                  ? "bg-[#eafffb]/12 text-[#eafffb] shadow-[inset_0_0_0_1px_rgba(234,255,251,0.16)]"
                  : "text-[#c4d6d0] hover:bg-[#eafffb]/8 hover:text-[#eafffb]",
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
              {count > 0 && section !== "dashboard" && (
                <motion.span
                  key={count}
                  className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-sm bg-[#e7f05f] px-0.5 font-mono text-[0.55rem] font-black text-[#163c3a]"
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
      </div>

      {/* Overlay drawer */}
      <AnimatePresence>
        {open && drawerReady && (
          <motion.div
            className="fixed inset-0 z-30 bg-[#27241f]/[0.02]"
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
            className={[
              "absolute left-[3.25rem] top-0 z-40 flex h-full flex-col border-r border-[#bfb39d] bg-[#f8f3e8] shadow-[18px_0_54px_rgba(49,40,28,0.18)]",
              drawerWidthClass,
            ].join(" ")}
            style={{ willChange: "transform" }}
            initial={{ x: drawerOffset }}
            animate={{ x: 0 }}
            exit={{ x: drawerOffset }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            onKeyDown={(e) => e.key === "Escape" && setOpen(null)}
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#d8cfba] bg-[#fffdf7] px-4">
              <span className="font-mono text-xs font-bold text-[#174844]">
                {open === "dashboard"
                  ? "案件图表"
                  : open === "locations"
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

            <div className="td-scrollbar flex-1 overflow-y-auto p-4 pb-28">
              {open === "dashboard" && (
                <CaseChartPanel
                  actionStatus={actionStatus}
                  activeStep={activeStep}
                  bootProgress={bootProgress}
                  data={data}
                  isBooting={isBooting}
                  state={state}
                  visualFocus={visualFocus}
                  onOpenRelationship={() => {
                    onOpenRelationship();
                    setOpen(null);
                  }}
                  onOpenTimeline={() => {
                    onOpenTimeline();
                    setOpen(null);
                  }}
                />
              )}

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
                      <VisualThumb asset={findVisualAsset(data.visualManifest, { kind: "location", entityId: location.id })} className="h-10 w-12" />
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
                      <VisualThumb asset={findVisualAsset(data.visualManifest, { kind: "clue_object", entityId: clue.id })} />
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
                  {data.discoveredEvidence.length ? data.discoveredEvidence.map((evidence) => {
                    const asset = findVisualAsset(data.visualManifest, { kind: "evidence", entityId: evidence.id });
                    return (
                      <button
                        key={evidence.id}
                        className={[
                          "flex w-full items-start gap-3 border px-3 py-2.5 text-left transition",
                          asset?.status === "pending"
                            ? "border-[#b8d8d2] bg-[#eff8f5] hover:border-[#24615b]"
                            : "border-paper/15 bg-paper/5 hover:border-brass/35",
                        ].join(" ")}
                        onClick={() => setSelectedEvidence(evidence)}
                        type="button"
                      >
                        <VisualThumb asset={asset} />
                        <span className="min-w-0">
                          <span className="font-mono text-[0.6rem] text-[#9d6d21]">{evidenceTypeLabels[evidence.type] ?? evidence.type}</span>
                          <span className="mt-0.5 block line-clamp-1 text-sm font-semibold text-[#27241f]">{evidence.title}</span>
                          <VisualInlineStatus asset={asset} />
                        </span>
                      </button>
                    );
                  }) : (
                    <p className="py-2 text-xs text-[#776f61]">尚无已归档证据。</p>
                  )}
                </div>
              )}

            </div>

            {/* Current location card */}
            {data?.currentLocation && (
              <div className="border-t border-[#d8cfba] px-4 py-3">
                <div className="flex items-start gap-3">
                  <VisualThumb asset={findVisualAsset(data.visualManifest, { kind: "location", entityId: data.currentLocation.id })} className="h-12 w-14" />
                  <div className="min-w-0">
                    <span className="line-clamp-1 text-xs font-semibold text-[#24615b]">{data.currentLocation.name}</span>
                    <p className="mt-1 line-clamp-2 text-[0.65rem] leading-4 text-[#776f61]">{data.currentLocation.description}</p>
                  </div>
                </div>
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
            <VisualThumb asset={findVisualAsset(data?.visualManifest, { kind: "clue_object", entityId: selectedClue.id })} className="mb-4 h-40 w-full" />
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
            <VisualThumb asset={findVisualAsset(data?.visualManifest, { kind: "location", entityId: selectedLocation.id })} className="mb-4 h-44 w-full" />
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
        (() => {
          const asset = findVisualAsset(data?.visualManifest, { kind: "evidence", entityId: selectedEvidence.id });
          const { keyFinding, detailLines } = evidenceModalContent(selectedEvidence, asset);
          const prompts = asset?.investigationPrompts.slice(0, 3) ?? [];

          return (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-[#27241f]/35 p-6 backdrop-blur"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => setSelectedEvidence(null)}
        >
          <motion.div
            className={[
              "td-scrollbar-hidden relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-lg border border-[#cfa65b] bg-[#fffdf7] p-0 shadow-[0_18px_60px_rgba(49,40,28,0.16)]",
              selectedEvidence.reliability === "low" ? "td-noise td-divergence" : selectedEvidence.reliability === "medium" ? "td-noise" : "",
            ].join(" ")}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <motion.span
              className="td-stamp pointer-events-none absolute right-5 top-12 rotate-[-8deg] text-[#9d6d21] opacity-70"
              initial={{ opacity: 0, scale: 1.45, rotate: -16 }}
              animate={{ opacity: 0.7, scale: 1, rotate: -8 }}
              transition={{ delay: 0.12, duration: 0.28, ease: "easeOut" }}
            >
              archived
            </motion.span>
            <div className="flex items-start justify-between gap-4 border-b border-[#e3dac8] bg-[#f8f3e8] px-5 py-4">
              <div className="min-w-0">
                <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[#9d6d21]">{evidenceTypeLabels[selectedEvidence.type] ?? selectedEvidence.type}</span>
                <h3 className="mt-2 pr-12 text-lg font-black leading-tight text-[#27241f]">{selectedEvidence.title}</h3>
                <p className="mt-1 font-mono text-[0.6rem] text-[#8b8171]">来源：{selectedEvidence.source}</p>
              </div>
              <button
                onClick={() => setSelectedEvidence(null)}
                type="button"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#8b8171] hover:bg-[#fffdf7] hover:text-[#9d6d21]"
              >
                <X size={14} />
              </button>
            </div>
            <div className="p-5">
              <VisualThumb asset={asset} className="mb-4 h-52 w-full rounded-md" />
              <VisualInlineStatus asset={asset} />
              {keyFinding && (
                <div className="mt-3 border border-[#d8cfba] bg-[#f8f3e8] p-3">
                  <p className="font-mono text-[0.58rem] uppercase tracking-[0.14em] text-[#9d6d21]">关键发现</p>
                  <p className="mt-2 text-sm leading-6 text-[#3d352b]">{keyFinding}</p>
                </div>
              )}
              {detailLines.length > 0 && (
                <div className="mt-3 grid gap-1.5">
                  {detailLines.map((detail) => (
                    <p key={detail} className="border-l-2 border-[#cfa65b] pl-2 text-xs leading-5 text-[#564d42]">
                      {detail}
                    </p>
                  ))}
                </div>
              )}
              {prompts.length ? (
                <div className="mt-4 border-t border-[#e3dac8] pt-3">
                  <p className="mb-2 font-mono text-[0.58rem] uppercase tracking-[0.14em] text-[#24615b]">继续追问</p>
                  <div className="flex flex-wrap gap-1.5">
                    {prompts.map((prompt) => (
                      <button
                        key={prompt}
                        className="inline-flex items-center gap-1 rounded-sm border border-[#b8d8d2] bg-[#e8f6f2] px-2 py-1 font-mono text-[0.58rem] text-[#24615b] hover:border-[#24615b]"
                        onClick={() => {
                          setInput(prompt);
                          setSelectedEvidence(null);
                          setOpen(null);
                        }}
                        type="button"
                      >
                        <Search size={11} /> {shortText(prompt, 22)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="mt-4 flex items-center gap-2 border-t border-[#e3dac8] pt-3">
                <span className="font-mono text-[0.58rem] text-[#8b8171]">可靠性</span>
                <span className={`font-mono text-[0.62rem] ${selectedEvidence.reliability === "high" ? "text-[#24615b]" : selectedEvidence.reliability === "medium" ? "text-[#9d6d21]" : "text-[#a64e3b]"}`}>
                  {selectedEvidence.reliability === "high" ? "高" : selectedEvidence.reliability === "medium" ? "中" : "低"}
                </span>
              </div>
            </div>
          </motion.div>
        </motion.div>
          );
        })()
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
  input,
  isActing,
  isBooting,
  phase,
  recommendedCommands,
  setInput,
  visualFocus,
  visualManifest,
  onCommand,
  onRequestExit,
}: {
  activeStep: BootStepId;
  bootError: string;
  bootProgress: number;
  bootStatus: string;
  chatMessages: InvestigationChatMessage[];
  chatMode: ChatModeState;
  commandDisabled: boolean;
  currentLocation?: InvestigationData["currentLocation"];
  input: string;
  isActing: boolean;
  isBooting: boolean;
  phase?: PlayerCaseState["phase"];
  recommendedCommands: string[];
  setInput: (value: string) => void;
  visualFocus: VisualFocusState;
  visualManifest?: CaseVisualManifest;
  onCommand: (command: string) => void;
  onRequestExit: () => void;
}) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [cmdExpanded, setCmdExpanded] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<VisualAsset | null>(null);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const solvedPulse = usePulseFlag(phase === "solved", 1700);

  useEffect(() => {
    const element = chatScrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [chatMessages]);

  const statusText = isActing ? "正在生成回答" : chatMode.mode === "interrogation" ? "问询接入" : "中枢在线";
  const isInterrogation = chatMode.mode === "interrogation";

  return (
    <motion.section
      ref={workspaceRef}
      className="relative min-h-0 overflow-hidden bg-[#f4f0e7] shadow-[inset_1px_0_0_rgba(255,255,255,0.55),inset_-1px_0_0_rgba(80,69,52,0.08)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.32, ease: "easeOut" }}
    >
      {isBooting ? (
        <div className="td-scrollbar h-full overflow-y-auto bg-[#f4f0e7] p-5">
          <BootConsole
            activeStep={activeStep}
            error={bootError}
            onCancel={onRequestExit}
            progress={bootProgress}
            status={bootStatus}
          />
        </div>
      ) : (
        <div className={["td-desk-stage relative flex h-full min-h-0 flex-col overflow-hidden text-[#27241f]", isInterrogation ? "td-desk-stage-interrogation" : ""].join(" ")}>
          <div className="td-desk-grain pointer-events-none absolute inset-0 z-0" />
          <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_18%,rgba(255,253,247,0.74),transparent_34rem),radial-gradient(circle_at_12%_88%,rgba(36,97,91,0.13),transparent_28rem),radial-gradient(circle_at_92%_42%,rgba(157,109,33,0.16),transparent_30rem)]" />
          <motion.div
            className="pointer-events-none absolute inset-0 z-0 [background-image:linear-gradient(rgba(39,36,31,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(39,36,31,0.16)_1px,transparent_1px)]"
            animate={{
              opacity: isInterrogation ? 0.16 : 0.1,
              backgroundSize: isInterrogation ? "23px 23px" : "31px 31px",
            }}
            transition={{ duration: 0.34 }}
          />
          <motion.div
            className="pointer-events-none absolute inset-x-0 top-0 z-0 h-36"
            animate={{
              background: isInterrogation
                ? "linear-gradient(180deg,rgba(197,83,61,0.22),transparent)"
                : "linear-gradient(180deg,rgba(111,213,199,0.2),transparent)",
            }}
            transition={{ duration: 0.3 }}
          />
          <div className="pointer-events-none absolute inset-y-0 left-0 z-0 w-16 bg-[linear-gradient(90deg,rgba(20,59,55,0.16),transparent)]" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-0 w-16 bg-[linear-gradient(270deg,rgba(80,69,52,0.16),transparent)]" />
          <div className="pointer-events-none absolute inset-0 z-0 shadow-[inset_0_0_90px_rgba(47,42,34,0.14)]" />
          {currentLocation && (
            <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden">
              <div className="absolute right-[7%] top-[18%] hidden h-44 w-64 rotate-[-8deg] border border-[#24615b]/10 bg-[linear-gradient(135deg,rgba(36,97,91,0.08),transparent_48%,rgba(157,109,33,0.08))] sm:block" />
              <div className="absolute left-[7%] top-[20%] max-w-5xl select-none font-display text-6xl font-black leading-none text-[#143b37]/[0.055] sm:text-7xl md:text-8xl lg:text-9xl">
                {currentLocation.name}
              </div>
            </div>
          )}

          <motion.div
            className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b px-5 shadow-[0_12px_36px_rgba(36,30,22,0.08)]"
            animate={{
              backgroundColor: isInterrogation ? "rgba(255, 240, 234, 0.94)" : "rgba(251, 248, 240, 0.9)",
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
            <div className="flex shrink-0 items-center gap-2">
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
              <button
                aria-label="退出案件"
                className="grid h-9 w-9 place-items-center rounded-md border border-[#d8cfba] bg-[#fffdf7]/78 text-[#675d4f] shadow-sm transition hover:border-[#a64e3b] hover:bg-[#fff0ea] hover:text-[#a64e3b]"
                onClick={onRequestExit}
                title="退出案件"
                type="button"
              >
                <LogOut size={15} />
              </button>
            </div>
          </motion.div>

          <div ref={chatScrollRef} className="td-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto px-4 pb-48 pt-7 sm:px-6 lg:px-8">
            <div className="td-case-feed mx-auto flex w-full max-w-[58rem] flex-col gap-4">
              <VisualStage
                chatMode={chatMode}
                currentLocation={currentLocation}
                focus={visualFocus}
                manifest={visualManifest}
              />
              {chatMessages.length === 0 && (
                <motion.div
                  className="td-field-note relative overflow-hidden border border-[#d8cfba] bg-[#fffdf7]/86 p-5 shadow-[0_22px_70px_rgba(49,40,28,0.13)] backdrop-blur-sm sm:p-6"
                  initial={{ opacity: 0, y: 8, rotate: -0.4 }}
                  animate={{ opacity: 1, y: 0, rotate: -0.4 }}
                  transition={{ duration: 0.24, ease: "easeOut" }}
                >
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-[#24615b]">field note / 001</p>
                      <h2 className="mt-1 font-display text-2xl font-black leading-none text-[#27241f] sm:text-3xl">
                        {currentLocation?.name ?? "案发现场"}
                      </h2>
                    </div>
                    <span className="td-stamp rotate-[5deg] border-[#cfa65b] bg-[#fff8e8]/76 px-2 py-1 text-[#9d6d21]">
                      active
                    </span>
                  </div>
                  <p className="max-w-3xl text-sm leading-7 text-[#625a4d]">
                    我先把现场压一下：现在人在{currentLocation?.name ?? "案发现场"}。
                    {currentLocation?.description ?? "门禁、监控、值班记录和现场物件会是第一批能撬开的口子。"}
                    你可以直接问要查哪一项，也可以从左侧线索进去看。
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <span className="rounded-sm border border-[#b8d8d2] bg-[#e8f6f2]/72 px-2 py-1 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-[#24615b]">
                      scene locked
                    </span>
                    <span className="rounded-sm border border-[#d8cfba] bg-[#f4efe5]/82 px-2 py-1 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-[#675d4f]">
                      archive ready
                    </span>
                  </div>
                </motion.div>
              )}
              {chatMessages.map((message) => {
                const isUser = message.speaker === "user";
                const isSuspect = message.speaker === "suspect";
                const isSystem = message.speaker === "system";
                const messageTone = isUser ? "user" : isSuspect ? "suspect" : isSystem ? "system" : "assistant";
                const speakerLabel = message.label ?? (isUser ? "你的行动" : isSuspect ? "问询转录" : isSystem ? "系统记录" : "案件分析");
                return (
                  <motion.div
                    key={message.id}
                    className={["flex", isUser ? "justify-end" : "justify-start"].join(" ")}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.16 }}
                  >
                    <div className={["flex max-w-[86%] flex-col gap-2 sm:max-w-[78%]", isUser ? "items-end" : "items-start"].join(" ")}>
                      <div
                        className={[
                          "td-message-card relative w-full overflow-hidden border px-4 py-3 shadow-[0_16px_44px_rgba(49,40,28,0.12)] backdrop-blur-sm",
                          isUser
                            ? "td-message-user rounded-md border-[#cfa65b] bg-[#fff4d4]/90 text-[#2f2618]"
                            : isSuspect
                              ? "td-message-suspect rounded-md border-[#b86956] bg-[#fff0ea]/90 text-[#35201a]"
                              : isSystem
                                ? "td-message-system rounded-md border-[#c8bda7] bg-[#f7f2e8]/88 text-[#4b4338]"
                                : "td-message-assistant rounded-md border-[#b8d8d2] bg-[#fffdf7]/84 text-[#1f2927]",
                        ].join(" ")}
                      >
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className={["flex min-w-0 items-center gap-2 font-mono text-[0.58rem] uppercase tracking-[0.16em]", isUser ? "text-[#9d6d21]" : isSuspect ? "text-[#a64e3b]" : isSystem ? "text-[#8b8171]" : "text-[#24615b]"].join(" ")}>
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-75" />
                            <span className="line-clamp-1">{speakerLabel}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            {isSuspect && (
                              <span className="hidden rounded-sm border border-[#d0a092] bg-[#fff7f3] px-1.5 py-0.5 font-mono text-[0.52rem] font-bold uppercase tracking-[0.12em] text-[#a64e3b] sm:inline-flex">
                                rec
                              </span>
                            )}
                            <span className="font-mono text-[0.52rem] uppercase tracking-[0.14em] text-[#9b9180]">
                              {messageTone}
                            </span>
                            {message.pending && (
                              <span className="flex items-center gap-1 text-[#8b8171]" aria-label="typing">
                                <span className="td-typing-dot" />
                                <span className="td-typing-dot" />
                                <span className="td-typing-dot" />
                              </span>
                            )}
                          </span>
                        </div>
                        <p className="relative z-[1] whitespace-pre-wrap text-sm leading-6">{message.text || "..."}</p>
                      </div>
                      {message.attachments?.length ? (
                        <div className="w-full">
                          <ChatVisualAttachmentGrid assets={message.attachments} onOpen={setSelectedAttachment} />
                        </div>
                      ) : null}
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

      <AnimatePresence>
        {selectedAttachment && (
          <VisualAttachmentModal
            asset={selectedAttachment}
            onClose={() => setSelectedAttachment(null)}
            onPrompt={setInput}
          />
        )}
      </AnimatePresence>

      {!isBooting && (
        <div className="absolute bottom-4 left-1/2 z-20 w-[min(860px,calc(100%-2rem))] -translate-x-1/2">
          <motion.div
            className={[
              "relative border border-[#cfc4ad] bg-[#fffdf7]/96 shadow-[0_18px_64px_rgba(36,30,22,0.2)] backdrop-blur",
              cmdExpanded && recommendedCommands.length > 0 ? "rounded-b-lg rounded-t-none" : "rounded-lg",
              isActing ? "td-scanline" : "",
            ].join(" ")}
          >
            <AnimatePresence initial={false}>
              {cmdExpanded && recommendedCommands.length > 0 && (
                <motion.div
                  className="absolute bottom-[calc(100%-1px)] left-[-1px] right-[-1px] flex gap-2 overflow-x-auto rounded-t-lg border border-b-0 border-[#cfc4ad] bg-[#fffdf7]/96 px-3 py-2 backdrop-blur"
                  initial={{ opacity: 0, y: 7 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 7 }}
                  transition={{ duration: 0.14, ease: "easeOut" }}
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

function CaseChartPanel({
  actionStatus,
  activeStep,
  bootProgress,
  data,
  isBooting,
  state,
  visualFocus,
  onOpenRelationship,
  onOpenTimeline,
}: {
  actionStatus: string;
  activeStep: BootStepId;
  bootProgress: number;
  data: InvestigationData | null;
  isBooting: boolean;
  state?: PlayerCaseState;
  visualFocus: VisualFocusState;
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
      <div className="rounded-lg border border-[#d8cfba] bg-[#fffdf7] p-4 shadow-[0_10px_28px_rgba(49,40,28,0.08)]">
        <p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.16em] text-[#174844]">案件图表生成中</p>
        <p className="mt-2 text-xs leading-5 text-[#4f483d]">{bootSteps.find((s) => s.id === activeStep)?.title}</p>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#d8cfba]">
          <div className="h-full bg-[#e7f05f] transition-all duration-500" style={{ width: `${bootProgress}%` }} />
        </div>
      </div>
    );
  }

  const metricMax = Math.max(1, data.discoveredEvidence.length, data.visibleSuspects.length, state.playerTimeline.length);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-[#d8cfba] bg-[#fffdf7] p-4 shadow-[0_10px_28px_rgba(49,40,28,0.08)]">
        <div className="flex items-center gap-3">
          <TruthGauge score={state.truthScore} delta={truthDelta} pulse={truthPulse} />
          <div className="min-w-0">
            <p className="font-mono text-[0.62rem] uppercase tracking-widest text-[#174844]">{phaseLabels[state.phase]}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#4f483d]">{shortText(actionStatus, 48)}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-1.5">
          <MiniStat label="证据" value={String(data.discoveredEvidence.length)} />
          <MiniStat label="人物" value={String(data.visibleSuspects.length)} />
          <MiniStat label="时间" value={String(state.playerTimeline.length)} />
        </div>
        <div className="mt-4 border-t border-[#e3dac8] pt-3">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-[#8a5d19]">调查分布</p>
          <div className="mt-3 grid gap-2">
            <MetricTrack label="证据索引" value={data.discoveredEvidence.length} max={metricMax} tone="scan" />
            <MetricTrack label="人物状态" value={data.visibleSuspects.length} max={metricMax} tone="rust" />
            <MetricTrack label="时间节点" value={state.playerTimeline.length} max={metricMax} tone="brass" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          className="flex items-center justify-center gap-2 rounded-md border border-[#cdbf9e] bg-[#fffdf7] py-2.5 font-mono text-[0.68rem] font-bold text-[#8a5d19] transition hover:border-[#9d6d21] hover:bg-[#fffaf0]"
          onClick={onOpenRelationship}
          type="button"
        >
          <GitBranch size={13} />
          关系图
        </button>
        <button
          className="flex items-center justify-center gap-2 rounded-md border border-[#cdbf9e] bg-[#fffdf7] py-2.5 font-mono text-[0.68rem] font-bold text-[#8a5d19] transition hover:border-[#9d6d21] hover:bg-[#fffaf0]"
          onClick={onOpenTimeline}
          type="button"
        >
          <Clock3 size={13} />
          时间线
        </button>
      </div>

      <div className="rounded-lg border border-[#d8cfba] bg-[#fffdf7] p-3">
        <button
          aria-expanded={data.visibleSuspects.length > 0 ? suspectsExpanded : undefined}
          className={[
            "flex w-full items-center justify-between font-mono text-[0.68rem] font-bold text-[#8a5d19] transition",
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
                  return (
                    <SuspectStatusCard
                      key={suspect.id}
                      active={visualFocus?.mode === "suspect" && visualFocus.entityId === suspect.id}
                      asset={findVisualAsset(data.visualManifest, { kind: "suspect_portrait", entityId: suspect.id })}
                      name={suspect.name}
                      state={ss}
                    />
                  );
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
              <p className="mt-2 text-xs leading-5 text-[#4f483d]">
                等门禁、监控、口供或物证指到某个人，这里会自动亮出人物状态。
              </p>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

function MetricTrack({
  label,
  max,
  tone,
  value,
}: {
  label: string;
  max: number;
  tone: "scan" | "rust" | "brass";
  value: number;
}) {
  const colorClass = {
    brass: "bg-[#d6a247]",
    rust: "bg-[#c5533d]",
    scan: "bg-[#24615b]",
  }[tone];
  const width = max > 0 ? `${Math.min(100, Math.max(0, (value / max) * 100))}%` : "0%";

  return (
    <div className="grid grid-cols-[4.5rem_1fr_2rem] items-center gap-2">
      <span className="font-mono text-[0.6rem] font-bold text-[#5f564a]">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-[#d3c8b2]">
        <motion.span
          className={`block h-full rounded-full ${colorClass}`}
          initial={{ width: 0 }}
          animate={{ width }}
          transition={{ duration: 0.38, ease: [0.25, 0.1, 0.25, 1] }}
        />
      </span>
      <span className="text-right font-mono text-[0.6rem] font-bold text-[#675d4f]">{value}</span>
    </div>
  );
}

export function RightRail({
  actionStatus,
  activeStep,
  bootProgress,
  data,
  isBooting,
  state,
  visualFocus,
  onOpenRelationship,
  onOpenTimeline,
}: {
  actionStatus: string;
  activeStep: BootStepId;
  bootProgress: number;
  data: InvestigationData | null;
  isBooting: boolean;
  state?: PlayerCaseState;
  visualFocus: VisualFocusState;
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
      <aside className="flex h-full flex-col overflow-hidden border-l border-[#c8bda7] bg-[#f6f1e8]/96">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#d8cfba] bg-[#fbf8f0]/88 px-4">
          <span className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.16em] text-[#24615b]">案件状态</span>
          <span className="font-mono text-[0.56rem] text-[#8f8574]">生成中</span>
        </div>
        <div className="p-4">
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
      className="td-scrollbar flex h-full flex-col overflow-y-auto border-l border-[#c8bda7] bg-[#f6f1e8]/96 shadow-[inset_1px_0_0_rgba(255,255,255,0.5)]"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
    >
      <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-[#d8cfba] bg-[#fbf8f0]/90 px-4 backdrop-blur">
        <span className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.16em] text-[#24615b]">案件状态</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d8cfba] bg-[#fffdf7]/76 px-2 py-1 font-mono text-[0.55rem] text-[#8f8574]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#6fd5c7]" />
          live
        </span>
      </div>
      <div className="flex flex-col gap-4 p-4">
      {/* Truth gauge */}
      <div className="rounded-lg border border-[#d8cfba] bg-[#fffdf7]/62 p-3 shadow-[0_12px_34px_rgba(49,40,28,0.08)]">
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
          className="flex items-center justify-center gap-2 rounded-md border border-[#d6c9ae] bg-[#fffdf7]/42 py-2 font-mono text-[0.65rem] text-[#9d6d21] transition hover:bg-[#fffdf7]"
          onClick={onOpenRelationship}
          type="button"
        >
          <GitBranch size={13} />
          关系图
        </button>
        <button
          className="flex items-center justify-center gap-2 rounded-md border border-[#d6c9ae] bg-[#fffdf7]/42 py-2 font-mono text-[0.65rem] text-[#9d6d21] transition hover:bg-[#fffdf7]"
          onClick={onOpenTimeline}
          type="button"
        >
          <Clock3 size={13} />
          时间线
        </button>
      </div>

      {/* Suspects accordion */}
      <div className="rounded-lg border border-[#d8cfba] bg-[#fffdf7]/48 p-3">
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
                  return (
                    <SuspectStatusCard
                      key={suspect.id}
                      active={visualFocus?.mode === "suspect" && visualFocus.entityId === suspect.id}
                      asset={findVisualAsset(data.visualManifest, { kind: "suspect_portrait", entityId: suspect.id })}
                      name={suspect.name}
                      state={ss}
                    />
                  );
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
      </div>
    </motion.aside>
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

function SuspectStatusCard({
  active,
  asset,
  name,
  state,
}: {
  active: boolean;
  asset?: VisualAsset;
  name: string;
  state?: SuspectState;
}) {
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
        active ? "border-[#b86956] shadow-[0_12px_32px_rgba(166,78,59,0.16)]" : "",
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
        <motion.span animate={changed || active ? { scale: [1, 1.08, 1] } : { scale: 1 }} transition={{ duration: 0.32 }}>
          <VisualThumb asset={asset} className="h-10 w-10 rounded-md" />
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

type RelationshipItem = InvestigationData["visibleRelationships"][number];
type RelationshipNodeKind = "victim" | "suspect" | "witness" | "evidence" | "location" | "unknown";

type RelationshipNode = {
  id: string;
  kind: RelationshipNodeKind;
  label: string;
  subtitle: string;
  x: number;
  y: number;
  degree: number;
};

type RelationshipEdge = RelationshipItem & {
  path: string;
  labelX: number;
  labelY: number;
  source: RelationshipNode;
  target: RelationshipNode;
};

const relationshipStatusLabels: Record<RelationshipItem["status"], string> = {
  unknown: "未知",
  suspected: "疑似",
  conflict: "冲突",
  confirmed: "确认",
  excluded: "排除",
  key: "关键",
};

const relationshipTypeLabels: Record<RelationshipItem["type"], string> = {
  normal: "普通",
  conflict: "矛盾",
  hidden: "隐秘",
  time: "时间",
  evidence: "证据",
  misleading: "误导",
};

const relationshipKindLabels: Record<RelationshipNodeKind, string> = {
  victim: "当事人",
  suspect: "嫌疑人",
  witness: "证人",
  evidence: "证据",
  location: "地点",
  unknown: "关联",
};

const relationshipStatusTone: Record<
  RelationshipItem["status"],
  { border: string; fill: string; stroke: string; text: string; dash?: string }
> = {
  unknown: { border: "#d8cfba", fill: "#f4efe5", stroke: "#8f8574", text: "#675d4f", dash: "6 7" },
  suspected: { border: "#d6a247", fill: "#fff5db", stroke: "#9d6d21", text: "#7a5319", dash: "9 7" },
  conflict: { border: "#d0a092", fill: "#fff0ea", stroke: "#c5533d", text: "#9a3829" },
  confirmed: { border: "#b8d8d2", fill: "#e8f6f2", stroke: "#24615b", text: "#174844" },
  excluded: { border: "#c8bda7", fill: "#ede8dc", stroke: "#8f8574", text: "#5f564a", dash: "4 8" },
  key: { border: "#c5533d", fill: "#fff0ea", stroke: "#a64e3b", text: "#7f241c" },
};

const relationshipNodeTone: Record<RelationshipNodeKind, { border: string; fill: string; text: string; ring: string }> = {
  victim: { border: "#b86956", fill: "#fff0ea", text: "#8e3227", ring: "#c5533d" },
  suspect: { border: "#d6a247", fill: "#fff5db", text: "#7a5319", ring: "#d6a247" },
  witness: { border: "#b8d8d2", fill: "#e8f6f2", text: "#174844", ring: "#24615b" },
  evidence: { border: "#c8bda7", fill: "#fffdf7", text: "#675d4f", ring: "#8f8574" },
  location: { border: "#cdbf9e", fill: "#f8f3e8", text: "#675d4f", ring: "#9d6d21" },
  unknown: { border: "#d8cfba", fill: "#f4efe5", text: "#675d4f", ring: "#8f8574" },
};

function relationshipEntityKind(data: InvestigationData, entityId: string): RelationshipNodeKind {
  if (data.caseData.victim.id === entityId) return "victim";
  if (data.caseData.suspects.some((suspect) => suspect.id === entityId)) return "suspect";
  if (data.caseData.witnesses.some((witness) => witness.id === entityId)) return "witness";
  if (data.caseData.evidence.some((evidence) => evidence.id === entityId)) return "evidence";
  if (data.caseData.locations.some((location) => location.id === entityId)) return "location";
  return "unknown";
}

function relationshipEntitySubtitle(data: InvestigationData, entityId: string, kind: RelationshipNodeKind) {
  if (kind === "suspect") return data.caseData.suspects.find((suspect) => suspect.id === entityId)?.identity ?? "嫌疑人";
  if (kind === "victim") return data.caseData.victim.role || "当事人";
  if (kind === "witness") return data.caseData.witnesses.find((witness) => witness.id === entityId)?.role ?? "证人";
  if (kind === "evidence") {
    const evidence = data.caseData.evidence.find((item) => item.id === entityId);
    return evidence ? evidenceTypeLabels[evidence.type] ?? "证据" : "证据";
  }
  if (kind === "location") return data.caseData.locations.find((location) => location.id === entityId)?.kind ?? "地点";
  return "关联节点";
}

function nodeIcon(kind: RelationshipNodeKind) {
  if (kind === "evidence") return Fingerprint;
  if (kind === "location") return MapPin;
  if (kind === "unknown") return FileText;
  return UserRound;
}

function relationshipPairKey(rel: Pick<RelationshipItem, "from" | "to">) {
  return [rel.from, rel.to].sort().join("::");
}

function relationshipGeometry(
  source: RelationshipNode,
  target: RelationshipNode,
  pairIndex: number,
  pairTotal: number,
) {
  const x1 = source.x * 10;
  const y1 = source.y * 6.4;
  const x2 = target.x * 10;
  const y2 = target.y * 6.4;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.max(Math.hypot(dx, dy), 1);
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const duplicateOffset = pairTotal > 1 ? (pairIndex - (pairTotal - 1) / 2) * 56 : 0;
  const longCrossOffset = pairTotal === 1 && source.degree > 1 && target.degree > 1 ? 18 : 0;
  const offset = duplicateOffset || longCrossOffset;

  if (!offset) {
    return {
      path: `M ${x1} ${y1} L ${x2} ${y2}`,
      labelX: midX,
      labelY: midY,
    };
  }

  const controlX = midX + normalX * offset;
  const controlY = midY + normalY * offset;

  return {
    path: `M ${x1} ${y1} Q ${controlX} ${controlY} ${x2} ${y2}`,
    labelX: controlX,
    labelY: controlY,
  };
}

function buildRelationshipGraph(data: InvestigationData) {
  const personRelationships = data.visibleRelationships.filter((rel) => {
    const sourceKind = relationshipEntityKind(data, rel.from);
    const targetKind = relationshipEntityKind(data, rel.to);
    return rel.from !== rel.to && ["victim", "suspect", "witness"].includes(sourceKind) && ["victim", "suspect", "witness"].includes(targetKind);
  });
  const ids = new Set<string>();
  const degree = new Map<string, number>();

  personRelationships.forEach((rel) => {
    ids.add(rel.from);
    ids.add(rel.to);
    degree.set(rel.from, (degree.get(rel.from) ?? 0) + 1);
    degree.set(rel.to, (degree.get(rel.to) ?? 0) + 1);
  });

  const nodeIds = Array.from(ids);
  const hubId = [...nodeIds].sort((a, b) => {
    const degreeDelta = (degree.get(b) ?? 0) - (degree.get(a) ?? 0);
    if (degreeDelta !== 0) return degreeDelta;
    const aKind = relationshipEntityKind(data, a);
    const bKind = relationshipEntityKind(data, b);
    const rank: Record<RelationshipNodeKind, number> = {
      evidence: 5,
      victim: 4,
      suspect: 3,
      witness: 2,
      location: 1,
      unknown: 0,
    };
    return rank[bKind] - rank[aKind];
  })[0];
  const orderedIds = hubId
    ? [hubId, ...nodeIds.filter((id) => id !== hubId).sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))]
    : nodeIds;

  const nodes: RelationshipNode[] = orderedIds.map((id, index) => {
    const kind = relationshipEntityKind(data, id);
    const base = {
      id,
      kind,
      label: data.entityNameById.get(id) ?? id,
      subtitle: relationshipEntitySubtitle(data, id, kind),
      degree: degree.get(id) ?? 0,
    };

    if (orderedIds.length === 1) return { ...base, x: 50, y: 50 };
    if (orderedIds.length === 2) return { ...base, x: index === 0 ? 34 : 66, y: 50 };
    if (index === 0) return { ...base, x: 50, y: 50 };

    const ringCount = orderedIds.length - 1;
    const topologySlots = [
      { x: 50, y: 22 },
      { x: 78, y: 50 },
      { x: 50, y: 78 },
      { x: 22, y: 50 },
      { x: 72, y: 28 },
      { x: 72, y: 72 },
      { x: 28, y: 72 },
      { x: 28, y: 28 },
      { x: 87, y: 35 },
      { x: 87, y: 65 },
      { x: 13, y: 65 },
      { x: 13, y: 35 },
    ];
    const slot = topologySlots[index - 1];
    if (slot) return { ...base, ...slot };

    const angle = -Math.PI / 2 + ((index - 1) / ringCount) * Math.PI * 2;
    const radiusX = 38;
    const radiusY = 32;

    return {
      ...base,
      x: 50 + Math.cos(angle) * radiusX,
      y: 50 + Math.sin(angle) * radiusY,
    };
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const pairTotals = new Map<string, number>();
  const pairSeen = new Map<string, number>();

  personRelationships.forEach((rel) => {
    const key = relationshipPairKey(rel);
    pairTotals.set(key, (pairTotals.get(key) ?? 0) + 1);
  });

  const edges: RelationshipEdge[] = personRelationships
    .map((rel) => {
      const source = nodeById.get(rel.from);
      const target = nodeById.get(rel.to);
      if (!source || !target) return null;

      const key = relationshipPairKey(rel);
      const pairIndex = pairSeen.get(key) ?? 0;
      pairSeen.set(key, pairIndex + 1);
      const geometry = relationshipGeometry(source, target, pairIndex, pairTotals.get(key) ?? 1);

      return {
        ...rel,
        ...geometry,
        source,
        target,
      };
    })
    .filter((edge): edge is RelationshipEdge => Boolean(edge));

  return { nodes, edges };
}

function RelationshipGraphNode({
  data,
  node,
  index,
}: {
  data: InvestigationData;
  node: RelationshipNode;
  index: number;
}) {
  const tone = relationshipNodeTone[node.kind];
  const asset = findEntityVisual(data, node.id);
  const Icon = nodeIcon(node.kind);

  return (
    <motion.div
      className="absolute z-20 w-[7.5rem] -translate-x-1/2 -translate-y-1/2 sm:w-[8.25rem]"
      style={{ left: `${node.x}%`, top: `${node.y}%` }}
      initial={{ opacity: 0, scale: 0.92, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay: 0.08 + index * 0.04, duration: 0.22, ease: "easeOut" }}
    >
      <div
        className="relative overflow-hidden rounded-md border px-2.5 pb-2 pt-2 text-center shadow-[0_16px_34px_rgba(49,40,28,0.12)]"
        style={{ backgroundColor: tone.fill, borderColor: tone.border }}
      >
        <span className="absolute left-2 top-2 font-mono text-[0.52rem] font-bold uppercase text-[#8f8574]">
          {relationshipKindLabels[node.kind]}
        </span>
        <div className="mx-auto mt-2 grid h-11 w-11 place-items-center overflow-hidden rounded-full border-2 bg-[#fffdf7]" style={{ borderColor: tone.ring }}>
          {asset ? <VisualThumb asset={asset} className="h-full w-full rounded-full border-0" /> : <Icon size={20} style={{ color: tone.text }} />}
        </div>
        <p className="mt-2 line-clamp-1 text-sm font-black leading-5 text-[#27241f]">{node.label}</p>
        <p className="line-clamp-1 text-[0.62rem] leading-4" style={{ color: tone.text }}>
          {node.subtitle}
        </p>
      </div>
    </motion.div>
  );
}

function RelationshipGraph({
  data,
  edges,
  nodes,
}: {
  data: InvestigationData;
  edges: RelationshipEdge[];
  nodes: RelationshipNode[];
}) {
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null);
  const activeEdge = edges.find((edge) => edge.id === activeEdgeId) ?? null;

  return (
    <div className="td-scrollbar overflow-x-auto">
      <div
        className="relative min-w-[40rem] overflow-hidden rounded-lg border border-[#d8cfba] bg-[#f8f3e8] md:min-w-0"
        style={{ height: "min(38rem, calc(100dvh - 10rem))" }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,253,247,0.78),rgba(248,243,232,0.28)_38%,transparent_64%),linear-gradient(rgba(80,69,52,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(80,69,52,0.06)_1px,transparent_1px)] bg-[size:auto,40px_40px,40px_40px]" />
        <svg className="absolute inset-0 z-10 h-full w-full" viewBox="0 0 1000 640" aria-hidden="true">
          {edges.map((edge, index) => {
            const tone = relationshipStatusTone[edge.status];
            const active = edge.id === activeEdgeId;
            return (
              <g key={edge.id}>
                <motion.path
                  d={edge.path}
                  fill="none"
                  stroke={tone.stroke}
                  strokeLinecap="round"
                  strokeWidth={active ? 5 : edge.status === "key" ? 3.6 : 2.6}
                  vectorEffect="non-scaling-stroke"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: active ? 0.98 : edge.status === "excluded" ? 0.34 : 0.58 }}
                  transition={{ delay: index * 0.035 + 0.1, duration: 0.48, ease: "easeInOut" }}
                />
                <motion.path
                  d={edge.path}
                  fill="none"
                  stroke={tone.stroke}
                  strokeDasharray={active ? "10 12" : "2 18"}
                  strokeLinecap="round"
                  strokeWidth={active ? 4 : 3}
                  vectorEffect="non-scaling-stroke"
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: active ? 1 : 0.74,
                    strokeDashoffset: [0, -56],
                  }}
                  transition={{
                    opacity: { delay: index * 0.035 + 0.18, duration: 0.25 },
                    strokeDashoffset: { duration: active ? 0.8 : 1.35, ease: "linear", repeat: Infinity },
                  }}
                />
                <path
                  className="cursor-pointer"
                  d={edge.path}
                  fill="none"
                  pointerEvents="stroke"
                  stroke="transparent"
                  strokeLinecap="round"
                  strokeWidth={22}
                  onMouseEnter={() => setActiveEdgeId(edge.id)}
                  onMouseLeave={() => setActiveEdgeId((current) => (current === edge.id ? null : current))}
                />
              </g>
            );
          })}
          {nodes.map((node) => (
            <motion.circle
              key={node.id}
              cx={node.x * 10}
              cy={node.y * 6.4}
              r="5"
              fill={relationshipNodeTone[node.kind].ring}
              initial={{ opacity: 0, r: 3 }}
              animate={{ opacity: [0.42, 0.84, 0.42], r: [4, 7, 4] }}
              transition={{ delay: 0.2, duration: 1.8, repeat: Infinity, repeatDelay: 0.7 }}
            />
          ))}
        </svg>
        {nodes.map((node, index) => (
          <RelationshipGraphNode key={node.id} data={data} node={node} index={index} />
        ))}
        <AnimatePresence>
          {activeEdge && <RelationshipEdgeTooltip edge={activeEdge} />}
        </AnimatePresence>
      </div>
    </div>
  );
}

function RelationshipEdgeTooltip({ edge }: { edge: RelationshipEdge }) {
  const tone = relationshipStatusTone[edge.status];

  return (
    <motion.div
      className="pointer-events-none absolute z-30 w-[17rem] -translate-x-1/2 -translate-y-[calc(100%+0.75rem)] rounded-md border bg-[#fffdf7] p-3 shadow-[0_20px_46px_rgba(49,40,28,0.22)]"
      style={{
        borderColor: tone.border,
        left: `${Math.max(17, Math.min(83, edge.labelX / 10))}%`,
        top: `${Math.max(24, Math.min(86, edge.labelY / 6.4))}%`,
      }}
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="line-clamp-1 text-xs font-black text-[#27241f]">
            {edge.source.label} 与 {edge.target.label}
          </p>
          <p className="mt-0.5 font-mono text-[0.55rem] uppercase tracking-[0.12em]" style={{ color: tone.text }}>
            {relationshipStatusLabels[edge.status]} / {relationshipTypeLabels[edge.type]}
          </p>
        </div>
        <span
          className="shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[0.54rem] font-bold"
          style={{ backgroundColor: tone.fill, borderColor: tone.border, color: tone.text }}
        >
          {relationshipStatusLabels[edge.status]}
        </span>
      </div>
      <p className="text-xs leading-5 text-[#4f483d]">{edge.label}</p>
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
  const graph = buildRelationshipGraph(data);

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-[#27241f]/35 p-3 backdrop-blur sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClose}
    >
      <motion.div
        className="grid max-h-[calc(100dvh-1.5rem)] w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-[#cfa65b] bg-[#fffdf7] shadow-[0_24px_90px_rgba(49,40,28,0.22)]"
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#d8cfba] bg-[#fbf8f0] px-4 py-3 sm:px-5">
          <div>
            <p className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.16em] text-[#24615b]">relationship map</p>
            <h3 className="mt-1 text-lg font-black leading-tight text-[#27241f]">人物关系图</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-sm border border-[#d8cfba] bg-[#fffdf7] px-2 py-1 font-mono text-[0.58rem] text-[#8f8574] sm:inline-flex">
              {graph.nodes.length} 节点 / {graph.edges.length} 关系
            </span>
            <button className="grid h-8 w-8 place-items-center rounded-md text-[#8b8171] hover:bg-[#f4efe5] hover:text-[#9d6d21]" onClick={onClose} type="button">
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="td-scrollbar min-h-0 overflow-y-auto p-4 sm:p-5">
          {graph.edges.length ? (
            <div className="grid gap-4">
              <RelationshipGraph data={data} edges={graph.edges} nodes={graph.nodes} />
            </div>
          ) : (
            <div className="grid min-h-56 place-items-center rounded-lg border border-dashed border-[#d6c9ae] bg-[#f8f3e8] p-8 text-center">
              <div>
                <GitBranch className="mx-auto text-[#9d6d21]" size={24} />
                <p className="mt-3 text-sm text-[#776f61]">人物关系尚未形成。需要先让 AI 基于已知事件梳理人物之间的关系。</p>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

export function TimelineModal({
  data,
  state,
  onClose,
}: {
  data: InvestigationData;
  state: PlayerCaseState;
  onClose: () => void;
}) {
  const timelineEvents = sortTimelineEvents(state.playerTimeline);

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
          {timelineEvents.length ? (
            <ol className="grid gap-3">
              {timelineEvents.map((event, index) => (
                <motion.li
                  key={event.id}
                  className="grid grid-cols-[3.5rem_3rem_1fr] items-start gap-3"
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
                  <VisualThumb asset={findEntityVisual(data, event.source)} className="h-12 w-12 rounded-md" />
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
