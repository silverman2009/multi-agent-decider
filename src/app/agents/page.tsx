"use client";

import { useCallback, useEffect, useState } from "react";
import ModelPicker from "@/components/ModelPicker";
import { Alert, Badge, Button, Card, Field, Spinner, Toggle, inputClass } from "@/components/ui";
import type { AgentDTO, ProviderConfigDTO } from "@/lib/types";

const PROTECTED = new Set(["orchestrator", "judge"]);

const KEY_SOURCE_LABEL: Record<string, string> = {
  custom: "کلید اختصاصی",
  linked: "کلید تنظیم متصل",
  default: "کلید پیش‌فرض",
  none: "بدون کلید",
};

type SourceMode = "default" | "config" | "manual";

interface EditorState {
  name: string;
  description: string;
  systemPrompt: string;
  source: SourceMode;
  configId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

function editorFrom(agent: AgentDTO): EditorState {
  return {
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    source: agent.providerConfigId ? "config" : agent.hasCustomSettings ? "manual" : "default",
    configId: agent.providerConfigId ?? "",
    baseUrl: agent.customBaseUrl ?? "",
    apiKey: "",
    model: agent.customModel ?? "",
  };
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentDTO[]>([]);
  const [configs, setConfigs] = useState<ProviderConfigDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, sRes] = await Promise.all([
        fetch("/api/agents", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      const aJson: unknown = await aRes.json().catch(() => null);
      const sJson: unknown = await sRes.json().catch(() => null);
      if (aRes.ok && aJson && typeof aJson === "object" && "agents" in aJson) {
        setAgents((aJson as { agents: AgentDTO[] }).agents);
        setError(null);
      } else setError("خواندن فهرست عامل‌ها ناموفق بود.");
      if (sRes.ok && sJson && typeof sJson === "object" && "configs" in sJson) {
        setConfigs((sJson as { configs: ProviderConfigDTO[] }).configs);
      }
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleOpen(agent: AgentDTO) {
    if (openId === agent.id) {
      setOpenId(null);
      setEditor(null);
    } else {
      setOpenId(agent.id);
      setEditor(editorFrom(agent));
      setError(null);
    }
  }

  async function patch(agent: AgentDTO, body: Record<string, unknown>) {
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      setError(
        json && typeof json === "object" && "error" in json && typeof json.error === "string"
          ? json.error
          : "به‌روزرسانی ناموفق بود."
      );
      return false;
    }
    await load();
    return true;
  }

  async function saveEditor(agent: AgentDTO) {
    if (!editor) return;
    if (editor.source !== "default" && !editor.name.trim()) return setError("نام عامل الزامی است.");
    if (editor.source === "manual" && !editor.baseUrl.trim()) return setError("Base URL برای حالت دستی الزامی است.");
    if (editor.source === "manual" && !editor.model.trim()) return setError("Model برای حالت دستی الزامی است.");
    setSaving(true);
    setError(null);
    try {
      const base: Record<string, unknown> = {
        name: editor.name.trim(),
        description: editor.description.trim(),
        systemPrompt: editor.systemPrompt.trim(),
      };
      let body: Record<string, unknown> = base;
      if (editor.source === "default") {
        body = { ...base, providerConfigId: null, baseUrl: null, model: null };
      } else if (editor.source === "config") {
        if (!editor.configId) return setError("یک تنظیمات ذخیره‌شده را انتخاب کنید.");
        body = { ...base, providerConfigId: editor.configId, baseUrl: null, model: null };
      } else {
        body = { ...base, providerConfigId: null, baseUrl: editor.baseUrl, model: editor.model };
        if (editor.apiKey.trim()) body.apiKey = editor.apiKey.trim();
      }
      const ok = await patch(agent, body);
      if (ok) {
        setOpenId(null);
        setEditor(null);
      }
    } finally {
      setSaving(false);
    }
  }

  async function removeCustom(agent: AgentDTO) {
    if (!window.confirm(`تنظیمات اختصاصی «${agent.name}» حذف شود و به تنظیمات پیش‌فرض عمومی برگردد؟`)) return;
    const ok = await patch(agent, { providerConfigId: null, baseUrl: null, model: null, clearApiKey: true });
    if (ok && openId === agent.id) {
      setEditor(editorFrom({ ...agent, providerConfigId: null, customBaseUrl: null, customModel: null }));
    }
  }

  async function removeAgent(agent: AgentDTO) {
    if (!window.confirm(`حذف عامل «${agent.name}» قطعی است؟`)) return;
    const res = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
    if (!res.ok) {
      const json: unknown = await res.json().catch(() => null);
      setError(
        json && typeof json === "object" && "error" in json && typeof json.error === "string"
          ? json.error
          : "حذف ناموفق بود."
      );
      return;
    }
    if (openId === agent.id) {
      setOpenId(null);
      setEditor(null);
    }
    await load();
  }

  if (loading && agents.length === 0) {
    return (
      <div className="flex items-center justify-center py-24 text-zinc-400">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">مدیریت عامل‌ها</h1>
        <p className="mt-1 text-sm text-zinc-500">
          ارکستراتور در هر اجرا فقط عامل‌های مرتبط با سؤال را فعال می‌کند. هر عامل می‌تواند تنظیمات مدل اختصاصی داشته باشد.
        </p>
      </div>

      {error && <Alert tone="red">{error}</Alert>}

      <div className="grid gap-3 md:grid-cols-2">
        {agents.map((agent) => {
          const isOpen = openId === agent.id;
          const protectedSlug = PROTECTED.has(agent.slug);
          return (
            <Card key={agent.id} className={isOpen ? "border-emerald-300 md:col-span-2" : undefined}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-zinc-900">{agent.name}</h2>
                    <span dir="ltr" className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                      {agent.slug}
                    </span>
                    {!agent.enabled && <Badge tone="red">غیرفعال</Badge>}
                    {agent.enabled &&
                      (agent.resolved.complete ? (
                        <Badge tone={agent.hasCustomSettings ? "blue" : "zinc"}>
                          {agent.hasCustomSettings ? "تنظیمات اختصاصی" : "تنظیمات پیش‌فرض"}
                        </Badge>
                      ) : (
                        <Badge tone="amber">تنظیمات ناقص</Badge>
                      ))}
                  </div>
                  <p className="mt-1.5 max-w-xl text-xs leading-6 text-zinc-500">{agent.description}</p>
                  <p dir="ltr" className="mt-1 font-mono text-[10px] text-zinc-400">
                    {agent.resolved.baseUrl ?? "?"} · {agent.resolved.model ?? "?"} ·{" "}
                    {KEY_SOURCE_LABEL[agent.resolved.keySource]}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Toggle
                    checked={agent.enabled}
                    disabled={protectedSlug}
                    onChange={(v) => void patch(agent, { enabled: v })}
                    label={`فعال بودن ${agent.name}`}
                  />
                  <Button size="sm" variant="ghost" onClick={() => toggleOpen(agent)}>
                    {isOpen ? "بستن" : "ویرایش"}
                  </Button>
                  {!protectedSlug && (
                    <Button size="sm" variant="danger" onClick={() => void removeAgent(agent)}>
                      حذف
                    </Button>
                  )}
                </div>
              </div>

              {isOpen && editor && (
                <div className="mt-4 space-y-4 border-t border-zinc-100 pt-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="نام">
                      <input
                        className={inputClass}
                        value={editor.name}
                        onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                      />
                    </Field>
                    <Field label="توضیح (برای ارکستراتور)">
                      <input
                        className={inputClass}
                        value={editor.description}
                        onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                      />
                    </Field>
                  </div>

                  {/* Model settings */}
                  <fieldset className="space-y-3 rounded-lg border border-dashed border-zinc-300 p-3">
                    <legend className="px-1 text-xs font-bold text-zinc-600">تنظیمات مدل این عامل</legend>
                    <div className="flex flex-wrap gap-4 text-xs">
                      {(
                        [
                          ["default", "استفاده از تنظیمات پیش‌فرض عمومی"],
                          ["config", "اتصال به تنظیمات ذخیره‌شده"],
                          ["manual", "ورود دستی Base URL / Key / Model"],
                        ] as [SourceMode, string][]
                      ).map(([mode, label]) => (
                        <label key={mode} className="flex items-center gap-1.5 text-zinc-600">
                          <input
                            type="radio"
                            name={`src-${agent.id}`}
                            checked={editor.source === mode}
                            onChange={() => setEditor({ ...editor, source: mode })}
                          />
                          {label}
                        </label>
                      ))}
                    </div>

                    {editor.source === "config" && (
                      <Field label="تنظیمات ذخیره‌شده">
                        <select
                          className={inputClass}
                          value={editor.configId}
                          onChange={(e) => setEditor({ ...editor, configId: e.target.value })}
                        >
                          <option value="">— انتخاب کنید —</option>
                          {configs.map((c) => (
                            <option key={c.id} value={c.id}>
                              {(c.name || c.baseUrl) + ` · ${c.model}`}
                              {c.isDefault ? " ★" : ""}
                              {c.enabled ? "" : " (غیرفعال)"}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}

                    {editor.source === "manual" && (
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Base URL">
                          <input
                            dir="ltr"
                            className={`${inputClass} font-mono text-xs`}
                            placeholder="https://api.openai.com/v1"
                            value={editor.baseUrl}
                            onChange={(e) => setEditor({ ...editor, baseUrl: e.target.value })}
                          />
                        </Field>
                        <Field
                          label="API Key"
                          hint={
                            agent.customApiKeyHint
                              ? `ذخیره‌شده: ${agent.customApiKeyHint} — مقدار جدید جایگزین می‌کند.`
                              : "اختیاری — برای سرویس‌های محلی خالی بگذارید."
                          }
                        >
                          <input
                            dir="ltr"
                            type="password"
                            autoComplete="new-password"
                            className={`${inputClass} font-mono text-xs`}
                            placeholder="sk-…"
                            value={editor.apiKey}
                            onChange={(e) => setEditor({ ...editor, apiKey: e.target.value })}
                          />
                        </Field>
                        <Field label="Model">
                          <input
                            dir="ltr"
                            className={`${inputClass} font-mono text-xs`}
                            value={editor.model}
                            onChange={(e) => setEditor({ ...editor, model: e.target.value })}
                          />
                        </Field>
                        <div className="self-end">
                          <ModelPicker
                            baseUrl={editor.baseUrl}
                            apiKey={editor.apiKey}
                            selected={editor.model}
                            onPick={(m) => setEditor((s) => (s ? { ...s, model: m } : s))}
                          />
                        </div>
                      </div>
                    )}
                    {configs.length === 0 && editor.source === "config" && (
                      <Alert tone="amber">هنوز تنظیمی ذخیره نکرده‌اید؛ ابتدا در صفحه تنظیمات یکی بسازید.</Alert>
                    )}
                  </fieldset>

                  <Field label="System Prompt">
                    <textarea
                      rows={7}
                      className={`${inputClass} text-xs leading-6`}
                      value={editor.systemPrompt}
                      onChange={(e) => setEditor({ ...editor, systemPrompt: e.target.value })}
                    />
                  </Field>

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void saveEditor(agent)} loading={saving}>
                      ذخیره تغییرات
                    </Button>
                    {agent.hasCustomSettings && (
                      <Button variant="ghost" onClick={() => void removeCustom(agent)}>
                        حذف تنظیمات اختصاصی
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
