import { NextResponse } from "next/server";
import { all, get, ready, run } from "@/lib/db";
import type { DecisionRow, StepRow } from "@/lib/db";
import { isDecisionRunning, rerunDecision } from "@/lib/engine";
import { errorResponse } from "@/lib/http";
import type {
  DecisionDetailDTO,
  DecisionStatus,
  DecisionStepDTO,
  JudgeOutput,
  OrchestratorAnalysis,
  SpecialistOutput,
  StepStatus,
  TokenUsage,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * JSON columns were written through sanitizers in engine.ts, so their shape is
 * trusted at read time — parse defensively and degrade to null.
 */
function parseJsonColumn<T>(txt: string | null): T | null {
  if (!txt) return null;
  try {
    const parsed: unknown = JSON.parse(txt);
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function toStepDTO(s: StepRow): DecisionStepDTO {
  const hasTokens =
    typeof s.prompt_tokens === "number" && typeof s.completion_tokens === "number" &&
    typeof s.total_tokens === "number" && (s.total_tokens > 0 || s.prompt_tokens > 0 || s.completion_tokens > 0);
  return {
    id: s.id,
    agentSlug: s.agent_slug,
    agentName: s.agent_name,
    orderIndex: s.order_index,
    status: s.status as StepStatus,
    output: parseJsonColumn<SpecialistOutput>(s.output),
    error: s.error,
    durationMs: s.duration_ms,
    usage: hasTokens
      ? {
          promptTokens: s.prompt_tokens ?? 0,
          completionTokens: s.completion_tokens ?? 0,
          totalTokens: s.total_tokens ?? 0,
        }
      : null,
  };
}

function sumUsage(a: TokenUsage | null, b: TokenUsage | null): TokenUsage | null {
  if (!a && !b) return null;
  return {
    promptTokens: (a?.promptTokens ?? 0) + (b?.promptTokens ?? 0),
    completionTokens: (a?.completionTokens ?? 0) + (b?.completionTokens ?? 0),
    totalTokens: (a?.totalTokens ?? 0) + (b?.totalTokens ?? 0),
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await ready();
    const d = await get<DecisionRow>("SELECT * FROM decisions WHERE id = ?", [params.id]);
    if (!d) return NextResponse.json({ error: "تصمیم یافت نشد." }, { status: 404 });

    const steps = await all<StepRow>(
      `SELECT id, decision_id, agent_slug, agent_name, order_index, status, output, error, duration_ms,
              prompt_tokens, completion_tokens, total_tokens
       FROM decision_steps WHERE decision_id = ? ORDER BY order_index ASC`,
      [params.id]
    );

    const stepDTOs = steps.map(toStepDTO);

    let usage = sumUsage(
      parseJsonColumn<TokenUsage>(d.orchestrator_usage),
      parseJsonColumn<TokenUsage>(d.judge_usage)
    );
    for (const s of stepDTOs) usage = sumUsage(usage, s.usage);

    const analysis = parseJsonColumn<OrchestratorAnalysis>(d.orchestrator_analysis);

    // Look up human-readable agent names and model labels for the UI
    const agentNames: Record<string, string> = {};
    const modelLabels: Record<string, string> = {};
    if (analysis) {
      const slugs = analysis.selectedAgents.map((s) => s.slug);
      if (slugs.length > 0) {
        const placeholders = slugs.map(() => "?").join(",");
        const rows = await all<{ slug: string; name: string }>(
          `SELECT slug, name FROM agents WHERE slug IN (${placeholders})`,
          slugs,
        );
        for (const r of rows) agentNames[r.slug] = r.name;
      }
      const modelIds = analysis.modelSelections.map((m) => m.modelId);
      if (modelIds.length > 0) {
        const placeholders = modelIds.map(() => "?").join(",");
        const rows = await all<{ id: string; label: string }>(
          `SELECT id, label FROM available_models WHERE id IN (${placeholders})`,
          modelIds,
        );
        for (const r of rows) modelLabels[r.id] = r.label;
      }
    }

    const detail: DecisionDetailDTO = {
      id: d.id,
      title: d.title,
      question: d.question,
      status: d.status as DecisionStatus,
      orchestratorAnalysis: analysis,
      steps: stepDTOs,
      judge: parseJsonColumn<JudgeOutput>(d.judge_output),
      finalAnswer: d.final_answer,
      error: d.error,
      failedStage: d.failed_stage,
      modelUsed: d.model_used,
      usage,
      durationMs: d.duration_ms,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    };
    return NextResponse.json({ decision: detail, agentNames, modelLabels });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    await rerunDecision(params.id);
    return NextResponse.json({ ok: true, id: params.id });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (isDecisionRunning(params.id)) {
      return NextResponse.json(
        { error: "این تصمیم در حال اجراست؛ حذف در این لحظه ممکن نیست." },
        { status: 409 }
      );
    }
    await ready();
    const row = await get<{ id: string }>("SELECT id FROM decisions WHERE id = ?", [params.id]);
    if (!row) return NextResponse.json({ error: "تصمیم یافت نشد." }, { status: 404 });
    await run("DELETE FROM decisions WHERE id = ?", [params.id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
