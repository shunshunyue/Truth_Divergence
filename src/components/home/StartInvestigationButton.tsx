"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, FileSearch, ScanLine } from "lucide-react";

type StartInvestigationButtonProps = {
  coverSrc: string;
};

export function StartInvestigationButton({ coverSrc }: StartInvestigationButtonProps) {
  const router = useRouter();
  const [isEntering, setIsEntering] = useState(false);

  useEffect(() => {
    router.prefetch("/play");
  }, [router]);

  function startInvestigation() {
    if (isEntering) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setIsEntering(true);
    window.setTimeout(() => {
      router.push("/play");
    }, reduceMotion ? 120 : 1050);
  }

  return (
    <>
      <button
        className="group relative inline-flex min-h-14 w-fit items-center gap-3 overflow-hidden border border-[#143b37] bg-[#163c3a] px-6 font-mono text-xs font-bold text-[#eafffb] shadow-[0_18px_44px_rgba(22,60,58,0.25)] transition hover:bg-[#24615b] disabled:cursor-wait disabled:bg-[#163c3a]"
        disabled={isEntering}
        onClick={startInvestigation}
        type="button"
      >
        <span className="absolute inset-y-0 left-0 w-10 -translate-x-12 skew-x-[-18deg] bg-[#e7f05f]/18 transition-transform duration-500 group-hover:translate-x-48" />
        <span className="relative">{isEntering ? "正在接入案件" : "开始处理今天的事"}</span>
        {isEntering ? (
          <ScanLine className="relative animate-pulse" size={17} />
        ) : (
          <ArrowRight className="relative transition group-hover:translate-x-1" size={17} />
        )}
      </button>

      <AnimatePresence>
        {isEntering && (
          <motion.div
            className="fixed inset-0 z-[90] overflow-hidden bg-[#102220] text-[#eafffb]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.img
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              src={coverSrc}
              initial={{ scale: 1.04, filter: "blur(0px)" }}
              animate={{ scale: 1.12, filter: "blur(8px)" }}
              transition={{ duration: 1.05, ease: [0.2, 0.7, 0.18, 1] }}
            />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(16,34,32,0.98)_0%,rgba(22,60,58,0.86)_48%,rgba(39,36,31,0.92)_100%)]" />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(234,255,251,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(234,255,251,0.045)_1px,transparent_1px)] bg-[length:34px_34px]" />
            <motion.div
              className="absolute inset-y-[-12%] left-[-32%] w-[38%] skew-x-[-18deg] bg-[linear-gradient(90deg,transparent,rgba(111,213,199,0.34),rgba(231,240,95,0.2),transparent)]"
              initial={{ x: 0 }}
              animate={{ x: "360vw" }}
              transition={{ duration: 0.94, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute left-5 right-5 top-1/2 max-w-xl -translate-y-1/2 md:left-12"
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08, duration: 0.34, ease: "easeOut" }}
            >
              <div className="inline-flex h-12 w-12 items-center justify-center border border-[#6fd5c7]/48 bg-[#eafffb]/8 shadow-[0_0_42px_rgba(111,213,199,0.18)]">
                <FileSearch size={22} />
              </div>
              <p className="mt-5 font-mono text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[#6fd5c7]">
                case ingress
              </p>
              <h2 className="mt-2 font-display text-5xl font-black leading-none md:text-7xl">案卷接入中</h2>
              <p className="mt-4 max-w-md text-sm font-semibold leading-6 text-[#d6e5df]">
                正在领取未使用案件，装配现场、证据索引和问答中枢。
              </p>
              <div className="mt-7 h-2 max-w-md border border-[#6fd5c7]/28 bg-[#071514]/64 p-[2px]">
                <motion.span
                  className="block h-full bg-[linear-gradient(90deg,#6fd5c7,#e7f05f)]"
                  initial={{ width: "8%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 0.92, ease: [0.2, 0.7, 0.18, 1] }}
                />
              </div>
            </motion.div>
            <motion.div
              className="absolute bottom-6 right-5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.16em] text-[#eafffb]/54 md:right-8"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0.64] }}
              transition={{ delay: 0.22, duration: 0.62 }}
            >
              routing to investigation
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
