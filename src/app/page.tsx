import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { FileSearch, Fingerprint, ScanLine, Sparkles } from "lucide-react";
import { StartInvestigationButton } from "@/components/home/StartInvestigationButton";
import { listHomeHeroCases } from "@/game/cache/caseCache";
import {
  homeHeroSidecarSchema,
  normalizeHomeHeroCopy,
  pickFallbackHomeHeroCopy,
  pickFallbackHomeHeroCopyForHints,
  type HomeHeroCopy,
} from "@/game/homeHero";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HomeHeroBundle = {
  coverSrc: string;
  heroCopy: HomeHeroCopy;
};

function getLocalHomeHeroBundle(): HomeHeroBundle {
  const casesRoot = path.join(process.cwd(), "public", "generated", "cases");
  const fallbackCover = "/generated/workspace-preview.png";

  if (!existsSync(casesRoot)) {
    return {
      coverSrc: fallbackCover,
      heroCopy: pickFallbackHomeHeroCopy(fallbackCover),
    };
  }

  const bundles = readdirSync(casesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const caseDir = path.join(casesRoot, entry.name);
      const coverDir = path.join(casesRoot, entry.name, "case_cover");

      if (!existsSync(coverDir)) {
        return [];
      }

      return readdirSync(coverDir, { withFileTypes: true })
        .filter((file) => file.isFile() && /^session-case\.(png|jpe?g|webp|svg)$/i.test(file.name))
        .map((file) => {
          const coverSrc = `/generated/cases/${entry.name}/case_cover/${file.name}`;
          const sidecar = readHomeHeroSidecar(path.join(caseDir, "home-hero.json"), coverSrc);
          const hints = getCaseDirectoryHints(caseDir);

          return {
            coverSrc,
            heroCopy: sidecar ?? pickFallbackHomeHeroCopyForHints(hints, entry.name),
          };
        });
    });

  return bundles.length > 0
    ? bundles[Math.floor(Math.random() * bundles.length)]
    : {
        coverSrc: fallbackCover,
        heroCopy: pickFallbackHomeHeroCopy(fallbackCover),
      };
}

function getCaseDirectoryHints(caseDir: string) {
  const hints = [path.basename(caseDir)];

  try {
    for (const entry of readdirSync(caseDir, { withFileTypes: true })) {
      hints.push(entry.name);
      if (!entry.isDirectory()) continue;

      const nestedDir = path.join(caseDir, entry.name);
      for (const file of readdirSync(nestedDir, { withFileTypes: true })) {
        if (file.isFile()) hints.push(file.name);
      }
    }
  } catch {
    return hints;
  }

  return hints;
}

function readHomeHeroSidecar(filePath: string, coverSrc: string) {
  if (!existsSync(filePath)) return null;

  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    const parsed = homeHeroSidecarSchema.omit({ homeHero: true }).parse(raw);
    if (parsed.coverSrc && parsed.coverSrc !== coverSrc) return null;
    return normalizeHomeHeroCopy(raw.homeHero, raw.caseData ?? {
      id: parsed.caseId,
      title: parsed.caseTitle,
      theme: parsed.caseTitle,
      difficulty: "待核验",
      openingEvent: { headline: parsed.caseTitle, brief: parsed.caseTitle, initialPrompt: parsed.caseTitle },
      victim: { id: "victim-home", name: parsed.caseTitle, role: "关键当事人", description: parsed.caseTitle },
      suspects: [],
      witnesses: [],
      locations: [],
      evidence: [],
      timeline: [],
      relationships: [],
      truth: {
        killer: "",
        motive: "",
        method: "",
        deathTime: "",
        keyTimeline: [],
        keyEvidence: [],
        falseLeads: [],
        hiddenRelationships: [],
        exclusionReasons: {},
      },
      scoringRules: { killer: 25, motive: 15, method: 15, timeline: 15, keyEvidence: 10, exclusions: 10, relationships: 5, clarity: 5 },
    });
  } catch {
    return null;
  }
}

async function getHomeHeroBundle(): Promise<HomeHeroBundle> {
  try {
    const records = await listHomeHeroCases();
    const bundles = records.flatMap((record) => {
      const cover = record.visualManifest?.assets.find(
        (asset) => asset.kind === "case_cover" && asset.status === "ready" && asset.fileUrl,
      );

      return cover?.fileUrl ? [{ coverSrc: cover.fileUrl, heroCopy: record.homeHero }] : [];
    });

    if (bundles.length > 0) {
      return bundles[Math.floor(Math.random() * bundles.length)];
    }
  } catch {
    // 首页不能因为数据库临时不可用而白屏，缓存不可读时直接走本地兜底。
  }

  return getLocalHomeHeroBundle();
}

export default async function Home() {
  const { coverSrc, heroCopy } = await getHomeHeroBundle();

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
            <p className="td-home-kicker font-mono text-xs font-bold uppercase text-[#9d6d21]">
              {heroCopy.caseName}
            </p>
            <h1
              aria-label={heroCopy.headline}
              className="td-home-headline mt-4 max-w-[54rem] font-display text-7xl font-black leading-[0.86] text-[#27241f] md:text-8xl xl:text-[9rem]"
            >
              {Array.from(heroCopy.headline).map((char, index) => (
                <span
                  aria-hidden="true"
                  className="td-home-letter"
                  key={`${char}-${index}`}
                  style={{ animationDelay: `${index * 46}ms, ${1400 + index * 120}ms` }}
                >
                  {char}
                </span>
              ))}
            </h1>
            <p className="td-home-prompt mt-6 max-w-2xl text-2xl font-black leading-tight text-[#27241f] md:text-3xl">
              {heroCopy.prompt}
            </p>
            <p className="td-home-note mt-4 max-w-md text-sm font-semibold leading-6 text-[#4f483d] md:text-base">
              {heroCopy.note}
            </p>
          </div>
        </div>

        <div className="td-home-rise td-home-rise-final grid gap-4 pb-2 lg:grid-cols-[auto_minmax(20rem,1fr)] lg:items-end">
          <StartInvestigationButton coverSrc={coverSrc} />

          <div className="flex flex-wrap items-center gap-2 text-[#fffdf7] lg:justify-end">
            {heroCopy.signals.map((item, index) => (
              <div
                key={item.label}
                className="td-home-signal flex min-h-12 w-full max-w-[15rem] items-center gap-2 border border-[#fffdf7]/58 bg-[#27241f]/34 px-3 shadow-[0_12px_34px_rgba(39,36,31,0.18)] backdrop-blur-md sm:w-auto"
                style={{ animationDelay: `${360 + index * 90}ms` }}
              >
                {index === 0 ? <Fingerprint size={14} /> : <ScanLine size={14} />}
                <span className="shrink-0 font-mono text-[0.62rem] text-[#fffdf7]/62">{item.label}</span>
                <span className="min-w-0 truncate text-xs font-bold text-[#fffdf7]">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
