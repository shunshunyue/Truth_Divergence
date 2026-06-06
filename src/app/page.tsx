import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { ArrowRight, FileSearch, Fingerprint, ScanLine, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const caseSignals = [
  { label: "门禁", value: "01:36 补录" },
  { label: "监控", value: "七分钟黑屏" },
  { label: "账册", value: "水渍封页" },
];

function getRandomCaseCover() {
  const casesRoot = path.join(process.cwd(), "public", "generated", "cases");
  const fallbackCover = "/generated/workspace-preview.png";

  if (!existsSync(casesRoot)) {
    return fallbackCover;
  }

  const covers = readdirSync(casesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const coverDir = path.join(casesRoot, entry.name, "case_cover");

      if (!existsSync(coverDir)) {
        return [];
      }

      return readdirSync(coverDir, { withFileTypes: true })
        .filter((file) => file.isFile() && /^session-case\.(png|jpe?g|webp|svg)$/i.test(file.name))
        .map((file) => `/generated/cases/${entry.name}/case_cover/${file.name}`);
    });

  return covers.length > 0 ? covers[Math.floor(Math.random() * covers.length)] : fallbackCover;
}

export default function Home() {
  const coverSrc = getRandomCaseCover();

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#ebe4d6] text-[#27241f]">
      <img
        alt="随机案件现场"
        className="absolute inset-0 h-full w-full object-cover object-[64%_center]"
        src={coverSrc}
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(244,239,229,0.98)_0%,rgba(244,239,229,0.9)_35%,rgba(244,239,229,0.44)_62%,rgba(39,36,31,0.26)_100%),linear-gradient(180deg,rgba(244,239,229,0.18)_0%,rgba(244,239,229,0.08)_44%,rgba(39,36,31,0.66)_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(47,42,34,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(47,42,34,0.045)_1px,transparent_1px)] bg-[length:36px_36px]" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-40 w-full bg-[linear-gradient(0deg,rgba(39,36,31,0.5),transparent)]" />

      <section className="relative z-10 mx-auto flex min-h-screen max-w-[1680px] flex-col px-5 py-5 sm:px-8 lg:px-10 lg:py-8">
        <header className="td-home-rise flex items-start justify-between gap-4">
          <div className="inline-flex items-center gap-2 border border-[#cdbf9e] bg-[#fffdf7]/78 px-3 py-2 text-xs font-bold text-[#24615b] shadow-[0_14px_40px_rgba(49,40,28,0.12)] backdrop-blur-sm">
            <Sparkles size={14} />
            AI 案件值班中
          </div>

          <div className="hidden items-center gap-3 border border-[#fffdf7]/64 bg-[#27241f]/28 px-3 py-2 text-[#fffdf7] shadow-[0_16px_46px_rgba(39,36,31,0.18)] backdrop-blur-md md:flex">
            <FileSearch size={14} />
            <span className="font-mono text-[0.65rem] font-bold uppercase">sample case</span>
          </div>
        </header>

        <div className="td-home-rise td-home-rise-delay flex flex-1 items-center py-12 sm:py-16 lg:py-8">
          <div className="max-w-[58rem]">
            <p className="font-mono text-xs font-bold uppercase text-[#9d6d21]">
              雾港冻库停电案
            </p>
            <h1 className="mt-4 max-w-[54rem] font-display text-7xl font-black leading-[0.86] text-[#27241f] md:text-8xl xl:text-[9rem]">
              今天事真多
            </h1>
            <p className="mt-6 max-w-3xl text-2xl font-black leading-tight text-[#27241f] md:text-4xl">
              十分钟黑暗里，谁补了一条门禁？
            </p>
            <p className="mt-5 max-w-xl text-base font-semibold leading-7 text-[#4f483d] md:text-lg">
              你开口追问，AI 把口供、证据和矛盾推到台前。
            </p>
          </div>
        </div>

        <div className="td-home-rise td-home-rise-final grid gap-4 pb-2 lg:grid-cols-[auto_minmax(20rem,1fr)] lg:items-end">
          <Link
            className="group inline-flex min-h-14 w-fit items-center gap-3 border border-[#143b37] bg-[#163c3a] px-6 font-mono text-xs font-bold text-[#eafffb] shadow-[0_18px_44px_rgba(22,60,58,0.25)] transition hover:bg-[#24615b]"
            href="/play"
          >
            开始处理今天的事
            <ArrowRight className="transition group-hover:translate-x-1" size={17} />
          </Link>

          <div className="flex flex-wrap items-center gap-2 text-[#fffdf7] lg:justify-end">
            {caseSignals.map((item, index) => (
              <div
                key={item.label}
                className="td-home-signal flex min-h-12 items-center gap-2 border border-[#fffdf7]/58 bg-[#27241f]/34 px-3 shadow-[0_12px_34px_rgba(39,36,31,0.18)] backdrop-blur-md"
                style={{ animationDelay: `${360 + index * 90}ms` }}
              >
                {index === 0 ? <Fingerprint size={14} /> : <ScanLine size={14} />}
                <span className="font-mono text-[0.62rem] text-[#fffdf7]/62">{item.label}</span>
                <span className="text-xs font-bold text-[#fffdf7]">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
