import Link from "next/link";
import { ArrowRight, ScanLine } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-void text-[#ece7dc]">
      <section className="grid min-h-screen grid-cols-1 lg:grid-cols-[minmax(0,1fr)_30rem]">
        <div className="flex flex-col justify-center border-brass/20 px-6 py-10 md:px-12 lg:border-r">
          <p className="font-mono text-xs text-brass">偏差调查局 / 案件接入</p>
          <h1 className="mt-5 font-display text-6xl font-black leading-[0.92] text-[#fff8df] md:text-8xl">
            真相偏差
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-[#c9c0ad]">
            进入后，AI 会生成本局案件的背景、事件和第一批可疑线索。你不选择案件，只负责调查。
          </p>

          <Link
            className="mt-10 inline-flex min-h-12 w-fit items-center gap-3 border border-brass/60 bg-brass px-5 font-mono text-xs font-bold text-black transition hover:bg-signal"
            href="/play"
          >
            开始调查
            <ArrowRight size={16} />
          </Link>
        </div>

        <aside className="relative min-h-[24rem] border-t border-brass/20 bg-panel/50 p-6 lg:border-t-0">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(111,213,199,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(111,213,199,0.05)_1px,transparent_1px)] bg-[length:28px_28px]" />
          <div className="relative grid h-full content-center">
            <div className="border border-scan/20 bg-black/40 p-5 shadow-terminal">
              <div className="mb-5 flex items-center justify-between font-mono text-xs text-scan">
                <span>等待案件生成</span>
                <ScanLine size={16} />
              </div>
              <div className="grid gap-3">
                <div className="h-3 w-2/3 bg-scan/25" />
                <div className="h-3 w-5/6 bg-brass/25" />
                <div className="h-3 w-1/2 bg-rust/25" />
                <div className="mt-6 border border-white/10 bg-void/80 p-4">
                  <p className="font-mono text-xs text-[#8f8574]">CASE SEED</p>
                  <p className="mt-2 text-sm leading-6 text-[#d8d0bd]">
                    案件不是预置列表，而是在开局时由 AI 与规则层共同生成。
                  </p>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
