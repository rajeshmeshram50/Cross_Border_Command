import { Fragment, useEffect, useMemo, useState } from 'react';
import api from '../../api';
import { MasterSelect } from '../../components/ui/MasterSelect';

/**
 * Dev Tools → Load Testing.
 *
 * Pick a module, pick one of its pages, press Run: the browser fires exactly the
 * API calls that page fires on open, each carrying `X-Profile: 1`, and shows what
 * came back — round-trip time, server time, database time, statement count and
 * payload size. An in-app Network tab scoped to one screen.
 *
 * Why replay from the browser rather than have the server call itself: a loopback
 * request skips TLS, auth and the real network, so its numbers flatter the app.
 * These are the numbers the actual screen gets.
 *
 * The query count is the interesting column. A list of N rows that fires ~N
 * queries is an N+1 — the page is asking per row instead of once for all rows.
 */

type Req = { method: string; url: string; label: string; write?: boolean; body?: Record<string, unknown> };
/** A queued request plus the module/page it belongs to — the grouping key. */
type Queued = Req & { moduleKey: string; moduleLabel: string; pageLabel: string };
type Action = { key: string; label: string; kind: 'read' | 'write'; requests: Req[] };
type Frontend = {
  lines: number | null; source_kb: number | null;
  chunk: string | null; chunk_kb: number | null; bundled?: boolean;
};
type AssetFile = { file: string; kb: number | null; type: string };
type AssetGraph = {
  bundled: boolean | null; entry: string | null;
  js: AssetFile[]; css: AssetFile[]; assets: AssetFile[];
  totals: { js_kb: number; css_kb: number; asset_kb: number; files: number };
};
type Page = { key: string; label: string; component?: string; actions: Action[]; frontend: Frontend; assets: AssetGraph };
type Module = { key: string; label: string; group: string; pages: Page[] };

type Result = {
  label: string; method: string; url: string;
  status: number | string;
  totalMs: number;          // browser round trip
  serverMs: number | null;  // time inside Laravel
  queryMs: number | null;   // time in the database
  queries: number | null;   // statements executed
  sizeKb: number;
  rows: number | null;
  profileId: string | null;
  rolledBack: boolean;
  moduleKey: string;
  moduleLabel: string;
  pageLabel: string;
  error?: string;
};

type QueryRow = { n: number; sql: string; ms: number; bindings: unknown[] };

type UsageSite = { file: string; line: number; method: string; snippet: string };
type Usage = {
  path: string; needle: string; total: number;
  backend: { method: string; uri: string; action: string }[];
  sites: UsageSite[];
  by_file: { file: string; count: number }[];
  by_method: { method: string; count: number }[];
};

/** Rows-to-queries ratio above which a response looks like an N+1. */
const NPLUS1_RATIO = 0.5;
const NPLUS1_MIN_QUERIES = 8;

export default function LoadTesting() {
  const [modules, setModules] = useState<Module[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(true);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  // What the endpoint actually replied, so the empty state can explain itself
  // instead of leaving you guessing between 'not built', 'no permission' and
  // 'wrong response shape' — three very different fixes.
  const [diag, setDiag] = useState<string | null>(null);

  const [moduleKey, setModuleKey] = useState('');
  const [pageKey, setPageKey] = useState('');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [actionKey, setActionKey] = useState('');
  // Query drill-down: which result row is expanded, and its fetched statements.
  const [openFlow, setOpenFlow] = useState<number | null>(null);
  const [flow, setFlow] = useState<Record<string, QueryRow[]>>({});
  const [flowLoading, setFlowLoading] = useState<string | null>(null);
  // "Where is this endpoint used?" — opened by clicking a request row.
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageFor, setUsageFor] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/dev-tools/profile-targets')
      .then(res => {
        if (cancelled) return;
        const mods: Module[] = Array.isArray(res.data?.modules) ? res.data.modules : [];
        setModules(mods);
        if (!mods.length) {
          setDiag(
            typeof res.data === 'string'
              // 200 but a document body: the request never reached the endpoint —
              // usually a stale bundle calling a route that did not exist yet.
              ? `HTTP ${res.status} returned a document, not JSON — the built assets are probably stale. Run \`npm run build\` and hard-reload.`
              : `HTTP ${res.status}, keys: [${Object.keys(res.data ?? {}).join(', ') || 'none'}] — expected a "modules" array.`,
          );
        }
        if (mods.length) {
          setModuleKey(mods[0].key);
          setPageKey(mods[0].pages[0]?.key ?? '');
          setActionKey(mods[0].pages[0]?.actions?.[0]?.key ?? '');
        }
      })
      .catch(err => {
        if (cancelled) return;
        const st = err?.response?.status;
        setTargetsError(
          err?.response?.data?.message
          || (st === 404 ? 'Endpoint not found (404) — the route is registered on the server but this build may predate it.'
            : st === 403 ? 'Not permitted, or the app is not running in local/staging.'
            : `Could not load profile targets${st ? ` (HTTP ${st})` : ''}.`),
        );
      })
      .finally(() => { if (!cancelled) setLoadingTargets(false); });
    return () => { cancelled = true; };
  }, []);

  const module = useMemo(() => modules.find(m => m.key === moduleKey), [modules, moduleKey]);
  const page   = useMemo(() => module?.pages.find(p => p.key === pageKey), [module, pageKey]);
  const action = useMemo(() => page?.actions?.find(a => a.key === actionKey) ?? page?.actions?.[0], [page, actionKey]);

  /* What Run will fire. The two "All" options flatten wider and wider: every
     action on a page, or every action on every page of the module — one press to
     see the whole surface rather than stepping through nine combinations. */
  const queued: Queued[] = useMemo(() => {
    const tag = (m: Module, p: Page, rs: Req[]): Queued[] =>
      rs.map(r => ({ ...r, moduleKey: m.key, moduleLabel: m.label, pageLabel: p.label }));

    // Benchmark: every request the registry knows about, so the summary can rank
    // modules against each other rather than showing one in isolation.
    if (moduleKey === '__all') {
      return modules.flatMap(m => m.pages.flatMap(p => tag(m, p, p.actions.flatMap(a => a.requests))));
    }
    if (!module) return [];
    if (pageKey === '__all') {
      return module.pages.flatMap(p => tag(module, p, p.actions.flatMap(a => a.requests)));
    }
    if (!page) return [];
    if (actionKey === '__all') {
      return tag(module, page, page.actions.flatMap(a => a.requests));
    }
    return tag(module, page, action?.requests ?? []);
  }, [modules, module, page, action, moduleKey, pageKey, actionKey]);

  /** True while the whole app is being measured — switches the view to a ranking. */
  const benchmarking = moduleKey === '__all';

  /** Per-module totals, the number you actually optimise against. */
  const byModule = useMemo(() => {
    const acc = new Map<string, {
      label: string; requests: number; serverMs: number; queryMs: number;
      queries: number; sizeKb: number; slowest: Result | null;
    }>();
    for (const r of results) {
      const cur = acc.get(r.moduleKey) ?? {
        label: r.moduleLabel, requests: 0, serverMs: 0, queryMs: 0, queries: 0, sizeKb: 0, slowest: null,
      };
      cur.requests += 1;
      cur.serverMs += r.serverMs ?? 0;
      cur.queryMs  += r.queryMs ?? 0;
      cur.queries  += r.queries ?? 0;
      cur.sizeKb   += r.sizeKb;
      if (!cur.slowest || (r.serverMs ?? 0) > (cur.slowest.serverMs ?? 0)) cur.slowest = r;
      acc.set(r.moduleKey, cur);
    }
    return [...acc.values()].sort((a, b) => b.serverMs - a.serverMs);
  }, [results]);

  const pageOptions = useMemo(() => [
    ...(module?.pages ?? []).map(p => ({ value: p.key, label: p.label })),
    ...((module?.pages?.length ?? 0) > 1
      ? [{ value: '__all', label: 'All pages in this module' }] : []),
  ], [module]);

  const actionOptions = useMemo(() => [
    ...(page?.actions ?? []).map(a => ({
      value: a.key,
      label: a.kind === 'write' ? `${a.label}  (write)` : a.label,
    })),
    ...((page?.actions?.length ?? 0) > 1
      ? [{ value: '__all', label: 'All actions on this page' }] : []),
  ], [page]);

  /** Fire the page's requests one after another and collect the profile headers. */
  const run = async () => {
    if (!queued.length || running) return;
    setRunning(true);
    setResults([]);
    const out: Result[] = [];

    for (const r of queued) {
      const t0 = performance.now();
      try {
        const res = await api.request({
          method: r.method,
          url: r.url,
          data: r.body,
          // A write really executes so its query cost is real, then the profiler
          // rolls the transaction back — nothing it inserts or updates survives.
          headers: {
            'X-Profile': '1',
            ...(r.write ? { 'X-Profile-Rollback': '1' } : {}),
          },
        });
        const totalMs = performance.now() - t0;
        const h = res.headers as Record<string, string>;
        const body = JSON.stringify(res.data ?? '');
        // Payload rows: a bare array, or the usual { data: [...] } envelope.
        const rows = Array.isArray(res.data) ? res.data.length
          : Array.isArray(res.data?.data) ? res.data.data.length : null;

        out.push({
          label: r.label, method: r.method, url: r.url,
          status: res.status,
          totalMs: Math.round(totalMs),
          serverMs: num(h['x-profile-total-ms']),
          queryMs:  num(h['x-profile-query-ms']),
          queries:  num(h['x-profile-queries']),
          sizeKb:   Math.round(body.length / 1024),
          rows,
          profileId: h['x-profile-id'] || null,
          rolledBack: h['x-profile-rolled-back'] === '1',
          moduleKey: r.moduleKey, moduleLabel: r.moduleLabel, pageLabel: r.pageLabel,
        });
      } catch (err: any) {
        out.push({
          label: r.label, method: r.method, url: r.url,
          status: err?.response?.status ?? 'ERR',
          totalMs: Math.round(performance.now() - t0),
          serverMs: null, queryMs: null, queries: null, sizeKb: 0, rows: null,
          profileId: null, rolledBack: false,
          moduleKey: r.moduleKey, moduleLabel: r.moduleLabel, pageLabel: r.pageLabel,
          error: err?.response?.data?.message || err?.message || 'Request failed',
        });
      }
      setResults([...out]);          // stream in, so a slow call doesn't blank the table
    }

    setRanAt(new Date().toLocaleTimeString());
    setRunning(false);
  };

  /** Pull the captured statement list for a row, once, then cache it. */
  const loadFlow = async (r: Result, idx: number) => {
    if (openFlow === idx) { setOpenFlow(null); return; }
    setOpenFlow(idx);
    if (!r.profileId || flow[r.profileId]) return;
    setFlowLoading(r.profileId);
    try {
      const res = await api.get(`/dev-tools/profile/${r.profileId}`);
      setFlow(f => ({ ...f, [r.profileId!]: res.data?.queries ?? [] }));
    } catch {
      setFlow(f => ({ ...f, [r.profileId!]: [] }));
    } finally {
      setFlowLoading(null);
    }
  };

  /** Ask the server which front-end files call this endpoint. */
  const loadUsage = async (url: string) => {
    if (usageFor === url) { setUsageFor(null); setUsage(null); return; }
    setUsageFor(url);
    setUsage(null);
    setUsageLoading(true);
    try {
      const res = await api.get('/dev-tools/api-usage', { params: { path: url } });
      setUsage(res.data as Usage);
    } catch {
      setUsage(null);
    } finally {
      setUsageLoading(false);
    }
  };

  const totals = useMemo(() => results.reduce(
    (a, r) => ({
      totalMs: a.totalMs + r.totalMs,
      serverMs: a.serverMs + (r.serverMs ?? 0),
      queryMs: a.queryMs + (r.queryMs ?? 0),
      queries: a.queries + (r.queries ?? 0),
      sizeKb: a.sizeKb + r.sizeKb,
    }),
    { totalMs: 0, serverMs: 0, queryMs: 0, queries: 0, sizeKb: 0 },
  ), [results]);

  const looksNPlus1 = (r: Result) =>
    r.queries != null && r.rows != null && r.rows > 0
    && r.queries >= NPLUS1_MIN_QUERIES && r.queries >= r.rows * NPLUS1_RATIO;

  if (loadingTargets) return <div className="lt-empty">Loading modules…</div>;
  if (targetsError)   return <div className="lt-empty lt-empty--err">{targetsError}</div>;
  if (!modules.length) {
    return (
      <div className="lt-empty">
        <b>No profile targets came back.</b>
        {diag && <div className="lt-diag">{diag}</div>}
        <div className="lt-diag-hint">
          The registry lives in <code>app/Support/DevToolsProfileTargets.php</code>. This screen is
          local/staging only.
        </div>
      </div>
    );
  }

  return (
    <div className="lt">
      <style>{CSS}</style>

      {/* ── Pickers ── */}
      <div className="lt-bar">
        <div className="lt-field">
          <span>MODULE</span>
          <MasterSelect
            value={moduleKey}
            options={[
              ...modules.map(m => ({ value: m.key, label: `${m.group} · ${m.label}` })),
              ...(modules.length > 1 ? [{ value: '__all', label: 'All modules — benchmark' }] : []),
            ]}
            searchable={false}
            onChange={v => {
              const m = modules.find(x => x.key === v);
              setModuleKey(v ?? '');
              setPageKey(m?.pages[0]?.key ?? '');
              setActionKey(m?.pages[0]?.actions?.[0]?.key ?? '');
              setResults([]); setRanAt(null); setUsage(null);
            }}
          />
        </div>

        {!benchmarking && (
        <div className="lt-field">
          <span>PAGE</span>
          <MasterSelect
            value={pageKey}
            options={pageOptions}
            searchable={false}
            onChange={v => {
              setPageKey(v ?? '');
              setActionKey(module?.pages.find(p => p.key === v)?.actions?.[0]?.key ?? '');
              setResults([]); setRanAt(null); setUsage(null);
            }}
          />
        </div>
        )}

        {!benchmarking && pageKey !== '__all' && (
          <div className="lt-field">
            <span>ACTION</span>
            <MasterSelect
              value={actionKey}
              options={actionOptions}
              searchable={false}
              onChange={v => { setActionKey(v ?? ''); setResults([]); setRanAt(null); setUsage(null); }}
            />
          </div>
        )}

        <button className="lt-run" onClick={run} disabled={running || !queued.length}>
          {running ? 'Running…' : `Run ${queued.length} request${queued.length === 1 ? '' : 's'}`}
        </button>
        {queued.some(r => r.write) && (
          <span className="lt-write-note" title="Writes execute for real, then the transaction is rolled back.">
            includes writes — rolled back
          </span>
        )}
        {ranAt && <span className="lt-ran">last run {ranAt}</span>}
      </div>

      {/* ── Front-end weight of the page ── */}
      {!benchmarking && page?.frontend && (
        <div className="lt-fe">
          <div><label>COMPONENT</label><b title={page.component}>{shortPath(page.component)}</b></div>
          <div><label>SOURCE</label><b>{page.frontend.lines ?? '—'} lines{page.frontend.source_kb ? ` · ${page.frontend.source_kb} KB` : ''}</b></div>
          <div>
            <label>BUNDLE</label>
            <b className={page.frontend.bundled ? 'is-warn' : ''}>
              {page.frontend.bundled
                ? 'in main app chunk'
                : `${page.frontend.chunk_kb} KB own chunk`}
            </b>
            {page.frontend.bundled && (
              <em>downloaded by every user, even those who never open this page</em>
            )}
          </div>
        </div>
      )}

      {/* ── Every file the browser loads for this page ── */}
      {!benchmarking && page?.assets && page.assets.totals.files > 0 && (
        <div className="lt-assets">
          <button type="button" className="lt-assets-hd" onClick={() => setShowFiles(v => !v)}>
            <span className={`lt-caret ${showFiles ? 'is-open' : ''}`}>▸</span>
            <b>Files the browser loads</b>
            <span className="lt-chip">{page.assets.js.length} JS · {fmtKb(page.assets.totals.js_kb)}</span>
            <span className="lt-chip">{page.assets.css.length} CSS · {fmtKb(page.assets.totals.css_kb)}</span>
            <span className="lt-chip">{page.assets.assets.length} assets · {fmtKb(page.assets.totals.asset_kb)}</span>
            <span className="lt-assets-note">
              from Vite's build manifest — fonts/images are what the bundle <em>references</em>, not
              all of which every browser fetches
            </span>
          </button>

          {showFiles && (
            <div className="lt-assets-body">
              {([['JavaScript', page.assets.js], ['Stylesheets', page.assets.css], ['Images & fonts', page.assets.assets]] as const)
                .filter(([, list]) => list.length > 0)
                .map(([label, list]) => (
                  <div key={label} className="lt-assets-grp">
                    <div className="lt-assets-grp-hd">{label} ({list.length})</div>
                    {list.map(f => (
                      <div key={f.file} className="lt-assets-row">
                        <span className={`lt-ext lt-ext--${f.type}`}>{f.type}</span>
                        <span className="lt-assets-name" title={f.file}>{f.file.replace('assets/', '')}</span>
                        <span className={`lt-assets-kb ${(f.kb ?? 0) >= 500 ? 'is-big' : ''}`}>{fmtKb(f.kb)}</span>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ── Module ranking (benchmark mode) ── */}
      {benchmarking && byModule.length > 0 && (
        <div className="lt-rank">
          <div className="lt-rank-hd">
            <b>Server time by module</b>
            <span>
              {results.length} of {queued.length} request(s) measured — ranked by time spent
              inside Laravel, which is the part your code controls
            </span>
          </div>

          <div className="lt-rank-tblwrap">
            <table className="lt-rank-tbl">
              <thead>
                <tr>
                  <th>MODULE</th><th className="num">REQ</th>
                  <th>SERVER TIME</th>
                  <th className="num">DB</th><th className="num">QUERIES</th>
                  <th className="num">PAYLOAD</th><th>SLOWEST CALL</th>
                </tr>
              </thead>
              <tbody>
                {byModule.map(m => {
                  const worst = byModule[0].serverMs || 1;
                  // DB time as a share of server time: a high bar that is mostly
                  // dark is a database problem, mostly light is PHP.
                  const dbShare = m.serverMs > 0 ? Math.min(100, (m.queryMs / m.serverMs) * 100) : 0;
                  return (
                    <tr key={m.label}>
                      <td className="lt-rank-name">{m.label}</td>
                      <td className="num">{m.requests}</td>
                      <td className="lt-rank-barcell">
                        <span className="lt-rank-track">
                          <span className="lt-rank-fill" style={{ width: `${Math.max(4, (m.serverMs / worst) * 100)}%` }}>
                            <span className="lt-rank-db" style={{ width: `${dbShare}%` }} />
                          </span>
                        </span>
                        <b>{Math.round(m.serverMs)} ms</b>
                      </td>
                      <td className="num">{Math.round(m.queryMs)} ms</td>
                      <td className="num">{m.queries}</td>
                      <td className="num">{m.sizeKb} KB</td>
                      <td className="lt-rank-slow" title={m.slowest?.url}>
                        {m.slowest ? `${m.slowest.label} · ${Math.round(m.slowest.serverMs ?? 0)} ms` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="lt-rank-key">
            <span><i className="lt-key-sw lt-key-sw--db" /> database</span>
            <span><i className="lt-key-sw lt-key-sw--php" /> PHP / framework</span>
            <span className="lt-rank-note">
              Measured on this machine against this dataset — useful for ranking modules
              against each other, not as an absolute production figure.
            </span>
          </div>
        </div>
      )}

      {/* ── Where an endpoint is used across the app ── */}
      {usageFor && (
        <div className="lt-usage">
          <div className="lt-usage-hd">
            <b>Where <code>{usageFor}</code> is used</b>
            <button type="button" className="lt-usage-x" onClick={() => { setUsageFor(null); setUsage(null); }}>✕</button>
          </div>

          {usageLoading && <div className="lt-flow-msg">Scanning the front end…</div>}

          {!usageLoading && usage && (
            <>
              <div className="lt-usage-kpis">
                <div><label>CALL SITES</label><b>{usage.total}</b></div>
                <div><label>FILES</label><b>{usage.by_file.length}</b></div>
                <div><label>METHODS</label><b>{usage.by_method.map(m => `${m.method} ×${m.count}`).join(', ') || '—'}</b></div>
                <div>
                  <label>SERVED BY</label>
                  <b>{usage.backend.length ? usage.backend[0].action.split('@')[0] : '—'}</b>
                  {usage.backend.length > 1 && <em>{usage.backend.length} route methods</em>}
                </div>
              </div>

              {usage.by_file.length > 0 && (
                <div className="lt-bars">
                  {usage.by_file.slice(0, 10).map(f => {
                    const max = usage.by_file[0].count || 1;
                    return (
                      <div className="lt-bar-row" key={f.file}>
                        <span className="lt-bar-lbl" title={f.file}>{f.file.replace('resources/js/', '')}</span>
                        <span className="lt-bar-track">
                          <span className="lt-bar-fill" style={{ width: `${Math.max(6, (f.count / max) * 100)}%` }} />
                        </span>
                        <span className="lt-bar-n">{f.count}</span>
                      </div>
                    );
                  })}
                  {usage.by_file.length > 10 && (
                    <div className="lt-bar-more">+ {usage.by_file.length - 10} more file(s)</div>
                  )}
                </div>
              )}

              <details className="lt-sites">
                <summary>Every call site ({usage.sites.length})</summary>
                {usage.sites.map((st, k) => (
                  <div className="lt-site" key={k}>
                    <span className="lt-site-m">{st.method}</span>
                    <span className="lt-site-f">{st.file.replace('resources/js/', '')}<em>:{st.line}</em></span>
                    <code className="lt-site-s">{st.snippet}</code>
                  </div>
                ))}
              </details>

              {usage.needle !== usage.path && (
                <div className="lt-usage-note">
                  Matched on <code>{usage.needle}</code> with an id-shaped gap — the source
                  interpolates the id, so the literal path never appears.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Results ── */}
      <div className="lt-tblwrap">
        <table className="lt-tbl">
          <thead>
            <tr>
              <th>REQUEST</th><th>STATUS</th>
              <th className="num">ROWS</th><th className="num">SIZE</th>
              <th className="num">ROUND TRIP</th><th className="num">SERVER</th>
              <th className="num">DB</th><th className="num">QUERIES</th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 && (
              <tr><td colSpan={8} className="lt-empty-cell">
                {running ? 'Running…' : 'Pick a module and page, then press Run.'}
              </td></tr>
            )}
            {results.map((r, i) => (
              <Fragment key={i}>
              <tr className={r.error ? 'is-err' : ''}>
                <td>
                  <button
                    type="button"
                    className={`lt-usebtn ${usageFor === r.url ? 'is-open' : ''}`}
                    onClick={() => loadUsage(r.url)}
                    title="Show every screen in the app that calls this endpoint"
                  >
                    <span className="lt-lbl">{r.label}</span>
                    <span className="lt-useico">where used ▸</span>
                  </button>
                  {benchmarking && (
                    <div className="lt-crumb">{r.moduleLabel} · {r.pageLabel}</div>
                  )}
                  <div className="lt-url"><span className="lt-m">{r.method}</span>{r.url}</div>
                  {r.error && <div className="lt-errmsg">{r.error}</div>}
                </td>
                <td><span className={`lt-status ${String(r.status).startsWith('2') ? 'ok' : 'bad'}`}>{r.status}</span></td>
                <td className="num">{r.rows ?? '—'}</td>
                <td className="num">{r.sizeKb} KB</td>
                <td className="num">{r.totalMs} ms</td>
                <td className="num">{r.serverMs ?? '—'}{r.serverMs != null && ' ms'}</td>
                <td className="num">{r.queryMs ?? '—'}{r.queryMs != null && ' ms'}</td>
                <td className="num">
                  {r.profileId && (r.queries ?? 0) > 0 ? (
                    <button
                      type="button"
                      className={`lt-qbtn ${openFlow === i ? 'is-open' : ''}`}
                      onClick={() => loadFlow(r, i)}
                      title="Show every statement this request ran, in order"
                    >
                      {r.queries}
                      <span className="lt-qcaret">{openFlow === i ? '▾' : '▸'}</span>
                    </button>
                  ) : (r.queries ?? '—')}
                  {looksNPlus1(r) && <span className="lt-flag" title={`${r.queries} queries for ${r.rows} rows — one per row suggests a missing eager load`}>N+1?</span>}
                </td>
              </tr>
                {openFlow === i && (
              <tr className="lt-flowrow">
                <td colSpan={8}>
                  {flowLoading === r.profileId && <div className="lt-flow-msg">Loading statements…</div>}
                  {flowLoading !== r.profileId && (flow[r.profileId ?? ''] ?? []).length === 0 && (
                    <div className="lt-flow-msg">
                      No statements captured — the capture expires after 10 minutes, so re-run to inspect it.
                    </div>
                  )}
                  {(flow[r.profileId ?? ''] ?? []).length > 0 && (
                    <div className="lt-flow">
                      <div className="lt-flow-hd">
                        <b>Query flow</b>
                        <span>{(flow[r.profileId ?? ''] ?? []).length} statement(s), in execution order</span>
                        {r.rolledBack && <span className="lt-rb">rolled back</span>}
                      </div>
                      {(flow[r.profileId ?? ''] ?? []).map(q => (
                        <div key={q.n} className={`lt-q ${q.ms >= 10 ? 'is-slow' : ''}`}>
                          <span className="lt-qn">{q.n}</span>
                          <span className="lt-qms">{q.ms} ms</span>
                          <code className="lt-qsql">{q.sql}</code>
                          {q.bindings?.length > 0 && (
                            <span className="lt-qb" title={JSON.stringify(q.bindings)}>
                              [{q.bindings.map(b => String(b ?? 'null')).join(', ')}]
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
                )}
              </Fragment>
            ))}
          </tbody>
          {results.length > 1 && (
            <tfoot>
              <tr>
                <td>TOTAL — {results.length} request(s)</td><td />
                <td className="num" />
                <td className="num">{totals.sizeKb} KB</td>
                <td className="num">{totals.totalMs} ms</td>
                <td className="num">{Math.round(totals.serverMs)} ms</td>
                <td className="num">{Math.round(totals.queryMs)} ms</td>
                <td className="num">{totals.queries}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

const fmtKb = (kb?: number | null) =>
  kb == null ? '—' : kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
const num = (v?: string) => (v == null || v === '' ? null : Number(v));
const shortPath = (p?: string) => (p ? p.replace('resources/js/', '') : '—');

const CSS = `
.lt{display:flex;flex-direction:column;gap:14px;padding:14px 16px 18px;}
.lt-empty{padding:34px;text-align:center;color:#64748b;font-size:13px;}
.lt-empty--err{color:#b91c1c;}
.lt-empty b{display:block;font-size:13px;color:#0f172a;margin-bottom:6px;}
.lt-diag{font-size:11.5px;color:#b45309;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:8px 12px;max-width:640px;margin:0 auto 8px;text-align:left;}
.lt-diag-hint{font-size:10.5px;color:#94a3b8;}
.lt-diag-hint code{font-family:ui-monospace,monospace;background:#f1f5f9;padding:1px 5px;border-radius:4px;}
.lt-bar{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;}
.lt-field{display:flex;flex-direction:column;gap:4px;min-width:210px;}
.lt-field span{font-size:9.5px;font-weight:800;letter-spacing:.06em;color:#64748b;}
.lt-field select{height:36px;border:1.5px solid #cbd5e1;border-radius:9px;padding:0 10px;font-size:12.5px;font-weight:600;background:#fff;color:#0f172a;}
.lt-run{height:36px;padding:0 18px;border:none;border-radius:9px;background:linear-gradient(135deg,#0e7490,#06b6d4);color:#fff;font-size:12.5px;font-weight:800;cursor:pointer;}
.lt-run:disabled{opacity:.6;cursor:not-allowed;}
.lt-ran{font-size:11px;color:#64748b;align-self:center;}
.lt-fe{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;border:1px solid #bae6fd;background:#f0f9ff;border-radius:12px;padding:10px 14px;}
.lt-fe > div{display:flex;flex-direction:column;gap:2px;min-width:0;}
.lt-fe label{font-size:8.5px;font-weight:800;letter-spacing:.06em;color:#64748b;margin:0;}
.lt-fe b{font-size:12px;font-weight:800;color:#0c4a6e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lt-fe b.is-warn{color:#b45309;}
.lt-fe em{font-size:9.5px;font-style:normal;color:#b45309;}
.lt-tblwrap{overflow-x:auto;border:1px solid #e2e8f0;border-radius:12px;}
.lt-tbl{width:100%;border-collapse:collapse;font-size:12px;background:#fff;}
.lt-tbl th{background:#0e8aa6;color:#fff;font-size:9.5px;font-weight:800;letter-spacing:.05em;text-align:left;padding:9px 12px;white-space:nowrap;}
.lt-tbl th.num,.lt-tbl td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
.lt-tbl td{padding:9px 12px;border-bottom:1px solid #eef2f6;vertical-align:top;}
.lt-tbl tr.is-err td{background:#fef2f2;}
.lt-tbl tfoot td{font-weight:800;background:#f8fafc;border-top:2px solid #e2e8f0;}
.lt-lbl{font-weight:700;color:#0f172a;}
.lt-url{font-size:10.5px;color:#64748b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;}
.lt-m{display:inline-block;min-width:34px;font-weight:800;color:#0891b2;}
.lt-errmsg{font-size:10.5px;color:#b91c1c;margin-top:2px;}
.lt-slow{font-size:10px;color:#94a3b8;margin-top:3px;font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:520px;}
.lt-status{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:800;}
.lt-status.ok{background:#dcfce7;color:#15803d;}
.lt-status.bad{background:#fee2e2;color:#b91c1c;}
.lt-flag{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:6px;background:#fef3c7;color:#b45309;font-size:9.5px;font-weight:800;}
.lt-empty-cell{text-align:center;color:#94a3b8;padding:26px;}
[data-bs-theme="dark"] .lt-field select,[data-bs-theme="dark"] .lt-tbl{background:#0f172a;color:#e2e8f0;border-color:#1e293b;}
[data-bs-theme="dark"] .lt-fe{background:#082f49;border-color:#0c4a6e;}
[data-bs-theme="dark"] .lt-fe b{color:#cffafe;}
[data-bs-theme="dark"] .lt-tbl td{border-color:#1e293b;}
[data-bs-theme="dark"] .lt-tbl tfoot td{background:#111c33;}
.lt-crumb{font-size:9.5px;font-weight:700;color:#0891b2;letter-spacing:.02em;}
.lt-rank{border:1px solid #bae6fd;background:#f8fdff;border-radius:12px;overflow:hidden;}
.lt-rank-hd{display:flex;flex-direction:column;gap:2px;padding:10px 14px;background:#e0f2fe;}
.lt-rank-hd b{font-size:12px;color:#0c4a6e;}
.lt-rank-hd span{font-size:10px;color:#0369a1;}
.lt-rank-tblwrap{overflow-x:auto;}
.lt-rank-tbl{width:100%;border-collapse:collapse;font-size:12px;}
.lt-rank-tbl th{text-align:left;font-size:9px;font-weight:800;letter-spacing:.05em;color:#64748b;padding:8px 12px;white-space:nowrap;}
.lt-rank-tbl th.num,.lt-rank-tbl td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
.lt-rank-tbl td{padding:7px 12px;border-top:1px solid #e8f4fa;vertical-align:middle;}
.lt-rank-name{font-weight:800;color:#0c4a6e;white-space:nowrap;}
.lt-rank-barcell{display:flex;align-items:center;gap:9px;min-width:230px;}
.lt-rank-barcell b{font-size:11.5px;color:#0c4a6e;font-variant-numeric:tabular-nums;white-space:nowrap;}
.lt-rank-track{flex:1;height:14px;background:#e2e8f0;border-radius:999px;overflow:hidden;min-width:110px;}
.lt-rank-fill{display:block;height:100%;background:#7dd3fc;border-radius:999px;position:relative;}
.lt-rank-db{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#0e7490,#0891b2);border-radius:999px 0 0 999px;}
.lt-rank-slow{font-size:10.5px;color:#64748b;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lt-rank-key{display:flex;align-items:center;gap:14px;padding:8px 14px;font-size:10px;color:#64748b;flex-wrap:wrap;}
.lt-key-sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px;}
.lt-key-sw--db{background:#0891b2;}
.lt-key-sw--php{background:#7dd3fc;}
.lt-rank-note{margin-left:auto;font-style:italic;max-width:420px;}
[data-bs-theme="dark"] .lt-rank{background:#082f49;border-color:#0c4a6e;}
[data-bs-theme="dark"] .lt-rank-hd{background:#0c4a6e;}
[data-bs-theme="dark"] .lt-rank-hd b,[data-bs-theme="dark"] .lt-rank-name,[data-bs-theme="dark"] .lt-rank-barcell b{color:#cffafe;}
[data-bs-theme="dark"] .lt-rank-tbl td{border-color:#0c4a6e;}
.lt-usebtn{display:flex;align-items:center;gap:8px;border:none;background:none;padding:0;cursor:pointer;text-align:left;}
.lt-usebtn .lt-lbl{font-weight:700;color:#0f172a;}
.lt-useico{font-size:9px;font-weight:800;color:#0891b2;opacity:0;transition:opacity .12s ease;white-space:nowrap;}
.lt-usebtn:hover .lt-useico,.lt-usebtn.is-open .lt-useico{opacity:1;}
.lt-usebtn.is-open .lt-lbl{color:#0891b2;}
.lt-usage{border:1px solid #bae6fd;background:#f8fdff;border-radius:12px;overflow:hidden;}
.lt-usage-hd{display:flex;align-items:center;justify-content:space-between;padding:9px 14px;background:#e0f2fe;}
.lt-usage-hd b{font-size:12px;color:#0c4a6e;}
.lt-usage-hd code{font-family:ui-monospace,monospace;background:rgba(255,255,255,.7);padding:1px 6px;border-radius:5px;}
.lt-usage-x{border:none;background:none;cursor:pointer;color:#0369a1;font-size:13px;font-weight:800;}
.lt-usage-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:12px 14px;}
.lt-usage-kpis > div{display:flex;flex-direction:column;gap:2px;min-width:0;}
.lt-usage-kpis label{font-size:8.5px;font-weight:800;letter-spacing:.06em;color:#64748b;margin:0;}
.lt-usage-kpis b{font-size:15px;font-weight:800;color:#0c4a6e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lt-usage-kpis em{font-size:9.5px;font-style:normal;color:#94a3b8;}
.lt-bars{display:flex;flex-direction:column;gap:5px;padding:2px 14px 12px;}
.lt-bar-row{display:flex;align-items:center;gap:9px;}
.lt-bar-lbl{flex:0 0 250px;font-size:10.5px;font-family:ui-monospace,monospace;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lt-bar-track{flex:1;height:12px;background:#e2e8f0;border-radius:999px;overflow:hidden;}
.lt-bar-fill{display:block;height:100%;background:linear-gradient(90deg,#0891b2,#22d3ee);border-radius:999px;}
.lt-bar-n{flex:0 0 26px;text-align:right;font-size:11px;font-weight:800;color:#0c4a6e;font-variant-numeric:tabular-nums;}
.lt-bar-more{font-size:10px;color:#94a3b8;padding-left:259px;}
.lt-sites{padding:0 14px 12px;}
.lt-sites summary{font-size:11px;font-weight:700;color:#0369a1;cursor:pointer;padding:4px 0;}
.lt-site{display:flex;align-items:baseline;gap:8px;padding:3px 0;border-bottom:1px dashed #e8eef4;}
.lt-site-m{flex:0 0 46px;font-size:9px;font-weight:800;color:#0891b2;}
.lt-site-f{flex:0 0 250px;font-size:10.5px;font-family:ui-monospace,monospace;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lt-site-f em{font-style:normal;color:#94a3b8;}
.lt-site-s{flex:1;min-width:0;font-size:10px;font-family:ui-monospace,monospace;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lt-usage-note{font-size:10px;color:#64748b;padding:0 14px 12px;}
.lt-usage-note code{font-family:ui-monospace,monospace;background:#e0f2fe;padding:1px 5px;border-radius:4px;}
[data-bs-theme="dark"] .lt-usage{background:#082f49;border-color:#0c4a6e;}
[data-bs-theme="dark"] .lt-usage-hd{background:#0c4a6e;}
[data-bs-theme="dark"] .lt-usage-hd b,[data-bs-theme="dark"] .lt-usage-kpis b{color:#cffafe;}
[data-bs-theme="dark"] .lt-usebtn .lt-lbl{color:#e2e8f0;}
@media (max-width:900px){.lt-usage-kpis{grid-template-columns:repeat(2,1fr);}.lt-bar-lbl,.lt-site-f{flex-basis:150px;}}
.lt-write-note{align-self:center;font-size:10.5px;font-weight:700;color:#b45309;background:#fef3c7;border:1px solid #fcd34d;border-radius:999px;padding:3px 10px;white-space:nowrap;}
.lt-qbtn{border:none;background:#e0f2fe;color:#0369a1;font-weight:800;font-size:11.5px;border-radius:7px;padding:2px 8px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-variant-numeric:tabular-nums;}
.lt-qbtn:hover,.lt-qbtn.is-open{background:#0891b2;color:#fff;}
.lt-qcaret{font-size:9px;}
.lt-flowrow td{background:#f8fafc;padding:0;}
.lt-flow{padding:10px 14px 12px;}
.lt-flow-msg{padding:12px 14px;font-size:11.5px;color:#64748b;}
.lt-flow-hd{display:flex;align-items:center;gap:10px;margin-bottom:8px;}
.lt-flow-hd b{font-size:11px;color:#0f172a;}
.lt-flow-hd span{font-size:10px;color:#64748b;}
.lt-rb{background:#fef3c7;color:#b45309;font-weight:800;padding:1px 8px;border-radius:999px;}
.lt-q{display:flex;align-items:baseline;gap:9px;padding:4px 0;border-bottom:1px dashed #e8eef4;}
.lt-q.is-slow .lt-qms{color:#b45309;font-weight:800;}
.lt-qn{min-width:22px;text-align:right;font-size:10px;color:#94a3b8;font-variant-numeric:tabular-nums;}
.lt-qms{min-width:58px;text-align:right;font-size:10.5px;color:#64748b;font-variant-numeric:tabular-nums;}
.lt-qsql{flex:1;min-width:0;font-size:10.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#0f172a;word-break:break-word;}
.lt-qb{font-size:9.5px;color:#94a3b8;font-family:ui-monospace,monospace;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;}
[data-bs-theme="dark"] .lt-flowrow td{background:#0b1220;}
[data-bs-theme="dark"] .lt-qsql,[data-bs-theme="dark"] .lt-flow-hd b{color:#e2e8f0;}
.lt-assets{border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#fff;}
.lt-assets-hd{display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;border:none;background:#f8fafc;cursor:pointer;text-align:left;flex-wrap:wrap;}
.lt-assets-hd b{font-size:12px;color:#0f172a;}
.lt-caret{display:inline-block;transition:transform .15s ease;color:#64748b;font-size:11px;}
.lt-caret.is-open{transform:rotate(90deg);}
.lt-chip{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:#e0f2fe;color:#0369a1;white-space:nowrap;}
.lt-assets-note{font-size:9.5px;color:#94a3b8;margin-left:auto;max-width:340px;line-height:1.3;}
.lt-assets-note em{font-style:italic;}
.lt-assets-body{padding:10px 12px 12px;display:flex;flex-direction:column;gap:12px;}
.lt-assets-grp-hd{font-size:9.5px;font-weight:800;letter-spacing:.05em;color:#64748b;margin-bottom:4px;}
.lt-assets-row{display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px dashed #f1f5f9;}
.lt-ext{flex-shrink:0;min-width:38px;text-align:center;font-size:9px;font-weight:800;text-transform:uppercase;padding:1px 5px;border-radius:5px;background:#e2e8f0;color:#475569;}
.lt-ext--js{background:#fef3c7;color:#b45309;}
.lt-ext--css{background:#dbeafe;color:#1d4ed8;}
.lt-ext--png,.lt-ext--jpg,.lt-ext--svg,.lt-ext--gif{background:#dcfce7;color:#15803d;}
.lt-ext--woff,.lt-ext--woff2,.lt-ext--ttf,.lt-ext--eot{background:#ede9fe;color:#6d28d9;}
.lt-assets-name{flex:1;min-width:0;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lt-assets-kb{font-size:11px;font-weight:700;color:#64748b;font-variant-numeric:tabular-nums;white-space:nowrap;}
.lt-assets-kb.is-big{color:#b45309;}
[data-bs-theme="dark"] .lt-assets{background:#0f172a;border-color:#1e293b;}
[data-bs-theme="dark"] .lt-assets-hd{background:#111c33;}
[data-bs-theme="dark"] .lt-assets-hd b,[data-bs-theme="dark"] .lt-assets-name{color:#e2e8f0;}
@media (max-width:820px){.lt-fe{grid-template-columns:1fr;}}
`;
