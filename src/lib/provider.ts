import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";
import { normalizeBaseUrl } from "@/lib/baseUrl";
import { all, get, nowIso, ready, run, uuid } from "@/lib/db";
import type { AgentRow, ConfigRow } from "@/lib/db";
import { JUDGE_SLUG, ORCHESTRATOR_SLUG } from "@/lib/seed-agents";
import type { AgentDTO, ProviderConfigDTO, ResolvedPreview } from "@/lib/types";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const PROTECTED_SLUGS: readonly string[] = [ORCHESTRATOR_SLUG, JUDGE_SLUG];

// ─── Provider configs ────────────────────────────────────────────────────────

export interface StoredConfig {
  id: string;
  name: string | null;
  baseUrl: string;
  apiKeyEnc: string | null;
  apiKeyHint: string | null;
  model: string;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapConfig(r: ConfigRow): StoredConfig {
  return {
    id: r.id,
    name: r.name,
    baseUrl: r.base_url,
    apiKeyEnc: r.api_key_enc,
    apiKeyHint: r.api_key_hint,
    model: r.model,
    enabled: r.enabled === 1,
    isDefault: r.is_default === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Client-safe projection — never contains the encrypted key material. */
export function toConfigDTO(c: StoredConfig): ProviderConfigDTO {
  return {
    id: c.id,
    name: c.name,
    baseUrl: c.baseUrl,
    model: c.model,
    enabled: c.enabled,
    isDefault: c.isDefault,
    apiKeyHint: c.apiKeyHint,
    hasApiKey: !!c.apiKeyEnc,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export async function listConfigs(): Promise<StoredConfig[]> {
  await ready();
  const rows = await all<ConfigRow>(
    "SELECT * FROM provider_configs ORDER BY is_default DESC, created_at ASC"
  );
  return rows.map(mapConfig);
}

export async function getConfig(id: string): Promise<StoredConfig | null> {
  await ready();
  const row = await get<ConfigRow>("SELECT * FROM provider_configs WHERE id = ?", [id]);
  return row ? mapConfig(row) : null;
}

export interface ConfigInput {
  name?: string | null;
  baseUrl: string;
  apiKey?: string | null;
  model: string;
  enabled?: boolean;
  makeDefault?: boolean;
}

export async function createConfig(input: ConfigInput): Promise<StoredConfig> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const model = input.model?.trim();
  if (!model) throw new ConfigError("فیلد Model الزامی است.");

  const plainKey = input.apiKey?.trim() || "";
  const enc = plainKey ? encryptSecret(plainKey) : null;
  const hint = plainKey ? maskSecret(plainKey) : null;

  await ready();
  const count = await get<{ n: number }>("SELECT COUNT(*) AS n FROM provider_configs");
  const makeDefault = input.makeDefault === true || !count || count.n === 0;
  if (makeDefault) await run("UPDATE provider_configs SET is_default = 0");

  const id = uuid();
  const now = nowIso();
  await run(
    `INSERT INTO provider_configs
       (id, name, base_url, api_key_enc, api_key_hint, model, enabled, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name?.trim() || null,
      baseUrl,
      enc,
      hint,
      model,
      input.enabled === false ? 0 : 1,
      makeDefault ? 1 : 0,
      now,
      now,
    ]
  );
  const created = await getConfig(id);
  if (!created) throw new ConfigError("ذخیره تنظیمات تأیید نشد.");
  return created;
}

export interface ConfigPatch {
  name?: string | null;
  baseUrl?: string;
  /** Plain API key — encrypts before storage. */
  apiKey?: string;
  /** Removes the stored API key entirely. */
  clearApiKey?: boolean;
  model?: string;
  enabled?: boolean;
  isDefault?: boolean;
}

export async function updateConfig(id: string, patch: ConfigPatch): Promise<StoredConfig> {
  const current = await getConfig(id);
  if (!current) throw new ConfigError("تنظیمات مورد نظر یافت نشد.");

  const sets: string[] = [];
  const vals: unknown[] = [];

  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name?.trim() || null);
  }
  if (patch.baseUrl !== undefined) {
    sets.push("base_url = ?");
    vals.push(normalizeBaseUrl(patch.baseUrl));
  }
  if (patch.clearApiKey) {
    sets.push("api_key_enc = NULL", "api_key_hint = NULL");
  } else if (patch.apiKey !== undefined && patch.apiKey.trim()) {
    const plain = patch.apiKey.trim();
    sets.push("api_key_enc = ?", "api_key_hint = ?");
    vals.push(encryptSecret(plain), maskSecret(plain));
  }
  if (patch.model !== undefined) {
    const m = patch.model.trim();
    if (!m) throw new ConfigError("Model نمی‌تواند خالی باشد.");
    sets.push("model = ?");
    vals.push(m);
  }
  if (patch.enabled !== undefined) {
    sets.push("enabled = ?");
    vals.push(patch.enabled ? 1 : 0);
  }
  if (patch.isDefault === true) {
    await run("UPDATE provider_configs SET is_default = 0");
    sets.push("is_default = 1");
  }

  if (sets.length > 0) {
    sets.push("updated_at = ?");
    vals.push(nowIso());
    vals.push(id);
    await run(`UPDATE provider_configs SET ${sets.join(", ")} WHERE id = ?`, vals);
  }

  const updated = await getConfig(id);
  if (!updated) throw new ConfigError("به‌روزرسانی تأیید نشد.");
  return updated;
}

export async function deleteConfig(id: string): Promise<boolean> {
  const current = await getConfig(id);
  if (!current) return false;
  await run("DELETE FROM provider_configs WHERE id = ?", [id]);
  if (current.isDefault) {
    // Promote the most recently created remaining config, if any.
    await run(
      `UPDATE provider_configs SET is_default = 1, updated_at = ?
       WHERE id = (SELECT id FROM provider_configs ORDER BY created_at DESC LIMIT 1)`,
      [nowIso()]
    );
  }
  return true;
}

// ─── Agents ──────────────────────────────────────────────────────────────────

export async function listAgentRows(): Promise<AgentRow[]> {
  await ready();
  return all<AgentRow>("SELECT * FROM agents ORDER BY created_at ASC");
}

export async function getAgentById(id: string): Promise<AgentRow | null> {
  await ready();
  const row = await get<AgentRow>("SELECT * FROM agents WHERE id = ?", [id]);
  return row ?? null;
}

export function slugifyName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "agent";
}

export interface AgentInput {
  name: string;
  slug?: string;
  description?: string;
  systemPrompt?: string;
  enabled?: boolean;
}

export async function createAgent(input: AgentInput): Promise<AgentRow> {
  await ready();
  const requested = input.slug?.trim() ? slugifyName(input.slug) : slugifyName(input.name);
  if (PROTECTED_SLUGS.includes(requested)) {
    throw new ConfigError(`نامک «${requested}» رزرو شده است.`);
  }
  let slug = requested;
  for (let i = 2; i < 100; i++) {
    const existing = await get<{ n: number }>("SELECT COUNT(*) AS n FROM agents WHERE slug = ?", [slug]);
    if (!existing || existing.n === 0) break;
    slug = `${requested}-${i}`;
  }
  const id = uuid();
  const now = nowIso();
  await run(
    `INSERT INTO agents (id, name, slug, description, system_prompt, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name.trim(), slug, input.description?.trim() || "", input.systemPrompt?.trim() || "", input.enabled === false ? 0 : 1, now, now]
  );
  const created = await getAgentById(id);
  if (!created) throw new ConfigError("ایجاد عامل تأیید نشد.");
  return created;
}

export interface AgentPatch {
  name?: string;
  description?: string;
  systemPrompt?: string;
  enabled?: boolean;
  providerConfigId?: string | null;
  /** Custom Base URL override (null clears). */
  baseUrl?: string | null;
  /** Plain API key override. */
  apiKey?: string;
  /** Clears the custom API key. */
  clearApiKey?: boolean;
  /** Custom Model override (null clears). */
  model?: string | null;
}

export async function updateAgent(id: string, patch: AgentPatch): Promise<AgentRow> {
  const current = await getAgentById(id);
  if (!current) throw new ConfigError("عامل یافت نشد.");

  const sets: string[] = [];
  const vals: unknown[] = [];

  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new ConfigError("نام عامل نمی‌تواند خالی باشد.");
    sets.push("name = ?");
    vals.push(n);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    vals.push(patch.description.trim());
  }
  if (patch.systemPrompt !== undefined) {
    const sp = patch.systemPrompt.trim();
    if (!sp) throw new ConfigError("System Prompt نمی‌تواند خالی باشد.");
    sets.push("system_prompt = ?");
    vals.push(sp);
  }
  if (patch.enabled !== undefined) {
    if (!patch.enabled && PROTECTED_SLUGS.includes(current.slug)) {
      throw new ConfigError("عامل‌های ارکستراتور و داور نباید غیرفعال شوند.");
    }
    sets.push("enabled = ?");
    vals.push(patch.enabled ? 1 : 0);
  }

  if (patch.providerConfigId !== undefined) {
    if (patch.providerConfigId === null) {
      sets.push("provider_config_id = NULL");
    } else {
      const cfg = await getConfig(patch.providerConfigId);
      if (!cfg) throw new ConfigError("تنظیمات انتخاب‌شده یافت نشد.");
      sets.push("provider_config_id = ?");
      vals.push(cfg.id);
    }
  }
  if (patch.baseUrl !== undefined) {
    if (patch.baseUrl === null || !patch.baseUrl.trim()) sets.push("base_url = NULL");
    else {
      sets.push("base_url = ?");
      vals.push(normalizeBaseUrl(patch.baseUrl));
    }
  }
  if (patch.clearApiKey) sets.push("api_key_enc = NULL", "api_key_hint = NULL");
  else if (patch.apiKey !== undefined && patch.apiKey.trim()) {
    const plain = patch.apiKey.trim();
    sets.push("api_key_enc = ?", "api_key_hint = ?");
    vals.push(encryptSecret(plain), maskSecret(plain));
  }
  if (patch.model !== undefined) {
    sets.push("model = ?");
    vals.push(patch.model === null || !patch.model.trim() ? null : patch.model.trim());
  }

  if (sets.length > 0) {
    sets.push("updated_at = ?");
    vals.push(nowIso());
    vals.push(id);
    await run(`UPDATE agents SET ${sets.join(", ")} WHERE id = ?`, vals);
  }

  const updated = await getAgentById(id);
  if (!updated) throw new ConfigError("به‌روزرسانی عامل تأیید نشد.");
  return updated;
}

export async function deleteAgent(id: string): Promise<boolean> {
  const current = await getAgentById(id);
  if (!current) return false;
  if (PROTECTED_SLUGS.includes(current.slug)) {
    throw new ConfigError("حذف عامل‌های ارکستراتور و داور مجاز نیست.");
  }
  await run("DELETE FROM agents WHERE id = ?", [id]);
  return true;
}

// ─── Resolution: agent-specific → linked config → global default ────────────

export interface ResolvedProvider {
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

interface ResolutionParts {
  baseUrlRaw: string;
  model: string;
  apiKeyEnc: string | null;
  linkedDisabled: boolean;
  linkedMissing: boolean;
}

function resolutionParts(
  agent: Pick<AgentRow, "provider_config_id" | "base_url" | "api_key_enc" | "model">,
  configs: StoredConfig[]
): ResolutionParts {
  const def = configs.find((c) => c.isDefault && c.enabled) ?? null;
  let linked: StoredConfig | null = null;
  let linkedMissing = false;
  let linkedDisabled = false;
  if (agent.provider_config_id) {
    linked = configs.find((c) => c.id === agent.provider_config_id) ?? null;
    if (!linked) linkedMissing = true;
    else if (!linked.enabled) linkedDisabled = true;
  }
  return {
    baseUrlRaw: agent.base_url || linked?.baseUrl || def?.baseUrl || "",
    model: agent.model || linked?.model || def?.model || "",
    apiKeyEnc: agent.api_key_enc || linked?.apiKeyEnc || def?.apiKeyEnc || null,
    linkedDisabled,
    linkedMissing,
  };
}

/**
 * Precedence per field: agent-specific → linked provider config → global default.
 * Throws ConfigError listing exactly which fields are unresolvable.
 */
export async function resolveProvider(
  agent: Pick<AgentRow, "provider_config_id" | "base_url" | "api_key_enc" | "model">
): Promise<ResolvedProvider> {
  const configs = await listConfigs();
  const parts = resolutionParts(agent, configs);

  if (parts.linkedMissing) {
    throw new ConfigError("تنظیمات متصل‌شده به این عامل حذف شده است؛ تنظیمات عامل را اصلاح یا بازنشانی کنید.");
  }
  if (parts.linkedDisabled) {
    throw new ConfigError("تنظیمات متصل‌شده به این عامل غیرفعال است.");
  }

  const missing: string[] = [];
  if (!parts.baseUrlRaw) missing.push("Base URL");
  if (!parts.model) missing.push("Model");
  if (missing.length > 0) {
    throw new ConfigError(
      `تنظیمات مدل ناقص است (${missing.join(" و ")}) — نه برای این عامل مقدار اختصاصی تعریف شده و نه تنظیمات پیش‌فرض فعالی وجود دارد.`
    );
  }

  let apiKey: string | null = null;
  if (parts.apiKeyEnc) {
    try {
      apiKey = decryptSecret(parts.apiKeyEnc);
    } catch (err) {
      throw new ConfigError(err instanceof Error ? err.message : "رمزگشایی کلید ناموفق بود.");
    }
  }

  return { baseUrl: normalizeBaseUrl(parts.baseUrlRaw), apiKey, model: parts.model };
}

/** Non-throwing preview of resolution for UI badges. */
export function previewResolution(
  agent: Pick<AgentRow, "provider_config_id" | "base_url" | "api_key_enc" | "model">,
  configs: StoredConfig[]
): ResolvedPreview {
  const parts = resolutionParts(agent, configs);
  const keySource: ResolvedPreview["keySource"] = parts.linkedMissing
    ? "none"
    : agent.api_key_enc
      ? "custom"
      : agent.provider_config_id && parts.apiKeyEnc
        ? "linked"
        : parts.apiKeyEnc
          ? "default"
          : "none";
  return {
    baseUrl: parts.baseUrlRaw || null,
    model: parts.model || null,
    keySource,
    complete: !!(parts.baseUrlRaw && parts.model) && !parts.linkedMissing && !parts.linkedDisabled,
  };
}

/** Client-safe agent projection incl. custom-settings flags and resolution preview. */
export function toAgentDTO(a: AgentRow, configs: StoredConfig[]): AgentDTO {
  return {
    id: a.id,
    name: a.name,
    slug: a.slug,
    description: a.description,
    systemPrompt: a.system_prompt,
    enabled: a.enabled === 1,
    providerConfigId: a.provider_config_id,
    customBaseUrl: a.base_url,
    customModel: a.model,
    customApiKeyHint: a.api_key_hint,
    hasCustomApiKey: !!a.api_key_enc,
    hasCustomSettings: !!(a.provider_config_id || a.base_url || a.model || a.api_key_enc),
    resolved: previewResolution(a, configs),
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}
