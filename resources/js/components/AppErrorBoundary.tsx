import { Component, type ErrorInfo, type ReactNode } from 'react';

/* ─────────────────────────────────────────────────────────────────────────
 * The app had NO error boundary anywhere, so any throw during render tore
 * down the entire tree and left a blank white page — no message, no way back,
 * nothing but a stack trace in the console. That is what a missing lazy chunk
 * after a deploy looked like from the user's side, and it is what any other
 * render-time bug would look like too.
 *
 * A boundary cannot un-break the page, but it can turn a blank screen into
 * something a person can act on and a tester can report: what happened, and a
 * button that fixes the common cause.
 *
 * Deliberately dependency-free (no toast, no router, no theme): it has to be
 * able to render when the thing that failed might be any of those.
 * ───────────────────────────────────────────────────────────────────────── */

type Props = { children: ReactNode };
type State = { error: Error | null };

/** A chunk that 404s after a deploy — see utils/lazyPage. */
function isStaleChunkError(err: Error): boolean {
  const m = `${err?.name ?? ''} ${err?.message ?? ''}`;
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to load module script|ChunkLoadError/i.test(m);
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    /* Kept in the console rather than shipped anywhere — there is no error
       reporting service wired up in this app, and inventing one here would be
       a bigger decision than this fix. The component stack is the part that
       actually locates the failure, and React does not print it itself once a
       boundary handles the error. */
    console.error('[AppErrorBoundary]', error, info.componentStack);
  }

  private reload = () => {
    /* Clear lazyPage's auto-reload stamp first (same RELOAD_KEY) so it
       treats this as a fresh start: a person deliberately clicking Reload
       should not be refused by the cooldown that exists to stop machine
       loops. */
    try { sessionStorage.removeItem('cbc_chunk_reload_at'); } catch {}
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const stale = isStaleChunkError(error);

    return (
      <div style={S.wrap} role="alert">
        <div style={S.card}>
          <div style={S.icon} aria-hidden>{stale ? '⟳' : '!'}</div>
          <h1 style={S.title}>
            {stale ? 'This page was updated' : 'Something went wrong'}
          </h1>
          <p style={S.body}>
            {stale
              ? 'A newer version of the app has been released since this tab was opened, so part of it could no longer be loaded. Reloading picks up the new version.'
              : 'The page could not be displayed. Reloading usually clears it; if it keeps happening, please report the details below.'}
          </p>
          <button type="button" style={S.btn} onClick={this.reload}>Reload the page</button>
          {/* Collapsed by default — a stack trace is noise to most users and
              the first thing a tester is asked for. */}
          <details style={S.details}>
            <summary style={S.summary}>Technical details</summary>
            <pre style={S.pre}>{error.name}: {error.message}</pre>
          </details>
        </div>
      </div>
    );
  }
}

/* Inline styles on purpose: the stylesheet itself may be what failed. */
const S: Record<string, React.CSSProperties> = {
  wrap: {
    position: 'fixed', inset: 0, zIndex: 99999,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 24, background: '#f8fafc',
    font: '400 14px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    color: '#0f172a',
  },
  card: {
    maxWidth: 460, width: '100%', textAlign: 'center',
    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
    padding: '32px 28px', boxShadow: '0 10px 30px rgba(15,23,42,.08)',
  },
  icon: {
    width: 46, height: 46, margin: '0 auto 16px', borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#ecfeff', color: '#0e7490', fontSize: 22, fontWeight: 700,
  },
  title: { margin: '0 0 8px', fontSize: 17, fontWeight: 700 },
  body: { margin: '0 0 20px', fontSize: 13, color: '#475569' },
  btn: {
    padding: '9px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
    background: 'linear-gradient(135deg,#0891b2,#0e7490)', color: '#fff',
    font: 'inherit', fontSize: 13, fontWeight: 700,
  },
  details: { marginTop: 20, textAlign: 'left' },
  summary: { cursor: 'pointer', fontSize: 12, color: '#64748b' },
  pre: {
    margin: '8px 0 0', padding: 10, borderRadius: 8,
    background: '#f1f5f9', color: '#334155',
    fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
};
