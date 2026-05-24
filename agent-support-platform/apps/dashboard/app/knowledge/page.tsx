import Link from "next/link";
import { fetchKnowledgeArticles } from "@/lib/api";
import { getServerApiToken } from "@/lib/auth-server";
import { formatRelative } from "@/lib/date-format";
import type { KnowledgeArticle } from "@/lib/types";
import { ArticleActions } from "./_components/article-actions";

export const dynamic = "force-dynamic";

const statusStyle: Record<KnowledgeArticle["status"], string> = {
  draft: "bg-amber-100 text-amber-800 ring-amber-200",
  active: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  archived: "bg-slate-100 text-slate-600 ring-slate-200",
};

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const token = await getServerApiToken();

  const filterStatus =
    searchParams?.status === "draft" ||
    searchParams?.status === "active" ||
    searchParams?.status === "archived"
      ? (searchParams.status as KnowledgeArticle["status"])
      : undefined;

  let articles: KnowledgeArticle[] = [];
  let error: string | null = null;
  try {
    articles = await fetchKnowledgeArticles(
      filterStatus ? { status: filterStatus } : undefined,
      token
    );
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  const draftCount = articles.filter((a) => a.status === "draft").length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Knowledge base</h1>
        <span className="text-sm text-slate-500">
          {articles.length} {filterStatus ? `${filterStatus} ` : ""}
          article{articles.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <FilterTab href="/knowledge" active={!filterStatus}>
          All
        </FilterTab>
        <FilterTab href="/knowledge?status=draft" active={filterStatus === "draft"}>
          Drafts{draftCount > 0 && !filterStatus ? ` (${draftCount})` : ""}
        </FilterTab>
        <FilterTab href="/knowledge?status=active" active={filterStatus === "active"}>
          Active
        </FilterTab>
        <FilterTab
          href="/knowledge?status=archived"
          active={filterStatus === "archived"}
        >
          Archived
        </FilterTab>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-medium">Failed to load articles</div>
          <div className="mt-1">{error}</div>
        </div>
      )}

      {!error && articles.length === 0 && (
        <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {filterStatus === "draft"
            ? "No drafts to review. Resolve tickets with a resolution summary and they'll show up here."
            : filterStatus === "active"
              ? "No active articles yet. Approve drafts to start surfacing them on new tickets."
              : "No articles yet."}
        </div>
      )}

      {articles.length > 0 && (
        <ul className="space-y-3">
          {articles.map((a) => (
            <li
              key={a.id}
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {a.title}
                    </h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyle[a.status]}`}
                    >
                      {a.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {a.category && <>{a.category.replace(/_/g, " ")} · </>}
                    {a.productArea ? `${a.productArea} · ` : ""}
                    updated {formatRelative(a.updatedAt)}
                    {a.usageCount > 0 && (
                      <>
                        {" · "}used {a.usageCount}× ·{" "}
                        {a.successCount + a.failureCount > 0
                          ? `${Math.round(
                              (a.successCount /
                                (a.successCount + a.failureCount)) *
                                100
                            )}% helpful`
                          : "no feedback yet"}
                      </>
                    )}
                  </div>
                  {a.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {a.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Problem
                      </div>
                      <p className="mt-1 line-clamp-3 text-sm text-slate-700">
                        {a.problemDescription}
                      </p>
                    </div>
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Resolution
                      </div>
                      <p className="mt-1 line-clamp-3 text-sm text-slate-700">
                        {a.resolutionText}
                      </p>
                    </div>
                  </div>

                  {a.sourceTicketIds.length > 0 && (
                    <div className="mt-3 text-xs text-slate-500">
                      Derived from{" "}
                      {a.sourceTicketIds.map((tid, i) => (
                        <span key={tid}>
                          <Link
                            href={`/tickets/${tid}`}
                            className="font-mono text-slate-700 hover:underline"
                          >
                            #{tid.slice(0, 8)}
                          </Link>
                          {i < a.sourceTicketIds.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <ArticleActions article={a} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
        active
          ? "bg-slate-900 text-white ring-slate-900"
          : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
      }`}
    >
      {children}
    </Link>
  );
}
