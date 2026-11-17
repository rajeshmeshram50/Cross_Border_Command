import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SVC_TYPES, type ServiceKind, type ServiceTab, type OtherType } from './serviceData';
import { SVC_ICONS } from './serviceIcons';
import './service-form.css';

export default function ServiceTypeGate({
  onClose, onChoose,
}: {
  onClose: () => void;
  onChoose: (kind: ServiceKind, otype?: OtherType) => void;
}) {
  const [open, setOpen] = useState<ServiceTab | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const pick = (k: ServiceTab) => {
    if (k === 'soft') { onChoose('soft'); return; }
    setOpen(o => (o === k ? null : k));
  };

  const go = (top: ServiceTab, sub: string) => {
    if (top === 'material') onChoose(sub as ServiceKind);
    else onChoose('other', sub as OtherType);
  };

  const cards: Array<{ k: ServiceTab; no: string; title: string; desc: string; chips: ReactNode[] }> = [
    { k: 'material', no: '01', title: SVC_TYPES.material.l, desc: 'Physical goods, equipment, assets and consumables purchased for internal use.', chips: ['Trackable', 'Consumable'] },
    { k: 'soft', no: '02', title: SVC_TYPES.soft.l, desc: 'Software, platforms, subscriptions, APIs, licences and cloud services.', chips: ['Licences', 'SaaS', 'Cloud', 'APIs'] },
    { k: 'other', no: '03', title: SVC_TYPES.other.l, desc: 'Professional, utility, facility, maintenance and outsourced services.', chips: ['Professional', 'Utility', 'Facility', <span key="more" className="stg-inc-more" title="Maintenance · Outsourcing">+2</span>] },
  ];
  const T = open ? SVC_TYPES[open] : null;

  return createPortal((
    <div className="svf-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="svg-modal stg-modal" role="dialog" aria-modal="true" aria-label="Add Service">
        <div className="svf-head">
          <div className="svf-head-left">
            <div className="svf-head-icon">{SVC_ICONS.wrench}</div>
            <div>
              <div className="svf-title">Add Service</div>
              <div className="svf-sub">Choose the primary service type, then its classification.</div>
            </div>
          </div>
          <button type="button" className="svf-close" onClick={onClose} aria-label="Close">{SVC_ICONS.x}</button>
        </div>

        <div className="svg-body">
          <div className="stg-cards">
            {cards.map(c => {
              const ico = SVC_ICONS[c.k === 'material' ? 'self' : c.k];
              return (
                <button key={c.k} type="button" className={`stg-card${open === c.k ? ' is-active' : ''}`} onClick={() => pick(c.k)}>
                  <span className="stg-card-wm" aria-hidden="true">{ico}</span>
                  <span className="stg-card-no" aria-hidden="true">{c.no}</span>
                  <span className="stg-card-top">
                    <span className="stg-card-ico">{ico}</span>
                    <span className="stg-card-title">{c.title}</span>
                  </span>
                  <span className="stg-card-desc">{c.desc}</span>
                  <span className="stg-inc">
                    <span className="stg-inc-lbl">Includes</span>
                    <span className="stg-inc-items">
                      {c.chips.map((ch, i) => (
                        <span key={i} className="stg-inc-item">{i > 0 && <i className="stg-inc-dot">·</i>}{ch}</span>
                      ))}
                    </span>
                    <span className="stg-inc-go">{SVC_ICONS.chevron}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {open && T && (
            <div className="stg-panel" style={{ '--stg-col': cards.findIndex(c => c.k === open) } as CSSProperties}>
              <div className="stg-panel-head">
                <span className="stg-panel-ico">{SVC_ICONS[open === 'material' ? 'self' : open]}</span>
                <div className="stg-panel-txt">
                  <b>{T.l} · {T.cls}</b>
                  <span>{T.desc}</span>
                </div>
              </div>
              <div className={`stg-subgrid${T.subs.length > 3 ? ' stg-subgrid--many' : ''}`} style={{ '--stg-n': T.subs.length } as CSSProperties}>
                {T.subs.map(s => {
                  const ico = SVC_ICONS[s.k as keyof typeof SVC_ICONS];
                  return (
                    <button key={s.k} type="button" className="stg-card stg-sub" onClick={() => go(open, s.k)}>
                      <span className="stg-card-wm" aria-hidden="true">{ico}</span>
                      <span className="stg-card-top">
                        <span className="stg-card-ico">{ico}</span>
                        <span className="stg-card-title">{open === 'material' ? s.full : s.l}</span>
                      </span>
                      <span className="stg-card-desc">{s.d}</span>
                      <span className="stg-sub-go">Continue {SVC_ICONS.chevron}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="svf-foot">
          <div className="svf-foot-left">
            <span className="stg-progress">
              <span className="stg-progress-steps" aria-hidden="true">
                <i className="is-on" /><b className={open ? 'is-on' : ''} /><i className={open ? 'is-on' : ''} />
              </span>
              {open ? `Now choose the ${SVC_TYPES[open].short.toLowerCase()} classification.` : 'Choose a primary service type to continue.'}
            </span>
          </div>
          <div className="svf-foot-right">
            <button type="button" className="svf-btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}
