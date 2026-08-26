import { all, get, getMetaValue, nowIso, ready, run, uuid } from "@/lib/db";
import type { AgentRow, DecisionRow, StepRow } from "@/lib/db";
import { chatJson } from "@/lib/llm";
import { LlmError } from "@/lib/llm";
import type { ChatMessage, ProviderCreds } from "@/lib/llm";
import { resolveProvider, createAgent, listConfigs } from "@/lib/provider";
import { JUDGE_SLUG, MAX_SPECIALISTS, ORCHESTRATOR_SLUG } from "@/lib/seed-agents";
import type {
  Complexity,
  JudgeOutput,
  ModelSelection,
  OrchestratorAnalysis,
  ProposedAgent,
  RiskLevel,
  SpecialistOutput,
  TokenUsage,
} from "@/lib/types";
import { listAvailableModels } from "@/lib/available-models";
import type { AvailableModelRow } from "@/lib/available-models";
import { getConfig } from "@/lib/provider";
import { decryptSecret } from "@/lib/crypto";

/**
 * Decision pipeline: orchestrator → selected specialists (sequential) → judge.
 * Progress is persisted per-step so the UI can poll live state.
 */

const activeRuns = new Set<string>();

export function isDecisionRunning(decisionId: string): boolean {
  return activeRuns.has(decisionId);
}

// ─── Sanitizers (model output is untrusted) ──────────────────────────────────

function asTrimmed(v: unknown, max = 6000): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function asStringArray(v: unknown, max = 12): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

function enumOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

const COMPLEXITIES = ["low", "medium", "high"] as const;
const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
const SEVERITIES = ["low", "medium", "high"] as const;
const PRIORITIES = ["high", "medium", "low"] as const;

/** Ensure a proposed agent has a useful system prompt even when the model omits one. */
function defaultProposedPrompt(slug: string, name: string): string {
  return `تو «${name}» از سیستم تصمیم‌یار Ox Alpha هستی. سؤال کاربر را از زاویه تخصصی خود تحلیل کن و خروجی را فقط به‌صورت JSON با این ساختار برگردان:
{"analysis":"...","recommendations":["..."],"risks":["..."],"confidence":0.0}
مهم: فقط JSON معتبر برگردان؛ بدون متن اضافه.`;
}

function sanitizeAnalysis(
  raw: unknown,
  existingSlugs: readonly string[],
  availableModelIds: Set<string> = new Set()
): { analysis: OrchestratorAnalysis; proposedAgents: ProposedAgent[] } {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  // Parse proposed agents first
  const proposedAgents: ProposedAgent[] = [];
  const proposedSlugs = new Set<string>();
  const PROTECTED = new Set([ORCHESTRATOR_SLUG, JUDGE_SLUG]);
  if (Array.isArray(obj.proposedAgents)) {
    for (const item of obj.proposedAgents) {
      if (!item || typeof item !== "object" || !("slug" in item)) continue;
      const slugRaw: unknown = item.slug;
      if (typeof slugRaw !== "string") continue;
      const slug = slugRaw.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
      if (!slug || slug.length < 2 || proposedSlugs.has(slug) || existingSlugs.includes(slug) || PROTECTED.has(slug)) continue;
      proposedSlugs.add(slug);
      const nameRaw: unknown = "name" in item ? item.name : undefined;
      const name = typeof nameRaw === "string" ? nameRaw.trim().slice(0, 60) : slug;
      const descRaw: unknown = "description" in item ? item.description : undefined;
      const description = typeof descRaw === "string" ? descRaw.trim().slice(0, 300) : `تحلیل‌گر تخصصی ${name}`;
      const spRaw: unknown = "systemPrompt" in item ? item.systemPrompt : undefined;
      const systemPrompt = typeof spRaw === "string" && spRaw.trim().length > 20 ? spRaw.trim() : defaultProposedPrompt(slug, name);
      proposedAgents.push({ slug, name, description, systemPrompt });
      if (proposedAgents.length >= MAX_SPECIALISTS) break;
    }
  }

  // Allowed slugs = existing + valid proposed
  const allowedSlugs = new Set<string>([...existingSlugs, ...proposedSlugs]);

  const chosen: { slug: string; reason: string }[] = [];
  const seenSlugs = new Set<string>();
  if (Array.isArray(obj.selectedAgents)) {
    for (const item of obj.selectedAgents) {
      if (!item || typeof item !== "object" || !("slug" in item)) continue;
      const slugRaw: unknown = item.slug;
      if (typeof slugRaw !== "string") continue;
      const slug = slugRaw.trim();
      if (!slug || seenSlugs.has(slug) || !allowedSlugs.has(slug)) continue;
      seenSlugs.add(slug);
      const reasonRaw: unknown = "reason" in item ? item.reason : "";
      chosen.push({
        slug,
        reason: (typeof reasonRaw === "string" ? reasonRaw.trim().slice(0, 400) : "") || "مرتبط با سؤال",
      });
      if (chosen.length >= MAX_SPECIALISTS) break;
    }
  }

  const orderSeen = new Set<string>();
  const executionOrder: string[] = [];
  for (const slug of asStringArray(obj.executionOrder, MAX_SPECIALISTS * 2)) {
    if (seenSlugs.has(slug) && !orderSeen.has(slug)) {
      orderSeen.add(slug);
      executionOrder.push(slug);
    }
  }
  for (const c of chosen) {
    if (!orderSeen.has(c.slug)) executionOrder.push(c.slug);
  }

  // Parse model selections
  const modelSelections: ModelSelection[] = [];
  const selSlugs = new Set(chosen.map((c) => c.slug));
  if (Array.isArray(obj.modelSelections)) {
    for (const item of obj.modelSelections) {
      if (!item || typeof item !== "object" || !("slug" in item) || !("modelId" in item)) continue;
      const slugRaw: unknown = item.slug;
      const midRaw: unknown = item.modelId;
      if (typeof slugRaw !== "string" || typeof midRaw !== "string" || !slugRaw.trim() || !midRaw.trim()) continue;
      if (!selSlugs.has(slugRaw.trim())) continue; // only for selected agents
      if (!availableModelIds.has(midRaw.trim())) continue; // must be a known available model
      const reasonRaw: unknown = "reason" in item ? item.reason : "";
      const reason = typeof reasonRaw === "string" ? reasonRaw.trim().slice(0, 300) : "";
      modelSelections.push({ slug: slugRaw.trim(), modelId: midRaw.trim(), reason });
    }
  }

  return {
    analysis: {
      topic: asTrimmed(obj.topic, 300),
      goal: asTrimmed(obj.goal, 800),
      complexity: enumOf<Complexity>(obj.complexity, COMPLEXITIES, "medium"),
      riskLevel: enumOf<RiskLevel>(obj.riskLevel, RISK_LEVELS, "medium"),
      missingInfo: asStringArray(obj.missingInfo),
      selectedAgents: chosen,
      executionOrder,
      proposedAgents,
      modelSelections,
    },
    proposedAgents,
  };
}

function sanitizeSpecialist(raw: unknown): SpecialistOutput {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const confRaw: unknown = obj.confidence;
  const confidence =
    typeof confRaw === "number" && Number.isFinite(confRaw) ? Math.min(1, Math.max(0, confRaw)) : 0.5;
  return {
    analysis: asTrimmed(obj.analysis, 8000),
    recommendations: asStringArray(obj.recommendations),
    risks: asStringArray(obj.risks),
    confidence,
  };
}

function sanitizeJudge(raw: unknown): JudgeOutput {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const risks: JudgeOutput["consolidatedRisks"] = [];
  if (Array.isArray(obj.consolidatedRisks)) {
    for (const r of obj.consolidatedRisks.slice(0, 12)) {
      if (!r || typeof r !== "object" || !("risk" in r)) continue;
      const riskText: unknown = r.risk;
      if (typeof riskText !== "string" || !riskText.trim()) continue;
      const sevUnknown: unknown = "severity" in r ? r.severity : undefined;
      const mitUnknown: unknown = "mitigation" in r ? r.mitigation : "";
      risks.push({
        risk: riskText.trim().slice(0, 500),
        severity: enumOf<"low" | "medium" | "high">(sevUnknown, SEVERITIES, "medium"),
        mitigation: typeof mitUnknown === "string" ? mitUnknown.trim().slice(0, 600) : "",
      });
    }
  }

  const actions: JudgeOutput["actionItems"] = [];
  if (Array.isArray(obj.actionItems)) {
    for (const a of obj.actionItems.slice(0, 15)) {
      if (!a || typeof a !== "object") continue;
      const detailUnknown: unknown = "detail" in a ? a.detail : "step" in a ? a.step : undefined;
      if (typeof detailUnknown !== "string" || !detailUnknown.trim()) continue;
      const stepUnknown: unknown = "step" in a ? a.step : "";
      const prioUnknown: unknown = "priority" in a ? a.priority : undefined;
      actions.push({
        step: (typeof stepUnknown === "string" ? stepUnknown.trim().slice(0, 120) : "") || `${actions.length + 1}`,
        detail: detailUnknown.trim().slice(0, 800),
        priority: enumOf<"high" | "medium" | "low">(prioUnknown, PRIORITIES, "medium"),
      });
    }
  }

  return {
    summary: asTrimmed(obj.summary, 4000),
    finalAnswer: asTrimmed(obj.finalAnswer, 8000),
    consolidatedRisks: risks,
    actionItems: actions,
    notes: asTrimmed(obj.notes, 2000),
  };
}

function trimText(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function contextBlock(question: string, analysis: OrchestratorAnalysis | null): string {
  if (!analysis) return `### سؤال کاربر\n${question}`;
  return [
    "### تحلیل ارکستراتور",
    `موضوع: ${analysis.topic || "—"}`,
    `هدف: ${analysis.goal || "—"}`,
    `پیچیدگی: ${analysis.complexity}`,
    `سطح ریسک: ${analysis.riskLevel}`,
    `اطلاعات ناقص: ${analysis.missingInfo.join("، ") || "—"}`,
  ].join("\n");
}

function specialistMessages(
  agent: Pick<AgentRow, "system_prompt" | "name" | "slug">,
  question: string,
  analysis: OrchestratorAnalysis | null,
  previous: { name: string; analysis: string }[]
): ChatMessage[] {
  const prevSection =
    previous.length === 0
      ? "(تو اولین تحلیل‌گری)"
      : previous.map((p) => `[${p.name}]\n${trimText(p.analysis, 700)}`).join("\n\n");
  return [
    { role: "system", content: agent.system_prompt },
    {
      role: "user",
      content:
        `agent_slug: ${agent.slug}\nagent_name: ${agent.name}\n\n` +
        `### سؤال کاربر\n${question}\n\n${contextBlock(question, analysis)}\n\n` +
        `### خروجی عامل‌های پیشین\n${prevSection}\n\n` +
        `وظیفه: از زاویه تخصصی خود («${agent.name}») پاسخ بده؛ به نقاط مرتبط دیگر عامل‌ها ارجاع بده.`,
    },
  ];
}

function judgeMessages(
  systemPrompt: string,
  question: string,
  analysis: OrchestratorAnalysis | null,
  outputs: { name: string; analysis: string }[]
): ChatMessage[] {
  const section =
    outputs.length === 0
      ? "(هیچ متخصصی انتخاب نشد — فقط بر اساس تحلیل ارکستراتور جمع‌بندی کن.)"
      : outputs.map((o) => `[${o.name}]\n${trimText(o.analysis, 1400)}`).join("\n\n");
  return [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `### سؤال کاربر\n${question}\n\n${contextBlock(question, analysis)}\n\n### پاسخ متخصص‌ها\n${section}\n\nاکنون جمع‌بندی نهایی را طبق ساختار خواسته‌شده تولید کن.`,
    },
  ];
}

// ─── Persistence helpers ─────────────────────────────────────────────────────

type DecisionPatch = {
  status?: string;
  orchestratorAnalysis?: OrchestratorAnalysis | null;
  judgeOutput?: JudgeOutput | null;
  finalAnswer?: string | null;
  error?: string | null;
  failedStage?: string | null;
  modelUsed?: string | null;
  orchestratorUsage?: TokenUsage | null;
  judgeUsage?: TokenUsage | null;
  durationMs?: number | null;
};

async function patchDecision(id: string, patch: DecisionPatch): Promise<void> {
  const colByField: Record<keyof DecisionPatch, string> = {
    status: "status",
    orchestratorAnalysis: "orchestrator_analysis",
    judgeOutput: "judge_output",
    finalAnswer: "final_answer",
    error: "error",
    failedStage: "failed_stage",
    modelUsed: "model_used",
    orchestratorUsage: "orchestrator_usage",
    judgeUsage: "judge_usage",
    durationMs: "duration_ms",
  };
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key of Object.keys(patch) as (keyof DecisionPatch)[]) {
    let value: unknown = patch[key];
    if (value === undefined) continue;
    if (
      (key === "orchestratorAnalysis" || key === "judgeOutput" || key === "orchestratorUsage" || key === "judgeUsage") &&
      value !== null
    ) {
      value = JSON.stringify(value);
    }
    sets.push(`${colByField[key]} = ?`);
    vals.push(value);
  }
  sets.push("updated_at = ?");
  vals.push(nowIso(), id);
  await run(`UPDATE decisions SET ${sets.join(", ")} WHERE id = ?`, vals);
}

async function insertStep(
  decisionId: string,
  agent: Pick<AgentRow, "slug" | "name">,
  orderIndex: number
): Promise<string> {
  const id = uuid();
  const now = nowIso();
  await run(
    `INSERT INTO decision_steps (id, decision_id, agent_slug, agent_name, order_index, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [id, decisionId, agent.slug, agent.name, orderIndex, now, now]
  );
  return id;
}

type StepPatch = {
  status?: string;
  output?: SpecialistOutput | null;
  error?: string | null;
  durationMs?: number | null;
  usage?: TokenUsage | null;
};

/** Build ProviderCreds from an available-model row (resolve its provider config). */
async function resolveModelCreds(m: AvailableModelRow): Promise<ProviderCreds> {
  const configs = await listConfigs();
  let baseUrl = "";
  let apiKey: string | null = null;
  if (m.provider_config_id) {
    const cfg = configs.find((c) => c.id === m.provider_config_id);
    if (!cfg) throw new Error(`تنظیمات متصل به مدل «${m.label}» یافت نشد یا حذف شده است.`);
    baseUrl = cfg.baseUrl;
    if (cfg.apiKeyEnc) apiKey = decryptSecret(cfg.apiKeyEnc);
  } else {
    const def = configs.find((c) => c.isDefault && c.enabled);
    if (!def) throw new Error("هیچ تنظیمات پیش‌فرض فعالی برای مدل انتخاب‌شده وجود ندارد.");
    baseUrl = def.baseUrl;
    if (def.apiKeyEnc) apiKey = decryptSecret(def.apiKeyEnc);
  }
  if (!baseUrl) throw new Error(`Base URL برای مدل «${m.label}» یافت نشد.`);
  return { baseUrl, apiKey, model: m.model };
}

function friendlyError(err: unknown): string {
  if (err instanceof LlmError) {
    const base = trimText(err.message, 500);
    return err.detail ? `${base} — جزئیات: ${trimText(err.detail, 300)}` : base;  }
  const msg = err instanceof Error ? err.message : "خطای ناشناخته در اجرای خط لوله تصمیم.";
  return trimText(msg, 700);
}

async function patchStep(stepId: string, patch: StepPatch): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key of Object.keys(patch) as (keyof StepPatch)[]) {
    const value: unknown = patch[key];
    if (value === undefined) continue;
    if (key === "usage") {
      if (value === null) continue;
      const u = value as TokenUsage;
      sets.push("prompt_tokens = ?", "completion_tokens = ?", "total_tokens = ?");
      vals.push(u.promptTokens ?? 0, u.completionTokens ?? 0, u.totalTokens ?? 0);
      continue;
    }
    let v = value;
    if (key === "output" && v !== null) v = JSON.stringify(v);
    const colByField: Record<string, string> = {
      status: "status",
      output: "output",
      error: "error",
      durationMs: "duration_ms",
    };
    sets.push(`${colByField[key]} = ?`);
    vals.push(v);
  }
  sets.push("updated_at = ?");
  vals.push(nowIso(), stepId);
  await run(`UPDATE decision_steps SET ${sets.join(", ")} WHERE id = ?`, vals);
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

export function startDecisionRun(decisionId: string, resume?: ResumeContext): void {
  if (activeRuns.has(decisionId)) return;
  activeRuns.add(decisionId);
  void runPipeline(decisionId, resume)
    .catch((err) => {
      console.error("[engine] unexpected failure:", err instanceof Error ? err.message : err);
      patchDecision(decisionId, {
        status: "failed",
        failedStage: "pipeline",
        error: friendlyError(err),
      }).catch(() => undefined);
    })
    .finally(() => {
      activeRuns.delete(decisionId);
    });
}

type ResumeContext = {
  analysis: OrchestratorAnalysis;
  completedOutputs: { name: string; analysis: string }[];
  startIndex: number; // 0..length; length = skip to judge only
};

async function runPipeline(decisionId: string, resume?: ResumeContext): Promise<void> {
  await ready();
  const decision = await get<DecisionRow>("SELECT * FROM decisions WHERE id = ?", [decisionId]);
  if (!decision) return;

  const startedAt = Date.now();
  let stage = resume && resume.startIndex > 0 ? "agent:resume" : "orchestrator";

  try {
    const enabledAgents = await all<AgentRow>("SELECT * FROM agents WHERE enabled = 1");
    const poolRows = enabledAgents.filter(
      (a) => a.slug !== ORCHESTRATOR_SLUG && a.slug !== JUDGE_SLUG
    );
    const availModels = await listAvailableModels();
    const configs = await listConfigs();

    // ── Orchestrator (fresh only) ───────────────────────────────────────
    let analysis: OrchestratorAnalysis;
    let modelUsed: string;
    let orderedAgents: AgentRow[];

    if (resume) {
      // Resume: use stored analysis, skip orchestrator call
      analysis = resume.analysis;
      modelUsed = decision.model_used || "";
      orderedAgents = analysis.executionOrder
        .map((slug) => poolRows.find((a) => a.slug === slug))
        .filter((a): a is AgentRow => !!a);
      await patchDecision(decisionId, { status: "executing" });
      console.log(`[engine] resuming from specialist index ${resume.startIndex}`);
    } else {
      await patchDecision(decisionId, { status: "orchestrating" });
      const orchestrator = enabledAgents.find((a) => a.slug === ORCHESTRATOR_SLUG);
      if (!orchestrator) throw new Error("عامل ارکستراتور یافت نشد یا غیرفعال است.");

      const orchCreds: ProviderCreds = await resolveProvider(orchestrator);
      modelUsed = orchCreds.model;

      // Build orchestrator prompt
      const availableLines = poolRows
        .map((a) => `- slug: ${a.slug}\n  name: ${a.name}\n  description: ${a.description}`)
        .join("\n");
      const defCfg = configs.find((c) => c.isDefault && c.enabled);
      const modelLines = availModels
        .map(
          (m) =>
            `- id: ${m.id}\n  label: ${m.label}\n  model: ${m.model}\n  provider: ${
              m.provider_config_id
                ? configs.find((c) => c.id === m.provider_config_id)?.name ?? "—"
                : defCfg?.name ?? "پیش‌فرض"
            }`
        )
        .join("\n");
      const availModelIds = new Set(availModels.map((m) => m.id));
      const orchMessages: ChatMessage[] = [
        { role: "system", content: orchestrator.system_prompt },
        {
          role: "user",
          content:
            `### سؤال کاربر\n${decision.question}\n\n### عامل‌های موجود\n${
              availableLines || "(هیچ عامل تخصصی فعالی موجود نیست)"
            }\n\n### مدل‌های موجود\n${
              modelLines || "(هیچ مدلی در کتابخانه مدل‌ها تعریف نشده — در صورت نیاز modelSelections را خالی بگذار)"
            }\n\n` +
            "یادآوری: فقط عامل‌های واقعاً مرتبط را انتخاب کن (حداکثر ۶). اگر هیچ‌کدام از عامل‌های موجود تخصص لازم را ندارند، عامل‌های جدید را در proposedAgents پیشنهاد بده. از مدل‌های موجود برای هر عامل انتخاب‌شده بهترین مدل را در modelSelections با دلیل انتخاب کن. اگر هیچ مدلی مناسب نیست، modelSelections را خالی بگذار.",
        },
      ];
      const { data: analysisRaw, usage: orchUsage } = await chatJson<unknown>(orchCreds, orchMessages, {
        temperature: 0.2,
        label: "خروجی ارکستراتور",
      });
      const { analysis: a, proposedAgents } = sanitizeAnalysis(
        analysisRaw,
        poolRows.map((a) => a.slug),
        availModelIds
      );
      analysis = a;

      await patchDecision(decisionId, { orchestratorUsage: orchUsage });

      // Create proposed agents
      const createdSlugs = new Set<string>();
      for (const p of proposedAgents) {
        if (poolRows.some((a) => a.slug === p.slug) || createdSlugs.has(p.slug)) continue;
        const created = await createAgent({
          name: p.name,
          slug: p.slug,
          description: p.description,
          systemPrompt: p.systemPrompt,
          enabled: true,
        });
        createdSlugs.add(p.slug);
        poolRows.push(created);
        console.log(`[engine] created proposed agent: ${p.slug}`);
      }

      orderedAgents = analysis.executionOrder
        .map((slug) => poolRows.find((a) => a.slug === slug))
        .filter((a): a is AgentRow => !!a);

      await patchDecision(decisionId, {
        status: "executing",
        orchestratorAnalysis: analysis,
        modelUsed,
      });
    }

    // ── Specialists (sequential, possibly resuming from startIndex) ──────
    const modelSelectionsBySlug = new Map<string, string>();
    for (const ms of analysis.modelSelections) {
      modelSelectionsBySlug.set(ms.slug, ms.modelId);
    }
    const modelsById = new Map(availModels.map((m) => [m.id, m]));

    const completedOutputs: { name: string; analysis: string }[] = resume
      ? [...resume.completedOutputs]
      : [];
    const rawRetries = await getMetaValue("max_agent_retries");
    const maxRetries =
      rawRetries && /^\d+$/.test(rawRetries) ? parseInt(rawRetries, 10) : 3;
    const startIndex = resume?.startIndex ?? 0;

    for (let i = startIndex; i < orderedAgents.length; i++) {
      const agent = orderedAgents[i];
      stage = `agent:${agent.slug}`;
      const stepId = await insertStep(decisionId, agent, i);
      const tStep = Date.now();
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
          await patchStep(stepId, { status: "running" });
          const selectedModelId = modelSelectionsBySlug.get(agent.slug);
          const creds: ProviderCreds = selectedModelId
            ? await resolveModelCreds(modelsById.get(selectedModelId)!)
            : await resolveProvider(agent);
          const { data: rawOut, usage } = await chatJson<unknown>(
            creds,
            specialistMessages(agent, decision.question, analysis, completedOutputs),
            { temperature: 0.5, label: `پاسخ ${agent.name}` }
          );
          const out = sanitizeSpecialist(rawOut);
          if (!out.analysis) throw new Error(`پاسخ ${agent.name} تحلیل قابل استفاده نداشت.`);
          await patchStep(stepId, { status: "completed", output: out, durationMs: Date.now() - tStep, usage });
          completedOutputs.push({ name: agent.name, analysis: out.analysis });
          break;
        } catch (err) {
          lastErr = err;
          if (attempt <= maxRetries) {
            console.log(`[engine] ${agent.slug} تلاش ${attempt}/${maxRetries + 1} ناموفق بود؛ تکرار.`);
            await patchStep(stepId, {
              status: "retrying",
              error: friendlyError(err),
              durationMs: Date.now() - tStep,
            });
            continue;
          }
        }
      }
      if (lastErr !== null) {
        await patchStep(stepId, {
          status: "failed",
          error: friendlyError(lastErr),
          durationMs: Date.now() - tStep,
        });
        throw new Error(`عامل ${agent.name} پس از ${maxRetries + 1} بار تلاش موفق نشد: ${friendlyError(lastErr)}`);
      }
    }

    // ── Judge synthesis ──────────────────────────────────────────────────
    stage = "judge";
    await patchDecision(decisionId, { status: "judging" });
    const judge = enabledAgents.find((a) => a.slug === JUDGE_SLUG);
    if (!judge) throw new Error("عامل داور یافت نشد یا غیرفعال است.");
    const judgeCreds: ProviderCreds = await resolveProvider(judge);
    const { data: judgeRaw, usage: judgeUsage } = await chatJson<unknown>(
      judgeCreds,
      judgeMessages(judge.system_prompt, decision.question, analysis, completedOutputs),
      { temperature: 0.3, label: "جمع‌بندی داور" }
    );
    const verdict = sanitizeJudge(judgeRaw);
    if (!verdict.finalAnswer) throw new Error("داور پاسخ نهایی معتبری تولید نکرد.");

    await patchDecision(decisionId, {
      status: "completed",
      judgeOutput: verdict,
      finalAnswer: verdict.finalAnswer,
      judgeUsage,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    await patchDecision(decisionId, {
      status: "failed",
      failedStage: stage,
      error: friendlyError(err),
      durationMs: Date.now() - startedAt,
    });
  }
}

/**
 * Restart a failed decision: wipe prior steps/results and run the pipeline
 * again from scratch (orchestrator → specialists → judge).
 */
/** Parse the stored orchestrator analysis JSON; null when absent/invalid. */
function parseStoredAnalysis(txt: string | null): OrchestratorAnalysis | null {
  if (!txt) return null;
  try {
    const parsed: unknown = JSON.parse(txt);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { executionOrder?: unknown }).executionOrder)
    ) {
      return null;
    }
    return parsed as OrchestratorAnalysis;
  } catch {
    return null;
  }
}

/**
 * Re-run a failed decision, resuming from where it stopped rather than
 * restarting the whole pipeline.
 *
 * - If the orchestrator itself failed (no stored analysis), restart from scratch.
 * - Otherwise keep the stored orchestrator analysis and all completed
 *   specialist steps; resume from the failed step (or straight to the judge
 *   when the failure happened during judge synthesis).
 */
export async function rerunDecision(decisionId: string): Promise<void> {
  await ready();
  const d = await get<DecisionRow>("SELECT * FROM decisions WHERE id = ?", [decisionId]);
  if (!d) throw new Error("تصمیم یافت نشد.");
  if (d.status !== "failed") {
    throw new Error("فقط تصمیم‌های ناموفق قابل اجرای مجدد هستند.");
  }
  if (activeRuns.has(decisionId)) {
    throw new Error("این تصمیم در حال اجراست.");
  }

  const storedAnalysis = parseStoredAnalysis(d.orchestrator_analysis);
  const failedStage = d.failed_stage;

  // Orchestrator never produced an analysis → nothing to resume from.
  if (!storedAnalysis || !failedStage || failedStage === "orchestrator") {
    await run("DELETE FROM decision_steps WHERE decision_id = ?", [decisionId]);
    await patchDecision(decisionId, {
      status: "pending",
      orchestratorAnalysis: null,
      judgeOutput: null,
      finalAnswer: null,
      error: null,
      failedStage: null,
      modelUsed: null,
      durationMs: null,
    });
    startDecisionRun(decisionId);
    return;
  }

  // Resume: keep completed steps + analysis; re-run from the failure point.
  const steps = await all<StepRow>(
    "SELECT * FROM decision_steps WHERE decision_id = ? ORDER BY order_index ASC",
    [decisionId]
  );

  const completedOutputs: { name: string; analysis: string }[] = [];
  for (const s of steps) {
    if (s.status !== "completed" || !s.output) continue;
    let analysis = "";
    try {
      const o: unknown = JSON.parse(s.output);
      analysis = o && typeof o === "object" && typeof (o as { analysis?: unknown }).analysis === "string"
        ? (o as { analysis: string }).analysis
        : "";
    } catch {
      /* keep empty */
    }
    completedOutputs.push({ name: s.agent_name, analysis });
  }

  let startIndex: number;
  if (failedStage === "judge") {
    startIndex = storedAnalysis.executionOrder.length; // all specialists done → judge only
  } else if (failedStage.startsWith("agent:")) {
    const slug = failedStage.slice("agent:".length);
    const failedStep = steps.find((s) => s.agent_slug === slug && s.status === "failed");
    startIndex = failedStep ? failedStep.order_index : completedOutputs.length;
  } else {
    startIndex = completedOutputs.length;
  }

  // Drop the failed step (and any later steps, though normally none) —
  // completed steps before it are preserved.
  await run(
    "DELETE FROM decision_steps WHERE decision_id = ? AND order_index >= ?",
    [decisionId, startIndex]
  );

  await patchDecision(decisionId, {
    status: startIndex >= storedAnalysis.executionOrder.length ? "judging" : "executing",
    judgeOutput: null,
    finalAnswer: null,
    error: null,
    failedStage: null,
    durationMs: null,
  });

  startDecisionRun(decisionId, {
    analysis: storedAnalysis,
    completedOutputs,
    startIndex,
  });
}
