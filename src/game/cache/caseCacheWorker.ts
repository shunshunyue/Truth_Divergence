import { generateInitialSession } from "@/ai/caseGenerator";
import { countReadyCases, insertFailedCase, insertReadyCase } from "@/game/cache/caseCache";

export type CaseCacheWorkerEvent = {
  type:
    | "tick"
    | "skip"
    | "inventory"
    | "generate-start"
    | "ai-status"
    | "ai-progress"
    | "generate-complete"
    | "insert"
    | "done"
    | "error";
  message: string;
  data?: Record<string, unknown>;
};

export type CaseCacheWorkerLogger = (event: CaseCacheWorkerEvent) => void;

const globalWorkerState = globalThis as typeof globalThis & {
  truthDivergenceCaseCacheWorker?: {
    timer?: ReturnType<typeof setInterval>;
    running: boolean;
    lastRunAt?: number;
  };
};

const workerState =
  globalWorkerState.truthDivergenceCaseCacheWorker ??
  {
    running: false,
  };
globalWorkerState.truthDivergenceCaseCacheWorker = workerState;

export function getCaseCacheTarget() {
  return Number(process.env.CASE_CACHE_TARGET ?? 5);
}

export function getCaseCacheIntervalMs() {
  return Number(process.env.CASE_CACHE_INTERVAL_MS ?? 60_000);
}

function emit(
  logger: CaseCacheWorkerLogger | undefined,
  type: CaseCacheWorkerEvent["type"],
  message: string,
  data?: Record<string, unknown>,
) {
  logger?.({
    type,
    message,
    ...(data ? { data } : {}),
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function refillCaseCacheOnce(logger?: CaseCacheWorkerLogger) {
  if (workerState.running) {
    emit(logger, "skip", "上一轮补货还在运行，本轮跳过。");
    return { skipped: true, reason: "already-running" };
  }

  workerState.running = true;
  workerState.lastRunAt = Date.now();
  let generated = 0;

  try {
    const target = getCaseCacheTarget();
    emit(logger, "tick", "开始检查案件缓存池。", { target });

    let ready = await countReadyCases();
    emit(logger, "inventory", "已读取缓存库存。", { ready, target });

    if (ready < target) {
      let streamedChars = 0;
      let lastProgressAt = 0;
      const startedAt = Date.now();
      const progressTimer =
        logger &&
        setInterval(() => {
          emit(logger, "ai-progress", "AI 仍在生成案件。", {
            elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
            receivedChars: streamedChars,
          });
        }, 10_000);

      try {
        emit(logger, "generate-start", "缓存未满，开始生成一个原创案件。", {
          slot: `${ready + 1}/${target}`,
        });

        const session = await generateInitialSession(
          (content) => {
            streamedChars += content.length;
            const now = Date.now();
            // AI 流式输出通常会拆成很多小片段；这里按时间节流，保证控制台可读。
            if (now - lastProgressAt > 3_000) {
              lastProgressAt = now;
              emit(logger, "ai-progress", "正在接收 AI 流式 JSON。", {
                receivedChars: streamedChars,
              });
            }
          },
          (status) => {
            emit(logger, "ai-status", status);
          },
        );

        emit(logger, "generate-complete", "AI 案件生成并校验完成。", {
          title: session.caseData.title,
          theme: session.caseData.theme,
          difficulty: session.caseData.difficulty,
          opening: session.caseData.openingEvent.headline,
          locations: session.caseData.locations.length,
          suspects: session.caseData.suspects.length,
          evidence: session.caseData.evidence.length,
          timeline: session.caseData.timeline.length,
        });

        const id = await insertReadyCase(session);
        emit(logger, "insert", "案件已写入缓存池。", {
          id,
          title: session.caseData.title,
          readyAfterInsert: ready + 1,
        });

        generated += 1;
        ready += 1;
      } catch (error) {
        emit(logger, "error", "案件生成失败，正在写入 failed 记录。", {
          error: errorMessage(error),
        });
        await insertFailedCase(error);
        throw error;
      } finally {
        if (progressTimer) clearInterval(progressTimer);
      }
    } else {
      emit(logger, "skip", "缓存数量已达到目标，本轮不生成。", { ready, target });
    }

    emit(logger, "done", "本轮案件缓存检查完成。", { skipped: false, generated, ready, target });
    return { skipped: false, generated, ready, target };
  } finally {
    workerState.running = false;
  }
}

export function ensureCaseCacheWorkerStarted() {
  if (workerState.timer) return;

  workerState.timer = setInterval(() => {
    refillCaseCacheOnce().catch((error) => {
      console.error("Case cache refill failed.", error);
    });
  }, getCaseCacheIntervalMs());

  refillCaseCacheOnce().catch((error) => {
    console.error("Initial case cache refill failed.", error);
  });
}
