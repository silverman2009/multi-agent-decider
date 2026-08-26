"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Spinner,
  STATUS_META,
  STEP_STATUS_META,
  fmtDateTime,
  fmtMs,
} from "@/components/ui";
import type { DecisionDetailDTO } from "@/lib/types";

const TERMINAL = new Set(["completed", "failed"]);

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2" title={`اطمینان: ${pct}%`}>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-200">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-zinc-400">{pct}٪</span>
    </div>
  );
}

export default function DecisionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [decision, setDecision] = useState<DecisionDetailDTO | null>(null);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [modelLabels, setModelLabels] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rerunToken, setRerunToken] = useState(0);
  const [rerunning, setRerunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/decisions/${id}`, { cache: "no-store" });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok || !json || typeof json !== "object" || !("decision" in json)) {
        setLoadError("دریافت اطلاعات تصمیم ناموفق بود.");
        return null;
      }
      setLoadError(null);
      const d = json.decision as DecisionDetailDTO;
      setDecision(d);
      const r = json as { agentNames?: unknown; modelLabels?: unknown };
      if (r.agentNames && typeof r.agentNames === "object") setAgentNames(r.agentNames as Record<string, string>);
      if (r.modelLabels && typeof r.modelLabels === "object") setModelLabels(r.modelLabels as Record<string, string>);
      return d;
    } catch {
      setLoadError("ارتباط با سرور برقرار نشد.");
      return null;
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function poll() {
      const d = await load();
      if (cancelled) return;
      if (d && !TERMINAL.has(d.status)) {
        timerRef.current = setTimeout(poll, 1500);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [id, load, rerunToken]);

  async function rerun() {
    if (!id || rerunning) return;
    setRerunning(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/decisions/${id}`, { method: "POST" });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          json && typeof json === "object" && "error" in json && typeof json.error === "string"
            ? json.error
            : "اجرای مجدد ناموفق بود.";
        setLoadError(msg);
        return;
      }
      setRerunToken((t) => t + 1);
    } catch {
      setLoadError("ارتباط با سرور برقرار نشد.");
    } finally {
      setRerunning(false);
    }
  }

  if (loadError && !decision) {
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <Alert tone="red">{loadError}</Alert>
        <Button variant="ghost" onClick={() => router.push("/")}>
          بازگشت به داشبورد
        </Button>
      </div>
    );
  }

  if (!decision) {
    return (
      <div className="flex items-center justify-center py-24 text-zinc-400">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const meta = STATUS_META[decision.status];
  const active = !TERMINAL.has(decision.status);
  const doneSteps = decision.steps.filter((s) => s.status === "completed" || s.status === "failed").length;
  const totalUnits = decision.steps.length + (decision.steps.length > 0 ? 1 : 0); // + judge
  const progress =
    decision.status === "completed"
      ? 100
      : totalUnits === 0
        ? decision.status === "pending"
          ? 5
          : 15
        : Math.min(95, Math.round(((doneSteps + (decision.status === "judging" ? 0.7 : 0)) / totalUnits) * 100));

  const a = decision.orchestratorAnalysis;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">{decision.title || "تصمیم چندعاملی"}</h1>
            <p className="mt-1 text-xs text-zinc-400">
              {fmtDateTime(decision.createdAt)} · مدل: {decision.modelUsed || "—"} · مدت: {fmtMs(decision.durationMs)}
              {decision.usage && decision.usage.totalTokens > 0 && (
                <span dir="ltr" className="mr-2 font-mono">
                  · {decision.usage.promptTokens}↑ / {decision.usage.completionTokens}↓ / {decision.usage.totalTokens}Σ توکن
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {decision.status === "failed" && (
              <Button size="sm" variant="primary" onClick={() => void rerun()} loading={rerunning}>
                اجرای مجدد
              </Button>
            )}
            <Badge tone={meta.tone}>
              {active && <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
              {meta.label}
            </Badge>
          </div>
        </div>
        {active && (
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${progress}%` }} />
          </div>
        )}
        <Card title="سؤال کاربر">
          <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-700">{decision.question}</p>
        </Card>
      </div>

      {decision.error && (
        <Alert tone="red">
          خطا در مرحله «{decision.failedStage}»: {decision.error}
        </Alert>
      )}

      {/* Orchestrator */}
      {a && (
        <Card
          title={
            <span className="flex items-center gap-2">
              ارکستراتور
              <Badge tone="blue">تحلیل و انتخاب تیم</Badge>
            </span>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3 text-sm leading-7">
              <p>
                <span className="font-medium text-zinc-500">موضوع: </span>
                {a.topic || "—"}
              </p>
              <p>
                <span className="font-medium text-zinc-500">هدف: </span>
                {a.goal || "—"}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge tone="zinc">پیچیدگی: {a.complexity}</Badge>
                <Badge tone={a.riskLevel === "critical" || a.riskLevel === "high" ? "red" : a.riskLevel === "medium" ? "amber" : "emerald"}>
                  ریسک: {a.riskLevel}
                </Badge>
              </div>
              {a.missingInfo.length > 0 && (
                <div>
                  <p className="font-medium text-zinc-500">اطلاعات ناقص:</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-zinc-600">
                    {a.missingInfo.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-zinc-500">
                تیم انتخاب‌شده ({a.selectedAgents.length} عامل):
              </p>
              {a.selectedAgents.length === 0 ? (
                <p className="text-xs text-zinc-400">هیچ عامل تخصصی انتخاب نشد — پاسخ مستقیم توسط داور.</p>
              ) : (
                <ol className="space-y-2">
                  {a.executionOrder.map((slug, idx) => {
                    const sel = a.selectedAgents.find((s) => s.slug === slug);
                    if (!sel) return null;
                    return (
                      <li key={slug} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
                        <div className="flex items-center gap-2 text-sm font-medium text-zinc-800">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] text-white">
                            {idx + 1}
                          </span>
                          {agentNames[sel.slug] ?? sel.slug}
                        </div>
                        <p className="mt-1 pr-7 text-xs leading-6 text-zinc-500">{sel.reason}</p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>

          {a.modelSelections && a.modelSelections.length > 0 && (
            <div className="mt-4 border-t border-zinc-100 pt-3">
              <p className="mb-2 text-sm font-medium text-zinc-500">
                انتخاب مدل توسط ارکستراتور ({a.modelSelections.length} مدل):
              </p>
              <ul className="space-y-2">
               {a.modelSelections.map((ms, i) => {

                  const agentLabel = agentNames[ms.slug] ?? ms.slug;
                  const modelLabel = modelLabels[ms.modelId] ?? ms.modelId;
                  return (
                    <li key={i} className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-xs leading-6">
                      <span className="font-semibold text-violet-800">{agentLabel}</span>
                      <span className="mx-2 text-violet-300">←</span>
                      <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-violet-900" dir="ltr">
                        {modelLabel}
                      </code>
                      {ms.reason && <p className="mt-1 pr-2 text-zinc-600">{ms.reason}</p>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* Specialist steps */}
      {decision.steps.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-zinc-700">بررسی تخصصی</h2>
          {decision.steps.map((step) => {
            const sm = STEP_STATUS_META[step.status];
            return (
              <Card key={step.id} className={step.status === "failed" ? "border-red-200" : undefined}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-zinc-800">{step.agentName}</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {step.usage && (
                      <span dir="ltr" className="font-mono text-[11px] text-zinc-400">
                        {step.usage.promptTokens}↑ · {step.usage.completionTokens}↓ · {step.usage.totalTokens}Σ
                      </span>
                    )}
                    {step.durationMs != null && <span className="text-[11px] text-zinc-400">{fmtMs(step.durationMs)}</span>}
                    <Badge tone={sm.tone}>{sm.label}</Badge>
                  </div>
                </div>

                {step.error && <p className="mt-2 text-xs leading-6 text-red-600">{step.error}</p>}

                {step.output && (
                  <div className="mt-3 space-y-3">
                    <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-700">{step.output.analysis}</p>
                    {step.output.recommendations.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-emerald-700">توصیه‌ها</p>
                        <ul className="mt-1 list-inside list-disc space-y-1 text-xs leading-6 text-zinc-600">
                          {step.output.recommendations.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {step.output.risks.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-amber-600">ریسک‌های دیدگاه این عامل</p>
                        <ul className="mt-1 list-inside list-disc space-y-1 text-xs leading-6 text-zinc-600">
                          {step.output.risks.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <ConfidenceBar value={step.output.confidence} />
                  </div>
                )}

                {!step.output && !step.error && step.status !== "pending" && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
                    <Spinner className="h-4 w-4" /> در حال تحلیل…
                  </div>
                )}
              </Card>
            );
          })}
        </section>
      )}

      {/* Judge verdict */}
      {decision.judge && (
        <Card
          title={
            <span className="flex items-center gap-2">
              جمع‌بندی نهایی داور
              <Badge tone="violet">Verdict</Badge>
            </span>
          }
          className="border-emerald-300 shadow-md"
        >
          <div className="space-y-4">
            {decision.judge.summary && (
              <p className="rounded-lg bg-emerald-50 p-3 text-sm leading-7 text-emerald-900">{decision.judge.summary}</p>
            )}
            <div>
              <p className="text-xs font-bold text-zinc-500">پاسخ نهایی</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-8 text-zinc-900">{decision.judge.finalAnswer}</p>
            </div>

            {decision.judge.consolidatedRisks.length > 0 && (
              <div>
                <p className="text-xs font-bold text-zinc-500">ریسک‌های تجمیعی</p>
                <ul className="mt-2 space-y-2">
                  {decision.judge.consolidatedRisks.map((r, i) => (
                    <li key={i} className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-xs leading-6">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-zinc-800">{r.risk}</span>
                        <Badge tone={r.severity === "high" ? "red" : r.severity === "medium" ? "amber" : "emerald"}>
                          {r.severity}
                        </Badge>
                      </div>
                      {r.mitigation && <p className="mt-1 text-zinc-500">راهکار: {r.mitigation}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {decision.judge.actionItems.length > 0 && (
              <div>
                <p className="text-xs font-bold text-zinc-500">برنامه اقدام پیشنهادی</p>
                <ol className="mt-2 space-y-1.5">
                  {decision.judge.actionItems.map((it, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs leading-6">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[9px] text-white">
                        {i + 1}
                      </span>
                      <span className="text-zinc-700">{it.detail}</span>
                      <Badge tone={it.priority === "high" ? "red" : it.priority === "medium" ? "amber" : "zinc"}>
                        {it.priority}
                      </Badge>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {decision.judge.notes && <p className="text-[11px] leading-6 text-zinc-400">یادداشت داور: {decision.judge.notes}</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
