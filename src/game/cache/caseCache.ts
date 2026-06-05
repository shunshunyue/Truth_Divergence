import mysql from "mysql2/promise";
import { randomUUID } from "crypto";
import { caseDataSchema, playerCaseStateSchema, type CaseData, type PlayerCaseState } from "@/game/schemas/game";
import type { GeneratedSession } from "@/ai/caseGenerator";

type CacheStatus = "ready" | "used" | "generating" | "failed";

export type CachedCaseRecord = {
  id: string;
  status: CacheStatus;
  caseData: CaseData;
  state: PlayerCaseState;
  errorMessage?: string | null;
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
      ai_page JSON NULL,
      error_message TEXT NULL,
      used_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status_created (status, created_at),
      INDEX idx_used_at (used_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  initialized = true;
}

function parseJsonColumn(value: unknown) {
  if (typeof value === "string") return JSON.parse(value);
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8"));
  return value;
}

function parseRecord(row: Record<string, unknown>): CachedCaseRecord {
  return {
    id: String(row.id),
    status: row.status as CacheStatus,
    caseData: caseDataSchema.parse(parseJsonColumn(row.case_data)),
    state: playerCaseStateSchema.parse(parseJsonColumn(row.player_state)),
    errorMessage: row.error_message ? String(row.error_message) : null,
  };
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
  const id = randomUUID();

  await pool.execute(
    `INSERT INTO ai_case_cache (id, status, case_title, case_theme, case_data, player_state)
     VALUES (?, 'ready', ?, ?, ?, ?)`,
    [
      id,
      session.caseData.title,
      session.caseData.theme,
      JSON.stringify(session.caseData),
      JSON.stringify(session.state),
    ],
  );

  return id;
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
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT * FROM ai_case_cache
       WHERE status = 'ready'
       ORDER BY RAND()
       LIMIT 1
       FOR UPDATE`,
    );

    const row = rows[0];
    if (!row) {
      await connection.rollback();
      return null;
    }

    await connection.execute(
      "UPDATE ai_case_cache SET status = 'used', used_at = NOW() WHERE id = ?",
      [row.id],
    );
    await connection.commit();
    return parseRecord(row);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function closeCaseCachePool() {
  await pool.end();
  initialized = false;
}
