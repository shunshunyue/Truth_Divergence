import { NextResponse } from "next/server";
import { countReadyCases } from "@/game/cache/caseCache";
import { ensureCaseCacheWorkerStarted, getCaseCacheIntervalMs, getCaseCacheTarget } from "@/game/cache/caseCacheWorker";

export async function GET() {
  ensureCaseCacheWorkerStarted();
  const ready = await countReadyCases();

  return NextResponse.json({
    ready,
    target: getCaseCacheTarget(),
    intervalMs: getCaseCacheIntervalMs(),
  });
}
