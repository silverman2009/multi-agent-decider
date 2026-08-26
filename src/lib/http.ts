import { NextResponse } from "next/server";
import { ConfigError } from "@/lib/provider";
import { LlmError } from "@/lib/llm";

/** Map domain errors from lib layer to HTTP responses with Persian messages. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ConfigError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof LlmError) {
    const payload: { error: string; detail?: string; status?: number } = { error: err.message };
    if (err.detail) payload.detail = err.detail.slice(0, 400);
    return NextResponse.json(payload, { status: 502 });
  }
  if (err instanceof Error) {
    // Covers Base URL normalization and other validation errors.
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return NextResponse.json({ error: "خطای ناشناخته رخ داد." }, { status: 500 });
}
/** Parse a JSON request body; returns null on malformed input. */
export async function readJsonBody<T>(req: Request): Promise<T | null> {
  try {
    const raw = await req.text();
    if (!raw.trim()) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}
