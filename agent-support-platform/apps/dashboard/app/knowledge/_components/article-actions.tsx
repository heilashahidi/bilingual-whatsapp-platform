"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveKnowledgeArticle, archiveKnowledgeArticle } from "@/lib/api";
import type { KnowledgeArticle } from "@/lib/types";

export function ArticleActions({ article }: { article: KnowledgeArticle }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function approve() {
    setError(null);
    startTransition(async () => {
      try {
        await approveKnowledgeArticle(article.id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Approve failed");
      }
    });
  }
  function archive() {
    setError(null);
    startTransition(async () => {
      try {
        await archiveKnowledgeArticle(article.id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Archive failed");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {article.status === "draft" && (
          <button
            type="button"
            onClick={approve}
            disabled={pending}
            className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:bg-slate-300"
          >
            Approve
          </button>
        )}
        {article.status !== "archived" && (
          <button
            type="button"
            onClick={archive}
            disabled={pending}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:bg-slate-100"
          >
            Archive
          </button>
        )}
      </div>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
