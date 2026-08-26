import { NextResponse } from "next/server";
import { errorResponse, readJsonBody } from "@/lib/http";
import { createAgent, listAgentRows, listConfigs, toAgentDTO } from "@/lib/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [agents, configs] = await Promise.all([listAgentRows(), listConfigs()]);
    return NextResponse.json({ agents: agents.map((a) => toAgentDTO(a, configs)) });
  } catch (err) {
    return errorResponse(err);
  }
}

interface CreateBody {
  name?: string;
  slug?: string;
  description?: string;
  systemPrompt?: string;
  enabled?: boolean;
}

export async function POST(req: Request) {
  const body = await readJsonBody<CreateBody>(req);
  if (!body) return NextResponse.json({ error: "بدنه درخواست JSON معتبر نیست." }, { status: 400 });
  if (!body.name?.trim()) return NextResponse.json({ error: "نام عامل الزامی است." }, { status: 400 });
  if (!body.systemPrompt?.trim()) {
    return NextResponse.json({ error: "System Prompt برای عامل جدید الزامی است." }, { status: 400 });
  }
  try {
    const created = await createAgent({
      name: body.name,
      slug: body.slug,
      description: body.description,
      systemPrompt: body.systemPrompt,
      enabled: body.enabled,
    });
    const configs = await listConfigs();
    return NextResponse.json({ agent: toAgentDTO(created, configs) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
