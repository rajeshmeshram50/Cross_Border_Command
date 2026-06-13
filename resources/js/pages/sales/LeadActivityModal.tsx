import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Lead Activity Tracker — timeline modal triggered by the clock icon in the
 * worksheet table. Shows the lead's lifecycle, newest-first:
 *
 *   generated   → the lead was captured (manual / CRM)
 *   assigned    → first owner set
 *   reassigned  → owner changed from one salesperson to another
 *
 * Data comes from GET /sales/leads/{id}/activity, which reads the generic
 * activity_logs table (target_type='lead'). The endpoint is tenant-scoped,
 * so an out-of-scope lead 404s before any rows are returned.
 * ───────────────────────────────────────────────────────────────────────── */

type ActivityRow = {
  id:          number;
  action:      string | null;
  description: string | null;
  actor:       string | null;
  platform:    string | null;
  source:      string | null;
  old:         Record<string, unknown> | null;
  new:         Record<string, unknown> | null;
  at:          string | null;
};

type Props = {
  open:   boolean;
  leadId: number | null;
  oppCode?: string | null;
  onClose: () => void;
};

/* Per-action visual config — dot colour + glyph. Unknown actions fall back
 * to a neutral slate dot so a future action type never renders blank. */
const ACTION_META: Record<string, { color: string; bg: string; label: string; icon: JSX.Element }> = {
  generated: {
    color: '#16a34a', bg: '#dcfce7', label: 'Generated',
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
  },
  assigned: {
    color: '#2563eb', bg: '#dbeafe', label: 'Assigned',
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>,
  },
  reassigned: {
    color: '#d97706', bg: '#fef3c7', label: 'Reassigned',
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>,
  },
};

const FALLBACK_META = {
  color: '#475569', bg: '#f1f5f9', label: 'Update',
  icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>,
};

/* Footer relationship label — makes the actor read as "who did the action". */
const FOOT_LABEL: Record<string, string> = {
  generated:  'Created by',
  assigned:   'Assigned by',
  reassigned: 'Reassigned by',
};

function fmt(at: string | null): string {
  if (!at) return '—';
  const d = new Date(at);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/* "2 hours ago" / "just now" — a soft secondary label next to the exact time. */
function rel(at: string | null): string {
  if (!at) return '';
  const d = new Date(at).getTime();
  if (isNaN(d)) return '';
  const s = Math.round((Date.now() - d) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
  const mo = Math.round(days / 30);
  if (mo < 12) return `${mo} month${mo > 1 ? 's' : ''} ago`;
  return `${Math.round(mo / 12)} year${mo >= 24 ? 's' : ''} ago`;
}

/* Two-letter initials for the actor avatar. */
function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* Deterministic avatar tint from a name so each person keeps one colour. */
const AVATAR_TINTS = ['#0891b2', '#7c3aed', '#db2777', '#d97706', '#16a34a', '#2563eb', '#0d9488', '#dc2626'];
function tint(name?: string | null): string {
  if (!name) return AVATAR_TINTS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

export default function LeadActivityModal({ open, leadId, oppCode, onClose }: Props) {
  const toast = useToast();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [headOpp, setHeadOpp] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [open]);

  useEffect(() => {
    if (!open || !leadId) { setRows([]); setHeadOpp(null); return; }
    setLoading(true);
    api.get<{ status: boolean; opp_code: string | null; data: ActivityRow[] }>(`/sales/leads/${leadId}/activity`)
      .then(({ data }) => { setRows(data.data ?? []); setHeadOpp(data.opp_code ?? null); })
      .catch(() => toast.error('Load failed', 'Could not load lead activity'))
      .finally(() => setLoading(false));
  }, [open, leadId, toast]);

  if (!open) return null;

  return createPortal((
    <div className="lat-backdrop" onClick={onClose}>
      <style>{LAT_CSS}</style>
      <div className="lat-modal" onClick={e => e.stopPropagation()}>
        <div className="lat-head">
          <div className="lat-head-left">
            <div className="lat-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div>
              <div className="lat-head-title">Activity Tracker</div>
              <div className="lat-head-sub">Opp ID: {headOpp ?? oppCode ?? '—'}</div>
            </div>
          </div>
          <button className="lat-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="lat-body">
          {loading && (
            <div className="lat-loading">
              <div className="lat-skel" /><div className="lat-skel" /><div className="lat-skel" />
            </div>
          )}

          {!loading && rows.length === 0 && (
            <div className="lat-empty">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              <div className="lat-empty-t">No activity yet</div>
              <div className="lat-empty-s">Generation and ownership changes will appear here.</div>
            </div>
          )}

          {!loading && rows.length > 0 && (
            <div className="lat-timeline">
              {rows.map(r => {
                const meta    = ACTION_META[r.action ?? ''] ?? FALLBACK_META;
                const fromName = strOrNull(r.old?.salesperson_name);
                const toName   = strOrNull(r.new?.salesperson_name);
                const oppCode  = strOrNull(r.new?.opp_code);
                const isGenerated = r.action === 'generated';
                const source   = strOrNull(r.source);
                const platform = strOrNull(r.platform);
                return (
                  <div className="lat-item" key={r.id}>
                    <div className="lat-rail">
                      <span className="lat-dot" style={{ background: meta.bg, color: meta.color, boxShadow: `0 0 0 4px ${meta.bg}` }}>
                        {meta.icon}
                      </span>
                    </div>

                    <div className="lat-card">
                      <div className="lat-card-top">
                        <span className="lat-tag" style={{ background: meta.bg, color: meta.color }}>
                          <span className="lat-tag-dot" style={{ background: meta.color }} />
                          {meta.label}
                        </span>
                        <span className="lat-time" title={fmt(r.at)}>{rel(r.at)}</span>
                      </div>

                      <div className="lat-desc">{r.description ?? '—'}</div>

                      {/* Ownership transition — from → to chips for a reassignment,
                          a single "to" chip for a first assignment. */}
                      {(fromName || toName) && (
                        <div className="lat-flow">
                          {fromName && (
                            <>
                              <span className="lat-owner lat-owner-old">
                                <span className="lat-ava" style={{ background: tint(fromName) }}>{initials(fromName)}</span>
                                {fromName}
                              </span>
                              <svg className="lat-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                              </svg>
                            </>
                          )}
                          {toName && (
                            <span className="lat-owner lat-owner-new">
                              <span className="lat-ava" style={{ background: tint(toName) }}>{initials(toName)}</span>
                              {toName}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Generated meta — where the lead came from. */}
                      {isGenerated && (source || platform || oppCode) && (
                        <div className="lat-flow lat-meta">
                          {source && (
                            <span className="lat-meta-chip"><span className="lat-meta-k">Source</span>{source}</span>
                          )}
                          {platform && (
                            <span className="lat-meta-chip"><span className="lat-meta-k">Platform</span>{platform}</span>
                          )}
                          {oppCode && <span className="lat-opp">{oppCode}</span>}
                        </div>
                      )}

                      <div className="lat-card-foot">
                        <span className="lat-by">
                          <span className="lat-by-label">{FOOT_LABEL[r.action ?? ''] ?? 'By'}</span>
                          {r.actor ? (
                            <>
                              <span className="lat-ava lat-ava-sm" style={{ background: tint(r.actor) }}>{initials(r.actor)}</span>
                              <span className="lat-by-name">{r.actor}</span>
                            </>
                          ) : (
                            <span className="lat-by-system">Not recorded</span>
                          )}
                        </span>
                        <span className="lat-exact">{fmt(r.at)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lat-foot">
          <span className="lat-foot-meta">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            Generation &amp; ownership history
          </span>
          <button className="lat-btn lat-btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  ), document.body);
}

const LAT_CSS = `
.lat-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  animation: lat-fade .15s ease-out; padding: 24px;
}
@keyframes lat-fade { from { opacity: 0; } to { opacity: 1; } }
.lat-modal {
  width: 560px; max-width: 100%; max-height: 88vh;
  background: #fff; border-radius: 16px;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  overflow: hidden; display: flex; flex-direction: column;
  animation: lat-pop .18s ease-out;
}
@keyframes lat-pop { from { transform: scale(.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }

.lat-head {
  display: flex; align-items: center; gap: 11px;
  padding: 13px 18px; background: linear-gradient(135deg, #0e7490, #0891b2 55%, #22d3ee);
  color: #fff;
}
.lat-head-left { display: flex; align-items: center; gap: 11px; flex: 1; min-width: 0; }
.lat-head-icon {
  width: 34px; height: 34px; border-radius: 10px; background: rgba(255,255,255,.2);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.lat-head-title { font-size: 14.5px; font-weight: 800; line-height: 1.2; letter-spacing: -.2px; }
.lat-head-sub { font-size: 10.5px; opacity: .85; margin-top: 2px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.lat-close {
  width: 26px; height: 26px; border: none; background: rgba(255,255,255,.18);
  color: #fff; border-radius: 8px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; transition: background .15s;
}
.lat-close:hover { background: rgba(255,255,255,.32); }

.lat-body { padding: 18px; flex: 1; overflow-y: auto; background: #f8fafc; }

.lat-loading { display: flex; flex-direction: column; gap: 12px; }
.lat-skel {
  height: 58px; border-radius: 10px;
  background: linear-gradient(90deg, #e2e8f0 0%, #f1f5f9 50%, #e2e8f0 100%);
  background-size: 200% 100%; animation: lat-shimmer 1.1s ease-in-out infinite;
}
@keyframes lat-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

.lat-empty { text-align: center; padding: 40px 16px; color: #94a3b8; }
.lat-empty svg { color: #cbd5e1; margin-bottom: 10px; }
.lat-empty-t { font-size: 13px; font-weight: 700; color: #475569; }
.lat-empty-s { font-size: 11px; margin-top: 3px; }

.lat-timeline { position: relative; padding: 2px 0; }
.lat-item { display: flex; gap: 14px; position: relative; }
.lat-rail { position: relative; display: flex; flex-direction: column; align-items: center; width: 30px; flex-shrink: 0; }
/* vertical connector — soft gradient so the chain reads top-to-bottom */
.lat-item:not(:last-child) .lat-rail::after {
  content: ''; position: absolute; top: 32px; bottom: -10px; left: 50%;
  width: 2px; transform: translateX(-50%);
  background: linear-gradient(to bottom, #cbd5e1, #e2e8f0);
}
.lat-dot {
  width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; z-index: 1; margin-top: 2px;
}

/* Each event is a card so the timeline reads as discrete, scannable rows. */
.lat-card {
  flex: 1; min-width: 0; margin-bottom: 14px;
  background: #fff; border: 1px solid #e8edf3; border-radius: 12px;
  padding: 11px 13px; box-shadow: 0 1px 3px rgba(15,23,42,.04);
  transition: border-color .15s, box-shadow .15s, transform .15s;
}
.lat-card:hover { border-color: #cbd5e1; box-shadow: 0 4px 14px rgba(15,23,42,.07); transform: translateY(-1px); }

.lat-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lat-tag {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px 3px 7px; border-radius: 999px;
  font-size: 9.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
}
.lat-tag-dot { width: 5px; height: 5px; border-radius: 50%; }
.lat-time { font-size: 10.5px; color: #94a3b8; font-weight: 600; white-space: nowrap; }

.lat-desc { font-size: 12.5px; font-weight: 600; color: #0f172a; margin-top: 8px; line-height: 1.45; }

/* Ownership transition row — avatar chips + arrow. */
.lat-flow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.lat-owner {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px 3px 3px; border-radius: 999px;
  font-size: 11px; font-weight: 700; color: #0f172a;
  background: #f1f5f9; border: 1px solid #e2e8f0;
}
.lat-owner-old { opacity: .72; text-decoration: line-through; text-decoration-color: #cbd5e1; }
.lat-owner-new { background: #ecfeff; border-color: #a5f3fc; color: #0e7490; }
.lat-arrow { color: #94a3b8; flex-shrink: 0; }
.lat-opp {
  display: inline-block; padding: 3px 10px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700; color: #0e7490;
  background: #ecfeff; border: 1px solid #a5f3fc;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.lat-meta { gap: 6px; }
.lat-meta-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px 3px 7px; border-radius: 8px;
  font-size: 11px; font-weight: 700; color: #334155;
  background: #f8fafc; border: 1px solid #e2e8f0;
}
.lat-meta-k {
  font-size: 8.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  color: #94a3b8;
}

.lat-ava {
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; font-size: 9px; font-weight: 800; letter-spacing: .02em;
}
.lat-ava-sm { width: 18px; height: 18px; font-size: 8px; }

.lat-card-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-top: 11px; padding-top: 9px; border-top: 1px dashed #eef2f6;
}
.lat-by { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: #475569; font-weight: 700; min-width: 0; }
.lat-by-label { font-size: 10px; font-weight: 700; color: #94a3b8; letter-spacing: .01em; }
.lat-by-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #334155; }
.lat-by-system {
  padding: 2px 8px; border-radius: 6px; background: #f1f5f9; color: #94a3b8;
  font-size: 10px; font-weight: 700; letter-spacing: .03em; font-style: italic;
}
.lat-exact { font-size: 10px; color: #b6c2cf; font-weight: 600; white-space: nowrap; }

.lat-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 18px; background: #fff; border-top: 1px solid #e2e8f0;
}
.lat-foot-meta { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; color: #0891b2; }
.lat-btn { padding: 7px 22px; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; border: 1.5px solid transparent; transition: all .15s; }
.lat-btn-primary { background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff; }
.lat-btn-primary:hover { filter: brightness(1.08); }

[data-bs-theme="dark"] .lat-modal { background: #0f172a; color: #e2e8f0; }
[data-bs-theme="dark"] .lat-body { background: #0b1226; }
[data-bs-theme="dark"] .lat-item:not(:last-child) .lat-rail::after { background: linear-gradient(to bottom, #334155, #1e293b); }
[data-bs-theme="dark"] .lat-card { background: #0f1a30; border-color: #1e293b; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
[data-bs-theme="dark"] .lat-card:hover { border-color: #334155; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
[data-bs-theme="dark"] .lat-desc { color: #e2e8f0; }
[data-bs-theme="dark"] .lat-owner { background: #1e293b; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .lat-owner-old { text-decoration-color: #475569; }
[data-bs-theme="dark"] .lat-owner-new { background: rgba(8,145,178,.16); border-color: rgba(34,211,238,.4); color: #67e8f9; }
[data-bs-theme="dark"] .lat-opp { background: rgba(8,145,178,.16); border-color: rgba(34,211,238,.4); color: #67e8f9; }
[data-bs-theme="dark"] .lat-meta-chip { background: #16213c; border-color: #1e293b; color: #cbd5e1; }
[data-bs-theme="dark"] .lat-meta-k { color: #64748b; }
[data-bs-theme="dark"] .lat-card-foot { border-top-color: #1e293b; }
[data-bs-theme="dark"] .lat-by { color: #cbd5e1; }
[data-bs-theme="dark"] .lat-by-name { color: #cbd5e1; }
[data-bs-theme="dark"] .lat-by-system { background: #1e293b; color: #94a3b8; }
[data-bs-theme="dark"] .lat-exact { color: #64748b; }
[data-bs-theme="dark"] .lat-foot { background: #0f172a; border-color: #1e293b; }
[data-bs-theme="dark"] .lat-skel { background: linear-gradient(90deg, #1e293b 0%, #334155 50%, #1e293b 100%); background-size: 200% 100%; }

@media (max-width: 480px) {
  .lat-backdrop { padding: 0; }
  .lat-modal { border-radius: 0; max-height: 100vh; height: 100vh; }
}
`;
