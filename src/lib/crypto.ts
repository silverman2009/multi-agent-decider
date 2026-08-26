import crypto from "crypto";

/**
 * AES-256-GCM encryption for provider API keys at rest.
 *
 * Security rules enforced here:
 *  - Key comes ONLY from ENCRYPTION_KEY env var.
 *  - In production the app refuses to run without it (module-level guard below
 *    fires as soon as any server route touching secrets is evaluated).
 *  - Keys are never logged and never returned to the client — only masked hints.
 */

const PREFIX_LEN = 3;
const TAIL_LEN = 4;

if (
  process.env.NODE_ENV === "production" &&
  typeof window === "undefined" &&
  !process.env.ENCRYPTION_KEY?.trim()
) {
  throw new Error(
    "[Ox Alpha] ENCRYPTION_KEY is required when NODE_ENV=production. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" " +
      "و آن را در .env یا متغیرهای محیطی تنظیم کنید."
  );
}

let cachedKey: Buffer | undefined;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) {
    // Dev only (guard above already stopped production).
    console.warn(
      "[Ox Alpha] ENCRYPTION_KEY is not set — falling back to an insecure DEV key. Do NOT use in production."
    );
    cachedKey = crypto.createHash("sha256").update("ox-alpha-insecure-dev-fallback").digest();
    return cachedKey;
  }
  cachedKey = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : // Passphrase mode: derive a proper 32-byte key.
      crypto.createHash("sha256").update(raw).digest();
  return cachedKey;
}

/** Encrypt → "v1:<iv b64>:<tag b64>:<ciphertext b64>" */
export function encryptSecret(plain: string): string {
  if (!plain) throw new Error("encryptSecret: empty plaintext");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  try {
    const [v, ivB64, tagB64, ctB64] = payload.split(":");
    if (v !== "v1" || !ivB64 || !tagB64 || !ctB64) throw new Error("bad format");
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(
      "رمزگشایی کلید ذخیره‌شده ممکن نشد؛ احتمالاً ENCRYPTION_KEY تغییر کرده است. تنظیمات را دوباره وارد کنید."
    );
  }
}

/** sk-****1234 style mask — safe to show/send to the client. */
export function maskSecret(plain: string): string {
  const p = plain.trim();
  if (!p) return "";
  if (p.length <= PREFIX_LEN + TAIL_LEN + 2) return "****";
  return `${p.slice(0, PREFIX_LEN)}****${p.slice(-TAIL_LEN)}`;
}

/** Remove any occurrence of secret from text (used before surfacing error bodies). */
export function redactSecret(text: string, secret?: string | null): string {
  if (!secret || !text) return text ?? "";
  let out = text.split(secret).join("***");
  if (secret.length > 8) {
    // also catch partially-escaped variants
    const head = secret.slice(0, 3);
    const tail = secret.slice(-4);
    if (!out.includes("***")) out = `${head}****${tail}`;
  }
  return out;
}
