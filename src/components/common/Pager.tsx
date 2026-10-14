/**
 * Paging for long lists — rendering thousands of rows (each with dropdowns)
 * at once froze the app. Filters and search still apply to everything;
 * only the visible page is drawn.
 */
import React, { useEffect, useState } from 'react';

export function usePaged<T>(items: T[], pageSize = 50, resetKey: unknown = undefined) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  // back to page 1 when filters/search change; stay in range when items shrink
  useEffect(() => { setPage(1); }, [resetKey]);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const start = (Math.min(page, pages) - 1) * pageSize;
  return { pageItems: items.slice(start, start + pageSize), page: Math.min(page, pages), pages, setPage, start, total: items.length };
}

export function Pager({ page, pages, setPage, start, shown, total, label = 'rows' }: {
  page: number; pages: number; setPage: (p: number) => void; start: number; shown: number; total: number; label?: string;
}) {
  if (pages <= 1) return null;
  const btn = 'px-2.5 py-1 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-slate-500">
      <span>{start + 1}–{start + shown} of {total} {label}</span>
      <div className="flex items-center gap-1.5">
        <button className={btn} disabled={page <= 1} onClick={() => setPage(1)}>« First</button>
        <button className={btn} disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
        <span className="px-1.5 font-mono">{page} / {pages}</span>
        <button className={btn} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next ›</button>
        <button className={btn} disabled={page >= pages} onClick={() => setPage(pages)}>Last »</button>
      </div>
    </div>
  );
}
