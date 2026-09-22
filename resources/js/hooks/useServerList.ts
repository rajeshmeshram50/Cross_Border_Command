import { useCallback, useEffect, useRef, useState } from 'react';

export type ServerPageMeta = { total: number; page: number; per_page: number; last_page: number };

export type ServerListQuery = { page: number; per_page?: number; search?: string; tab?: string };

type Options = {
  /** Rows per page; omit to use the server's default. */
  perPage?: number;
  /** Already debounced by the caller. */
  search?: string;
  tab?: string;
  /** Phone cards: each next page is appended instead of replacing the rows. */
  append?: boolean;
};

/**
 * A server-paged list: page, search and tab are sent to the API. Only the
 * latest request may update the screen. A load that will replace the rows
 * (reload, tab, page, search) raises `replacing`, so the screen can show its
 * skeleton instead of dimming stale rows; appending the next page on phones
 * keeps the rows on screen and only raises `refreshing`.
 */
export function useServerList<T, M extends ServerPageMeta>(
  fetcher: (q: ServerListQuery) => Promise<{ rows: T[]; meta: M | null }>,
  { perPage, search = '', tab, append = false }: Options,
  onError?: (e: unknown) => void,
) {
  const [rows, setRows] = useState<T[]>([]);
  const [meta, setMeta] = useState<M | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);       // first load only — shows the skeleton
  const [refreshing, setRefreshing] = useState(false); // any load in flight
  const [replacing, setReplacing] = useState(false);   // a load that will replace the rows
  const seq = useRef(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const errRef = useRef(onError);
  errRef.current = onError;

  const load = useCallback((p: number, mode: 'replace' | 'append') => {
    const id = ++seq.current;
    setRefreshing(true);
    setReplacing(mode === 'replace');
    fetchRef.current({ page: p, per_page: perPage, search: search || undefined, tab })
      .then((res) => {
        if (id !== seq.current) return; // a newer request has been sent since
        setRows((cur) => (mode === 'append' ? [...cur, ...res.rows] : res.rows));
        setMeta(res.meta);
      })
      .catch((e) => { if (id === seq.current) errRef.current?.(e); })
      .finally(() => {
        if (id !== seq.current) return;
        setLoading(false);
        setRefreshing(false);
        setReplacing(false);
      });
  }, [perPage, search, tab]);

  // Any change to what is listed starts again from page 1.
  useEffect(() => {
    setPage(1);
    load(1, 'replace');
  }, [load]);

  const goTo = (p: number) => {
    setPage(p);
    load(p, 'replace');
  };

  const hasMore = !!meta && page < meta.last_page;
  const loadMore = () => {
    if (!hasMore || refreshing) return;
    const next = page + 1;
    setPage(next);
    load(next, append ? 'append' : 'replace');
  };

  /** Same page again (after a save elsewhere); in append mode the list restarts. */
  const reload = () => {
    if (append) { setPage(1); load(1, 'replace'); } else load(page, 'replace');
  };

  return { rows, meta, page, loading, refreshing, replacing, goTo, loadMore, hasMore, reload };
}
