import mysql from "mysql2/promise";
import { randomUUID } from "crypto";
import { caseDataSchema, playerCaseStateSchema, type CaseData, type PlayerCaseState } from "@/game/schemas/game";
import { caseVisualManifestSchema, type CaseVisualManifest } from "@/game/schemas/visuals";
import type { GeneratedSession } from "@/ai/caseGenerator";
import { normalizeHomeHeroCopy, type HomeHeroCopy } from "@/game/homeHero";

type CacheStatus = "ready" | "used" | "generating" | "failed";
type VisualStatus = "pending" | "ready" | "failed" | "disabled";

export type CachedCaseRecord = {
  id: string;
  status: CacheStatus;
  caseData: CaseData;
  state: PlayerCaseState;
  visualManifest?: CaseVisualManifest;
  homeHero: HomeHeroCopy;
  visualStatus?: VisualStatus | null;
  errorMessage?: string | null;
};

export type HomeHeroCaseRecord = {
  id: string;
  caseData: CaseData;
  visualManifest?: CaseVisualManifest;
  homeHero: HomeHeroCopy;
};

const databaseUrl = process.env.DATABASE_URL ?? "mysql://root:123456@localhost:3306/truth_divergence";
const pool = mysql.createPool({
  uri: databaseUrl,
  connectionLimit: 4,
  multipleStatements: true,
});

let initialized = false;

function databaseNameFromUrl() {
  const url = new URL(databaseUrl);
  return url.pathname.replace(/^\//, "") || "truth_divergence";
}

async function ensureDatabase() {
  const url = new URL(databaseUrl);
  const databaseName = databaseNameFromUrl();
  const bootstrap = await mysql.createConnection({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    multipleStatements: true,
  });

  try {
    await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await bootstrap.end();
  }
}

async function columnExists(tableName: string, columnName: string) {
  const databaseName = databaseNameFromUrl();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [databaseName, tableName, columnName],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function addColumnIfMissing(tableName: string, columnName: string, definition: string) {
  if (await columnExists(tableName, columnName)) return;
  await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definition}`);
}

export async function ensureCaseCacheSchema() {
  if (initialized) return;

  await ensureDatabase();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_case_cache (
      id CHAR(36) PRIMARY KEY,
      status ENUM('ready','used','generating','failed') NOT NULL DEFAULT 'ready',
      case_title VARCHAR(255) NULL,
      case_theme VARCHAR(255) NULL,
      case_data JSON NULL,
      player_state JSON NULL,
      visual_manifest JSON NULL,
      home_hero JSON NULL,
      visual_status ENUM('pending','ready','failed','disabled') NULL,
      visual_error_message TEXT NULL,
      visual_generated_at DATETIME NULL,
      ai_page JSON NULL,
      error_message TEXT NULL,
      used_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status_created (status, created_at),
      INDEX idx_used_at (used_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("ai_case_cache", "visual_manifest", "visual_manifest JSON NULL");
  await addColumnIfMissing("ai_case_cache", "home_hero", "home_hero JSON NULL");
  await addColumnIfMissing(
    "ai_case_cache",
    "visual_status",
    "visual_status ENUM('pending','ready','failed','disabled') NULL",
  );
  await addColumnIfMissing("ai_case_cache", "visual_error_message", "visual_error_message TEXT NULL");
  await addColumnIfMissing("ai_case_cache", "visual_generated_at", "visual_generated_at DATETIME NULL");

  initialized = true;
}

function parseJsonColumn(value: unknown) {
  if (typeof value === "string") return JSON.parse(value);
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8"));
  return value;
}

function parseRecord(row: Record<string, unknown>): CachedCaseRecord {
  const rawVisualManifest = row.visual_manifest ? parseJsonColumn(row.visual_manifest) : undefined;
  const caseData = caseDataSchema.parse(parseJsonColumn(row.case_data));
  return {
    id: String(row.id),
    status: row.status as CacheStatus,
    caseData,
    state: playerCaseStateSchema.parse(parseJsonColumn(row.player_state)),
    visualManifest: rawVisualManifest ? caseVisualManifestSchema.parse(rawVisualManifest) : undefined,
    homeHero: parseHomeHero(row.home_hero, caseData),
    visualStatus: row.visual_status ? (String(row.visual_status) as VisualStatus) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
  };
}

function parseHomeHero(value: unknown, caseData: CaseData) {
  if (value) {
    try {
      return normalizeHomeHeroCopy(parseJsonColumn(value), caseData);
    } catch {
      return normalizeHomeHeroCopy(undefined, caseData);
    }
  }

  return normalizeHomeHeroCopy(undefined, caseData);
}

export async function countReadyCases() {
  await ensureCaseCacheSchema();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM ai_case_cache WHERE status = 'ready'",
  );
  return Number(rows[0]?.total ?? 0);
}

export async function insertReadyCase(session: GeneratedSession) {
  await ensureCaseCacheSchema();
  const id = session.visualManifest?.cacheId ?? randomUUID();
  const visualStatus: VisualStatus = session.visualManifest ? "ready" : "disabled";

  await pool.execute(
    `INSERT INTO ai_case_cache
       (id, status, case_title, case_theme, case_data, player_state, visual_manifest, home_hero, visual_status, visual_generated_at)
     VALUES (?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      session.caseData.title,
      session.caseData.theme,
      JSON.stringify(session.caseData),
      JSON.stringify(session.state),
      session.visualManifest ? JSON.stringify({ ...session.visualManifest, cacheId: id }) : null,
      JSON.stringify(session.homeHero),
      visualStatus,
      session.visualManifest ? new Date() : null,
    ],
  );

  return id;
}

export async function listHomeHeroCases(limit = 24) {
  await ensureCaseCacheSchema();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, case_data, visual_manifest, home_hero
     FROM ai_case_cache
     WHERE case_data IS NOT NULL
       AND visual_manifest IS NOT NULL
       AND visual_status = 'ready'
     ORDER BY RAND()
     LIMIT ?`,
    [limit],
  );

  return rows.flatMap((row): HomeHeroCaseRecord[] => {
    try {
      const caseData = caseDataSchema.parse(parseJsonColumn(row.case_data));
      const rawVisualManifest = row.visual_manifest ? parseJsonColumn(row.visual_manifest) : undefined;
      const visualManifest = rawVisualManifest ? caseVisualManifestSchema.parse(rawVisualManifest) : undefined;

      return [
        {
          id: String(row.id),
          caseData,
          visualManifest,
          homeHero: parseHomeHero(row.home_hero, caseData),
        },
      ];
    } catch {
      return [];
    }
  });
}

export async function listCasesWithVisuals(limit = 100) {
  await ensureCaseCacheSchema();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT *
     FROM ai_case_cache
     WHERE case_data IS NOT NULL
       AND visual_manifest IS NOT NULL
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit],
  );

  return rows.flatMap((row): CachedCaseRecord[] => {
    try {
      return [parseRecord(row)];
    } catch {
      return [];
    }
  });
}

export async function updateCaseHomeHero(id: string, homeHero: HomeHeroCopy) {
  await ensureCaseCacheSchema();
  await pool.execute("UPDATE ai_case_cache SET home_hero = ? WHERE id = ?", [JSON.stringify(homeHero), id]);
}

export async function insertFailedCase(error: unknown) {
  await ensureCaseCacheSchema();
  await pool.execute(
    `INSERT INTO ai_case_cache (id, status, case_title, case_theme, case_data, player_state, ai_page, error_message)
     VALUES (?, 'failed', NULL, NULL, NULL, NULL, NULL, ?)`,
    [
      randomUUID(),
      error instanceof Error ? error.message : "unknown",
    ],
  );
}

export async function claimRandomReadyCase() {
  await ensureCaseCacheSchema();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT * FROM ai_case_cache
     WHERE status = 'ready'
     ORDER BY (visual_status = 'ready') DESC, RAND()
     LIMIT 1`,
  );

  const row = rows[0];
  return row ? parseRecord(row) : null;
}

export async function markClaimedCaseUsed(id: string) {
  await ensureCaseCacheSchema();
  await pool.execute(
    `UPDATE ai_case_cache
     SET status = 'used', used_at = NOW()
     WHERE id = ? AND status = 'ready'`,
    [id],
  );
}

export async function listReadyCasesMissingVisuals(limit = 5) {
  await ensureCaseCacheSchema();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT * FROM ai_case_cache
     WHERE status = 'ready' AND (visual_manifest IS NULL OR visual_status IS NULL OR visual_status <> 'ready')
     ORDER BY created_at ASC
     LIMIT ?`,
    [limit],
  );
  return rows.map((row) => parseRecord(row));
}

export async function updateCaseVisualManifest(id: string, visualManifest: CaseVisualManifest, visualErrorMessage?: string) {
  await ensureCaseCacheSchema();
  const hasFailedAssets = visualManifest.assets.some((asset) => asset.status === "failed");
  await pool.execute(
    `UPDATE ai_case_cache
     SET visual_manifest = ?, visual_status = ?, visual_error_message = ?, visual_generated_at = NOW()
     WHERE id = ?`,
    [
      JSON.stringify({ ...visualManifest, cacheId: id }),
      hasFailedAssets ? "failed" : "ready",
      visualErrorMessage ?? null,
      id,
    ],
  );
}

export async function closeCaseCachePool() {
  await pool.end();
  initialized = false;
}
