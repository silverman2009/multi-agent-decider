import { NextResponse } from "next/server";
import { errorResponse, readJsonBody } from "@/lib/http";
import { getMetaValue, setMetaValue } from "@/lib/db";
import { createConfig, listConfigs, toConfigDTO } from "@/lib/provider";

export const dynamic = "force-dynamic";

const DEFAULT_MAX_RETRIES = 3;

export async function GET() {
  try {
    const configs = await listConfigs();
    const raw = await getMetaValue("max_agent_retries");
    const maxAgentRetries = raw ? parseInt(raw, 10) : DEFAULT_MAX_RETRIES;
    return NextResponse.json({
      configs: configs.map(toConfigDTO),
      defaultId: configs.find((c) => c.isDefault)?.id ?? null,
      maxAgentRetries: Number.isFinite(maxAgentRetries) && maxAgentRetries >= 0 ? maxAgentRetries : DEFAULT_MAX_RETRIES,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

interface PutBody {
  maxAgentRetries?: number;
}

export async function PUT(req: Request) {
  try {
    const body = await readJsonBody<PutBody>(req);
    if (!body || typeof body.maxAgentRetries !== "number" || !Number.isFinite(body.maxAgentRetries) || body.maxAgentRetries < 0) {
      return NextResponse.json({ error: "maxAgentRetries باید یک عدد نامنفی باشد." }, { status: 400 });
    }
    const value = String(Math.floor(body.maxAgentRetries));
    await setMetaValue("max_agent_retries", value);
    return NextResponse.json({ maxAgentRetries: Number(value) });
  } catch (err) {
    return errorResponse(err);
  }
}

interface CreateBody {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  enabled?: boolean;
  makeDefault?: boolean;
}

export async function POST(req: Request) {
  const body = await readJsonBody<CreateBody>(req);
  if (!body) return NextResponse.json({ error: "بدنه درخواست JSON معتبر نیست." }, { status: 400 });
  if (!body.baseUrl?.trim()) {
    return NextResponse.json({ error: "Base URL الزامی است." }, { status: 400 });
  }
  if (!body.model?.trim()) {
    return NextResponse.json({ error: "فیلد Model الزامی است." }, { status: 400 });
  }
  try {
    const created = await createConfig({
      name: body.name ?? null,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey ?? null,
      model: body.model,
      enabled: body.enabled,
      makeDefault: body.makeDefault,
    });
    return NextResponse.json({ config: toConfigDTO(created) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
