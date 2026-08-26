/**
 * Ox Alpha LLM client — every call happens SERVER-SIDE ONLY.
 *
 *  - GET  {baseUrl}/models           (list models)
 *  - POST {baseUrl}/chat/completions (OpenAI-compatible chat)
 *
 * Authorization: Bearer <key> is sent only when a key exists — local servers
 * like Ollama/LM Studio often run without keys. API keys are never logged,
 * never echoed in errors, and never included in any response payload.
 */
import { joinUrl } from "./baseUrl";
import { redactSecret } from "./crypto";
import type { TokenUsage } from "./types";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatResult = {
  content: string;
  usage: TokenUsage | null;
};

export type ProviderCreds = {
  baseUrl: string; // normalized
  apiKey: string | null;
  model: string;
};

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly detail?: string
  ) {
    super(message);
    this.name = "LlmError";
  }
}

function authHeaders(apiKey: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey && apiKey.trim()) h["Authorization"] = `Bearer ${apiKey.trim()}`;
  return h;
}

function describeHttpError(status: number, bodyText: string, key: string | null): LlmError {
  const safe = redactSecret(bodyText.slice(0, 400), key);
  if (status === 401 || status === 403) {
    return new LlmError(`احراز هویت رد شد (${status}) — API Key اشتباه یا بدون دسترسی است.`, status, safe);
  }
  if (status === 404) {
    return new LlmError(
      "یافت نشد (404) — Base URL یا نام مدل اشتباه است. Endpoint صحیح: {baseUrl}/models و {baseUrl}/chat/completions",
      status,
      safe
    );
  }
  if (status === 429) return new LlmError("محدودیت تعداد درخواست (429) — کمی بعد دوباره تلاش کنید.", status, safe);
  if (status >= 500) return new LlmError(`خطای سرور مدل (${status}).`, status, safe);
  return new LlmError(`درخواست به مدل ناموفق بود (HTTP ${status}).`, status, safe);
}
function networkErrorMessage(err: unknown): string {
  const parts: (string | undefined)[] = [];
  if (err && typeof err === "object") {
    const e = err as { name?: string; code?: string; cause?: unknown };
    parts.push(e.code);
    if (e.cause && typeof e.cause === "object") {
      const c = e.cause as { code?: string; errors?: { code?: string }[] };
      parts.push(c.code);
      parts.push(c.errors?.[0]?.code);
    }
    parts.push(e.name);
  }
  const code = parts.find(Boolean) ?? "";
  if (parts.includes("AbortError") || parts.includes("TimeoutError")) return "مهلت پاسخ مدل تمام شد (Timeout).";
  if (code === "ECONNREFUSED") return "اتصال برقرار نشد (ECONNREFUSED) — سرویس روی این آدرس در حال اجرا نیست.";
  if (code === "ENOTFOUND") return "آدرس یافت نشد (ENOTFOUND) — Base URL را بررسی کنید.";
  if (code === "EPROTO" || code === "ERR_SSL_WRONG_VERSION_NUMBER")
    return "خطای پروتکل — احتمالاً به جای https از http (یا برعکس) استفاده کرده‌اید.";
  return `خطای شبکه هنگام تماس با مدل${code ? ` (${code})` : ""}.`;
}

// ─── Models listing ──────────────────────────────────────────────────────────

/** Narrow an unknown /models item into {id,name?}; boundary for external API data. */
function asModelEntry(item: unknown): { id: string; name?: string } | null {
  if (typeof item === "string") {
    const id = item.trim();
    return id ? { id } : null;
  }
  if (!item || typeof item !== "object" || !("id" in item)) return null;
  const rawId: unknown = item.id;
  if (typeof rawId !== "string") return null;
  const id = rawId.trim();
  if (!id) return null;
  const hasName = "name" in item && typeof item.name === "string" && item.name.trim().length > 0;
  return hasName ? { id, name: (item.name as string).trim() } : { id };
}

export async function fetchModels(
  creds: { baseUrl: string; apiKey: string | null },
  timeoutMs = 20000
): Promise<{ id: string; name?: string }[]> {
  let res: Response;
  try {
    res = await fetch(joinUrl(creds.baseUrl, "/models"), {
      method: "GET",
      headers: authHeaders(creds.apiKey),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    throw new LlmError(networkErrorMessage(err));
  }
  if (!res.ok) {
    throw describeHttpError(res.status, await res.text().catch(() => ""), creds.apiKey);
  }

  const json: unknown = await res.json().catch(() => null);

  let list: unknown[] | null = null;
  if (Array.isArray(json)) list = json;
  else if (json && typeof json === "object" && "data" in json && Array.isArray(json.data)) list = json.data;
  if (!list) throw new LlmError("ساختار پاسخ مدل‌ها قابل خواندن نبود (انتظار data یا آرایه).");

  const byId = new Map<string, { id: string; name?: string }>();
  for (const item of list) {
    const entry = asModelEntry(item);
    if (entry && !byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// ─── Chat completion with tolerant JSON extraction ──────────────────────────

/** Narrow choices[0].message.content out of an OpenAI-compatible response body. */
function asChatContent(raw: unknown): string {
  if (!raw || typeof raw !== "object" || !("choices" in raw) || !Array.isArray(raw.choices)) return "";
  const first: unknown = raw.choices[0];
  if (!first || typeof first !== "object" || !("message" in first)) return "";
  const message: unknown = first.message;
  if (!message || typeof message !== "object" || !("content" in message)) return "";
  const content: unknown = message.content;
  return typeof content === "string" ? content : "";
}

export async function chatCompletionText(
  creds: ProviderCreds,
  messages: ChatMessage[],
  opts: { temperature?: number; timeoutMs?: number } = {}
): Promise<ChatResult> {
  let res: Response;
  try {
    res = await fetch(joinUrl(creds.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: authHeaders(creds.apiKey),
      body: JSON.stringify({
        model: creds.model,
        messages,
        temperature: opts.temperature ?? 0.4,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 180000),
      cache: "no-store",
    });
  } catch (err) {
    throw new LlmError(networkErrorMessage(err));
  }
  if (!res.ok) {
    throw describeHttpError(res.status, await res.text().catch(() => ""), creds.apiKey);
  }

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** finish_reason out of an OpenAI-shaped object, when present. */
function finishReasonOf(obj: unknown): string | undefined {
  if (!obj || typeof obj !== "object" || !("choices" in obj) || !Array.isArray(obj.choices)) return undefined;
  const first: unknown = obj.choices[0];
  if (!first || typeof first !== "object" || !("finish_reason" in first)) return undefined;
  const fr: unknown = first.finish_reason;
  return typeof fr === "string" ? fr : undefined;
}

/** Extract token usage from an OpenAI-shaped object, when present. */
function usageOf(obj: unknown): TokenUsage | null {
  if (!obj || typeof obj !== "object" || !("usage" in obj)) return null;
  const u: unknown = obj.usage;
  if (!u || typeof u !== "object") return null;
  const r = u as Record<string, unknown>;
  const prompt = typeof r.prompt_tokens === "number" ? Math.max(0, Math.round(r.prompt_tokens)) : 0;
  const comp = typeof r.completion_tokens === "number" ? Math.max(0, Math.round(r.completion_tokens)) : 0;
  const total = typeof r.total_tokens === "number" ? Math.max(0, Math.round(r.total_tokens)) : prompt + comp;
  return { promptTokens: prompt, completionTokens: comp, totalTokens: total };
}

/**
 * Tolerant chat response parser. Real-world gateways deviate from the spec:
 *  - single JSON object with Content-Type: text/event-stream AND a trailing
 *    `data: [DONE]` line (9router-style)
 *  - genuine SSE delta streams (choices[].delta.content fragments)
 *  - JSON objects embedded in prose
 */
function parseChatResponse(text: string): { content: string; finish?: string; usage: TokenUsage | null } {
  const direct = tryParseJson(text.trim());
  if (direct !== null) {
    return { content: asChatContent(direct), finish: finishReasonOf(direct), usage: usageOf(direct) };
  }

  const stripped = text.trim().replace(/data:\s*\[DONE\]\s*$/i, "").trim();
  const afterStrip = tryParseJson(stripped);
  if (afterStrip !== null) {
    return { content: asChatContent(afterStrip), finish: finishReasonOf(afterStrip), usage: usageOf(afterStrip) };
  }

  if (text.includes("data:")) {
    let merged = "";
    let finish: string | undefined;
    let usage: TokenUsage | null = null;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^data:\s*(.+)$/);
      if (!m || m[1].trim() === "[DONE]") continue;
      const piece = tryParseJson(m[1]);
      if (piece === null || typeof piece !== "object" || !("choices" in piece) || !Array.isArray(piece.choices)) continue;
      const first: unknown = piece.choices[0];
      if (!first || typeof first !== "object") continue;
      const bucket: unknown = "delta" in first ? first.delta : "message" in first ? first.message : undefined;
      if (bucket && typeof bucket === "object" && "content" in bucket && typeof bucket.content === "string") {
        merged += bucket.content;
      }
      const fr: unknown = "finish_reason" in first ? first.finish_reason : undefined;
      if (typeof fr === "string") finish = fr;
      const u = usageOf(piece);
      if (u && (u.totalTokens > 0 || u.promptTokens > 0 || u.completionTokens > 0)) usage = u;
    }
    if (merged.trim()) return { content: merged, finish, usage };
  }

  // Last resort: balanced-brace scan for an embedded JSON object.
  const start = text.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (!inStr && ch === "{") depth++;
      else if (!inStr && ch === "}") {
        depth--;
        if (depth === 0) {
          const obj = tryParseJson(text.slice(start, i + 1));
          if (obj !== null) {
            return { content: asChatContent(obj), finish: finishReasonOf(obj), usage: usageOf(obj) };
          }
          break;
        }
      }
    }
  }
  return { content: "", finish: undefined, usage: null };
}

  // Read as text once: some gateways lie about Content-Type (e.g. event-stream
  // carrying a single JSON object), and we want the raw body for diagnostics.
  const bodyText = await res.text();
  const parsed = parseChatResponse(bodyText);
  if (!parsed.content.trim()) {
    throw new LlmError(
      parsed.finish === "length"
        ? "مدل پیش از تولید پاسخ به سقف توکن رسید (finish_reason=length) — مدل دیگری امتحان کنید یا سؤال را کوتاه‌تر کنید."
        : "پاسخ مدل خالی بود یا ساختار مورد انتظار را نداشت.",
      undefined,
      `HTTP ${res.status} · ${res.headers.get("content-type") ?? "?"} · ${redactSecret(bodyText.slice(0, 300), creds.apiKey)}`
    );
  }
  return { content: parsed.content, usage: parsed.usage };
}

/** Extract a JSON object from raw model output (handles ```json fences & prose). */
export function extractJson<T>(raw: string, label = "پاسخ"): T {
  let s = raw.trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last <= first) {
    throw new LlmError(`${label} JSON نبود: ${s.slice(0, 160)}`);
  }
  const candidate = s.slice(first, last + 1);
  try {
    return JSON.parse(candidate) as T;
  } catch {
    /* fall through to balanced scan */
  }

  // Balanced-brace scan respecting strings/escapes.
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (!inStr && ch === "{") depth++;
    else if (!inStr && ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = candidate.slice(0, i + 1);
        return JSON.parse(slice) as T;
      }
    }
  }
  throw new LlmError(`${label} قابل تجزیه به JSON نبود: ${candidate.slice(0, 160)}…`);
}

export async function chatJson<T>(
  creds: ProviderCreds,
  messages: ChatMessage[],
  opts: { temperature?: number; timeoutMs?: number; label?: string } = {}
): Promise<{ data: T; usage: TokenUsage | null }> {
  const { content, usage } = await chatCompletionText(creds, messages, opts);
  return { data: extractJson<T>(content, opts.label), usage };
}
