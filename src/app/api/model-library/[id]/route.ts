import { NextResponse } from "next/server";
import { errorResponse, readJsonBody } from "@/lib/http";
import { deleteAvailableModel, getAvailableModel, toAvailableModelDTO } from "@/lib/available-models";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const ok = await deleteAvailableModel(params.id);
    if (!ok) return NextResponse.json({ error: "مدل یافت نشد." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}