"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

type StartInvestigationButtonProps = {
  coverSrc: string;
};

export function StartInvestigationButton(_props: StartInvestigationButtonProps) {
  const router = useRouter();

  useEffect(() => {
    router.prefetch("/play");
  }, [router]);

  function startInvestigation() {
    router.push("/play");
  }

  return (
    <button
      className="group relative inline-flex min-h-14 w-fit items-center gap-3 overflow-hidden border border-[#143b37] bg-[#163c3a] px-6 font-mono text-xs font-bold text-[#eafffb] shadow-[0_18px_44px_rgba(22,60,58,0.25)] transition hover:bg-[#24615b]"
      onClick={startInvestigation}
      type="button"
    >
      <span className="absolute inset-y-0 left-0 w-10 -translate-x-12 skew-x-[-18deg] bg-[#e7f05f]/18 transition-transform duration-500 group-hover:translate-x-48" />
      <span className="relative">开始处理今天的事</span>
      <ArrowRight className="relative transition group-hover:translate-x-1" size={17} />
    </button>
  );
}
