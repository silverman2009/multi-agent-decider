/**
 * Minimal OpenAI-compatible mock for local end-to-end testing of Ox Alpha
 * WITHOUT any real LLM provider. Not part of the app runtime.
 *
 *   node scripts/mock-openai.mjs        (port via MOCK_PORT, default 4545)
 *
 * Endpoints:
 *   GET  .../models             → canned model list
 *   POST .../chat/completions   → detects pipeline stage from prompt markers:
 *       '"selectedAgents"' → orchestrator plan
 *       '"recommendations"' → specialist output (uses agent_slug line)
 *       '"finalAnswer"'     → judge verdict
 *
 * Security: request headers are never logged (no API keys leak into logs).
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 4545);

const MODELS = [
  { id: "gpt-mock-4o", name: "GPT Mock 4o" },
  { id: "llama-mock-3.1" },
  { id: "mock-mini", name: "Mock Mini" },
  { id: "mock-pro", name: "Mock Pro" },
  { id: "mock-reasoner", name: "Mock Reasoner" },
  { id: "qwen-mock-max" },
].sort((a, b) => a.id.localeCompare(b.id));

function extractSection(text, header) {
  const idx = text.indexOf(header);
  if (idx === -1) return "";
  const rest = text.slice(idx + header.length);
  const nextHeader = rest.indexOf("###");
  return (nextHeader === -1 ? rest : rest.slice(0, nextHeader)).trim();
}

function buildOrchestratorReply(userText) {
  const question = extractSection(userText, "### سؤال کاربر").slice(0, 140) || "سؤال کاربر";
  const slugs = [...userText.matchAll(/- slug:\s*([a-z0-9-]+)/g)].map((m) => m[1]);
  const preferred = ["financial-analyst", "risk-analyst"].filter((s) => slugs.includes(s));
  for (const s of slugs) {
    if (preferred.length >= 2) break;
    if (s === "judge" || s === "orchestrator" || preferred.includes(s)) continue;
    preferred.push(s);
  }
  const proposedSlug = "health-wellness";
  const selectedAgents = preferred.map((slug) => ({
    slug,
    reason: `مرتبط‌ترین دیدگاه برای این سؤال در نقش ${slug}`,
  }));
  selectedAgents.push({
    slug: proposedSlug,
    reason: "این سؤال جنبه سلامتی/سبک زندگی دارد؛ عامل تخصصی موجود نیست.",
  });
  const executionOrder = [...preferred, proposedSlug];
  // Model selections: parse available model ids from the orchestrator prompt and
  // assign the first two to the first two selected agents (for deterministic tests).
  const modelIds = [...userText.matchAll(/- id:\s*([a-z0-9-]+)/g)].map((m) => m[1]);
  const modelSelections = selectedAgents.slice(0, 2).map((sel, i) => ({
    slug: sel.slug,
    modelId: modelIds[i] || "",
    reason: `مدل مناسب برای وظیفه ${sel.slug}`,
  })).filter((m) => m.modelId);
  const plan = {
    topic: question.split(/[؟?.!]/)[0].slice(0, 80) || question.slice(0, 60),
    goal: `پاسخ روشن و قابل اقدام به: ${question}`,
    complexity: "medium",
    riskLevel: "medium",
    missingInfo: ["بازه زمانی تصمیم", "محدودیت بودجه کاربر"],
    selectedAgents,
    executionOrder,
    modelSelections,
    proposedAgents: [
      {
        slug: proposedSlug,
        name: "مشاور سلامت و سبک زندگی",
        description: "بررسی اثر تصمیم بر سلامت جسمی و روانی و سبک زندگی.",
        systemPrompt:
          "تو «مشاور سلامت و سبک زندگی» Ox Alpha هستی. اثر تصمیم بر سلامت جسمی و روانی، خواب، تغذیه و سبک زندگی را بررسی کن. فقط JSON با ساختار {\"analysis\":...,\"recommendations\":[...],\"risks\":[...],\"confidence\":0.0} برگردان.",
      },
    ],
  };
  return JSON.stringify(plan);
}

function buildSpecialistReply(userText, model) {
  const slugMatch = userText.match(/agent_slug:\s*([a-z0-9-]+)/);
  const nameMatch = userText.match(/agent_name:\s*([^\n]+)/);
  const slug = slugMatch ? slugMatch[1] : "specialist";
  const agentName = nameMatch ? nameMatch[1].trim() : slug;
  const question = extractSection(userText, "### سؤال کاربر").slice(0, 120);
  const reply = {
    analysis: `[mock:${slug}] تحلیل «${agentName}» درباره: ${question} [model=${model || "?"}]. این پاسخ ساختگی برای آزمایش خط لوله چندعاملی است؛ ارجاع به خروجی عامل‌های پیشین در صورت وجود.`,
    recommendations: [
      `[${slug}] گام اول عملی با کم‌ترین ریسک`,
      `[${slug}] گام دوم مشروط به بررسی بودجه/زمان`,
    ],
    risks: [`[${slug}] ریسک اصلی سناریو`, `[${slug}] ریسک فرعی قابل مدیریت`],
    confidence: 0.72,
  };
  return JSON.stringify(reply);
}

function buildJudgeReply(userText) {
  const specialistCount = (userText.match(/\[[^\]\n]+\]\n?\[?mock:/g) || []).length;
  const sections = (userText.match(/^\[[^\]]+\]$/gm) || []).length;
  const n = Math.max(specialistCount, sections > 2 ? sections - 1 : specialistCount, 1);
  const reply = {
    summary: "[mock] متخصص‌ها هم‌جهت با احتیاط صحبت کردند؛ جمع‌بندی بر پایه توازن ریسک و بازده.",
    finalAnswer:
      "[mock] پاسخ نهایی: با اطلاعات فعلی، گزینه تدریجی و برگشت‌پذیر انتخاب شود؛ پیش از اجرا دو مورد از اطلاعات ناقص تکمیل گردد.",
    consolidatedRisks: [
      { risk: "کمبود داده ورودی کاربر", severity: "medium", mitigation: "تکمیل اطلاعات ناقص فهرست‌شده توسط ارکستراتور" },
      { risk: "دستکاری شرایط محیطی در آینده", severity: "low", mitigation: "نقطه بازبینی ماهانه" },
    ],
    actionItems: [
      { step: "۱", detail: "تکمیل اطلاعات ناقص ظرف ۴۸ ساعت", priority: "high" },
      { step: "۲", detail: "اجرای گام اول به‌صورت کوچک و اندازه‌گیری نتیجه", priority: "high" },
      { step: "۳", detail: "بازبینی پس از یک ماه و اصلاح مسیر", priority: "medium" },
    ],
    notes: `این پاسخ ساختگی است؛ ${n} خروجی تخصصی دریافت شد.`,
  };
  return JSON.stringify(reply);
}

function pickReply(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const all = messages.map((m) => String(m?.content ?? "")).join("\n");
  if (!all) return "خطا: پیامی دریافت نشد";
  if (all.includes('"selectedAgents"')) return buildOrchestratorReply(all);
  if (all.includes('"finalAnswer"')) return buildJudgeReply(all);
  if (all.includes('"recommendations"')) return buildSpecialistReply(all, body.model);
  return JSON.stringify({ echo: all.slice(0, 200) });
}

const server = http.createServer((req, res) => {
  const url = req.url || "";
  // Never log headers — API keys must not reach logs.
  console.log(`[mock] ${req.method} ${url}`);

  if (req.method === "GET" && url.endsWith("/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: MODELS }));
    return;
  }

  if (req.method === "POST" && url.endsWith("/chat/completions")) {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        /* keep empty */
      }
      setTimeout(() => {
        const content = pickReply(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: `chatcmpl-mock-${Date.now()}`,
            object: "chat.completion",
            model: body.model ?? "mock",
            choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
            usage: {
              prompt_tokens: 120,
              completion_tokens: 45,
              total_tokens: 165,
            },
          })
        );
      }, 150); // small latency so UI states are observable
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: `no route: ${req.method} ${url}` } }));
});

server.listen(PORT, () => {
  console.log(`[mock] OpenAI-compatible mock on http://localhost:${PORT}/v1`);
});
