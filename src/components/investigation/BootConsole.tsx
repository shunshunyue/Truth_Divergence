import { CheckCircle2, FileText, Gauge, Loader2, Map, MessageSquareText, Radar, Search, Sparkles } from "lucide-react";
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
  progress,
  status,
}: {
  activeStep: BootStepId;
  error: string;
  progress: number;
  status: string;
}) {
  const activeIndex = bootSteps.findIndex((step) => step.id === activeStep);

  return (
    <div className="min-h-[36rem] rounded-xl border border-[#d8cfba] bg-[#fffdf7]/90 p-5 shadow-[0_18px_60px_rgba(49,40,28,0.14)]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-[#24615b]">初始化操作台</p>
          <h2 className="mt-2 font-display text-4xl font-black leading-none text-[#27241f]">案件正在接入</h2>
        </div>
        <Loader2 className="animate-spin text-[#24615b]" size={22} />
      </div>

      <div className="mt-6 h-2 bg-[#d8cfba]">
        <div className="h-full bg-[#24615b] transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-3 text-sm leading-6 text-[#625a4d]">{error || status}</p>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {bootSteps.map((step, index) => {
          const done = index < activeIndex || progress === 100;
          const active = step.id === activeStep && progress < 100;
          const Icon = bootIcons[step.id];
          return (
            <div
              key={step.id}
              className={[
                "grid min-h-36 content-between border p-4 transition",
                done
                  ? "border-[#9d6d21]/40 bg-[#fff5db]"
                  : active
                    ? "border-[#24615b]/45 bg-[#e8f6f2]"
                    : "border-[#ded4c0] bg-[#f4efe5] opacity-65",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <Icon className={done ? "text-[#9d6d21]" : active ? "text-[#24615b]" : "text-[#81796b]"} size={24} />
                {done ? <CheckCircle2 size={16} className="text-[#9d6d21]" /> : active ? <Sparkles size={16} className="text-[#24615b]" /> : null}
              </div>
              <div>
                <p className="font-mono text-xs text-[#9d6d21]">{step.title}</p>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#a99f8d]">{step.text}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
