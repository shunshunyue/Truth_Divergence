"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

export const routeTransitionStartEvent = "td-route-transition:start";
export const routeTransitionDuration = 430;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useRouteTransition() {
  const router = useRouter();

  const navigate = useCallback(
    (href: string, method: "push" | "replace") => {
      if (typeof window === "undefined" || prefersReducedMotion()) {
        router[method](href);
        return;
      }

      const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (href === currentHref || href === window.location.pathname) return;

      window.dispatchEvent(new CustomEvent(routeTransitionStartEvent));
      window.setTimeout(() => {
        router[method](href);
      }, routeTransitionDuration);
    },
    [router],
  );

  return {
    prefetch: router.prefetch,
    push: (href: string) => navigate(href, "push"),
    replace: (href: string) => navigate(href, "replace"),
  };
}
