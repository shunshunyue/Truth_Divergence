import "tsconfig-paths/register";
import { config } from "dotenv";
import { generateCaseVisualManifest } from "@/ai/imageGenerator";
import {
  closeCaseCachePool,
  listReadyCasesMissingVisuals,
  updateCaseVisualManifest,
} from "@/game/cache/caseCache";

config({ path: ".env.local", quiet: true });

function log(message: string, data?: Record<string, unknown>) {
  const suffix = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`[${new Date().toLocaleString()}] ${message}${suffix}`);
}

async function main() {
  const limit = Number(process.env.CASE_VISUAL_BACKFILL_LIMIT ?? 3);
  const records = await listReadyCasesMissingVisuals(limit);
  log("开始回填案件视觉资产。", { count: records.length, limit });

  for (const record of records) {
    log("回填视觉包。", { id: record.id, title: record.caseData.title });
    const manifest = await generateCaseVisualManifest(record.caseData, {
      cacheId: record.id,
      logger: (message, data) => log(message, data),
    });
    await updateCaseVisualManifest(record.id, manifest);
    log("视觉包已写回缓存。", {
      id: record.id,
      assets: manifest.assets.length,
      fallback: manifest.assets.filter((asset) => asset.source === "fallback").length,
      failed: manifest.assets.filter((asset) => asset.status === "failed").length,
    });
  }

  await closeCaseCachePool();
}

main().catch(async (error) => {
  console.error(error);
  await closeCaseCachePool().catch(() => undefined);
  process.exit(1);
});
