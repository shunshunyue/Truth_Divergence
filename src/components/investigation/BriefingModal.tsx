"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { SessionPayload } from "@/components/investigation/types";
import { findVisualAsset, visualUrl } from "@/components/investigation/visualAssets";

export function BriefingScreen({
  session,
  onClose,
}: {
  session: SessionPayload;
  onClose: () => boolean | void | Promise<boolean | void>;
}) {
  const firstLocation = session.caseData.locations[0];
  const firstClues = firstLocation?.objects.slice(0, 3) ?? [];
  const coverAsset = findVisualAsset(session.visualManifest, { kind: "case_cover", entityId: session.caseData.id });
  const coverUrl = visualUrl(coverAsset);
  const titleLetters = Array.from(session.caseData.title);
  const briefLines = session.caseData.openingEvent.brief.match(/[^。！？]+[。！？]?/g) ?? [session.caseData.openingEvent.brief];
  const [stamping, setStamping] = useState(false);
  const enterTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (enterTimerRef.current) window.clearTimeout(enterTimerRef.current);
    };
  }, []);

  function stampAndEnter() {
    if (stamping) return;
    setStamping(true);
    enterTimerRef.current = window.setTimeout(() => {
      void Promise.resolve(onClose())
        .then((entered) => {
          if (entered === false) setStamping(false);
        })
        .catch(() => setStamping(false));
    }, 980);
  }

  return (
    <div className={`td-scrollbar td-briefing-stage relative h-full min-h-0 overflow-y-auto bg-[#e9e2d2] text-[#27241f] ${stamping ? "td-briefing-stamping" : ""}`}>
      {coverUrl && (
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          src={coverUrl}
        />
      )}
      {!coverUrl && (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_42%,rgba(111,213,199,0.2),transparent_24rem),linear-gradient(135deg,#ece6d7,#d9cfb9)]" />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(237,232,220,0.98)_0%,rgba(237,232,220,0.94)_31%,rgba(237,232,220,0.64)_48%,rgba(237,232,220,0.12)_72%,rgba(237,232,220,0.04)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-[linear-gradient(0deg,rgba(237,232,220,0.88),transparent)]" />
      <div className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(39,36,31,0.48)_1px,transparent_1px),linear-gradient(90deg,rgba(39,36,31,0.48)_1px,transparent_1px)] [background-size:32px_32px] opacity-[0.045]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[linear-gradient(180deg,rgba(111,213,199,0.18),transparent)]" />
      <div className="td-briefing-scanbeam pointer-events-none absolute inset-0" />

      <section className="relative z-10 grid min-h-full w-full content-center px-5 py-8 md:px-10 lg:px-20">
        <div aria-hidden="true" className="td-briefing-stamp">
          <span className="td-briefing-stamp-ring">
            <span className="td-briefing-stamp-small">TRUTH DIVERGENCE</span>
            <span className="td-briefing-stamp-main">准予调查</span>
            <span className="td-briefing-stamp-code">CASE OPENED</span>
          </span>
        </div>

        <div className="td-briefing-content max-w-3xl">
          <p className="td-briefing-kicker font-mono text-xs text-[#24615b]">
            生成完毕
            <span aria-hidden="true" className="td-briefing-kicker-cursor" />
          </p>
          <h1
            aria-label={session.caseData.title}
            className="td-briefing-title mt-4 max-w-2xl py-2 font-display text-5xl font-black leading-none text-[#27241f] md:text-7xl"
            data-title={session.caseData.title}
          >
            {titleLetters.map((char, index) => (
              <span
                aria-hidden="true"
                className="td-briefing-title-char"
                key={`${char}-${index}`}
                style={{ animationDelay: `${110 + index * 34}ms, ${1180 + index * 86}ms` }}
              >
                {char === " " ? "\u00A0" : char}
              </span>
            ))}
          </h1>
          <p className="td-briefing-copy mt-6 max-w-2xl text-sm leading-7 text-[#5f574a] md:text-base md:leading-8">
            {briefLines.map((line, index) => (
              <span
                className="td-briefing-copy-line"
                key={`${line}-${index}`}
                style={{ animationDelay: `${360 + index * 150}ms` }}
              >
                {line}
              </span>
            ))}
          </p>

          <div className="mt-9 grid max-w-3xl gap-3 md:grid-cols-[0.8fr_1.2fr]">
            <div
              className="td-briefing-panel border border-[#b8d8d2]/80 bg-[#edf8f5]/78 p-4 shadow-[0_18px_60px_rgba(36,97,91,0.1)] backdrop-blur-sm"
              style={{ animationDelay: "300ms" }}
            >
              <p className="font-mono text-xs text-[#24615b]">初始地点</p>
              <p className="td-briefing-panel-value mt-3 text-base font-black text-[#27241f]">{firstLocation?.name}</p>
            </div>
            <div
              className="td-briefing-panel border border-[#d8cfba]/90 bg-[#fff5db]/76 p-4 shadow-[0_18px_60px_rgba(157,109,33,0.1)] backdrop-blur-sm"
              style={{ animationDelay: "390ms" }}
            >
              <p className="font-mono text-xs text-[#9d6d21]">初始目标</p>
              <p className="td-briefing-panel-value mt-3 text-sm font-semibold leading-6 text-[#27241f]">
                {session.caseData.openingEvent.initialPrompt}
              </p>
            </div>
          </div>

          <div
            className="td-briefing-panel mt-4 max-w-3xl border border-[#ded4c0]/90 bg-[#f4efe5]/70 p-4 shadow-[0_14px_42px_rgba(49,40,28,0.08)] backdrop-blur-sm"
            style={{ animationDelay: "480ms" }}
          >
            <p className="font-mono text-xs text-[#8f8574]">第一批可调查线索</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {firstClues.map((clue, index) => (
                <span
                  key={clue.id}
                  className="td-briefing-chip border border-[#b8d8d2] bg-[#e8f6f2]/82 px-2 py-1 text-xs text-[#24615b]"
                  style={{ animationDelay: `${620 + index * 90}ms` }}
                >
                  {clue.name}
                </span>
              ))}
            </div>
          </div>

          <button
            className="td-briefing-enter td-scanline mt-7 inline-flex min-h-12 w-fit items-center gap-2 overflow-hidden rounded-lg border border-[#143b37] bg-[#163c3a] px-5 font-mono text-xs font-bold text-[#eafffb] shadow-[0_18px_42px_rgba(20,59,55,0.22)] transition hover:bg-[#24615b]"
            disabled={stamping}
            onClick={stampAndEnter}
            type="button"
          >
            {stamping ? "准予调查" : "进入调查"}
            <ArrowRight size={15} />
          </button>
        </div>
      </section>
    </div>
  );
}
