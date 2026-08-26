import { NextResponse } from "next/server";
import { normalizeBaseUrl } from "@/lib/baseUrl";
import { decryptSecret } from "@/lib/crypto";
import { errorResponse, readJsonBody } from "@/lib/http";
import { fetchModels } from "@/lib/llm";
import { getConfig } from "@/lib/provider";

export const dynamic = "force-dynamic";

/**
 * Server-side model listing.
 * API key arrives in the request BODY, is used only here, and never comes back
 * in the response. When configId is given, the stored (encrypted) key is used
 * so the client does not need to re-send it.
 */
interface Body {
  configId?: string;
  baseUrl?: string;
  apiKey?: string;
}

export async function POST(req: Request) {
  const body = await readJsonBody<Body>(req);
  if (!body) return NextResponse.json({ error: "بدنه درخواست JSON معتبر نیست." }, { status: 400 });

  try {
    let baseUrl: string;
    let apiKey: string | null = null;

    const configId = body.configId?.trim();
    if (configId) {
      const cfg = await getConfig(configId);
      if (!cfg) return NextResponse.json({ error: "تنظیمات انتخاب‌شده یافت نشد." }, { status: 404 });
      baseUrl = cfg.baseUrl;
      apiKey = cfg.apiKeyEnc ? decryptSecret(cfg.apiKeyEnc) : null;
    } else {
      if (!body.baseUrl?.trim()) {
        return NextResponse.json(
          { error: "برای دریافت مدل‌ها، Base URL را وارد کنید یا یک تنظیمات ذخیره‌شده انتخاب کنید." },
          { status: 400 }
        );
      }
      baseUrl = normalizeBaseUrl(body.baseUrl);
      apiKey = body.apiKey?.trim() || null;
    }

    const models = await fetchModels({ baseUrl, apiKey });
    return NextResponse.json({ models, count: models.length });
  } catch (err) {
    return errorResponse(err);
  }
}
