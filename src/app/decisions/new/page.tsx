"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Field, inputClass } from "@/components/ui";

const SAMPLES = [
  "با پس‌انداز فعلی‌ام مغازه بزنم یا ادامه تحصیل کنم؟",
  "پیشنهاد شغلی دورکاری در شرکت استارتاپی را بپذیرم یا شغل فعلی را نگه دارم؟",
  "برای راه‌اندازی SaaS کوچک، شرکتی ثبت کنم یا به‌صورت فریلنسر شروع کنم؟",
];

export default function NewDecisionPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (question.trim().length < 5) {
      setError("متن سؤال باید حداقل ۵ کاراکتر باشد.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, title: title.trim() || undefined }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok || !json || typeof json !== "object" || !("id" in json)) {
        const msg =
          json && typeof json === "object" && "error" in json && typeof json.error === "string"
            ? json.error
            : `ایجاد تصمیم ناموفق بود (HTTP ${res.status}).`;
        setError(msg);
        setSubmitting(false);
        return;
      }
      router.push(`/decisions/${String(json.id)}`);
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-bold">ایجاد تصمیم جدید</h1>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <Field label="عنوان (اختیاری)">
            <input
              className={inputClass}
              placeholder="مثلاً: تصمیم درباره تغییر شغل"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="سؤال یا مسئله شما" hint="هرچه زمینه دقیق‌تری بدهید، تحلیل عامل‌ها هدفمندتر خواهد بود.">
            <textarea
              className={`${inputClass} min-h-[140px] leading-7`}
              placeholder="سؤال خود را کامل بنویسید…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={submitting}
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            {SAMPLES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setQuestion(s)}
                disabled={submitting}
                className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-500 hover:border-emerald-300 hover:text-emerald-700"
              >
                {s}
              </button>
            ))}
          </div>

          {error && <Alert tone="red">{error}</Alert>}

          <Button type="submit" loading={submitting}>
            ارسال به ارکستراتور
          </Button>
        </form>
      </Card>
    </div>
  );
}
