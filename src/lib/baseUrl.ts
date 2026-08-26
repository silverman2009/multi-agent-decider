/**
 * OpenAI-compatible Base URL normalization.
 *
 * Rules:
 *  - trim whitespace
 *  - add http:// when scheme missing
 *  - strip ALL trailing slashes
 *  - keep an explicit /v1 path exactly once (never /v1/v1)
 *  - bare origin (no path at all) gets /v1 appended
 *  - any other custom path (e.g. /api, /ollama/v1 proxy prefixes) is preserved
 *
 * Models endpoint contract: GET {baseUrl}/models
 */
export function normalizeBaseUrl(input: string): string {
  let u = (input ?? "").trim();
  if (!u) throw new Error("Base URL الزامی است.");
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;

  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new Error(`Base URL نامعتبر است: ${input}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Base URL باید با http یا https شروع شود: ${input}`);
  }

  const path = parsed.pathname.replace(/\/+$/, ""); // trailing slashes gone
  const origin = parsed.origin;

  if (/^\/v1$/i.test(path)) return origin + "/v1"; // already canonical
  if (path === "") return origin + "/v1"; // bare host → append /v1
  return origin + path; // custom path — preserve verbatim
}

export function joinUrl(base: string, suffix: string): string {
  return `${base.replace(/\/+$/, "")}${suffix}`;
}
