import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../hooks/useScrollLock';
import { IdCell as DtIdCell, PillCell, TruncCell, type DataTableColumn, type DataTableTab } from '../../components/ui/DataTable';
import { cvApi, CvApiError, type CredentialRow, type Meta, type PageMeta, type Perm, type Risk, type Twofa, type TypeDef } from './cvApi';
import { CV_ICONS } from './cvIcons';
import '../../components/ui/DataTable.css';
import '../p2p/p2p-master-management/supplier-management/supplier-management.css';
import '../sales/core-masters/customer/SalesCustomers.css';
import './credvault.css';
import './credvault-app.css';

export function Svg({ icon, d, size = 14, sw = 2.2, stroke = 'currentColor', className }: {
  icon?: string; d?: string; size?: number; sw?: number; stroke?: string; className?: string;
}) {
  const inner = d ?? (icon ? (CV_ICONS[icon] ?? (/^M/.test(icon) ? `<path d="${icon}"/>` : icon)) : '');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}
      dangerouslySetInnerHTML={{ __html: inner }} />
  );
}

export const IC = {
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  shieldAlert: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  view: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  del: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  chevDown: '<polyline points="6 9 12 15 18 9"/>',
  chevLeft: '<polyline points="15 18 9 12 15 6"/>',
  chevRight: '<polyline points="9 18 15 12 9 6"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  pulse: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/><polyline points="3.5 12 8 12 10 9 13 15 15 12 20.5 12"/>',
  log: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>',
  bin: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  restore: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  dash: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  policy: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  backup: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  req: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  sharedWithYou: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87',
} as const;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
export function fmtDay(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : `${pad(d.getDate())} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}
export function fmtTime(iso?: string | null, seconds = false): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? ':' + pad(d.getSeconds()) : ''}`;
}
export function timeAgo(iso?: string | null): string {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
export function initials(name?: string | null): string {
  const p = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
}
export function bytes(n?: number | null): string {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
export const cap = (s?: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
export function errMsg(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  return e instanceof CvApiError || e instanceof Error ? e.message || fallback : fallback;
}

export function useCvMeta(): {
  meta: Meta | null;
  typeOf: (key?: string | null) => TypeDef | undefined;
  error: string | null;
  reload: () => Promise<void>;
} {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const on = useRef(true);
  const reload = useCallback(() => cvApi.meta()
    .then(m => { if (on.current) { setMeta(m); setError(null); } })
    .catch(e => { if (on.current) setError(errMsg(e)); }), []);
  useEffect(() => { on.current = true; reload(); return () => { on.current = false; }; }, [reload]);
  const byKey = useMemo(() => new Map((meta?.types ?? []).map(t => [t.key, t])), [meta]);
  return { meta, typeOf: (key) => (key ? byKey.get(key) : undefined), error, reload };
}

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useNow(active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!active) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [active]);
  return now;
}

export function CvPage({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`cvx smc-root whm-page ${className}`}>{children}</div>;
}

export function CvStrip({ icon, title, sub, actions, tone = 'teal' }: {
  icon: string; title: string; sub: ReactNode; actions?: ReactNode; tone?: string;
}) {
  return (
    <div className="sup-fig">
      <div className={`cstrip cstrip--${tone}`}>
        <span className="cstrip__accent" />
        <span className="cstrip__glow" />
        <span className="cstrip__sheen" />
        <div className="cstrip__left">
          <div className="cstrip__avatar-wrap">
            <div className="cstrip__avatar"><Svg d={icon} size={17} stroke="#fff" /></div>
            <span className="cstrip__online-dot" />
          </div>
          <div className="min-w-0">
            <div className="cstrip__title">{title}</div>
            <div className="cstrip__sub">{sub}</div>
          </div>
        </div>
        {actions && <div className="cstrip__right">{actions}</div>}
      </div>
    </div>
  );
}

export function StripBtn({ icon, children, onClick, ghost, disabled, title }: {
  icon: string; children: ReactNode; onClick?: () => void; ghost?: boolean; disabled?: boolean; title?: string;
}) {
  return (
    <button type="button" className={`cstrip__action-btn${ghost ? ' cstrip__action-btn--ghost' : ''}`}
      onClick={onClick} disabled={disabled} title={title}>
      {!ghost && <span className="cstrip__action-btn-sheen" />}
      <Svg d={icon} size={13} />{children}
    </button>
  );
}

export function CvBrief({ icon, label, sub, steps, defaultOpen = false }: {
  icon: string; label: string; sub: string;
  steps: { icon: string; title: string; desc: string }[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="sup-fig">
      <div className={`bref-box bref-box--teal${open ? '' : ' is-collapsed'}`}>
        <div className="bref-box__header" onClick={() => setOpen(o => !o)} role="button" aria-expanded={open}>
          <div className="bref-box__header-ico"><Svg d={icon} size={15} /></div>
          <div className="bref-box__header-mid">
            <div className="bref-box__header-row">
              <div className="bref-box__header-label">{label}</div>
              <div className="bref-box__header-sep" />
              <div className="bref-box__header-title">What We Are Doing Here</div>
            </div>
            <div className="bref-box__header-sub">{sub}</div>
          </div>
          <div className="bref-box__header-right"><div className="bref-box__toggle"><Svg d={IC.chevDown} size={10} /></div></div>
        </div>
        <div className="bref-box__body">
          {steps.map((s, i) => (
            <div className="bref-item" key={s.title}>
              <div className="bref-item__top">
                <div className="bref-item__ico"><Svg d={s.icon} size={12} /></div>
                <span className="bref-item__num">Step {String(i + 1).padStart(2, '0')}</span>
              </div>
              <div className="bref-item__title">{s.title}</div>
              <div className="bref-item__desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CvCard({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const scroller = el.closest('.main-content') as HTMLElement | null;
      const top = scroller
        ? el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
        : el.getBoundingClientRect().top + (document.scrollingElement?.scrollTop ?? 0);
      const space = scroller ? scroller.clientHeight : window.innerHeight;
      const foot = (document.querySelector('footer.footer') as HTMLElement | null)?.offsetHeight ?? 0;
      el.style.minHeight = `${Math.max(240, space - top - (foot > 0 ? foot + 8 : 15))}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : undefined;
    for (let s = el.parentElement?.previousElementSibling; s; s = s.previousElementSibling) ro?.observe(s);
    return () => { window.removeEventListener('resize', fit); ro?.disconnect(); };
  }, []);
  return <div className="bst-wrap"><div className="bst-card" ref={ref}>{children}</div></div>;
}

export interface CvTab { key: string; label: string; icon: string; count?: number | null }
export function CvTabsRow({ tabs, active, onTab, search, onSearch, placeholder, extra, className = 'tvc-top' }: {
  tabs: CvTab[]; active: string; onTab: (k: string) => void;
  search?: string; onSearch?: (v: string) => void; placeholder?: string; extra?: ReactNode; className?: string;
}) {
  return (
    <div className={`parch-main-row whm-main-row ${className}`}>
      <div className="smt-proctype-tabs parch-main-tabs" role="tablist">
        {tabs.map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={active === t.key} data-pt="svc-phys"
            className={`smt-proctype-tab${active === t.key ? ' is-active' : ''}`} onClick={() => onTab(t.key)}>
            <span className="smt-proctype-tab__ico">
              {t.icon.startsWith('ri-') ? <i className={t.icon} style={{ fontSize: 15 }} /> : <Svg icon={t.icon} d={t.icon.startsWith('<') ? t.icon : undefined} size={15} />}
            </span>
            <span className="smt-proctype-tab__lbl">{t.label}</span>
            <span className="bst-tab-c parch-main-c">{t.count ?? '·'}</span>
          </button>
        ))}
      </div>
      {extra}
      {onSearch && (
        <div className="bst-search parch-search whm-main-search">
          <Svg d={IC.search} size={14} stroke="#94a3b8" />
          <input type="text" value={search ?? ''} placeholder={placeholder} onChange={e => onSearch(e.target.value)} aria-label="Search" autoComplete="off" />
          {search ? (
            <button type="button" className="bst-search-clear" onClick={() => onSearch('')} aria-label="Clear search">
              <Svg d={IC.close} size={13} sw={2.4} />
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function CvPager({ page, lastPage, total, perPage, noun = 'credentials', onPage }: {
  page: number; lastPage: number; total: number; perPage: number; noun?: string; onPage: (p: number) => void;
}) {
  if (!total) return null;
  const start = (page - 1) * perPage;
  if (lastPage <= 1) {
    return <div className="bst-pager whm-pager"><span className="bst-pg-info">Showing <b>{total}</b> {total === 1 ? noun.replace(/s$/, '') : noun}</span></div>;
  }
  const from = Math.max(1, Math.min(page - 2, lastPage - 4));
  const nums = Array.from({ length: Math.min(5, lastPage) }, (_, i) => from + i);
  return (
    <div className="bst-pager whm-pager">
      <span className="bst-pg-info">Showing <b>{start + 1}–{Math.min(start + perPage, total)}</b> of <b>{total}</b> {noun}</span>
      <div className="bst-pg-ctrls">
        <button type="button" className="bst-pg-btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button>
        {nums.map(n => (
          <button key={n} type="button" className={`bst-pg-num${n === page ? ' is-active' : ''}`} onClick={() => onPage(n)}>{n}</button>
        ))}
        <button type="button" className="bst-pg-btn" disabled={page >= lastPage} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function ShimRows({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="cv-shimrow">{Array.from({ length: cols }, (_, c) => <td key={c}><i style={{ width: `${55 + ((r * 7 + c * 13) % 40)}%` }} /></td>)}</tr>
      ))}
    </>
  );
}

export function EmptyRow({ cols, title, sub, action }: { cols: number; title: string; sub: string; action?: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="mv-empty">
        <div className="mv-empty__box">
          <div className="mv-empty__ico"><Svg d={`${IC.lock}<circle cx="12" cy="16" r="1.4"/>`} size={24} /></div>
          <div className="mv-empty__t">{title}</div>
          <div className="mv-empty__s">{sub}</div>
          {action}
        </div>
      </td>
    </tr>
  );
}

export function CvPortal({ onClose, children }: { onClose?: () => void; children: ReactNode }) {
  useScrollLock(true);
  useEffect(() => {
    if (!onClose) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(<div className="cvx cv-portal">{children}</div>, document.body);
}

export function ConfirmModal({ title, sub, icon, cred, points, ackLabel, confirmLabel, confirmIcon, busy, onConfirm, onClose, children }: {
  title: string; sub?: ReactNode; icon: string;
  cred?: { icon?: string; name: string; code: string; meta?: string; risk?: Risk };
  points?: { icon: string; title: ReactNode; text: ReactNode }[];
  ackLabel?: ReactNode; confirmLabel: string; confirmIcon?: string; busy?: boolean;
  onConfirm: () => void; onClose: () => void; children?: ReactNode;
}) {
  const [ack, setAck] = useState(!ackLabel);
  return (
    <CvPortal onClose={onClose}>
      <div className="dl-ov" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="dl-modal mb" role="dialog" aria-modal="true" aria-label={title}>
          <div className="mb-hd">
            <span className="mb-hd__ico"><Svg d={icon} size={24} sw={2.1} /></span>
            <div><b>{title}</b>{sub && <small>{sub}</small>}</div>
            <button type="button" data-h40="skip" className="mb-x" onClick={onClose} aria-label="Close"><Svg icon="x" size={13} sw={2.8} /></button>
          </div>
          <div className="mb-bd">
            {cred && (
              <div className="mb-cred">
                <span className="mb-cred__ico"><Svg icon={cred.icon ?? 'lock'} size={18} /></span>
                <div className="mb-cred__t"><b>{cred.name}</b><small><i className="whm-idpill">{cred.code}</i>{cred.meta}</small></div>
                {cred.risk && <span className={`znm-flag mv-rk mv-rk--${cred.risk}`}><i />{cap(cred.risk)}</span>}
              </div>
            )}
            {points && points.length > 0 && (
              <div className="mb-pts">
                {points.map((p, i) => (
                  <div className="mb-pt" key={i}><span><Svg d={p.icon} size={13} /></span><div><b>{p.title}</b><small>{p.text}</small></div></div>
                ))}
              </div>
            )}
            {children}
            {ackLabel && (
              <label className="mb-ack">
                <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
                <span className="dl-ack__box"><Svg icon="check" size={11} sw={3.2} /></span>
                <span>{ackLabel}</span>
              </label>
            )}
          </div>
          <div className="mb-ft">
            <button type="button" data-h40="skip" className="mb-btn mb-btn--ghost" onClick={onClose}>Cancel</button>
            <button type="button" data-h40="skip" className="mb-btn mb-btn--go" disabled={!ack || busy} onClick={onConfirm}>
              {confirmIcon && <Svg d={confirmIcon} size={14} />}{busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </CvPortal>
  );
}

let lastCopyId = 0;

function clearClipboard(id: number) {
  if (lastCopyId !== id) return;
  navigator.clipboard.writeText('').then(() => {}, () => {
    const retry = () => {
      if (document.visibilityState !== 'visible') return;
      window.removeEventListener('focus', retry);
      document.removeEventListener('visibilitychange', retry);
      if (lastCopyId !== id) return;
      navigator.clipboard.writeText('').then(() => {}, () => { });
    };
    window.addEventListener('focus', retry);
    document.addEventListener('visibilitychange', retry);
  });
}

export async function copyText(text: string, clearAfter = 0): Promise<void> {
  await navigator.clipboard.writeText(text);
  const id = ++lastCopyId;
  if (clearAfter > 0) setTimeout(() => clearClipboard(id), clearAfter * 1000);
}

const STR_LV = ['', 'weak', 'fair', 'good', 'strong'];

export function RiskFlag({ risk }: { risk: Risk }) {
  return <div className="znm-flagcell"><span className={`znm-flag mv-rk mv-rk--${risk}`}><i />{cap(risk)}</span></div>;
}

export function StrengthCell({ row }: { row: Pick<CredentialRow, 'has_password' | 'strength' | 'strength_label'> }) {
  if (!row.has_password) return <span className="znm-flag znm-flag--no">N/A</span>;
  const pct = row.strength * 25;
  const lv = STR_LV[row.strength] || 'weak';
  return (
    <div className={`mv-sg mv-sg--${lv}`} title={`Password strength: ${row.strength_label} · ${pct}/100`}>
      <div className="mv-sg__top">
        <span className="mv-sg__lbl"><i />{row.strength_label}</span>
        <span className="mv-sg__sc">{pct}<small>/100</small></span>
      </div>
      <div className="mv-sg__track"><span className="mv-sg__fill" style={{ width: `${pct}%` }} /><span className="mv-sg__knob" style={{ left: `${pct}%` }} /></div>
    </div>
  );
}

export function TwofaCell({ twofa }: { twofa: Twofa }) {
  return (
    <div className="znm-flagcell">
      {twofa === 'na' ? <span className="znm-flag znm-flag--no">N/A</span>
        : twofa === 'yes' ? <span className="znm-flag mv-2on"><Svg icon="shield" size={11} />Enabled</span>
          : <span className="znm-flag znm-flag--no">Not Enabled</span>}
    </div>
  );
}

export function IdCell({ code, date }: { code: string; date?: string | null }) {
  return <div className="whm-idcell"><span className="whm-idpill">{code}</span><span className="whm-iddate">{fmtDate(date)}</span></div>;
}

export function NameCell({ row, typeIcon }: { row: Pick<CredentialRow, 'name' | 'url' | 'access'>; typeIcon?: string }) {
  const shared = row.access?.via === 'share';
  const sub = row.url ?? '';
  const subIcon = shared ? IC.sharedWithYou : (/^https?:|\.[a-z]{2,}/i.test(sub) ? 'globe' : 'tag');
  return (
    <div className="whm-namecell">
      <span className="whm-namecell__ico"><Svg icon={typeIcon ?? 'lock'} size={15} /></span>
      <div className="whm-namecell__t">
        <b>{row.name}</b>
        {sub && <span className="whm-namecell__loc" title={sub}><Svg icon={subIcon} size={11} />{sub}</span>}
      </div>
    </div>
  );
}

export function CategoryCell({ label, group }: { label: string; group: string }) {
  return <div className="znm-whcell mv-catc"><span className="whm-idpill znm-whid">{label}</span><b>{group}</b></div>;
}

export function OwnerCell({ row }: { row: Pick<CredentialRow, 'owner' | 'scope' | 'access'> }) {
  const badge = row.access?.via === 'share' ? <em className="mv-shared">Shared with you</em>
    : row.scope === 'team' ? <em className="mv-team">Team</em> : <em className="mv-pers">Personal</em>;
  return (
    <div className="mv-ownc">
      <span className="mv-ownc__av">{row.owner.initials}</span>
      <div><b title={row.owner.is_me ? undefined : row.owner.name ?? undefined}>{row.owner.is_me ? 'You' : row.owner.name}</b>{badge}</div>
    </div>
  );
}

export function UpdatedCell({ iso }: { iso?: string | null }) {
  return <div className="whm-idcell"><b className="mv-upd-d">{fmtDay(iso)}</b><span className="whm-iddate">{fmtTime(iso)}</span></div>;
}

export function ActBtn({ icon, title, onClick, tone, disabled }: {
  icon: string; title: string; onClick: () => void; tone?: 'edit' | 'danger'; disabled?: boolean;
}) {
  return (
    <button type="button" className={`whm-act${tone ? ` whm-act--${tone}` : ''}`} title={title} aria-label={title}
      onClick={onClick} disabled={disabled} style={disabled ? { opacity: .35, cursor: 'not-allowed' } : undefined}>
      <Svg d={icon} size={14} />
    </button>
  );
}
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export const RISK_TONE: Record<Risk, Tone> = { low: 'success', medium: 'warning', high: 'danger', critical: 'danger' };
export const STRENGTH_TONE: Tone[] = ['danger', 'danger', 'warning', 'info', 'success'];
export const PERM_TONE: Record<Perm, Tone> = { use: 'neutral', view: 'info', copy: 'accent', full: 'success' };

export function TwoLine({ top, sub }: { top: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-truncate">{top}</div>
      {sub ? <div className="text-muted text-truncate" style={{ fontSize: 11 }}>{sub}</div> : null}
    </div>
  );
}

export const emptyState = (text: ReactNode, icon = 'ri-lock-2-line') => (
  <><i className={`${icon} d-block mb-2`} style={{ fontSize: 32, opacity: 0.4 }} />{text}</>
);

export function cvTableProps({ tabs, activeTab, onTabChange, search, onSearch, placeholder, loading, empty, paging, minWidth = 1100 }: {
  tabs?: DataTableTab[]; activeTab?: string; onTabChange?: (k: string) => void;
  search?: string; onSearch?: (v: string) => void; placeholder?: string;
  loading: boolean; empty: ReactNode; minWidth?: number;
  paging?: { meta: PageMeta | null; page: number; setPage: (p: number) => void; setPerPage: (n: number) => void };
}) {
  return {
    leadingToolbar: tabs || onSearch ? (
      <CvTabsRow tabs={(tabs ?? []).map(t => ({ key: t.key, label: t.label, icon: t.icon ?? '', count: t.count ?? null }))}
        active={activeTab ?? ''} onTab={k => onTabChange?.(k)} search={search} onSearch={onSearch} placeholder={placeholder} />
    ) : undefined,
    searchable: false,
    className: 'hr-dt', serial: true, disableSorting: true, accent: 'teal' as const, minWidth,
    fitToViewport: true, autoFitRows: true, fillToFooter: true, loading, emptyMessage: empty,
    ...(paging ? {
      serverPagination: {
        total: paging.meta?.total ?? 0,
        pageIndex: paging.page - 1,
        onPageChange: (p: number) => paging.setPage(p + 1),
        onPageSizeChange: (sz: number) => { paging.setPerPage(Math.min(100, sz)); paging.setPage(1); },
      },
    } : {}),
  };
}

export function credentialColumns({ critical = false }: { critical?: boolean } = {}): DataTableColumn<CredentialRow>[] {
  return [
    {
      header: 'Credential ID', id: 'code', meta: { width: '9%' },
      cell: ({ row: { original: r } }) => <TwoLine top={<DtIdCell value={critical ? r.critical_code ?? r.code : r.code} />} sub={fmtDate(critical ? r.updated_at : r.created_at)} />,
    },
    {
      header: 'Credential Name', id: 'name', meta: { width: '15%' },
      cell: ({ row: { original: r } }) => <TwoLine top={<b><TruncCell value={r.name} caseSensitive max={40} /></b>} sub={r.url ?? undefined} />,
    },
    {
      header: 'Category', id: 'category', meta: { width: '10%' },
      cell: ({ row: { original: r } }) => <TwoLine top={<PillCell value={r.type_label} tone="info" />} sub={r.category_group} />,
    },
    {
      header: 'Username', id: 'username', meta: { width: '10%' },
      cell: ({ row: { original: r } }) => <TruncCell value={r.username} caseSensitive max={30} />,
    },
    {
      header: 'Owner', id: 'owner', meta: { width: '10%' },
      cell: ({ row: { original: r } }) => (
        <TwoLine top={r.owner.is_me ? 'You' : r.owner.name ?? '—'}
          sub={r.access?.via === 'share' ? 'Shared with you' : r.scope === 'team' ? 'Team' : 'Personal'} />
      ),
    },
    {
      header: 'Risk', id: 'risk', meta: { width: '7%', align: 'center' },
      cell: ({ row: { original: r } }) => <PillCell value={cap(r.risk)} tone={RISK_TONE[r.risk]} />,
    },
    {
      header: 'Strength', id: 'strength', meta: { width: '9%', align: 'center' },
      cell: ({ row: { original: r } }) => (r.has_password
        ? <PillCell value={`${r.strength_label} · ${r.strength * 25}`} tone={STRENGTH_TONE[r.strength] ?? 'neutral'} />
        : <PillCell value="N/A" />),
    },
    {
      header: '2FA', id: 'twofa', meta: { width: '7%', align: 'center' },
      cell: ({ row: { original: r } }) => <PillCell value={r.twofa === 'yes' ? 'Enabled' : r.twofa === 'no' ? 'Not Enabled' : 'N/A'} tone={r.twofa === 'yes' ? 'success' : 'neutral'} />,
    },
    {
      header: 'Last Updated', id: 'updated', meta: { width: '8%' },
      cell: ({ row: { original: r } }) => <TwoLine top={fmtDay(r.updated_at)} sub={fmtTime(r.updated_at)} />,
    },
  ];
}
