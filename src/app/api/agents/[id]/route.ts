import { NextResponse } from "next/server";
import { errorResponse, readJsonBody } from "@/lib/http";
import { deleteAgent, getAgentById, listConfigs, toAgentDTO, updateAgent } from "@/lib/provider";
import type { AgentPatch } from "@/lib/provider";

export const dynamic = "force-dynamic";

function toPatch(b: Record<string, unknown>): AgentPatch {
  const patch: AgentPatch = {};
  if (typeof b.name === "string") patch.name = b.name;
  if (typeof b.description === "string") patch.description = b.description;
  if (typeof b.systemPrompt === "string") patch.systemPrompt = b.systemPrompt;
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;

  if ("providerConfigId" in b) {
    patch.providerConfigId = typeof b.providerConfigId === "string" && b.providerConfigId ? b.providerConfigId : null;
  }
  if ("baseUrl" in b) {
    patch.baseUrl = typeof b.baseUrl === "string" && b.baseUrl.trim() ? b.baseUrl : null;
  }
  if ("model" in b) {
    patch.model = typeof b.model === "string" && b.model.trim() ? b.model : null;
  }
  if (typeof b.apiKey === "string" && b.apiKey.trim()) patch.apiKey = b.apiKey.trim();
  else if ("apiKey" in b || b.clearApiKey === true) patch.clearApiKey = true;
  return patch;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const agent = await getAgentById(params.id);
    if (!agent) return NextResponse.json({ error: "عامل یافت نشد." }, { status: 404 });
    const configs = await listConfigs();
    return NextResponse.json({ agent: toAgentDTO(agent, configs) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await readJsonBody<Record<string, unknown>>(req);
  if (!body) return NextResponse.json({ error: "بدنه درخواست JSON معتبر نیست." }, { status: 400 });
  try {
    await updateAgent(params.id, toPatch(body));
    const agent = await getAgentById(params.id);
    if (!agent) return NextResponse.json({ error: "عامل یافت نشد." }, { status: 404 });
    const configs = await listConfigs();
    return NextResponse.json({ agent: toAgentDTO(agent, configs) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const deleted = await deleteAgent(params.id);
    if (!deleted) return NextResponse.json({ error: "عامل یافت نشد." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
