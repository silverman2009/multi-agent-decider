import crypto from "crypto";
import { mkdirSync } from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { ORCHESTRATOR_SLUG, SEED_AGENTS } from "./seed-agents";

export const DATA_DIR = path.join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = path.join(DATA_DIR, "ox-alpha.sqlite3");

sqlite3.verbose();
const db = new sqlite3.Database(DB_PATH);

// ─── Promisified primitives ──────────────────────────────────────────────────

export function run(sql: string, params: unknown[] = []): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  db.run(sql, params, function onRunDone(err) {
    if (err) reject(err);
    else resolve();
  });
  return promise;
}

export function get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  const { promise, resolve, reject } = Promise.withResolvers<T | undefined>();
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T | undefined)));
  return promise;
}

export function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { promise, resolve, reject } = Promise.withResolvers<T[]>();
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve((rows ?? []) as T[])));
  return promise;
}

/** Multi-statement SQL (sqlite3 run() only executes the first statement). */
export function exec(sql: string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  db.exec(sql, (err) => (err ? reject(err) : resolve()));
  return promise;
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Read a string value from the key-value `meta` table (empty string when absent). */
export async function getMetaValue(key: string): Promise<string> {
  await ready();
  const row = await get<{ value: string }>("SELECT value FROM meta WHERE key = ?", [key]);
  return row?.value ?? "";
}

/** Upsert a string value into the `meta` table. */
export async function setMetaValue(key: string, value: string): Promise<void> {
  await ready();
  await run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [key, value]);
}

// ─── Row shapes ──────────────────────────────────────────────────────────────

export interface ConfigRow {
  id: string;
  name: string | null;
  base_url: string;
  api_key_enc: string | null;
  api_key_hint: string | null;
  model: string;
  enabled: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface AgentRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  system_prompt: string;
  enabled: number;
  provider_config_id: string | null;
  base_url: string | null;
  api_key_enc: string | null;
  api_key_hint: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

export interface DecisionRow {
  id: string;
  title: string | null;
  question: string;
  status: string;
  orchestrator_analysis: string | null;
  judge_output: string | null;
  final_answer: string | null;
  error: string | null;
  failed_stage: string | null;
  model_used: string | null;
  orchestrator_usage: string | null;
  judge_usage: string | null;
  created_at: string;
  updated_at: string;
  duration_ms: number | null;
}

export interface StepRow {
  id: string;
  decision_id: string;
  agent_slug: string;
  agent_name: string;
  order_index: number;
  status: string;
  output: string | null;
  error: string | null;
  duration_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
}

// ─── Schema init & seed ──────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS provider_configs (
  id TEXT PRIMARY KEY,
  name TEXT,
  base_url TEXT NOT NULL,
  api_key_enc TEXT,
  api_key_hint TEXT,
  model TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  provider_config_id TEXT REFERENCES provider_configs(id) ON DELETE SET NULL,
  base_url TEXT,
  api_key_enc TEXT,
  api_key_hint TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  title TEXT,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  orchestrator_analysis TEXT,
  judge_output TEXT,
  final_answer TEXT,
  error TEXT,
  failed_stage TEXT,
  model_used TEXT,
  orchestrator_usage TEXT,
  judge_usage TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS decision_steps (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  agent_slug TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  output TEXT,
  error TEXT,
  duration_ms INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_steps_decision ON decision_steps(decision_id, order_index);

CREATE TABLE IF NOT EXISTS available_models (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_config_id TEXT REFERENCES provider_configs(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

async function migrateAddColumn(table: string, column: string, type: string): Promise<void> {
  const cols = await all<{ name: string }>(`PRAGMA table_info(${table})`);
  if (cols.some((c) => c.name === column)) return;
  await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

async function seedAgentsIfEmpty(): Promise<void> {
  const row = await get<{ n: number }>("SELECT COUNT(*) AS n FROM agents");
  const now = nowIso();
  if (row && row.n === 0) {
    for (const a of SEED_AGENTS) {
      await run(
        `INSERT INTO agents (id, name, slug, description, system_prompt, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [uuid(), a.name, a.slug, a.description, a.systemPrompt, now, now]
      );
    }
    console.log(`[Ox Alpha] ${SEED_AGENTS.length} عامل پیش‌فرض در پایگاه داده ساخته شد.`);
  }
  // Migration v2: update orchestrator prompt to include proposedAgents capability.
  await run(
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
  );
  const ver = await get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'");
  const orch = SEED_AGENTS.find((a) => a.slug === ORCHESTRATOR_SLUG);
  const needPromptUpdate = !ver || Number(ver.value) < 2 || Number(ver.value) < 3;
  if (needPromptUpdate && orch) {
    await run(
      `UPDATE agents SET system_prompt = ?, updated_at = ? WHERE slug = ?`,
      [orch.systemPrompt, now, ORCHESTRATOR_SLUG]
    );
    console.log(`[Ox Alpha] Migration v3: orchestrator prompt updated (modelSelections).`);
  }
  if (!ver || Number(ver.value) < 3) {
    await run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '3')`);
  }

  // Migration v4: add token-usage columns to decisions + decision_steps.
  await migrateAddColumn("decisions", "orchestrator_usage", "TEXT");
  await migrateAddColumn("decisions", "judge_usage", "TEXT");
  await migrateAddColumn("decision_steps", "prompt_tokens", "INTEGER");
  await migrateAddColumn("decision_steps", "completion_tokens", "INTEGER");
  await migrateAddColumn("decision_steps", "total_tokens", "INTEGER");
  if (!ver || Number(ver.value) < 4) {
    await run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '4')`);
  }
}

let initPromise: Promise<void> | null = null;

/** Idempotent init — every entry point (routes/RSC/engine) awaits this first. */
export function ready(): Promise<void> {
  if (!initPromise) {
    initPromise = run("PRAGMA foreign_keys = ON")
      .then(() => exec(SCHEMA_SQL))
      .then(seedAgentsIfEmpty)
      .catch((err) => {
        initPromise = null;
        throw err;
      });
  }
  return initPromise;
}
