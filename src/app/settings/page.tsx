"use client";

import { useCallback, useEffect, useState } from "react";
import ModelPicker from "@/components/ModelPicker";
import AvailableModelsManager from "@/components/AvailableModelsManager";
import { Alert, Badge, Button, Card, Field, Toggle, fmtDateTime, inputClass } from "@/components/ui";
import type { ProviderConfigDTO } from "@/lib/types";

type Editing = { id: string | null } // null = creating

interface FormState {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  makeDefault: boolean;
}

const EMPTY_FORM: FormState = { name: "", baseUrl: "", apiKey: "", model: "", enabled: true, makeDefault: false };

export default function SettingsPage() {
  const [configs, setConfigs] = useState<ProviderConfigDTO[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [maxAgentRetries, setMaxAgentRetries] = useState(3);
  const [retriesDraft, setRetriesDraft] = useState(3);
  const [savingRetries, setSavingRetries] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editHint, setEditHint] = useState<string | null>(null); // masked key of edited config
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"providers" | "models" | "general">("providers");

  const TABS: { id: "providers" | "models" | "general"; label: string }[] = [
    { id: "providers", label: "اتصال به مدل" },
    { id: "models", label: "کتابخانه مدل‌ها" },
    { id: "general", label: "اجرا و تلاش مجدد" },
  ];
  const TAB_META: Record<typeof tab, { title: string; sub: string }> = {
    providers: {
      title: "تنظیمات اتصال به مدل",
      sub: "اتصال OpenAI-compatible؛ تنظیمات پیش‌فرض برای همه عامل‌هایی که تنظیم اختصاصی ندارند استفاده می‌شود.",
    },
    models: {
      title: "کتابخانه مدل‌های موجود",
      sub: "مدل‌هایی که ارکستراتور برای هر عامل انتخاب می‌کند و دلیل انتخاب را ذکر می‌کند.",
    },
    general: {
      title: "اجرا و تلاش مجدد",
      sub: "تنظیم رفتار خط لوله تصمیم‌گیری هنگام خطای عامل‌ها.",
    },
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const json: unknown = await res.json().catch(() => null);
      if (res.ok && json && typeof json === "object" && "configs" in json && Array.isArray(json.configs)) {
        setConfigs(json.configs as ProviderConfigDTO[]);
        setDefaultId(
          json && typeof json === "object" && "defaultId" in json && typeof json.defaultId === "string"
            ? json.defaultId
            : null
        );
        const retriesRaw =
          json && typeof json === "object" && "maxAgentRetries" in json
            ? (json as Record<string, unknown>).maxAgentRetries
            : undefined;
        const retriesNum = typeof retriesRaw === "number" ? retriesRaw : 3;
        setMaxAgentRetries(retriesNum);
        setRetriesDraft(retriesNum);
        setError(null);
      } else {
        setError("خواندن تنظیمات ناموفق بود.");
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

  function startCreate() {
    setEditing({ id: null });
    setForm(EMPTY_FORM);
    setEditHint(null);
    setError(null);
  }

  function startEdit(c: ProviderConfigDTO) {
    setEditing({ id: c.id });
    setForm({
      name: c.name ?? "",
      baseUrl: c.baseUrl,
      apiKey: "",
      model: c.model,
      enabled: c.enabled,
      makeDefault: c.isDefault,
    });
    setEditHint(c.apiKeyHint);
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.baseUrl.trim()) return setError("Base URL الزامی است.");
    if (!form.model.trim()) return setError("فیلد Model الزامی است.");
    setSaving(true);
    setError(null);
    try {
      const isEdit = editing?.id != null;
      const body: Record<string, unknown> = {
        name: form.name.trim() || null,
        baseUrl: form.baseUrl,
        model: form.model,
        enabled: form.enabled,
      };
      if (!isEdit) {
        body.apiKey = form.apiKey.trim() || undefined;
        body.makeDefault = form.makeDefault || configs.length === 0;
      } else {
        if (form.apiKey.trim()) body.apiKey = form.apiKey.trim();
        else if (editHint) body.clearApiKey = true; // emptied while editing existing key → remove it
      }

      const res = await fetch(isEdit ? `/api/settings/${editing!.id}` : "/api/settings", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          json && typeof json === "object" && "error" in json && typeof json.error === "string"
            ? json.error
            : `ذخیره ناموفق بود (HTTP ${res.status}).`;
        setError(msg);
        return;
      }
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/settings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json: unknown = await res.json().catch(() => null);
      setError(
        json && typeof json === "object" && "error" in json && typeof json.error === "string"
          ? json.error
          : "به‌روزرسانی ناموفق بود."
      );
      return;
    }
    await load();
  }

  async function saveRetries() {
    const value = Math.max(0, Math.floor(Number(retriesDraft) || 0));
    setSavingRetries(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxAgentRetries: value }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          json && typeof json === "object" && "error" in json && typeof json.error === "string"
            ? json.error
            : "ذخیره تنظیمات ناموفق بود."
        );
        return;
      }
      setMaxAgentRetries(value);
      setRetriesDraft(value);
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setSavingRetries(false);
    }
  }

  async function remove(c: ProviderConfigDTO) {
    const label = c.name || `${c.baseUrl} (${c.model})`;
    if (!window.confirm(`حذف تنظیمات «${label}» قطعی است؟ عامل‌های متصل به آن به تنظیمات پیش‌فرض برمی‌گردند.`)) return;
    const res = await fetch(`/api/settings/${c.id}`, { method: "DELETE" });
    if (!res.ok) {
      const json: unknown = await res.json().catch(() => null);
      setError(
        json && typeof json === "object" && "error" in json && typeof json.error === "string"
          ? json.error
          : "حذف ناموفق بود."
      );
      return;
    }
    if (editing?.id === c.id) setEditing(null);
    await load();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{TAB_META[tab].title}</h1>
          <p className="mt-1 text-sm text-zinc-500">{TAB_META[tab].sub}</p>
        </div>
        {tab === "providers" && !editing && (
          <Button onClick={startCreate}>+ تنظیمات جدید</Button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-zinc-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Providers tab */}
      {tab === "providers" && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {editing !== null && (
            <Card title={editing.id ? "ویرایش تنظیمات" : "تنظیمات جدید"}>
              <form onSubmit={save} className="space-y-3">
                <Field label="نام (اختیاری)">
                  <input
                    className={inputClass}
                    placeholder="مثلاً: OpenRouter اصلی"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </Field>
                <Field
                  label="Base URL"
                  hint={`مثال: https://api.openai.com/v1 یا https://openrouter.ai/api/v1 یا http://localhost:11434/v1`}
                >
                  <input
                    dir="ltr"
                    className={`${inputClass} font-mono text-xs`}
                    placeholder="https://api.openai.com/v1"
                    value={form.baseUrl}
                    onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                  />
                </Field>
                <Field
                  label="API Key"
                  hint={
                    editHint
                      ? `کلید ذخیره‌شده فعلی: ${editHint} — برای تغییر مقدار جدید وارد کنید؛ خالی بگذارید تا حذف شود.`
                      : "فقط سمت سرور استفاده و رمزنگاری می‌شود (AES-256-GCM)."
                  }
                >
                  <input
                    dir="ltr"
                    type="password"
                    autoComplete="new-password"
                    className={`${inputClass} font-mono text-xs`}
                    placeholder={editHint ? "برای حذف خالی بگذارید" : "sk-…"}
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  />
                </Field>

                <Field label="Model">
                  <input
                    dir="ltr"
                    className={`${inputClass} font-mono text-xs`}
                    placeholder="gpt-4o-mini"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                  />
                </Field>

                {(form.baseUrl.trim() || editing.id) && (
                  <ModelPicker
                    baseUrl={form.baseUrl}
                    apiKey={form.apiKey}
                    selected={form.model}
                    onPick={(m) => setForm((f) => ({ ...f, model: m }))}
                  />
                )}

                <div className="flex flex-wrap items-center gap-4 pt-1">
                  <label className="flex items-center gap-2 text-sm text-zinc-600">
                    <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="فعال" />
                    فعال
                  </label>
                  {!editing.id && (
                    <label className="flex items-center gap-2 text-sm text-zinc-600">
                      <Toggle
                        checked={form.makeDefault}
                        onChange={(v) => setForm({ ...form, makeDefault: v })}
                        label="پیش‌فرض"
                      />
                      تنظیم به‌عنوان پیش‌فرض
                    </label>
                  )}
                </div>

                {error && <Alert tone="red">{error}</Alert>}

                <div className="flex gap-2 pt-1">
                  <Button type="submit" loading={saving}>
                    ذخیره
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                    انصراف
                  </Button>
                </div>
              </form>
            </Card>
          )}

          <Card title={`تنظیمات ذخیره‌شده (${configs.length})`}>
            {loading ? (
              <p className="py-6 text-center text-sm text-zinc-400">در حال بارگذاری…</p>
            ) : configs.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-400">
                هنوز تنظیمی ذخیره نشده است. اولین تنظیم به‌طور خودکار پیش‌فرض می‌شود.
              </p>
            ) : (
              <ul className="space-y-3">
                {configs.map((c) => (
                  <li key={c.id} className="rounded-lg border border-zinc-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-800">
                          {c.name || "(بی‌نام)"}
                          {c.isDefault && <Badge tone="emerald">پیش‌فرض</Badge>}
                          {!c.enabled && <Badge tone="red">غیرفعال</Badge>}
                        </p>
                        <p dir="ltr" className="mt-1 truncate font-mono text-[11px] text-zinc-500">
                          {c.baseUrl} · {c.model}
                        </p>
                        <p dir="ltr" className="font-mono text-[11px] text-zinc-400">
                          Key: {c.hasApiKey ? c.apiKeyHint : "—"}
                        </p>
                        <p className="mt-0.5 text-[10px] text-zinc-300">{fmtDateTime(c.updatedAt)}</p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {!c.isDefault && (
                          <Button size="sm" variant="ghost" onClick={() => patch(c.id, { isDefault: true })}>
                            پیش‌فرض کن
                          </Button>
                        )}
                        <label className="flex items-center gap-1 px-1 text-xs text-zinc-500">
                          <Toggle checked={c.enabled} onChange={(v) => patch(c.id, { enabled: v })} label="فعال" />
                        </label>
                        <Button size="sm" variant="ghost" onClick={() => startEdit(c)}>
                          ویرایش
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => remove(c)}>
                          حذف
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {defaultId === null && !loading && configs.length > 0 && (
              <Alert tone="amber">هیچ تنظیم پیش‌فرض فعالی وجود ندارد؛ یکی را پیش‌فرض کنید.</Alert>
            )}
          </Card>
        </div>
      )}

      {/* Models tab */}
      {tab === "models" && <AvailableModelsManager />}

      {/* General tab */}
      {tab === "general" && (
        <Card title="تلاش مجدد عامل‌ها">
          <div className="flex flex-wrap items-end gap-3">
            <Field
              label="حداکثر تعداد تلاش برای هر عامل"
              hint="اگر یک عامل نتواند پاسخ تولید کند، همین تعداد بار دیگر تلاش می‌شود؛ در صورت ادامه‌ی شکست، کل عملیات همان‌جا ناموفق پایان می‌یابد."
            >
              <input
                type="number"
                min={0}
                max={20}
                dir="ltr"
                className={`${inputClass} w-32 font-mono text-xs`}
                value={retriesDraft}
                onChange={(e) => setRetriesDraft(e.target.value === "" ? 0 : Number(e.target.value))}
              />
            </Field>
            <Button onClick={() => void saveRetries()} loading={savingRetries}>
              ذخیره
            </Button>
            {maxAgentRetries !== retriesDraft && !savingRetries && (
              <span className="pb-2 text-xs text-zinc-400">تغییر ذخیره نشده است</span>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
