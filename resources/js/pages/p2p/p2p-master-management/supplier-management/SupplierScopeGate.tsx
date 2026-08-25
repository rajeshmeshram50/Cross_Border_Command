import { useEffect } from 'react';

/**
 * SupplierScopeGate — the Domestic / International question that now stands in
 * front of "Add Supplier".
 *
 * Ported from the P2P prototype's "Create New Procurement" gate
 * (`smtOpenProcurementGate` in P2P_Main_Journey.html) — same structure and
 * motion, recoloured into the violet family the Supplier page already runs
 * on. The prototype's cyan header and amber card were the only things on
 * this screen not in that family. The two choices stay distinguishable by
 * moving along the family (violet vs indigo) instead of leaving it.
 *
 * It exists because the answer changes the FORM, not just a label — a domestic
 * supplier is an India/GST entity and an international one is explicitly not,
 * so Country cannot offer the same list to both. Asking once up front is what
 * lets the form stop guessing.
 *
 * Deliberately NOT shown when editing: an existing supplier's scope is already
 * settled by the country on record, and re-asking would invite someone to flip
 * it by accident.
 */

export type SupplierScope = 'domestic' | 'international';

type Props = {
  onChoose: (scope: SupplierScope) => void;
  onClose: () => void;
};

const SCOPED_CSS = `
.ssg-bd {
  position: fixed; inset: 0; z-index: 1090;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  background: rgba(46, 16, 101, 0.45);
  backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
  animation: ssgFade .18s ease;
}
@keyframes ssgFade { from { opacity: 0 } to { opacity: 1 } }
@keyframes ssgUp { from { opacity: 0; transform: translateY(14px) scale(.97) } to { opacity: 1; transform: none } }

.ssg-box {
  width: 780px; max-width: 96vw;
  background: #fff; border-radius: 22px; overflow: hidden;
  box-shadow: 0 1px 0 rgba(255,255,255,.7) inset,
              0 50px 110px -25px rgba(46,16,101,.55),
              0 0 0 1px rgba(46,16,101,.06);
  animation: ssgUp .3s cubic-bezier(.16,1,.3,1) both;
}

/* ── Header ── */
.ssg-head {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 14px;
  padding: 13px 20px; color: #fff;
  /* The exact header gradient the Add Supplier form uses (.avm-head). This
     gate opens that form, so the two are seen one after the other — a
     different violet ramp between them reads as two different products.
     The old ramp also ended on #a78bfa, which is pale enough that the
     white close button and the title lost their contrast on the right
     third of the bar. This one tops out at #8b5cf6 and holds. */
  background: linear-gradient(115deg, #4c1d95 0%, #5b21b6 28%, #6d28d9 55%, #7c3aed 80%, #8b5cf6 100%);
}
.ssg-head::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(rgba(255,255,255,.16) 1px, transparent 1.4px);
  background-size: 18px 18px; opacity: .45;
  -webkit-mask-image: linear-gradient(105deg, transparent 40%, #000 100%);
  mask-image: linear-gradient(105deg, transparent 40%, #000 100%);
}
.ssg-head::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(circle at 92% -60%, rgba(255,255,255,.4), transparent 50%);
}
.ssg-accent {
  position: absolute; left: 0; right: 0; bottom: 0; height: 3px; opacity: .9;
  background: linear-gradient(90deg,#a78bfa,#c4b5fd 45%,#ddd6fe 100%);
}
.ssg-head-ico {
  position: relative; z-index: 1; width: 40px; height: 40px; border-radius: 13px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  font-size: 18px;
  background: linear-gradient(145deg, rgba(255,255,255,.28), rgba(255,255,255,.1));
  box-shadow: 0 0 0 1px rgba(255,255,255,.3) inset, 0 8px 20px rgba(0,0,0,.2);
}
.ssg-head-txt { position: relative; z-index: 1; min-width: 0; flex: 1; }
.ssg-eyebrow {
  font-size: 9.5px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase;
  color: rgba(255,255,255,.65); margin-bottom: 3px;
}
.ssg-title { font-size: 17px; font-weight: 800; letter-spacing: -.3px; }
.ssg-sub { font-size: 11.5px; font-weight: 500; color: rgba(255,255,255,.82); margin-top: 3px; }
.ssg-cl {
  position: relative; z-index: 1; width: 30px; height: 30px; border-radius: 9px;
  border: 1.5px solid rgba(255,255,255,.3); background: rgba(255,255,255,.14);
  color: #fff; cursor: pointer; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 14px;
  transition: all .18s;
}
.ssg-cl:hover { background: rgba(255,255,255,.26); transform: rotate(90deg); }

/* ── The two choices ── */
.ssg-body {
  display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
  padding: 18px 20px 18px;
  background: linear-gradient(180deg,#faf5ff,#fff 45%);
}
@media (max-width: 560px) { .ssg-body { grid-template-columns: 1fr; } }

.ssg-card {
  position: relative; overflow: hidden; isolation: isolate;
  display: flex; flex-direction: column; align-items: flex-start; text-align: left;
  padding: 16px 18px 15px; border-radius: 16px;
  background: #fff; border: 1.5px solid #edf1f6; cursor: pointer;
  font-family: inherit;
  transition: all .22s cubic-bezier(.22,1,.36,1);
}
.ssg-card::before {
  content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px;
  background: var(--sg-accent, #cbd5e1); opacity: 0; transition: opacity .22s;
}
.ssg-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--sg-shadow, 0 14px 30px -12px rgba(15,23,42,.18));
  border-color: var(--sg-border, #dbe4ee);
}
.ssg-card:hover::before { opacity: 1; }
.ssg-card:focus-visible { outline: 2px solid #7c3aed; outline-offset: 2px; }

.ssg-card--dom {
  --sg-accent: linear-gradient(90deg,#7c3aed,#a78bfa);
  --sg-shadow: 0 16px 34px -12px rgba(124,58,237,.32);
  --sg-border: #c4b5fd;
}
.ssg-card--intl {
  --sg-accent: linear-gradient(90deg,#4338ca,#818cf8);
  --sg-shadow: 0 16px 34px -12px rgba(67,56,202,.32);
  --sg-border: #a5b4fc;
}

.ssg-card__wm {
  position: absolute; top: -22px; right: -18px; font-size: 100px; line-height: 1;
  opacity: .05; pointer-events: none; transition: opacity .22s, transform .3s;
}
.ssg-card--dom  .ssg-card__wm { color: #7c3aed; }
.ssg-card--intl .ssg-card__wm { color: #4338ca; }
.ssg-card:hover .ssg-card__wm { opacity: .09; transform: scale(1.06) rotate(4deg); }

.ssg-card__top {
  position: relative; z-index: 1;
  display: flex; align-items: center; justify-content: space-between; width: 100%;
}
.ssg-card__ico {
  width: 42px; height: 42px; border-radius: 13px; flex-shrink: 0; color: #fff;
  display: flex; align-items: center; justify-content: center; font-size: 19px;
  transition: transform .22s;
}
.ssg-card--dom .ssg-card__ico {
  background: linear-gradient(135deg,#a78bfa,#7c3aed);
  box-shadow: 0 8px 18px -6px rgba(124,58,237,.55), inset 0 1px 0 rgba(255,255,255,.35);
}
.ssg-card--intl .ssg-card__ico {
  background: linear-gradient(135deg,#818cf8,#4338ca);
  box-shadow: 0 8px 18px -6px rgba(67,56,202,.55), inset 0 1px 0 rgba(255,255,255,.35);
}
.ssg-card:hover .ssg-card__ico { transform: scale(1.07) rotate(-3deg); }

.ssg-card__tag {
  font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  padding: 4px 9px; border-radius: 999px;
}
.ssg-card--dom  .ssg-card__tag { background: #ede9fe; color: #5b21b6; }
.ssg-card--intl .ssg-card__tag { background: #e0e7ff; color: #312e81; }

.ssg-card__title {
  position: relative; z-index: 1; margin-top: 11px;
  font-size: 15px; font-weight: 800; color: #0f172a; letter-spacing: -.2px;
}
.ssg-card__desc {
  position: relative; z-index: 1; margin-top: 5px;
  font-size: 11.5px; font-weight: 600; color: #64748b; line-height: 1.5;
}
.ssg-card__cta {
  position: relative; z-index: 1; margin-top: 12px;
  display: flex; align-items: center; gap: 6px;
  font-size: 11.5px; font-weight: 800;
}
.ssg-card--dom  .ssg-card__cta { color: #6d28d9; }
.ssg-card--intl .ssg-card__cta { color: #3730a3; }
.ssg-card__cta i { transition: transform .2s; }
.ssg-card:hover .ssg-card__cta i { transform: translateX(4px); }

/* ── Footer ── */
.ssg-foot {
  display: flex; align-items: center; justify-content: flex-end;
  padding: 10px 20px; border-top: 1px solid #ede9fe; background: #faf8ff;
  font-size: 11px; font-weight: 600; color: #7e6fa3;
}
.ssg-cancel {
  font-family: inherit; font-size: 11.5px; font-weight: 800; color: #6d28d9;
  background: #fff; border: 1.5px solid #ddd6fe; border-radius: 10px;
  padding: 7px 15px; cursor: pointer; transition: all .15s;
}
.ssg-cancel:hover { background: #f5f3ff; border-color: #c4b5fd; }

[data-bs-theme="dark"] .ssg-box,
[data-layout-mode="dark"] .ssg-box { background: var(--vz-card-bg); }
[data-bs-theme="dark"] .ssg-body,
[data-layout-mode="dark"] .ssg-body { background: var(--vz-card-bg); }
[data-bs-theme="dark"] .ssg-card,
[data-layout-mode="dark"] .ssg-card {
  background: var(--vz-card-bg); border-color: var(--vz-border-color);
}
[data-bs-theme="dark"] .ssg-card__title,
[data-layout-mode="dark"] .ssg-card__title { color: var(--vz-heading-color, #fff); }
[data-bs-theme="dark"] .ssg-foot,
[data-layout-mode="dark"] .ssg-foot {
  background: rgba(255,255,255,.03); border-top-color: var(--vz-border-color);
}
[data-bs-theme="dark"] .ssg-cancel,
[data-layout-mode="dark"] .ssg-cancel {
  background: transparent; color: var(--vz-body-color); border-color: var(--vz-border-color);
}
`;

export default function SupplierScopeGate({ onChoose, onClose }: Props) {
  // Esc closes, and the page behind must not scroll while this is up. The
  // lock has to cover <html> as well as <body> — body alone leaves the
  // document element scrolling behind the backdrop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);

    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [onClose]);

  return (
    <>
      <style>{SCOPED_CSS}</style>
      <div className="ssg-bd" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="ssg-box" role="dialog" aria-modal="true" aria-label="Choose supplier scope">
          <div className="ssg-head">
            <div className="ssg-head-ico"><i className="ri-add-line" /></div>
            <div className="ssg-head-txt">
              <div className="ssg-eyebrow">Procure to Pay · IDIMS</div>
              <div className="ssg-title">Add New Supplier</div>
              <div className="ssg-sub">Is this a domestic or international supplier?</div>
            </div>
            <button type="button" className="ssg-cl" onClick={onClose} aria-label="Close">
              <i className="ri-close-line" />
            </button>
            <span className="ssg-accent" />
          </div>

          <div className="ssg-body">
            <button type="button" className="ssg-card ssg-card--dom" onClick={() => onChoose('domestic')}>
              <span className="ssg-card__wm"><i className="ri-home-4-line" /></span>
              <span className="ssg-card__top">
                <span className="ssg-card__ico"><i className="ri-home-4-line" /></span>
                <span className="ssg-card__tag">India · GST</span>
              </span>
              <span className="ssg-card__title">Domestic Supplier</span>
              <span className="ssg-card__desc">
                An India-registered vendor — GST and PAN apply, and Country is locked to India.
              </span>
              <span className="ssg-card__cta">Continue<i className="ri-arrow-right-s-line" /></span>
            </button>

            <button type="button" className="ssg-card ssg-card--intl" onClick={() => onChoose('international')}>
              <span className="ssg-card__wm"><i className="ri-global-line" /></span>
              <span className="ssg-card__top">
                <span className="ssg-card__ico"><i className="ri-global-line" /></span>
                <span className="ssg-card__tag">Import · Customs</span>
              </span>
              <span className="ssg-card__title">International Supplier</span>
              <span className="ssg-card__desc">
                An overseas vendor — Country lists every country except India, and GST does not apply.
              </span>
              <span className="ssg-card__cta">Continue<i className="ri-arrow-right-s-line" /></span>
            </button>
          </div>

          {/* Cancel alone. The hint that used to sit here restated the header's
              own question, and the two cards below it already say "Continue". */}
          <div className="ssg-foot">
            <button type="button" className="ssg-cancel" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </>
  );
}
