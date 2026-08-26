import { NextResponse } from "next/server";
import { errorResponse, readJsonBody } from "@/lib/http";
import {
  createAvailableModel,
  listAllModelRows,
  toAvailableModelDTO,
} from "@/lib/available-models";
import { listConfigs } from "@/lib/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [rows, configs] = await Promise.all([listAllModelRows(), listConfigs()]);
    const dtos = await Promise.all(rows.map((r) => toAvailableModelDTO(r)));
    return NextResponse.json({
      models: dtos,
      configs: configs.map((c) => ({ id: c.id, name: c.name ?? c.baseUrl, isDefault: c.isDefault })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

interface CreateBody {
  label?: string;
  model?: string;
  providerConfigId?: string | null;
  enabled?: boolean;
}

export async function POST(req: Request) {
  const body = await readJsonBody<CreateBody>(req);
  if (!body) return NextResponse.json({ error: "بدنه درخواست JSON معتبر نیست." }, { status: 400 });
  const label = body.label?.trim();
  const model = body.model?.trim();
  if (!label) return NextResponse.json({ error: "برچسب مدل الزامی است." }, { status: 400 });
  if (!model) return NextResponse.json({ error: "شناسه مدل الزامی است." }, { status: 400 });
  try {
    const created = await createAvailableModel({
      label,
      model,
      providerConfigId: body.providerConfigId ?? null,
      enabled: body.enabled,
    });
    return NextResponse.json({ model: await toAvailableModelDTO(created) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}