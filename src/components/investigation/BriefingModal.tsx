import { ArrowRight } from "lucide-react";
import type { SessionPayload } from "@/components/investigation/types";

export function BriefingModal({ session, onClose }: { session: SessionPayload; onClose: () => void }) {
  const firstLocation = session.caseData.locations[0];
  const firstClues = firstLocation?.objects.slice(0, 3) ?? [];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#27241f]/35 p-4 backdrop-blur">
      <section className="w-full max-w-2xl rounded-xl border border-[#d8cfba] bg-[#fffdf7] p-5 shadow-[0_18px_60px_rgba(49,40,28,0.2)]">
        <p className="font-mono text-xs text-[#24615b]">生成完毕</p>
        <h2 className="mt-2 font-display text-4xl font-black leading-none text-[#27241f]">{session.caseData.title}</h2>
        <p className="mt-4 text-sm leading-6 text-[#625a4d]">{session.caseData.openingEvent.brief}</p>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="border border-[#b8d8d2] bg-[#eff8f5] p-3">
            <p className="font-mono text-xs text-[#24615b]">初始地点</p>
            <p className="mt-2 text-sm font-semibold text-[#27241f]">{firstLocation?.name}</p>
          </div>
          <div className="border border-[#d8cfba] bg-[#fff5db] p-3">
            <p className="font-mono text-xs text-[#9d6d21]">初始目标</p>
            <p className="mt-2 text-sm font-semibold text-[#27241f]">{session.caseData.openingEvent.initialPrompt}</p>
          </div>
        </div>
        <div className="mt-4 border border-[#ded4c0] bg-[#f4efe5] p-3">
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
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#143b37] bg-[#163c3a] px-4 font-mono text-xs font-bold text-[#eafffb] transition hover:bg-[#24615b]"
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
