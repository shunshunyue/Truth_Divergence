import { ArrowRight } from "lucide-react";
import type { SessionPayload } from "@/components/investigation/types";

export function BriefingScreen({ session, onClose }: { session: SessionPayload; onClose: () => void }) {
  const firstLocation = session.caseData.locations[0];
  const firstClues = firstLocation?.objects.slice(0, 3) ?? [];

  return (
    <div className="td-scrollbar relative h-full min-h-0 overflow-y-auto bg-[#ede8dc] text-[#27241f]">
      <div className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(39,36,31,0.75)_1px,transparent_1px),linear-gradient(90deg,rgba(39,36,31,0.75)_1px,transparent_1px)] [background-size:30px_30px] opacity-[0.06]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[linear-gradient(180deg,rgba(111,213,199,0.16),transparent)]" />

      <section className="relative mx-auto grid min-h-full w-full max-w-5xl content-center gap-5 px-4 py-8 md:px-8">
        <div className="border-b border-[#d8cfba] pb-4">
          <p className="font-mono text-xs text-[#24615b]">生成完毕</p>
          <h1 className="mt-2 font-display text-4xl font-black leading-none text-[#27241f] md:text-6xl">
            {session.caseData.title}
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-[#625a4d]">{session.caseData.openingEvent.brief}</p>
        </div>

        <div className="grid gap-3 md:grid-cols-[0.85fr_1.15fr]">
          <div className="border border-[#b8d8d2] bg-[#eff8f5] p-4 shadow-[0_14px_42px_rgba(36,97,91,0.08)]">
            <p className="font-mono text-xs text-[#24615b]">初始地点</p>
            <p className="mt-3 text-base font-semibold text-[#27241f]">{firstLocation?.name}</p>
          </div>
          <div className="border border-[#d8cfba] bg-[#fff5db] p-4 shadow-[0_14px_42px_rgba(157,109,33,0.08)]">
            <p className="font-mono text-xs text-[#9d6d21]">初始目标</p>
            <p className="mt-3 text-sm font-semibold leading-6 text-[#27241f]">{session.caseData.openingEvent.initialPrompt}</p>
          </div>
        </div>

        <div className="border border-[#ded4c0] bg-[#f4efe5] p-4 shadow-[0_14px_42px_rgba(49,40,28,0.08)]">
          <p className="font-mono text-xs text-[#8f8574]">第一批可调查线索</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {firstClues.map((clue) => (
              <span key={clue.id} className="border border-[#b8d8d2] bg-[#e8f6f2] px-2 py-1 text-xs text-[#24615b]">
                {clue.name}
              </span>
            ))}
          </div>
        </div>

        <button
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg border border-[#143b37] bg-[#163c3a] px-4 font-mono text-xs font-bold text-[#eafffb] shadow-[0_16px_36px_rgba(20,59,55,0.18)] transition hover:bg-[#24615b]"
          onClick={onClose}
          type="button"
        >
          进入调查
          <ArrowRight size={15} />
        </button>
      </section>
    </div>
  );
}
