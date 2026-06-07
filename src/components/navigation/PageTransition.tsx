"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import { usePathname } from "next/navigation";
import {
  routeTransitionDuration,
  routeTransitionStartEvent,
} from "@/components/navigation/useRouteTransition";

type TransitionPhase = "idle" | "leaving" | "arriving";

const pageVariants: Variants = {
  initial: (isPlayRoute: boolean) => ({
    filter: "blur(10px)",
    opacity: 0,
    scale: isPlayRoute ? 0.992 : 1.006,
    y: isPlayRoute ? 18 : -10,
  }),
  animate: {
    filter: "blur(0px)",
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: 0.42,
      ease: [0.2, 0.72, 0.17, 1],
    },
  },
  exit: (isPlayRoute: boolean) => ({
    filter: "blur(8px)",
    opacity: 0,
    scale: isPlayRoute ? 1.006 : 0.992,
    y: isPlayRoute ? -12 : 12,
    transition: {
      duration: 0.24,
      ease: [0.4, 0, 0.2, 1],
    },
  }),
};

const veilVariants: Variants = {
  idle: {
    opacity: 0,
    scaleX: 0,
    transformOrigin: "right center",
    transition: { duration: 0.18, ease: "easeOut" },
  },
  leaving: {
    opacity: 1,
    scaleX: 1,
    transformOrigin: "left center",
    transition: { duration: routeTransitionDuration / 1000, ease: [0.2, 0.72, 0.17, 1] },
  },
  arriving: {
    opacity: 1,
    scaleX: 0,
    transformOrigin: "right center",
    transition: { duration: 0.5, ease: [0.22, 0.78, 0.2, 1] },
    transitionEnd: { opacity: 0 },
  },
};

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<TransitionPhase>("idle");
  const isPlayRoute = pathname.startsWith("/play");

  useEffect(() => {
    if (reduceMotion) return;

    function beginTransition() {
      setPhase("leaving");
    }

    window.addEventListener(routeTransitionStartEvent, beginTransition);
    return () => window.removeEventListener(routeTransitionStartEvent, beginTransition);
  }, [reduceMotion]);

  useEffect(() => {
    if (reduceMotion) return;

    setPhase("arriving");
    const idleTimer = window.setTimeout(() => setPhase("idle"), 560);
    return () => window.clearTimeout(idleTimer);
  }, [pathname, reduceMotion]);

  if (reduceMotion) return <>{children}</>;

  return (
    <div className="td-route-stack">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          animate="animate"
          className="td-route-page"
          custom={isPlayRoute}
          exit="exit"
          initial="initial"
          key={pathname}
          variants={pageVariants}
        >
          {children}
        </motion.div>
      </AnimatePresence>

      <motion.div
        aria-hidden="true"
        animate={phase}
        className="td-route-veil"
        data-phase={phase}
        initial={false}
        variants={veilVariants}
      >
        <div className="td-route-veil-grid" />
        <div className="td-route-veil-scan" />
        <div className="td-route-veil-mark">
          <span>TRUTH DIVERGENCE</span>
          <strong>{phase === "leaving" ? "请等待。。。" : "画面校准"}</strong>
        </div>
      </motion.div>
    </div>
  );
}
