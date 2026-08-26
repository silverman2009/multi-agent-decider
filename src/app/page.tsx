import Link from "next/link";
import { all, get } from "@/lib/db";
import { Card, StatCard } from "@/components/ui";
import RecentDecisionsList from "@/components/RecentDecisionsList";
import type { DecisionListItem } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadStats() {
  const total = await get<{ n: number }>("SELECT COUNT(*) AS n FROM decisions");
  const completed = await get<{ n: number }>("SELECT COUNT(*) AS n FROM decisions WHERE status = 'completed'");
  const running = await get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM decisions WHERE status IN ('pending','orchestrating','executing','judging')"
  );
  const agents = await get<{ n: number }>("SELECT COUNT(*) AS n FROM agents WHERE enabled = 1");
  return {
    total: total?.n ?? 0,
    completed: completed?.n ?? 0,
    running: running?.n ?? 0,
    agents: agents?.n ?? 0,
  };
}

export default async function DashboardPage() {
  const [stats, recent] = await Promise.all([
    loadStats(),
    all<{
      id: string;
      title: string | null;
      question: string;
      status: string;
      created_at: string;
      steps_count: number;
    }>(
      `SELECT d.id, d.title, d.question, d.status, d.created_at,
              (SELECT COUNT(*) FROM decision_steps s WHERE s.decision_id = d.id) AS steps_count
       FROM decisions d ORDER BY d.created_at DESC LIMIT 10`
    ),
  ]);

  const recentItems: DecisionListItem[] = recent.map((d) => ({
    id: d.id,
    title: d.title,
    question: d.question,
    status: d.status as DecisionListItem["status"],
    createdAt: d.created_at,
    stepsCount: d.steps_count ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">داشبورد</h1>
          <p className="mt-1 text-sm text-zinc-500">
            سؤال خود را بپرسید؛ ارکستراتور تیم تخصصی را می‌سازد و داور نهایی جمع‌بندی می‌کند.
          </p>
        </div>
        <Link
          href="/decisions/new"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          + تصمیم جدید
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="کل تصمیم‌ها" value={stats.total} />
        <StatCard label="تکمیل‌شده" value={stats.completed} />
        <StatCard label="در حال اجرا" value={stats.running} />
        <StatCard label="عامل‌های فعال" value={stats.agents} hint="شامل ارکستراتور و داور" />
      </div>

      <Card title="آخرین تصمیم‌ها">
        <RecentDecisionsList items={recentItems} />
      </Card>
    </div>
  );
}
