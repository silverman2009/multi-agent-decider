import { NextResponse } from "next/server";
import { all, nowIso, ready, run, uuid } from "@/lib/db";
import type { AgentRow, DecisionRow } from "@/lib/db";
import { startDecisionRun } from "@/lib/engine";
import { errorResponse, readJsonBody } from "@/lib/http";
import { resolveProvider } from "@/lib/provider";
import { JUDGE_SLUG, ORCHESTRATOR_SLUG } from "@/lib/seed-agents";
import type { DecisionListItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ready();
    const rows = await all<DecisionRow & { steps_count: number }>(
      `SELECT d.*, (SELECT COUNT(*) FROM decision_steps s WHERE s.decision_id = d.id) AS steps_count
       FROM decisions d ORDER BY d.created_at DESC LIMIT 100`
    );
    const items: DecisionListItem[] = rows.map((d) => ({
      id: d.id,
      title: d.title,
      question: d.question,
      status: d.status as DecisionListItem["status"],
      createdAt: d.created_at,
      stepsCount: d.steps_count ?? 0,
    }));
    return NextResponse.json({ decisions: items });
  } catch (err) {
    return errorResponse(err);
  }
}

interface CreateBody {
  question?: string;
  title?: string;
}

export async function POST(req: Request) {
  const body = await readJsonBody<CreateBody>(req);
  if (!body) return NextResponse.json({ error: "بدنه درخواست JSON معتبر نیست." }, { status: 400 });

  const question = body.question?.trim() ?? "";
  if (question.length < 5) {
    return NextResponse.json({ error: "متن سؤال باید حداقل ۵ کاراکتر باشد." }, { status: 400 });
  }

  try {
    await ready();
    // Fail fast on pipeline prerequisites before persisting anything.
    const enabledAgents = await all<AgentRow>("SELECT * FROM agents WHERE enabled = 1");
    const orchestrator = enabledAgents.find((a) => a.slug === ORCHESTRATOR_SLUG);
    const judge = enabledAgents.find((a) => a.slug === JUDGE_SLUG);
    if (!orchestrator) {
      return NextResponse.json(
        { error: "عامل ارکستراتور غیرفعال یا حذف شده است؛ ابتدا آن را در صفحه عامل‌ها فعال کنید." },
        { status: 400 }
      );
    }
    if (!judge) {
      return NextResponse.json(
        { error: "عامل داور غیرفعال یا حذف شده است؛ ابتدا آن را در صفحه عامل‌ها فعال کنید." },
        { status: 400 }
      );
    }
    await resolveProvider(orchestrator); // throws ConfigError when incomplete

    const id = uuid();
    const now = nowIso();
    await run(
      `INSERT INTO decisions (id, title, question, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
      [id, body.title?.trim() || null, question, now, now]
    );
    startDecisionRun(id);
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

