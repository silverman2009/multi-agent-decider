import { all, get, nowIso, ready, run, uuid } from "@/lib/db";
import { listConfigs } from "@/lib/provider";
import type { AvailableModelDTO } from "@/lib/types";

export const MODELS_SCHEMA = `
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

export interface AvailableModelRow {
  id: string;
  label: string;
  model: string;
  provider_config_id: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface AvailableModelInput {
  label: string;
  model: string;
  providerConfigId?: string | null;
  enabled?: boolean;
}

export async function listAvailableModels(): Promise<AvailableModelRow[]> {
  await ready();
  return all<AvailableModelRow>("SELECT * FROM available_models WHERE enabled = 1 ORDER BY label");
}

export async function listAllModelRows(): Promise<AvailableModelRow[]> {
  await ready();
  return all<AvailableModelRow>("SELECT * FROM available_models ORDER BY label");
}

export async function getAvailableModel(id: string): Promise<AvailableModelRow | null> {
  await ready();
  return (await get<AvailableModelRow>("SELECT * FROM available_models WHERE id = ?", [id])) ?? null;
}

export async function createAvailableModel(input: AvailableModelInput): Promise<AvailableModelRow> {
  await ready();
  const id = uuid();
  const now = nowIso();
  const row: AvailableModelRow = {
    id,
    label: input.label.trim(),
    model: input.model.trim(),
    provider_config_id: input.providerConfigId?.trim() || null,
    enabled: input.enabled !== false ? 1 : 0,
    created_at: now,
    updated_at: now,
  };
  await run(
    `INSERT INTO available_models (id, label, model, provider_config_id, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.label, row.model, row.provider_config_id, row.enabled, row.created_at, row.updated_at]
  );
  return row;
}

export async function deleteAvailableModel(id: string): Promise<boolean> {
  await ready();
  const row = await getAvailableModel(id);
  if (!row) return false;
  await run("DELETE FROM available_models WHERE id = ?", [id]);
  return true;
}

export async function toAvailableModelDTO(row: AvailableModelRow): Promise<AvailableModelDTO> {
  const configs = await listConfigs();
  const def = configs.find((c) => c.isDefault && c.enabled);
  const linked = row.provider_config_id ? configs.find((c) => c.id === row.provider_config_id) : null;
  const usesDefaultProvider = !linked && !row.provider_config_id;
  return {
    id: row.id,
    label: row.label,
    model: row.model,
    providerConfigId: row.provider_config_id,
    providerLabel: linked?.name || (usesDefaultProvider && def ? def.name || def.baseUrl : "—") || "—",
    usesDefaultProvider,
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}