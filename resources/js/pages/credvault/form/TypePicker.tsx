import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Meta, TypeDef } from '../cvApi';
import { Svg, cap } from '../shared';
import { typeColor } from './formHelpers';

/* Step 1 of Add Credential — "What would you like to add?" (crdOpenPicker). */

const gid = (g: string) => 'crdG_' + g.replace(/[^a-z]/gi, '');

function Tile({ t, group, onPick }: { t: TypeDef; group: string; onPick: (k: string) => void }) {
  const n = t.fields.length;
  return (
    <button type="button" data-h40="skip" className="crd-tile crd-tile--c" title={t.fields.map(f => f.label).join(' · ')}
      onClick={() => onPick(t.key)} style={{ '--tc': typeColor(t.key) } as CSSProperties} aria-label={`${t.label} — ${group}`}>
      <span className="crd-tile__ico"><Svg icon={t.icon} size={18} /></span>
      <span className="crd-tile__b">
        <span className="crd-tile__row">
          <span className="crd-tile__l">{t.label}</span>
          {t.twofa && <span className="crd-tile__new cv-tile-2fa" title="Supports a 2FA authenticator lock">2FA</span>}
          {t.is_new && <span className="crd-tile__new">New</span>}
        </span>
        <span className="crd-tile__d">{t.description}</span>
        <span className="crd-tile__meta">
          <span className={`crd-tile__risk crd-tile__risk--${t.risk}`}><i />{cap(t.risk)} risk</span>
          <span className="crd-tile__n">{n} field{n === 1 ? '' : 's'}</span>
        </span>
      </span>
      <span className="crd-tile__go"><Svg d='<path d="M5 12h14M13 6l6 6-6 6"/>' size={13} sw={2.6} /></span>
    </button>
  );
}

export default function TypePicker({ meta, onPick, onClose }: { meta: Meta; onPick: (k: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [nav, setNav] = useState('all');
  const body = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const byKey = new Map(meta.types.map(t => [t.key, t]));
    return meta.groups.map(g => ({ ...g, items: g.types.map(k => byKey.get(k)).filter((t): t is TypeDef => !!t) }));
  }, [meta]);
  const total = groups.reduce((s, g) => s + g.items.length, 0);

  const term = q.toLowerCase().trim();
  const hay = (t: TypeDef, g: string) => `${t.label} ${g} ${t.description} ${t.fields.map(f => f.label).join(' ')}`.toLowerCase();
  const shown = groups.map(g => ({ ...g, hits: g.items.filter(t => !term || hay(t, g.name).includes(term)) }));
  const any = shown.some(g => g.hits.length > 0);

  useEffect(() => {
    const t = setTimeout(() => search.current?.focus(), 30);
    const k = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== search.current) { e.preventDefault(); search.current?.focus(); }
    };
    document.addEventListener('keydown', k);
    return () => { clearTimeout(t); document.removeEventListener('keydown', k); };
  }, []);

  const go = (id: string) => {
    const b = body.current;
    if (!b) return;
    if (id === 'all') b.scrollTo({ top: 0, behavior: 'smooth' });
    else {
      const el = b.querySelector<HTMLElement>(`#${id}`);
      if (el) b.scrollTo({ top: el.offsetTop - b.offsetTop - 6, behavior: 'smooth' });
    }
    setNav(id);
  };

  // crdSpy: the category the list is scrolled to lights up in the side nav.
  const spy = () => {
    const b = body.current;
    if (!b) return;
    if (b.scrollTop < 8) { setNav('all'); return; }
    const vis = Array.from(b.querySelectorAll<HTMLElement>('.crd-grp:not([hidden])'));
    let cur: string | null = null;
    vis.forEach(g => { if (g.offsetTop - b.offsetTop - 40 <= b.scrollTop) cur = g.id; });
    if (b.scrollTop + b.clientHeight >= b.scrollHeight - 4 && vis.length) cur = vis[vis.length - 1].id;
    if (cur) setNav(cur);
  };

  return (
    <div className="mapsup-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mapsup-box crd-box crd-box--pick" role="dialog" aria-modal="true" aria-label="What would you like to add?">
        <div className="mapsup-header crd-phd">
          <div className="mapsup-hrow">
            <div className="mapsup-title-wrap">
              <div className="mapsup-hicon crd-phd__ico"><Svg icon="plus" size={22} sw={2.6} /></div>
              <div className="mapsup-title-block">
                <h3 className="mapsup-title">What would you like to add?</h3>
                <p className="mapsup-sub">Choose a credential type — every type is stored under one policy engine and audit trail</p>
              </div>
            </div>
            <div className="crd-phd__r">
              <div className="crd-search">
                <Svg icon="search" size={16} />
                <input ref={search} type="text" value={q} onChange={e => setQ(e.target.value)}
                  placeholder="Search type — e.g. card, server, Aadhaar, Wi-Fi…" autoComplete="off" aria-label="Search credential types" />
                <kbd>/</kbd>
              </div>
              <button type="button" className="mapsup-close" onClick={onClose} aria-label="Close"><Svg icon="x" size={13} sw={2.8} /></button>
            </div>
          </div>
        </div>
        <div className="crd-pick">
          <aside className="crd-nav">
            <div className="crd-nav__h">Categories</div>
            <div className="crd-nav__list">
              <button type="button" data-h40="skip" className={`crd-nav__b${nav === 'all' ? ' is-on' : ''}`} onClick={() => go('all')}>
                <span className="crd-nav__i"><Svg d='<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>' size={14} /></span>
                <span className="crd-nav__t">All types</span>
                <span className="crd-nav__c">{term ? shown.reduce((s, g) => s + g.hits.length, 0) : total}</span>
              </button>
              {shown.map(g => (
                <button key={g.name} type="button" data-h40="skip"
                  className={`crd-nav__b${nav === gid(g.name) ? ' is-on' : ''}${g.hits.length ? '' : ' is-dim'}`} onClick={() => go(gid(g.name))}>
                  <span className="crd-nav__i"><Svg icon={g.icon || 'folder'} size={14} /></span>
                  <span className="crd-nav__t">{g.name}</span>
                  <span className="crd-nav__c">{g.hits.length}</span>
                </button>
              ))}
            </div>
            <div className="crd-nav__tip">
              <Svg icon="lock" size={14} />
              <div><b>Zero-knowledge vault</b><span>Secrets are encrypted before they are saved and every view is audit-logged.</span></div>
            </div>
          </aside>
          <div className="crd-pickbody" ref={body} onScroll={spy}>
            {shown.map(g => (
              <section key={g.name} className="crd-grp" id={gid(g.name)} hidden={!g.hits.length}>
                <div className="crd-grp__t">
                  <span className="crd-grp__i"><Svg icon={g.icon || 'folder'} size={15} /></span>
                  <span className="crd-grp__txt"><b>{g.name}</b><small>{g.description}</small></span>
                  <span className="crd-grp__c">{term ? `${g.hits.length} of ${g.items.length}` : g.items.length} type{g.items.length === 1 ? '' : 's'}</span>
                </div>
                <div className="crd-tiles">
                  {g.hits.map(t => <Tile key={t.key} t={t} group={g.name} onPick={onPick} />)}
                </div>
              </section>
            ))}
            <div className="crd-none" hidden={any}>
              <Svg icon="search" size={22} />
              <b>No credential type matches</b>
              <span>Try a different word — e.g. “key”, “bank” or “id”.</span>
            </div>
          </div>
        </div>
        <div className="mapsup-footer">
          <div className="mapsup-footer__info">
            <Svg d='<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01"/>' size={13} /> Pick a type to open its form — only the fields that type needs are shown
          </div>
          <div className="mapsup-footer__actions">
            <button type="button" className="crd-cancel" onClick={onClose}><Svg icon="x" size={13} sw={2.6} />Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
