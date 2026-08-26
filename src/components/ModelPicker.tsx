"use client";

import { useState } from "react";
import type { ModelInfo } from "@/lib/types";
import { Alert, Badge, Button, Spinner, inputClass } from "@/components/ui";

/**
 * Fetches model lists through POST /api/models (server-side only).
 * The API key typed by the user is forwarded to OUR server route in the body
 * — per spec it is never persisted client-side and never returned back.
 */
export default function ModelPicker({
  baseUrl,
  apiKey,
  selected,
  onPick,
}: {
  baseUrl: string;
  apiKey: string;
  selected?: string | null;
  onPick: (modelId: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [query, setQuery] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey: apiKey.trim() || undefined }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          json && typeof json === "object" && "error" in json && typeof json.error === "string"
            ? json.error
            : `دریافت مدل‌ها ناموفق بود (HTTP ${res.status}).`;
        setError(msg);
        setModels(null);
        return;
      }
      if (!json || typeof json !== "object" || !("models" in json) || !Array.isArray(json.models)) {
        setError("پاسخ دریافت مدل‌ها معتبر نبود.");
        setModels(null);
        return;
      }
      setModels(json.models as ModelInfo[]);
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }

  const filtered = models?.filter((m) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-zinc-300 p-3">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={load} loading={loading}>
          دریافت مدل‌ها
        </Button>
        {!apiKey.trim() && (
          <span className="text-[11px] text-zinc-400">بدون API Key (برای سرویس‌های محلی)</span>
        )}
        {models && !loading && (
          <Badge tone="emerald">{models.length} مدل یافت شد</Badge>
        )}
      </div>

      {error && <Alert tone="red">{error}</Alert>}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Spinner className="h-4 w-4" /> در حال دریافت…
        </div>
      )}

      {models && models.length > 0 && (
        <>
          <input
            className={inputClass}
            placeholder="جست‌وجو در مدل‌ها…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="thin-scroll max-h-56 space-y-1 overflow-y-auto pl-1" dir="ltr">
            {filtered?.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onPick(m.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-mono text-xs transition-colors ${
                    selected === m.id
                      ? "bg-emerald-600 text-white"
                      : "bg-zinc-50 text-zinc-700 hover:bg-emerald-50 hover:text-emerald-800"
                  }`}
                >
                  <span>{m.id}</span>
                  {m.name && <span className="shrink-0 opacity-70">{m.name}</span>}
                </button>
              </li>
            ))}
            {filtered?.length === 0 && (
              <li className="px-2 py-1.5 text-xs text-zinc-400">مدلی با این عبارت یافت نشد.</li>
            )}
          </ul>
        </>
      )}
      {models && models.length === 0 && !error && (
        <p className="text-xs text-zinc-400">هیچ مدلی از این سرویس گزارش نشد.</p>
      )}
    </div>
  );
}
