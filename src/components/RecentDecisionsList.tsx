"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Badge, Button, STATUS_META, fmtDateTime } from "@/components/ui";
import type { DecisionListItem } from "@/lib/types";

type Props = {
  items: DecisionListItem[];
};

export default function RecentDecisionsList({ items }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const handleDelete = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (deleting.has(id)) return;
      if (!confirm("آیا از حذف این تصمیم اطمینان دارید؟")) return;
      setDeleting((prev) => new Set(prev).add(id));
      try {
        const res = await fetch(`/api/decisions/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          alert(body?.error || "حذف ناموفق بود.");
          return;
        }
        router.refresh();
      } catch {
        alert("ارتباط با سرور برقرار نشد.");
      } finally {
        setDeleting((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [deleting, router]
  );

  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-zinc-400">
        هنوز تصمیمی ثبت نشده است. با «تصمیم جدید» شروع کنید.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {items.map((d) => {
        const meta = STATUS_META[d.status];
        const isDeleting = deleting.has(d.id);
        return (
          <li key={d.id}>
            <div className="group flex items-center gap-2 rounded-lg px-2 py-3 hover:bg-zinc-50">
              <a
                href={`/decisions/${d.id}`}
                className="flex flex-1 items-center justify-between gap-3"
              >
                <div className="min-w-0 overflow-hidden">
                  <p className="line-clamp-2 text-sm font-medium text-zinc-800">
                    {d.title || d.question}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {fmtDateTime(d.createdAt)} · {d.stepsCount} عامل تخصصی
                  </p>
                </div>
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </a>
              <button
                onClick={(e) => void handleDelete(d.id, e)}
                disabled={isDeleting}
                className="shrink-0 rounded-md p-1.5 text-zinc-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 disabled:opacity-30"
                title="حذف"
                aria-label="حذف"
              >
                {isDeleting ? (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                )}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}