import { NextResponse } from "next/server";
import { errorResponse, readJsonBody } from "@/lib/http";
import { deleteConfig, toConfigDTO, updateConfig } from "@/lib/provider";
import type { ConfigPatch } from "@/lib/provider";

export const dynamic = "force-dynamic";

function toPatch(b: Record<string, unknown>): ConfigPatch {
  const patch: ConfigPatch = {};
  if ("name" in b) patch.name = typeof b.name === "string" ? b.name : null;
  if (typeof b.baseUrl === "string") patch.baseUrl = b.baseUrl;
  if ("apiKey" in b && !b.clearApiKey) {
    const key = b.apiKey;
    if (typeof key === "string" && key.trim()) patch.apiKey = key.trim();
    else if (key === "" || key === null) patch.clearApiKey = true;
  }
  if (b.clearApiKey === true) patch.clearApiKey = true;
  if (typeof b.model === "string") patch.model = b.model;
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
  if (b.isDefault === true) patch.isDefault = true;
  return patch;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await readJsonBody<Record<string, unknown>>(req);
  if (!body) return NextResponse.json({ error: "بدنه درخواست JSON معتبر نیست." }, { status: 400 });
  try {
    const updated = await updateConfig(params.id, toPatch(body));
    return NextResponse.json({ config: toConfigDTO(updated) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const deleted = await deleteConfig(params.id);
    if (!deleted) return NextResponse.json({ error: "تنظیمات یافت نشد." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
