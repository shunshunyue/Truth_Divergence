import "tsconfig-paths/register";
import { config } from "dotenv";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { getVisualStorageDriver, getVisualsDir } from "@/ai/visualStorage";
import {
  closeCaseCachePool,
  listCasesWithVisuals,
  updateCaseHomeHero,
  type CachedCaseRecord,
} from "@/game/cache/caseCache";
import { buildHomeHeroCopy, type HomeHeroCopy } from "@/game/homeHero";

config({ path: ".env.local", quiet: true });

function log(message: string, data?: Record<string, unknown>) {
  const suffix = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`[${new Date().toLocaleString()}] ${message}${suffix}`);
}

async function writeSidecar(record: CachedCaseRecord, homeHero: HomeHeroCopy) {
  if (getVisualStorageDriver() !== "local") return;

  const cacheId = record.visualManifest?.cacheId ?? record.id;
  const coverAsset = record.visualManifest?.assets.find((asset) => asset.kind === "case_cover" && asset.fileUrl);
  const sidecarDir = path.join(process.cwd(), getVisualsDir(), cacheId);

  await mkdir(sidecarDir, { recursive: true });
  await writeFile(
    path.join(sidecarDir, "home-hero.json"),
    `${JSON.stringify(
      {
        version: 1,
        cacheId,
        caseId: record.caseData.id,
        caseTitle: record.caseData.title,
        coverSrc: coverAsset?.fileUrl,
        homeHero,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function main() {
  const limit = Number(process.env.HOME_HERO_BACKFILL_LIMIT ?? 100);
  const records = await listCasesWithVisuals(limit);
  log("开始回填首页文案。", { count: records.length, limit });

  for (const record of records) {
    const homeHero = record.homeHero ?? buildHomeHeroCopy(record.caseData);
    await updateCaseHomeHero(record.id, homeHero);
    await writeSidecar(record, homeHero);
    log("首页文案已回填。", {
      id: record.id,
      title: record.caseData.title,
      headline: homeHero.headline,
    });
  }

  await closeCaseCachePool();
}

main().catch(async (error) => {
  console.error(error);
  await closeCaseCachePool().catch(() => undefined);
  process.exit(1);
});
