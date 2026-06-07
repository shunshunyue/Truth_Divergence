import { CheckCircle2, FileText, Gauge, Loader2, Map, MessageSquareText, Radar, Search, Sparkles, X } from "lucide-react";
import { motion } from "framer-motion";
import { bootSteps, type BootStepId } from "@/components/investigation/types";

const bootIcons = {
  core: FileText,
  scene: Map,
  clues: Search,
  evidence: Radar,
  agent: Gauge,
  chat: MessageSquareText,
};

export function BootConsole({
  activeStep,
  error,
  onCancel,
  progress,
  status,
}: {
  activeStep: BootStepId;
  error: string;
  onCancel?: () => void;
  progress: number;
  status: string;
}) {
  const activeIndex = bootSteps.findIndex((step) => step.id === activeStep);

  return (
    <motion.div
      className="min-h-[36rem] rounded-xl border border-[#d8cfba] bg-[#fffdf7]/90 p-5 shadow-[0_18px_60px_rgba(49,40,28,0.14)]"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-[#24615b]">初始化操作台</p>
          <h2 className="mt-2 font-display text-4xl font-black leading-none text-[#27241f]">案件正在接入</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onCancel && (
            <button
              aria-label="取消接入并返回首页"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#d8cfba] bg-[#fffdf7]/78 px-3 font-mono text-xs font-bold text-[#675d4f] shadow-sm transition hover:border-[#a64e3b] hover:bg-[#fff0ea] hover:text-[#a64e3b]"
              onClick={onCancel}
              type="button"
            >
              <X size={14} />
              <span className="hidden sm:inline">取消接入</span>
            </button>
          )}
          <motion.span animate={{ rotate: 360 }} transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}>
            <Loader2 className="text-[#24615b]" size={22} />
          </motion.span>
        </div>
      </div>

      <div className="td-scanline mt-6 h-2 bg-[#d8cfba]">
        <motion.div
          className="h-full bg-[#24615b]"
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>
      <p className="mt-3 text-sm leading-6 text-[#625a4d]">{error || status}</p>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {bootSteps.map((step, index) => {
          const done = index < activeIndex || progress === 100;
          const active = step.id === activeStep && progress < 100;
          const Icon = bootIcons[step.id];
          return (
            <motion.div
              key={step.id}
              className={[
                "grid min-h-36 content-between border p-4 transition",
                active ? "td-scanline" : "",
                done
                  ? "border-[#9d6d21]/40 bg-[#fff5db]"
                  : active
                    ? "border-[#24615b]/45 bg-[#e8f6f2]"
                    : "border-[#ded4c0] bg-[#f4efe5] opacity-65",
              ].join(" ")}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.045, duration: 0.22 }}
            >
              <div className="flex items-start justify-between gap-3">
                <Icon className={done ? "text-[#9d6d21]" : active ? "text-[#24615b]" : "text-[#81796b]"} size={24} />
                {done ? (
                  <motion.span initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                    <CheckCircle2 size={16} className="text-[#9d6d21]" />
                  </motion.span>
                ) : active ? (
                  <motion.span animate={{ scale: [1, 1.18, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                    <Sparkles size={16} className="text-[#24615b]" />
                  </motion.span>
                ) : null}
              </div>
              <div>
                <p className="font-mono text-xs text-[#9d6d21]">{step.title}</p>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#a99f8d]">{step.text}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
