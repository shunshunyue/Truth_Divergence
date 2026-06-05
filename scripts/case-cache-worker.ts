import "tsconfig-paths/register";
import { config } from "dotenv";
import type { CaseCacheWorkerEvent } from "@/game/cache/caseCacheWorker";

config({ path: ".env.local", quiet: true });

type WorkerModule = typeof import("@/game/cache/caseCacheWorker");
type MaybeWrappedWorkerModule = WorkerModule | { default: WorkerModule };

function unwrapWorkerModule(module: MaybeWrappedWorkerModule) {
  return "refillCaseCacheOnce" in module ? module : module.default;
}

function formatData(data: unknown) {
  if (!data) return "";
  return ` ${JSON.stringify(data)}`;
}

function logWorkerEvent(event: CaseCacheWorkerEvent) {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] [${event.type}] ${event.message}${formatData(event.data)}`);
}

function shouldRunOnce() {
  return ["1", "true", "yes"].includes(String(process.env.CASE_CACHE_WORKER_ONCE ?? "").toLowerCase());
}

async function tick(worker: WorkerModule) {
  const result = await worker.refillCaseCacheOnce(logWorkerEvent);
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] [result] ${JSON.stringify(result)}`);
}

async function main() {
  const worker = unwrapWorkerModule(await import("@/game/cache/caseCacheWorker"));
  const { getCaseCacheIntervalMs, getCaseCacheTarget } = worker;
  console.log(
    `Truth Divergence case cache worker started. target=${getCaseCacheTarget()} interval=${getCaseCacheIntervalMs()}ms`,
  );

  await tick(worker).catch((error) => {
    console.error(`[${new Date().toLocaleString()}] [fatal] Initial refill failed.`, error);
  });

  if (shouldRunOnce()) {
    const cache = await import("@/game/cache/caseCache");
    await cache.closeCaseCachePool();
    console.log(`[${new Date().toLocaleString()}] [exit] CASE_CACHE_WORKER_ONCE=1，单轮运行结束。`);
    return;
  }

  setInterval(() => {
    tick(worker).catch((error) => {
      console.error(`[${new Date().toLocaleString()}] [fatal] Scheduled refill failed.`, error);
    });
  }, getCaseCacheIntervalMs());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
