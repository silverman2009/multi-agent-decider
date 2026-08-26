"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Field, Toggle, inputClass } from "@/components/ui";
import type { AvailableModelDTO } from "@/lib/types";

type ConfigOpt = { id: string; name: string; isDefault: boolean };

interface FormState {
  label: string;
  model: string;
  providerConfigId: string; // "" = use default provider
  enabled: boolean;
}

const EMPTY: FormState = { label: "", model: "", providerConfigId: "", enabled: true };

export default function AvailableModelsManager() {
  const [models, setModels] = useState<AvailableModelDTO[]>([]);
  const [configs, setConfigs] = useState<ConfigOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/model-library", { cache: "no-store" });
      const json: unknown = await res.json().catch(() => null);
      if (res.ok && json && typeof json === "object" && "models" in json && Array.isArray(json.models)) {
        setModels(json.models as AvailableModelDTO[]);
        setConfigs(
          json && typeof json === "object" && "configs" in json && Array.isArray(json.configs)
            ? (json.configs as ConfigOpt[])
            : []
        );
        setError(null);
      } else {
        setError("خواندن مدل‌های موجود ناموفق بود.");
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

  async function fetchProviderModels() {
    if (!form.providerConfigId) {
      setError("برای دریافت مدل‌ها ابتدا یک تنظیمات (Provider) انتخاب کنید.");
      return;
    }
    setFetching(true);
    setError(null);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configId: form.providerConfigId }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          json && typeof json === "object" && "error" in json && typeof json.error === "string"
            ? json.error
            : "دریافت مدل‌ها ناموفق بود."
        );
        return;
      }
      const list =
        json && typeof json === "object" && "models" in json && Array.isArray(json.models)
          ? (json.models as { id?: string; name?: string }[])
          : [];
      setFetchedModels(list.map((m) => m.id).filter((x): x is string => !!x));
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setFetching(false);
    }
  }

  async function addModel(e: React.FormEvent) {
    e.preventDefault();
    if (!form.label.trim()) return setError("برچسب مدل الزامی است.");
    if (!form.model.trim()) return setError("شناسه مدل الزامی است.");
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/model-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: form.label.trim(),
          model: form.model.trim(),
          providerConfigId: form.providerConfigId || null,
          enabled: form.enabled,
        }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          json && typeof json === "object" && "error" in json && typeof json.error === "string"
            ? json.error
            : "افزودن مدل ناموفق بود."
        );
        return;
      }
      // Keep the chosen provider and fetched list so adding several models
      // from the same provider doesn't require re-selecting / re-fetching.
      setForm((f) => ({ ...f, label: "", model: "" }));
      await load();
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setSaving(false);
    }
  }

  async function removeModel(id: string, label: string) {
    if (!window.confirm(`حذف مدل «${label}» از کتابخانه قطعی است؟`)) return;
    const res = await fetch(`/api/model-library/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json: unknown = await res.json().catch(() => null);
      setError(
        json && typeof json === "object" && "error" in json && typeof json.error === "string"
          ? json.error
          : "حذف مدل ناموفق بود."
      );
      return;
    }
    await load();
  }

  return (
    <Card title="کتابخانه مدل‌های موجود">
      <p className="mb-3 text-xs leading-5 text-zinc-500">
        این مدل‌ها به ارکستراتور ارائه می‌شوند تا برای هر عامل، مناسب‌ترین مدل را با ذکر دلیل انتخاب کند.
      </p>

      {error && (
        <div className="mb-3">
          <Alert tone="red">{error}</Alert>
        </div>
      )}

      {/* Add form */}
      <form onSubmit={addModel} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="برچسب (نام نمایشی)">
            <input
              className={inputClass}
              placeholder="مثلاً: Qwen 72B قوی"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </Field>
          <Field
            label="شناسه مدل"
            hint={fetchedModels.length ? "یکی از مدل‌های دریافت‌شده را انتخاب کنید." : undefined}
          >
            <input
              dir="ltr"
              list="fetched-models"
              className={`${inputClass} font-mono text-xs`}
              placeholder="gpt-4o-mini"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
            {fetchedModels.length > 0 && (
              <datalist id="fetched-models">
                {fetchedModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            )}
          </Field>
        </div>

        <Field label="Provider (تنظیمات اتصال)" hint="خالی = استفاده از تنظیمات پیش‌فرض">
          <select
            className={inputClass}
            value={form.providerConfigId}
            onChange={(e) => {
              setForm({ ...form, providerConfigId: e.target.value });
              setFetchedModels([]);
            }}
          >
            <option value="">استفاده از پیش‌فرض</option>
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isDefault ? " (پیش‌فرض)" : ""}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="button" variant="ghost" onClick={() => void fetchProviderModels()} loading={fetching}>
            دریافت مدل‌ها از Provider
          </Button>
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="فعال" />
            فعال برای ارکستراتور
          </label>
        </div>

        <div>
          <Button type="submit" loading={saving}>
            افزودن مدل
          </Button>
        </div>
      </form>

      {/* Models list — at bottom so the form (most used action) is always visible */}
      <div className="mt-4 space-y-2 border-t border-zinc-100 pt-4">
        {loading ? (
          <p className="py-4 text-center text-sm text-zinc-400">در حال بارگذاری…</p>
        ) : models.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-400">
            هنوز مدلی تعریف نشده است. با فرم بالا مدل اضافه کنید.
          </p>
        ) : (
          models.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-zinc-800">{m.label}</p>
                  {!m.enabled && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">غیرفعال</span>}
                </div>
                <p className="mt-0.5 truncate text-xs text-zinc-400" dir="ltr">
                  {m.model} · {m.providerLabel}
                </p>
              </div>
              <button
                onClick={() => void removeModel(m.id, m.label)}
                className="shrink-0 rounded-md p-1.5 text-zinc-300 hover:bg-red-50 hover:text-red-500"
                title="حذف"
                aria-label="حذف"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}